//! Pastas trancadas (`/seguro/*`): qualquer pasta do espaço pessoal pode ser trancada com senha, e as pastas-filhas vão junto.
//!
//! Decisões (2026-11-17):
//! - O bloqueio é do **servidor**, não cifra: os arquivos seguem `.md` em texto claro no PC da pessoa. Pasta trancada fecha
//!   a leitura, a escrita e a busca por todo o app; o nome da pasta continua aparecendo (com cadeado).
//! - **Um só nível**: não se tranca uma pasta dentro de outra já trancada (nem uma que contenha pastas trancadas).
//! - **Senha-mestra + senhas próprias**: por padrão uma pasta usa a mestra; opcionalmente ganha senha própria. Destrancar abre
//!   tudo que usa aquela mesma senha ("grupo": `mestra`, ou o caminho da pasta de senha própria).
//! - O estado "aberto" mora na tabela `pasta_aberta` (por pessoa, vale em todos os aparelhos) e expira por inatividade:
//!   cada acesso a conteúdo trancado renova o prazo. Estar no banco deixa o filtro de visibilidade (`espacos`) consultá-lo em SQL.

use axum::extract::State;
use axum::{Extension, Json};
use chrono::Utc;
use ecos_core::ErrorCode;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::auth::password;
use crate::error::{AppError, AppResult, CampoInvalido};
use crate::middleware::auth_guard::UsuarioAutenticado;
use crate::state::AppState;

pub const MINUTOS_PADRAO: i64 = 5;
const MINUTOS_MAXIMO: i64 = 1440;
/// Nome do grupo da senha-mestra (as de senha própria usam o caminho da pasta).
const MESTRA: &str = "mestra";
const AGORA: &str = "CAST(strftime('%s', 'now') AS INTEGER)";

fn campo(campo: &str, motivo: &str) -> AppError {
    AppError::validation(vec![CampoInvalido { campo: campo.into(), motivo: motivo.into() }])
}

fn validar_senha(senha: &str, nome: &str) -> AppResult<()> {
    if !(8..=128).contains(&senha.chars().count()) {
        return Err(campo(nome, "use de 8 a 128 caracteres"));
    }
    if senha.chars().any(char::is_control) {
        return Err(campo(nome, "não use caracteres de controle"));
    }
    Ok(())
}

fn validar_minutos(minutos: i64) -> AppResult<()> {
    if (1..=MINUTOS_MAXIMO).contains(&minutos) { Ok(()) } else { Err(campo("minutos", "use de 1 a 1440 minutos")) }
}

async fn hash_em_thread(senha: String) -> AppResult<String> {
    tokio::task::spawn_blocking(move || password::hash(&senha)).await.map_err(|_| AppError::new(ErrorCode::InternalError))?
}

async fn verificar_em_thread(senha: String, hash: String) -> bool {
    tokio::task::spawn_blocking(move || password::verify(&senha, &hash)).await.unwrap_or(false)
}

/// Normaliza o caminho de pasta vindo do cliente: sem barras nas pontas, sem `..`, sem partes internas/ocultas.
pub fn normalizar_pasta(bruto: &str) -> Option<String> {
    let p = bruto.trim().trim_matches('/').replace('\\', "/");
    if p.is_empty() || !crate::espacos::caminho_relativo_seguro(&p) || p.split('/').any(|s| s.is_empty() || crate::espacos::nome_interno(s)) {
        return None;
    }
    Some(p)
}

// ---------------------------------------------------------------------------------------------------------------
// Leitura do estado
// ---------------------------------------------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct Mestra {
    pub configurada: bool,
    pub aberta: bool,
    pub minutos: i64,
    pub restante_s: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct PastaTrancada {
    pub pasta: String,
    /// Tem senha própria (senão usa a mestra).
    pub propria: bool,
    pub aberta: bool,
    pub minutos: i64,
    pub restante_s: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct Estado {
    pub mestra: Mestra,
    pub mostrar_tarefas: bool,
    pub pastas: Vec<PastaTrancada>,
}

struct Linha {
    pasta: String,
    propria: bool,
    minutos_proprios: Option<i64>,
}

fn ler_estado(conn: &rusqlite::Connection, uid: &str) -> rusqlite::Result<Estado> {
    let agora: i64 = conn.query_row(&format!("SELECT {AGORA}"), [], |r| r.get(0))?;
    let cfg: Option<i64> = conn.query_row("SELECT minutos FROM seguro_config WHERE usuario_id = ?1", [uid], |r| r.get(0)).optional()?;
    let mut abertas: HashMap<String, i64> = HashMap::new();
    let mut st = conn.prepare("SELECT grupo, ate FROM pasta_aberta WHERE usuario_id = ?1 AND ate > ?2")?;
    for r in st.query_map(rusqlite::params![uid, agora], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))? {
        let (g, ate) = r?;
        abertas.insert(g, ate - agora);
    }
    let mut st = conn.prepare("SELECT pasta, senha_hash IS NOT NULL, minutos FROM pasta_trancada WHERE usuario_id = ?1 ORDER BY pasta")?;
    let linhas: Vec<Linha> = st.query_map([uid], |r| Ok(Linha { pasta: r.get(0)?, propria: r.get(1)?, minutos_proprios: r.get(2)? }))?.collect::<Result<_, _>>()?;
    let mostrar: Option<bool> = conn.query_row("SELECT mostrar_tarefas FROM seguro_preferencia WHERE usuario_id = ?1", [uid], |r| r.get(0)).optional()?;
    let minutos_mestra = cfg.unwrap_or(MINUTOS_PADRAO);
    let restante_mestra = abertas.get(MESTRA).copied();
    Ok(Estado {
        mestra: Mestra { configurada: cfg.is_some(), aberta: restante_mestra.is_some(), minutos: minutos_mestra, restante_s: restante_mestra },
        mostrar_tarefas: mostrar.unwrap_or(false),
        pastas: linhas
            .into_iter()
            .map(|l| {
                let (restante, minutos) = if l.propria { (abertas.get(&l.pasta).copied(), l.minutos_proprios.unwrap_or(MINUTOS_PADRAO)) } else { (restante_mestra, minutos_mestra) };
                PastaTrancada { pasta: l.pasta, propria: l.propria, aberta: restante.is_some(), minutos, restante_s: restante }
            })
            .collect(),
    })
}

async fn estado(state: &AppState, uid: &str) -> AppResult<Estado> {
    let uid = uid.to_string();
    Ok(state.db.with_read(move |conn| ler_estado(conn, &uid)).await?)
}

/// `GET /seguro/status` — não renova nada (só olhar não conta como uso).
pub async fn status(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>) -> AppResult<Json<Estado>> {
    Ok(Json(estado(&state, &usuario.0).await?))
}

// ---------------------------------------------------------------------------------------------------------------
// Guardas usadas pelo resto do servidor
// ---------------------------------------------------------------------------------------------------------------

/// Tranca que cobre `pasta` (ela mesma ou uma ancestral): `(pasta da tranca, grupo, minutos)`.
fn tranca_que_cobre(conn: &rusqlite::Connection, uid: &str, pasta: &str) -> rusqlite::Result<Option<(String, String, i64)>> {
    let linha: Option<(String, bool, Option<i64>)> = conn
        .query_row(
            "SELECT pasta, senha_hash IS NOT NULL, minutos FROM pasta_trancada WHERE usuario_id = ?1 \
             AND (?2 = pasta OR substr(?2, 1, length(pasta) + 1) = pasta || '/') LIMIT 1",
            rusqlite::params![uid, pasta],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    let Some((raiz, propria, minutos)) = linha else { return Ok(None) };
    if propria {
        Ok(Some((raiz.clone(), raiz, minutos.unwrap_or(MINUTOS_PADRAO))))
    } else {
        let m: Option<i64> = conn.query_row("SELECT minutos FROM seguro_config WHERE usuario_id = ?1", [uid], |r| r.get(0)).optional()?;
        Ok(Some((raiz, MESTRA.to_string(), m.unwrap_or(MINUTOS_PADRAO))))
    }
}

/// Renova o prazo de um grupo aberto; `false` se está trancado (ou expirou).
fn renovar(conn: &rusqlite::Connection, uid: &str, grupo: &str, minutos: i64) -> rusqlite::Result<bool> {
    let n = conn.execute(
        &format!("UPDATE pasta_aberta SET ate = {AGORA} + ?3 WHERE usuario_id = ?1 AND grupo = ?2 AND ate > {AGORA}"),
        rusqlite::params![uid, grupo, minutos * 60],
    )?;
    Ok(n > 0)
}

/// Exige que `pasta` (do espaço pessoal) não esteja numa pasta trancada e fechada. Pasta aberta tem o prazo renovado.
/// Só vale para o espaço `pessoal`; `pasta` `None`/vazia é a raiz (nunca trancada).
pub async fn exigir_pasta_aberta(state: &AppState, uid: &str, espaco: &str, pasta: Option<&str>) -> AppResult<()> {
    let Some(pasta) = pasta.map(|p| p.trim_matches('/')).filter(|p| !p.is_empty()) else { return Ok(()) };
    if espaco != "pessoal" {
        return Ok(());
    }
    let (u, p) = (uid.to_string(), pasta.to_string());
    let coberta = state.db.with_read(move |conn| tranca_que_cobre(conn, &u, &p)).await?;
    let Some((_, grupo, minutos)) = coberta else { return Ok(()) };
    let u = uid.to_string();
    let aberta = state.db.with(move |conn| renovar(conn, &u, &grupo, minutos)).await?;
    if aberta { Ok(()) } else { Err(AppError::new(ErrorCode::FolderLocked)) }
}

/// Recusa mexer (renomear, mover, excluir) numa pasta que **é** ou **contém** uma pasta trancada: o caminho guardado na tranca
/// ficaria apontando para o lugar errado e o conteúdo escaparia do cadeado. A pessoa tira o cadeado antes.
pub async fn exigir_sem_tranca_na_pasta(state: &AppState, uid: &str, espaco: &str, pasta: &str) -> AppResult<()> {
    let pasta = pasta.trim_matches('/');
    if espaco != "pessoal" || pasta.is_empty() {
        return Ok(());
    }
    let (u, p) = (uid.to_string(), pasta.to_string());
    let existe: bool = state
        .db
        .with_read(move |conn| conn.query_row("SELECT EXISTS(SELECT 1 FROM pasta_trancada WHERE usuario_id = ?1 AND (pasta = ?2 OR substr(pasta, 1, length(?2) + 1) = ?2 || '/'))", rusqlite::params![u, p], |r| r.get(0)))
        .await?;
    if existe {
        return Err(AppError::new(ErrorCode::Conflict).with_message("Esta pasta tem um cadeado (ou contém uma pasta trancada). Remova o cadeado antes de renomear, mover ou excluir."));
    }
    Ok(())
}

/// Pastas trancadas da pessoa (para a exportação ignorá-las e para mensagens).
pub async fn pastas_trancadas(state: &AppState, uid: &str) -> AppResult<Vec<String>> {
    let uid = uid.to_string();
    Ok(state
        .db
        .with_read(move |conn| {
            let mut st = conn.prepare("SELECT pasta FROM pasta_trancada WHERE usuario_id = ?1")?;
            let v = st.query_map([&uid], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
            Ok(v)
        })
        .await?)
}

/// Pastas-raiz de tranca que estão **fechadas** agora (para esconder o que há dentro delas, como os nomes das subpastas).
pub async fn raizes_fechadas(state: &AppState, uid: &str) -> AppResult<Vec<String>> {
    let uid = uid.to_string();
    Ok(state
        .db
        .with_read(move |conn| {
            let mut st = conn.prepare(&format!(
                "SELECT pt.pasta FROM pasta_trancada pt WHERE pt.usuario_id = ?1 AND NOT EXISTS (SELECT 1 FROM pasta_aberta pa \
                 WHERE pa.usuario_id = pt.usuario_id AND pa.grupo = CASE WHEN pt.senha_hash IS NULL THEN 'mestra' ELSE pt.pasta END AND pa.ate > {AGORA})"
            ))?;
            let v = st.query_map([&uid], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
            Ok(v)
        })
        .await?)
}

/// Se a pessoa quer ver tarefas de pastas trancadas (mascaradas) na Agenda/Hoje.
pub async fn mostrar_tarefas_trancadas(state: &AppState, uid: &str) -> AppResult<bool> {
    let uid = uid.to_string();
    let v: Option<bool> = state.db.with_read(move |conn| conn.query_row("SELECT mostrar_tarefas FROM seguro_preferencia WHERE usuario_id = ?1", [&uid], |r| r.get(0)).optional()).await?;
    Ok(v.unwrap_or(false))
}

// ---------------------------------------------------------------------------------------------------------------
// Senha-mestra e abrir/fechar
// ---------------------------------------------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct SenhaPayload {
    pub senha: String,
    /// Pasta de senha própria a destrancar; ausente = senha-mestra.
    #[serde(default)]
    pub pasta: Option<String>,
}

async fn hash_da_mestra(state: &AppState, uid: &str) -> AppResult<Option<(String, i64)>> {
    let uid = uid.to_string();
    Ok(state.db.with_read(move |conn| conn.query_row("SELECT senha_hash, minutos FROM seguro_config WHERE usuario_id = ?1", [&uid], |r| Ok((r.get(0)?, r.get(1)?))).optional()).await?)
}

/// `(hash, minutos, grupo)` da senha a que `pasta` se refere (`None` = mestra). Erro claro se não existir.
async fn credencial(state: &AppState, uid: &str, pasta: Option<&str>) -> AppResult<(String, i64, String)> {
    match pasta {
        None => {
            let (h, m) = hash_da_mestra(state, uid).await?.ok_or_else(|| AppError::new(ErrorCode::Conflict).with_message("A senha-mestra ainda não foi criada."))?;
            Ok((h, m, MESTRA.to_string()))
        }
        Some(p) => {
            let p = normalizar_pasta(p).ok_or_else(|| campo("pasta", "caminho de pasta inválido"))?;
            let (u, q) = (uid.to_string(), p.clone());
            let linha: Option<(Option<String>, Option<i64>)> = state.db.with_read(move |conn| conn.query_row("SELECT senha_hash, minutos FROM pasta_trancada WHERE usuario_id = ?1 AND pasta = ?2", [&u, &q], |r| Ok((r.get(0)?, r.get(1)?))).optional()).await?;
            match linha {
                Some((Some(h), m)) => Ok((h, m.unwrap_or(MINUTOS_PADRAO), p)),
                Some((None, _)) => hash_da_mestra(state, uid).await?.map(|(h, m)| (h, m, MESTRA.to_string())).ok_or_else(|| AppError::new(ErrorCode::Conflict).with_message("A senha-mestra ainda não foi criada.")),
                None => Err(AppError::new(ErrorCode::NotFound)),
            }
        }
    }
}

async fn abrir_grupo(state: &AppState, uid: &str, grupo: String, minutos: i64) -> AppResult<()> {
    let uid = uid.to_string();
    state
        .db
        .with(move |conn| {
            conn.execute(
                &format!("INSERT INTO pasta_aberta (usuario_id, grupo, ate) VALUES (?1, ?2, {AGORA} + ?3) ON CONFLICT (usuario_id, grupo) DO UPDATE SET ate = excluded.ate"),
                rusqlite::params![uid, grupo, minutos * 60],
            )?;
            // Faxina: grupos vencidos não precisam ficar.
            conn.execute(&format!("DELETE FROM pasta_aberta WHERE ate <= {AGORA}"), [])
        })
        .await?;
    Ok(())
}

/// `POST /seguro/configurar` — cria a senha-mestra (e já a destranca).
pub async fn configurar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Json(p): Json<SenhaPayload>) -> AppResult<Json<Estado>> {
    validar_senha(&p.senha, "senha")?;
    if hash_da_mestra(&state, &usuario.0).await?.is_some() {
        return Err(AppError::new(ErrorCode::Conflict).with_message("A senha-mestra já existe. Desbloqueie ou troque a senha."));
    }
    let hash = hash_em_thread(p.senha).await?;
    let (uid, agora) = (usuario.0.clone(), Utc::now().to_rfc3339());
    state.db.with(move |conn| conn.execute("INSERT INTO seguro_config (usuario_id, senha_hash, minutos, criado_em, atualizado_em) VALUES (?1, ?2, ?3, ?4, ?4)", rusqlite::params![uid, hash, MINUTOS_PADRAO, agora])).await?;
    abrir_grupo(&state, &usuario.0, MESTRA.into(), MINUTOS_PADRAO).await?;
    Ok(Json(estado(&state, &usuario.0).await?))
}

/// `POST /seguro/desbloquear {senha, pasta?}` — abre tudo que usa aquela senha.
pub async fn desbloquear(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Json(p): Json<SenhaPayload>) -> AppResult<Json<Estado>> {
    let (hash, minutos, grupo) = credencial(&state, &usuario.0, p.pasta.as_deref()).await?;
    if !verificar_em_thread(p.senha, hash).await {
        return Err(campo("senha", "Senha incorreta."));
    }
    abrir_grupo(&state, &usuario.0, grupo, minutos).await?;
    Ok(Json(estado(&state, &usuario.0).await?))
}

#[derive(Debug, Deserialize, Default)]
pub struct PastaOpcional {
    #[serde(default)]
    pub pasta: Option<String>,
}

/// Grupo (sem checar senha) a que uma pasta trancada pertence; `None` se a pasta não tem tranca própria.
async fn grupo_da_pasta(state: &AppState, uid: &str, pasta: &str) -> AppResult<Option<String>> {
    let (u, p) = (uid.to_string(), normalizar_pasta(pasta).ok_or_else(|| campo("pasta", "caminho de pasta inválido"))?);
    let q = p.clone();
    let linha: Option<bool> = state.db.with_read(move |conn| conn.query_row("SELECT senha_hash IS NOT NULL FROM pasta_trancada WHERE usuario_id = ?1 AND pasta = ?2", [&u, &q], |r| r.get(0)).optional()).await?;
    Ok(linha.map(|propria| if propria { p } else { MESTRA.to_string() }))
}

/// `POST /seguro/trancar {pasta?}` — fecha o grupo da pasta (todas que usam a mesma senha) ou, sem pasta, tudo.
pub async fn trancar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, body: Option<Json<PastaOpcional>>) -> AppResult<Json<Estado>> {
    let pasta = body.and_then(|Json(b)| b.pasta);
    let uid = usuario.0.clone();
    match pasta {
        Some(p) => {
            let grupo = grupo_da_pasta(&state, &uid, &p).await?.ok_or_else(|| AppError::new(ErrorCode::NotFound))?;
            state.db.with(move |conn| conn.execute("DELETE FROM pasta_aberta WHERE usuario_id = ?1 AND grupo = ?2", rusqlite::params![uid, grupo])).await?;
        }
        None => {
            state.db.with(move |conn| conn.execute("DELETE FROM pasta_aberta WHERE usuario_id = ?1", [&uid])).await?;
        }
    }
    Ok(Json(estado(&state, &usuario.0).await?))
}

/// `POST /seguro/manter {pasta?}` — a pessoa segue usando (digitando, lendo): renova o prazo. 423 se já trancou.
pub async fn manter(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, body: Option<Json<PastaOpcional>>) -> AppResult<Json<Estado>> {
    let pasta = body.and_then(|Json(b)| b.pasta);
    match pasta {
        Some(p) => exigir_pasta_aberta(&state, &usuario.0, "pessoal", Some(&p)).await?,
        None => {
            // Sem pasta: renova a mestra e as de senha própria que estiverem abertas.
            let uid = usuario.0.clone();
            state
                .db
                .with(move |conn| {
                    let m: i64 = conn.query_row("SELECT minutos FROM seguro_config WHERE usuario_id = ?1", [&uid], |r| r.get(0)).optional()?.unwrap_or(MINUTOS_PADRAO);
                    renovar(conn, &uid, MESTRA, m)?;
                    let mut st = conn.prepare("SELECT pasta, COALESCE(minutos, ?2) FROM pasta_trancada WHERE usuario_id = ?1 AND senha_hash IS NOT NULL")?;
                    let proprias: Vec<(String, i64)> = st.query_map(rusqlite::params![uid, MINUTOS_PADRAO], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<_, _>>()?;
                    for (g, min) in proprias { renovar(conn, &uid, &g, min)?; }
                    Ok(())
                })
                .await?;
        }
    }
    Ok(Json(estado(&state, &usuario.0).await?))
}

#[derive(Debug, Deserialize)]
pub struct ConfigPayload {
    #[serde(default)]
    pub minutos: Option<i64>,
    /// Com `pasta`, o tempo é da senha própria dessa pasta; sem, da senha-mestra.
    #[serde(default)]
    pub pasta: Option<String>,
    #[serde(default)]
    pub mostrar_tarefas: Option<bool>,
}

/// `PATCH /seguro/config` — tempo de inatividade (exige o grupo aberto) e preferência de mostrar tarefas.
pub async fn atualizar_config(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Json(p): Json<ConfigPayload>) -> AppResult<Json<Estado>> {
    if let Some(m) = p.minutos {
        validar_minutos(m)?;
        let uid = usuario.0.clone();
        let agora = Utc::now().to_rfc3339();
        match p.pasta.as_deref() {
            None => {
                let (_, _, grupo) = credencial(&state, &usuario.0, None).await?;
                exigir_grupo_aberto(&state, &usuario.0, &grupo).await?;
                state.db.with(move |conn| conn.execute("UPDATE seguro_config SET minutos = ?2, atualizado_em = ?3 WHERE usuario_id = ?1", rusqlite::params![uid, m, agora])).await?;
            }
            Some(pasta) => {
                let pasta = normalizar_pasta(pasta).ok_or_else(|| campo("pasta", "caminho de pasta inválido"))?;
                exigir_pasta_aberta(&state, &usuario.0, "pessoal", Some(&pasta)).await?;
                let n = state.db.with(move |conn| conn.execute("UPDATE pasta_trancada SET minutos = ?3 WHERE usuario_id = ?1 AND pasta = ?2 AND senha_hash IS NOT NULL", rusqlite::params![uid, pasta, m])).await?;
                if n == 0 {
                    return Err(campo("pasta", "só pastas com senha própria têm tempo próprio; as demais usam o da senha-mestra"));
                }
            }
        }
    }
    if let Some(v) = p.mostrar_tarefas {
        let uid = usuario.0.clone();
        state.db.with(move |conn| conn.execute("INSERT INTO seguro_preferencia (usuario_id, mostrar_tarefas) VALUES (?1, ?2) ON CONFLICT (usuario_id) DO UPDATE SET mostrar_tarefas = excluded.mostrar_tarefas", rusqlite::params![uid, v])).await?;
    }
    Ok(Json(estado(&state, &usuario.0).await?))
}

async fn exigir_grupo_aberto(state: &AppState, uid: &str, grupo: &str) -> AppResult<()> {
    let (u, g) = (uid.to_string(), grupo.to_string());
    let aberto: bool = state.db.with_read(move |conn| conn.query_row(&format!("SELECT EXISTS(SELECT 1 FROM pasta_aberta WHERE usuario_id = ?1 AND grupo = ?2 AND ate > {AGORA})"), [&u, &g], |r| r.get(0))).await?;
    if aberto { Ok(()) } else { Err(AppError::new(ErrorCode::FolderLocked)) }
}

#[derive(Debug, Deserialize)]
pub struct TrocarSenhaPayload {
    pub atual: String,
    pub nova: String,
    #[serde(default)]
    pub pasta: Option<String>,
}

/// Grava uma nova senha: da mestra (`pasta` ausente) ou da pasta de senha própria. Tranca o grupo.
async fn gravar_senha(state: &AppState, uid: &str, pasta: Option<&str>, nova: String) -> AppResult<()> {
    validar_senha(&nova, "nova")?;
    let hash = hash_em_thread(nova).await?;
    let (u, agora) = (uid.to_string(), Utc::now().to_rfc3339());
    match pasta {
        None => {
            state
                .db
                .with(move |conn| {
                    conn.execute(
                        "INSERT INTO seguro_config (usuario_id, senha_hash, minutos, criado_em, atualizado_em) VALUES (?1, ?2, ?3, ?4, ?4) \
                         ON CONFLICT (usuario_id) DO UPDATE SET senha_hash = excluded.senha_hash, atualizado_em = excluded.atualizado_em",
                        rusqlite::params![u, hash, MINUTOS_PADRAO, agora],
                    )?;
                    conn.execute("DELETE FROM pasta_aberta WHERE usuario_id = ?1 AND grupo = ?2", rusqlite::params![u, MESTRA])
                })
                .await?;
        }
        Some(p) => {
            let p = normalizar_pasta(p).ok_or_else(|| campo("pasta", "caminho de pasta inválido"))?;
            state
                .db
                .with(move |conn| {
                    let n = conn.execute("UPDATE pasta_trancada SET senha_hash = ?3 WHERE usuario_id = ?1 AND pasta = ?2 AND senha_hash IS NOT NULL", rusqlite::params![u, p, hash])?;
                    if n == 0 { return Err(rusqlite::Error::QueryReturnedNoRows); }
                    conn.execute("DELETE FROM pasta_aberta WHERE usuario_id = ?1 AND grupo = ?2", rusqlite::params![u, p])
                })
                .await
                .map_err(|e| if matches!(e, rusqlite::Error::QueryReturnedNoRows) { AppError::new(ErrorCode::NotFound) } else { e.into() })?;
        }
    }
    Ok(())
}

/// `POST /seguro/senha {atual, nova, pasta?}` — troca sabendo a atual.
pub async fn trocar_senha(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Json(p): Json<TrocarSenhaPayload>) -> AppResult<Json<serde_json::Value>> {
    let (hash, _, _) = credencial(&state, &usuario.0, p.pasta.as_deref()).await?;
    if p.pasta.is_some() && hash_da_mestra(&state, &usuario.0).await?.is_some_and(|(h, _)| h == hash) {
        return Err(AppError::new(ErrorCode::Conflict).with_message("Esta pasta usa a senha-mestra. Troque a senha-mestra."));
    }
    if !verificar_em_thread(p.atual, hash).await {
        return Err(campo("atual", "Senha incorreta."));
    }
    gravar_senha(&state, &usuario.0, p.pasta.as_deref(), p.nova).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Debug, Deserialize)]
pub struct RedefinirPayload {
    /// Senha da conta Ecos — prova de que quem pede é a dona da conta.
    pub senha_conta: String,
    pub nova: String,
    #[serde(default)]
    pub pasta: Option<String>,
}

/// `POST /seguro/redefinir {senha_conta, nova, pasta?}` — esqueceu a senha: confirma a da conta e cria outra. Os textos não
/// são cifrados, então nada se perde.
pub async fn redefinir(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Json(p): Json<RedefinirPayload>) -> AppResult<Json<serde_json::Value>> {
    let uid = usuario.0.clone();
    let hash_conta: Option<String> = state.db.with_read(move |conn| conn.query_row("SELECT senha_hash FROM usuario WHERE id = ?1", [&uid], |r| r.get(0)).optional()).await?;
    let hash_conta = hash_conta.ok_or_else(|| AppError::new(ErrorCode::Unauthorized))?;
    if !verificar_em_thread(p.senha_conta, hash_conta).await {
        return Err(campo("senha_conta", "Senha da conta incorreta."));
    }
    gravar_senha(&state, &usuario.0, p.pasta.as_deref(), p.nova).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------------------------------------------
// Trancar / destrancar pastas
// ---------------------------------------------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct TrancarPastaPayload {
    pub pasta: String,
    /// Senha própria para esta pasta; ausente = usa a senha-mestra.
    #[serde(default)]
    pub senha: Option<String>,
    #[serde(default)]
    pub minutos: Option<i64>,
}

/// `POST /seguro/pastas` — põe o cadeado numa pasta (e nas filhas). Um só nível: recusa dentro de pasta já trancada e pasta que
/// contenha uma trancada.
pub async fn trancar_pasta(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Json(p): Json<TrancarPastaPayload>) -> AppResult<Json<Estado>> {
    let pasta = normalizar_pasta(&p.pasta).ok_or_else(|| campo("pasta", "caminho de pasta inválido"))?;
    if let Some(m) = p.minutos { validar_minutos(m)?; }
    let hash = match p.senha.as_deref().filter(|s| !s.is_empty()) {
        Some(s) => { validar_senha(s, "senha")?; Some(hash_em_thread(s.to_string()).await?) }
        None => {
            if hash_da_mestra(&state, &usuario.0).await?.is_none() {
                return Err(AppError::new(ErrorCode::Conflict).with_message("Crie a senha-mestra antes (ou informe uma senha própria para esta pasta)."));
            }
            None
        }
    };
    // A pasta tem de existir de verdade no espaço pessoal.
    let raiz = crate::espacos::raiz(&state, &crate::espacos::fisica("pessoal", &usuario.0), "").await?;
    if !raiz.join(&pasta).is_dir() {
        return Err(AppError::new(ErrorCode::NotFound).with_message("Essa pasta não existe."));
    }
    let (uid, pasta_c, agora, propria, minutos) = (usuario.0.clone(), pasta.clone(), Utc::now().to_rfc3339(), hash.is_some(), p.minutos);
    let resultado = state
        .db
        .with(move |conn| {
            let conflito: Option<String> = conn
                .query_row(
                    "SELECT pasta FROM pasta_trancada WHERE usuario_id = ?1 AND (pasta = ?2 OR substr(?2, 1, length(pasta) + 1) = pasta || '/' OR substr(pasta, 1, length(?2) + 1) = ?2 || '/') LIMIT 1",
                    rusqlite::params![uid, pasta_c], |r| r.get(0),
                )
                .optional()?;
            if let Some(c) = conflito { return Ok(Err(c)); }
            conn.execute(
                "INSERT INTO pasta_trancada (usuario_id, pasta, senha_hash, minutos, criado_em) VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![uid, pasta_c, hash, if propria { minutos } else { None }, agora],
            )?;
            Ok(Ok(()))
        })
        .await?;
    if let Err(existente) = resultado {
        return Err(AppError::new(ErrorCode::Conflict).with_message(format!("Não dá para trancar aqui: já existe um cadeado em “{existente}” (dentro ou fora desta pasta). O cadeado vale para a pasta e todas as filhas.")));
    }
    // Quem acabou de criar a senha própria segue com a pasta aberta (senão a pasta sumiria na cara dela).
    if propria { abrir_grupo(&state, &usuario.0, pasta, p.minutos.unwrap_or(MINUTOS_PADRAO)).await?; }
    Ok(Json(estado(&state, &usuario.0).await?))
}

/// `DELETE /seguro/pastas {pasta}` — tira o cadeado. Só com a pasta destrancada.
pub async fn destrancar_pasta(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Json(p): Json<PastaOpcional>) -> AppResult<Json<Estado>> {
    let pasta = normalizar_pasta(p.pasta.as_deref().unwrap_or("")).ok_or_else(|| campo("pasta", "caminho de pasta inválido"))?;
    exigir_pasta_aberta(&state, &usuario.0, "pessoal", Some(&pasta)).await?;
    let (uid, pasta_c) = (usuario.0.clone(), pasta);
    let n = state
        .db
        .with(move |conn| {
            let n = conn.execute("DELETE FROM pasta_trancada WHERE usuario_id = ?1 AND pasta = ?2", rusqlite::params![uid, pasta_c])?;
            conn.execute("DELETE FROM pasta_aberta WHERE usuario_id = ?1 AND grupo = ?2", rusqlite::params![uid, pasta_c])?;
            Ok(n)
        })
        .await?;
    if n == 0 {
        // Só as pastas-raiz da tranca têm cadeado próprio; uma filha herda e não se destranca sozinha.
        return Err(AppError::new(ErrorCode::NotFound).with_message("Esta pasta não tem cadeado próprio: ela herda o da pasta-mãe."));
    }
    Ok(Json(estado(&state, &usuario.0).await?))
}
