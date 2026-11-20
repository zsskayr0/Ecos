//! Integridade da escrita de notas: trava por nota, gravação atômica, `versao` (conflito otimista) e
//! histórico de versões (snapshots).
//!
//! - **Trava**: um `tokio::sync::Mutex` por id de nota, cobrindo ler → alterar → gravar. Só protege
//!   escritas que passam pelo servidor; edição externa no disco continua possível (o watcher reindexa).
//! - **Gravação atômica**: `.<nome>.tmp` no mesmo diretório, `sync_all`, `rename` por cima.
//! - **`versao`**: contador inteiro no front-matter (chave `versao`, guardada em `extras`, então o tipo do
//!   core não muda). Ausente = 0. Toda gravação feita por este módulo soma 1. Edições externas que não
//!   mexem na chave não mudam a versão (limitação conhecida).
//! - **Snapshots**: `<notes_root>/.ecos/versoes/<id>/<ms>-<motivo>.snap`, com o `.md` inteiro. Fora das
//!   árvores `Notas/`/`Tarefas/`, então o índice e o explorador não os enxergam. Retenção por
//!   `ECOS_VERSOES_DIAS` (padrão 30) e `ECOS_VERSOES_MAX` (padrão 200 por nota).

use axum::extract::{Path, State};
use axum::{Extension, Json};
use chrono::{DateTime, TimeZone, Utc};
use ecos_core::types::NotaFrontMatter;
use ecos_core::{frontmatter, ErrorCode};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path as FsPath, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use crate::db::reindex_incremental::{reindexar_itens, Mudanca};
use crate::error::{AppError, AppResult};
use crate::middleware::auth_guard::UsuarioAutenticado;
use crate::state::AppState;

// --- Trava por nota ---------------------------------------------------------

type Travas = Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>;

fn travas() -> &'static Travas {
    static T: OnceLock<Travas> = OnceLock::new();
    T.get_or_init(Default::default)
}

/// Segura a trava da nota `id` até o guard cair. Não é reentrante: não chame duas vezes no mesmo fluxo.
pub async fn travar(id: &str) -> tokio::sync::OwnedMutexGuard<()> {
    let m = {
        let mut mapa = travas().lock().unwrap_or_else(|e| e.into_inner());
        // Limpa travas que ninguém está usando, para o mapa não crescer sem fim.
        mapa.retain(|_, m| Arc::strong_count(m) > 1);
        mapa.entry(id.to_string()).or_default().clone()
    };
    m.lock_owned().await
}

// --- E/S ----------------------------------------------------------------------

fn gravar_atomico_sync(destino: &FsPath, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let dir = destino.parent().unwrap_or_else(|| FsPath::new("."));
    let nome = destino.file_name().and_then(|n| n.to_str()).unwrap_or("nota.md");
    let tmp = dir.join(format!(".{nome}.tmp"));
    let resultado = (|| {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        std::fs::rename(&tmp, destino)
    })();
    if resultado.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    resultado
}

/// Grava `bytes` em `destino` sem nunca deixar um arquivo pela metade (tmp + fsync + rename), fora do runtime.
pub async fn gravar_atomico(destino: PathBuf, bytes: Vec<u8>) -> AppResult<()> {
    tokio::task::spawn_blocking(move || gravar_atomico_sync(&destino, &bytes))
        .await
        .map_err(|_| AppError::new(ErrorCode::InternalError))??;
    Ok(())
}

pub async fn ler(caminho: &FsPath) -> AppResult<String> {
    Ok(tokio::fs::read_to_string(caminho).await?)
}

// --- versao -----------------------------------------------------------------

pub fn versao(fm: &NotaFrontMatter) -> u64 {
    fm.extras.get("versao").and_then(|v| v.as_u64()).unwrap_or(0)
}

/// Soma 1 na versão e devolve a nova.
pub fn incrementar(fm: &mut NotaFrontMatter) -> u64 {
    let nova = versao(fm) + 1;
    fm.extras.insert("versao".into(), serde_yaml::Value::Number(nova.into()));
    nova
}

/// 409 se `base` veio e não bate com a versão atual. `None` = cliente antigo, sem checagem.
pub fn checar_base(base: Option<u64>, fm: &NotaFrontMatter, corpo: &str) -> AppResult<()> {
    match base {
        Some(b) if b != versao(fm) => Err(AppError::new(ErrorCode::Conflict).with_message("Esta nota mudou em outro lugar.").with_extra(
            "atual",
            serde_json::json!({ "titulo": fm.titulo, "corpo": corpo, "versao": versao(fm), "atualizado_em": fm.atualizado_em }),
        )),
        _ => Ok(()),
    }
}

// --- Snapshots ----------------------------------------------------------------

pub const INTERVALO_PERIODICO_MIN: i64 = 10;
const MOTIVOS: [&str; 4] = ["periodico", "reducao", "fechamento", "restauracao"];

fn dir_versoes(state: &AppState, id: &str) -> PathBuf {
    state.config.notes_root.join(".ecos").join("versoes").join(id)
}

fn env_num(chave: &str, padrao: i64) -> i64 {
    std::env::var(chave).ok().and_then(|v| v.trim().parse().ok()).filter(|v: &i64| *v > 0).unwrap_or(padrao)
}

struct Entrada {
    id: String,
    ms: i64,
    motivo: String,
    tamanho: u64,
    caminho: PathBuf,
}

/// Snapshots da nota, mais recente primeiro. Nomes fora do padrão são ignorados.
fn listar_sync(dir: &FsPath) -> Vec<Entrada> {
    let mut v: Vec<Entrada> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let caminho = e.path();
            let stem = caminho.file_name()?.to_str()?.strip_suffix(".snap")?.to_string();
            let (ms, motivo) = stem.split_once('-')?;
            let ms: i64 = ms.parse().ok()?;
            if !MOTIVOS.contains(&motivo) {
                return None;
            }
            Some(Entrada { motivo: motivo.to_string(), ms, tamanho: e.metadata().ok()?.len(), caminho, id: stem })
        })
        .collect();
    v.sort_by(|a, b| b.ms.cmp(&a.ms).then(b.id.cmp(&a.id)));
    v
}

fn podar(entradas: Vec<Entrada>) {
    let max = env_num("ECOS_VERSOES_MAX", 200) as usize;
    let limite = Utc::now().timestamp_millis() - env_num("ECOS_VERSOES_DIAS", 30) * 86_400_000;
    for (i, e) in entradas.into_iter().enumerate() {
        if i >= max || e.ms < limite {
            let _ = std::fs::remove_file(&e.caminho);
        }
    }
}

/// Guarda `conteudo` (o `.md` inteiro) como snapshot. Chamar com a trava da nota na mão.
pub async fn tirar_snapshot(state: &AppState, id: &str, conteudo: String, motivo: &'static str) -> AppResult<()> {
    let dir = dir_versoes(state, id);
    tokio::task::spawn_blocking(move || -> std::io::Result<()> {
        std::fs::create_dir_all(&dir)?;
        let mut ms = Utc::now().timestamp_millis();
        // Dois snapshots no mesmo milissegundo com o mesmo motivo: empurra 1 ms.
        while dir.join(format!("{ms}-{motivo}.snap")).exists() {
            ms += 1;
        }
        gravar_atomico_sync(&dir.join(format!("{ms}-{motivo}.snap")), conteudo.as_bytes())?;
        podar(listar_sync(&dir));
        Ok(())
    })
    .await
    .map_err(|_| AppError::new(ErrorCode::InternalError))??;
    Ok(())
}

/// Regras automáticas antes de gravar um corpo novo: redução > 80% (ou esvaziar) e periódico a cada 10 min.
pub async fn snapshot_antes_de_gravar(state: &AppState, id: &str, bruto_atual: &str, corpo_atual: &str, corpo_novo: &str) -> AppResult<()> {
    if corpo_atual == corpo_novo || corpo_atual.trim().is_empty() {
        return Ok(());
    }
    let reduziu = corpo_novo.trim().is_empty() || (corpo_novo.len() as f64) < (corpo_atual.len() as f64) * 0.2;
    if reduziu {
        return tirar_snapshot(state, id, bruto_atual.to_string(), "reducao").await;
    }
    let dir = dir_versoes(state, id);
    let ultimo = tokio::task::spawn_blocking(move || listar_sync(&dir).first().map(|e| e.ms)).await.ok().flatten();
    let agora = Utc::now().timestamp_millis();
    if ultimo.is_none_or(|ms| agora - ms >= INTERVALO_PERIODICO_MIN * 60_000) {
        tirar_snapshot(state, id, bruto_atual.to_string(), "periodico").await?;
    }
    Ok(())
}

fn data(ms: i64) -> DateTime<Utc> {
    Utc.timestamp_millis_opt(ms).single().unwrap_or_else(Utc::now)
}

// --- Rotas --------------------------------------------------------------------

#[derive(Serialize)]
pub struct VersaoResumo {
    id: String,
    criado_em: DateTime<Utc>,
    tamanho_bytes: u64,
    motivo: String,
}

pub async fn listar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(id): Path<String>) -> AppResult<Json<Vec<VersaoResumo>>> {
    crate::routes::notas::caminho_por_id(&state, &usuario.0, &id).await?;
    let dir = dir_versoes(&state, &id);
    let v = tokio::task::spawn_blocking(move || listar_sync(&dir)).await.map_err(|_| AppError::new(ErrorCode::InternalError))?;
    Ok(Json(v.into_iter().map(|e| VersaoResumo { criado_em: data(e.ms), tamanho_bytes: e.tamanho, motivo: e.motivo, id: e.id }).collect()))
}

async fn ler_snapshot(state: &AppState, id: &str, vid: &str) -> AppResult<(i64, frontmatter::ParsedDocument<NotaFrontMatter>)> {
    let dir = dir_versoes(state, id);
    let vid_owned = vid.to_string();
    let e = tokio::task::spawn_blocking(move || listar_sync(&dir).into_iter().find(|e| e.id == vid_owned))
        .await
        .map_err(|_| AppError::new(ErrorCode::InternalError))?
        .ok_or(AppError::new(ErrorCode::NotFound))?;
    let bruto = ler(&e.caminho).await?;
    Ok((e.ms, frontmatter::parse::<NotaFrontMatter>(&bruto)?))
}

pub async fn obter(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path((id, vid)): Path<(String, String)>) -> AppResult<Json<serde_json::Value>> {
    crate::routes::notas::caminho_por_id(&state, &usuario.0, &id).await?;
    let (ms, doc) = ler_snapshot(&state, &id, &vid).await?;
    Ok(Json(serde_json::json!({ "id": vid, "criado_em": data(ms), "titulo": doc.front_matter.titulo, "corpo": doc.body })))
}

/// POST `/notas/:id/versoes` — o cliente chama ao fechar a nota. Não duplica se nada mudou desde o último snapshot.
pub async fn criar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let caminho = state.config.notes_root.join(crate::routes::notas::caminho_por_id(&state, &usuario.0, &id).await?);
    let _trava = travar(&id).await;
    let bruto = ler(&caminho).await?;
    let dir = dir_versoes(&state, &id);
    let ultimo = tokio::task::spawn_blocking(move || listar_sync(&dir).into_iter().next()).await.ok().flatten();
    let igual = match ultimo {
        Some(e) => tokio::fs::read_to_string(&e.caminho).await.map(|s| s == bruto).unwrap_or(false),
        None => false,
    };
    if !igual {
        tirar_snapshot(&state, &id, bruto, "fechamento").await?;
    }
    Ok(Json(serde_json::json!({ "ok": true, "criado": !igual })))
}

/// POST `/notas/:id/versoes/:vid/restaurar` — guarda o atual (motivo `restauracao`) e grava o título e o corpo da versão.
/// Pasta, espaço, tags e demais propriedades ficam como estão hoje.
pub async fn restaurar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path((id, vid)): Path<(String, String)>) -> AppResult<Json<serde_json::Value>> {
    let relativo = crate::routes::notas::caminho_por_id(&state, &usuario.0, &id).await?;
    let caminho = state.config.notes_root.join(&relativo);
    let _trava = travar(&id).await;
    let (_, snap) = ler_snapshot(&state, &id, &vid).await?;
    let bruto = ler(&caminho).await?;
    let doc = frontmatter::parse::<NotaFrontMatter>(&bruto)?;
    tirar_snapshot(&state, &id, bruto, "restauracao").await?;
    let mut fm = doc.front_matter;
    if fm.titulo != snap.front_matter.titulo {
        let antes = fm.titulo.clone();
        fm.titulo = snap.front_matter.titulo.clone();
        ecos_core::naming::atualizar_aliases(&mut fm.aliases, Some(&antes), &fm.titulo.clone());
    }
    fm.atualizado_em = Utc::now();
    let nova = incrementar(&mut fm);
    gravar_atomico(caminho, frontmatter::serialize(&fm, &snap.body)?.into_bytes()).await?;
    reindexar_itens(&state.db, &state.config.notes_root, &[Mudanca::Escrito(relativo)]).await?;
    Ok(Json(serde_json::json!({ "id": fm.id, "titulo": fm.titulo, "corpo": snap.body, "versao": nova, "atualizado_em": fm.atualizado_em })))
}
