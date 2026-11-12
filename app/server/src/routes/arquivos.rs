//! Explorador de arquivos: a árvore do espaço como a pessoa a vê. `Notas/X` e `Tarefas/X` são a mesma pasta
//! (ADR árvore única), e qualquer arquivo dentro delas aparece, não só nota e tarefa. O que é interno do Ecos
//! (nomes começando com `.`, `_anexos/`, temporários) não aparece. Endereçado por caminho lógico, relativo à raiz
//! do espaço, como as pastas.

use axum::extract::{Query, State};
use axum::http::header;
use axum::{Extension, Json};
use ecos_core::{naming, ErrorCode};
use rusqlite::OptionalExtension;
use serde::Deserialize;
use std::path::{Path, PathBuf};

use crate::db::reindex::reindexar_tudo;
use crate::error::{AppError, AppResult, CampoInvalido};
use crate::middleware::auth_guard::UsuarioAutenticado;
use crate::routes::anexos_comuns::mime_por_extensao;
use crate::state::AppState;

const ARVORES: [&str; 2] = ["Notas", "Tarefas"];

fn invalido(campo: &str, motivo: &str) -> AppError {
    AppError::validation(vec![CampoInvalido { campo: campo.into(), motivo: motivo.into() }])
}

/// Caminho lógico vindo do cliente: vazio só onde `pode_ser_raiz`; nunca `..`, barra inicial ou unidade.
fn validar_caminho(campo: &str, caminho: &str, pode_ser_raiz: bool) -> AppResult<()> {
    if (caminho.is_empty() && pode_ser_raiz) || (!caminho.trim().is_empty() && crate::espacos::caminho_relativo_seguro(caminho)) {
        Ok(())
    } else {
        Err(invalido(campo, "caminho inválido"))
    }
}

/// As raízes físicas do espaço (uma por árvore), depois de conferir o acesso.
async fn raizes(state: &AppState, usuario_id: &str, espaco: Option<&str>) -> AppResult<Vec<PathBuf>> {
    let espaco = espaco.filter(|e| !e.is_empty()).unwrap_or("pessoal");
    espaco.parse::<ecos_core::types::Espaco>().map_err(|motivo| invalido("espaco", &motivo))?;
    crate::espacos::exigir_acesso(state, usuario_id, espaco).await?;
    let fisica = crate::espacos::fisica(espaco, usuario_id);
    let mut out = Vec::new();
    for arvore in ARVORES {
        let raiz = crate::espacos::raiz(state, &fisica, arvore).await?;
        // Na árvore única as duas são a mesma pasta.
        if !out.contains(&raiz) {
            out.push(raiz);
        }
    }
    Ok(out)
}

/// Entrada interna do Ecos, nunca listada nem movida pelo explorador (inclui `.ecos_app/`).
fn interna(nome: &str) -> bool {
    crate::espacos::nome_interno(nome) || nome.ends_with(".ecos-tmp")
}

/// Categoria do arquivo para o cliente escolher ícone e visualizador.
fn categoria(nome: &str) -> &'static str {
    let ext = nome.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    match ext.as_str() {
        "md" => "markdown",
        "pdf" => "pdf",
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "avif" | "bmp" => "imagem",
        "mp3" | "wav" | "ogg" | "m4a" | "flac" | "opus" => "audio",
        "mp4" | "webm" | "mov" | "mkv" | "m4v" => "video",
        "txt" | "csv" | "json" | "log" | "yml" | "yaml" | "xml" | "html" | "css" | "js" | "ts" | "rs" | "py" | "sh" | "toml" | "ini" => "texto",
        _ => "outro",
    }
}

fn juntar(pasta: &str, nome: &str) -> String {
    if pasta.is_empty() { nome.to_string() } else { format!("{pasta}/{nome}") }
}

#[derive(Debug, Deserialize)]
pub struct ListarQuery {
    #[serde(default)]
    pub espaco: Option<String>,
    #[serde(default)]
    pub pasta: Option<String>,
}

/// Conteúdo direto de uma pasta lógica: subpastas (das duas árvores, sem repetir) e todos os arquivos.
pub async fn listar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Query(q): Query<ListarQuery>) -> AppResult<Json<serde_json::Value>> {
    let pasta = q.pasta.clone().unwrap_or_default();
    validar_caminho("pasta", &pasta, true)?;
    let raizes = raizes(&state, &usuario.0, q.espaco.as_deref()).await?;
    let notes_root = state.config.notes_root.clone();

    let mut pastas = std::collections::BTreeMap::<String, String>::new();
    // (nome, caminho lógico, caminho relativo à raiz das notas, tamanho, modificado)
    let mut arquivos: Vec<(String, String, String, u64, Option<String>)> = Vec::new();
    let mut alguma_existe = pasta.is_empty();
    for raiz in &raizes {
        let dir = raiz.join(&pasta);
        let Ok(entradas) = std::fs::read_dir(&dir) else { continue };
        alguma_existe = true;
        for entrada in entradas.flatten() {
            let nome = entrada.file_name().to_string_lossy().to_string();
            if interna(&nome) {
                continue;
            }
            let Ok(meta) = entrada.metadata() else { continue };
            if meta.is_dir() {
                pastas.insert(nome.to_lowercase(), nome);
            } else if meta.is_file() {
                let modificado = meta.modified().ok().map(|m| chrono::DateTime::<chrono::Utc>::from(m).to_rfc3339());
                let relativo = crate::db::reindex_incremental::relativo(&notes_root, &entrada.path());
                arquivos.push((nome.clone(), juntar(&pasta, &nome), relativo, meta.len(), modificado));
            }
        }
    }
    if !alguma_existe {
        return Err(AppError::new(ErrorCode::NotFound));
    }

    // Nota/tarefa: o índice diz o que o `.md` é (o tipo vem do conteúdo, não do nome).
    let caminhos: Vec<String> = arquivos.iter().filter(|a| categoria(&a.0) == "markdown").map(|a| a.2.clone()).collect();
    let itens: std::collections::HashMap<String, (&'static str, String, String, Option<String>)> = state
        .db
        .with_read(move |conn| {
            let mut out = std::collections::HashMap::new();
            for c in caminhos {
                for (tabela, tipo) in [("nota", "nota"), ("tarefa", "tarefa")] {
                    let status = if tipo == "tarefa" { "status" } else { "NULL" };
                    let achado: Option<(String, String, Option<String>)> = conn
                        .query_row(&format!("SELECT id, titulo, {status} FROM {tabela} WHERE caminho_arquivo = ?1"), [&c], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                        .optional()?;
                    if let Some((id, titulo, status)) = achado {
                        out.insert(c.clone(), (tipo, id, titulo, status));
                        break;
                    }
                }
            }
            Ok(out)
        })
        .await?;

    // Mídias que a nota ou tarefa referencia (biblioteca do espaço, `src/Media/...` no texto): viram "anexos" do item.
    let espaco_fisico = {
        let e = q.espaco.as_deref().filter(|e| !e.is_empty()).unwrap_or("pessoal");
        crate::espacos::fisica(e, &usuario.0)
    };
    let raiz_midia = crate::routes::media::raiz(&state, &espaco_fisico).await.ok();
    let anexos_do_item = |relativo: &str| -> Vec<serde_json::Value> {
        let Some(raiz_midia) = raiz_midia.as_ref() else { return Vec::new() };
        let Ok(texto) = std::fs::read_to_string(notes_root.join(relativo)) else { return Vec::new() };
        let mut vistos: Vec<PathBuf> = Vec::new();
        let mut saida = Vec::new();
        for candidato in crate::espacos::midias_referenciadas(&texto) {
            let alvo = raiz_midia.join(&candidato);
            if candidato.contains("..") || vistos.contains(&alvo) {
                continue;
            }
            let Ok(meta) = std::fs::metadata(&alvo) else { continue };
            if !meta.is_file() {
                continue;
            }
            vistos.push(alvo);
            let nome = candidato.rsplit('/').next().unwrap_or(&candidato).to_string();
            saida.push(serde_json::json!({ "nome": nome, "caminho": format!("{}{}", crate::espacos::PREFIXO_MIDIA, candidato), "tamanho_bytes": meta.len() }));
            if saida.len() >= 40 {
                break;
            }
        }
        saida
    };

    arquivos.sort_by_key(|a| a.0.to_lowercase());
    let arquivos: Vec<serde_json::Value> = arquivos
        .into_iter()
        .map(|(nome, caminho, relativo, tamanho, modificado)| {
            let mut v = serde_json::json!({ "nome": nome, "caminho": caminho, "categoria": categoria(&nome), "tamanho_bytes": tamanho, "modificado_em": modificado });
            if let Some((tipo, id, titulo, status)) = itens.get(&relativo) {
                v["tipo"] = serde_json::json!(tipo);
                v["id"] = serde_json::json!(id);
                v["titulo"] = serde_json::json!(titulo);
                if let Some(status) = status {
                    v["status"] = serde_json::json!(status);
                }
                v["fora_do_padrao"] = serde_json::json!(!crate::routes::arquivos_problemas::nome_no_padrao(*tipo == "tarefa", &relativo));
                let anexos = anexos_do_item(&relativo);
                if !anexos.is_empty() {
                    v["anexos"] = serde_json::json!(anexos);
                }
            }
            v
        })
        .collect();
    // Cor e ícone escolhidos para a pasta (`.ecos-pastas.json` na raiz de cada árvore; a primeira raiz vale em conflito).
    let mut aparencia = crate::routes::pastas::MetaPastas::new();
    for raiz in raizes.iter().rev() {
        aparencia.extend(crate::routes::pastas::ler_meta(raiz));
    }
    let pastas: Vec<serde_json::Value> = pastas
        .into_values()
        .map(|nome| {
            let caminho = juntar(&pasta, &nome);
            let campo = |k: &str| aparencia.get(&caminho).and_then(|a| a.get(k)).cloned().unwrap_or(serde_json::Value::Null);
            serde_json::json!({ "nome": nome, "caminho": caminho, "cor": campo("cor"), "icone": campo("icone"), "tags": campo("tags"), "descricao": campo("descricao"), "fixada": campo("fixada"), "prioridade_padrao": campo("prioridade_padrao"), "duracao_padrao_min": campo("duracao_padrao_min") })
        })
        .collect();
    Ok(Json(serde_json::json!({ "pasta": pasta, "pastas": pastas, "arquivos": arquivos })))
}

/// Desce por uma pasta física contando o que há dentro (subpastas, arquivos e tamanho), sem seguir atalhos.
fn percorrer(dir: &Path, notes_root: &Path, profundidade: u32, pastas: &mut u64, arquivos: &mut Vec<(String, String, u64)>) {
    if profundidade > 64 {
        return;
    }
    let Ok(entradas) = std::fs::read_dir(dir) else { return };
    for entrada in entradas.flatten() {
        let nome = entrada.file_name().to_string_lossy().to_string();
        if interna(&nome) {
            continue;
        }
        let Ok(meta) = entrada.metadata() else { continue };
        if meta.is_dir() {
            *pastas += 1;
            percorrer(&entrada.path(), notes_root, profundidade + 1, pastas, arquivos);
        } else if meta.is_file() {
            arquivos.push((nome, crate::db::reindex_incremental::relativo(notes_root, &entrada.path()), meta.len()));
        }
    }
}

/// Resumo de uma pasta com tudo o que há dentro dela (subpastas incluídas): quantas pastas, arquivos, notas,
/// tarefas e mídias, e quanto espaço ocupam.
pub async fn resumo(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Query(q): Query<ListarQuery>) -> AppResult<Json<serde_json::Value>> {
    let pasta = q.pasta.clone().unwrap_or_default();
    validar_caminho("pasta", &pasta, true)?;
    let raizes = raizes(&state, &usuario.0, q.espaco.as_deref()).await?;
    let notes_root = state.config.notes_root.clone();

    let mut pastas = 0u64;
    let mut arquivos: Vec<(String, String, u64)> = Vec::new();
    let mut alguma_existe = pasta.is_empty();
    for raiz in &raizes {
        let dir = raiz.join(&pasta);
        if !dir.is_dir() {
            continue;
        }
        alguma_existe = true;
        percorrer(&dir, &notes_root, 0, &mut pastas, &mut arquivos);
    }
    if !alguma_existe {
        return Err(AppError::new(ErrorCode::NotFound));
    }

    let bytes: u64 = arquivos.iter().map(|a| a.2).sum();
    let midias = arquivos.iter().filter(|a| matches!(categoria(&a.0), "imagem" | "audio" | "video")).count();
    let caminhos: Vec<String> = arquivos.iter().filter(|a| categoria(&a.0) == "markdown").map(|a| a.1.clone()).collect();
    let (notas, tarefas) = state
        .db
        .with_read(move |conn| {
            let (mut notas, mut tarefas) = (0u64, 0u64);
            for c in caminhos {
                let nota: Option<i64> = conn.query_row("SELECT 1 FROM nota WHERE caminho_arquivo = ?1", [&c], |r| r.get(0)).optional()?;
                if nota.is_some() {
                    notas += 1;
                    continue;
                }
                let tarefa: Option<i64> = conn.query_row("SELECT 1 FROM tarefa WHERE caminho_arquivo = ?1", [&c], |r| r.get(0)).optional()?;
                if tarefa.is_some() {
                    tarefas += 1;
                }
            }
            Ok((notas, tarefas))
        })
        .await?;
    Ok(Json(serde_json::json!({ "pastas": pastas, "arquivos": arquivos.len(), "notas": notas, "tarefas": tarefas, "midias": midias, "bytes": bytes })))
}

#[derive(Debug, Deserialize)]
pub struct ConteudoQuery {
    #[serde(default)]
    pub espaco: Option<String>,
    pub caminho: String,
}

/// O arquivo físico de um caminho lógico, garantido dentro de uma das raízes do espaço.
fn localizar(raizes: &[PathBuf], caminho: &str) -> Option<PathBuf> {
    raizes.iter().find_map(|raiz| {
        let alvo = raiz.join(caminho);
        let (Ok(r), Ok(a)) = (std::fs::canonicalize(raiz), std::fs::canonicalize(&alvo)) else { return None };
        (a.starts_with(&r) && a.is_file()).then_some(alvo)
    })
}

/// Bytes de um arquivo para visualizar ou baixar.
pub async fn conteudo(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Query(q): Query<ConteudoQuery>) -> AppResult<([(header::HeaderName, String); 2], Vec<u8>)> {
    validar_caminho("caminho", &q.caminho, false)?;
    if q.caminho.split('/').any(interna) {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    let raizes = raizes(&state, &usuario.0, q.espaco.as_deref()).await?;
    let arquivo = localizar(&raizes, &q.caminho).ok_or(AppError::new(ErrorCode::NotFound))?;
    let nome = arquivo.file_name().and_then(|n| n.to_str()).unwrap_or("arquivo").to_string();
    let mime = match categoria(&nome) {
        "texto" | "markdown" => "text/plain; charset=utf-8".to_string(),
        _ => mime_por_extensao(&nome).to_string(),
    };
    // RFC 5987: só não-reservados passam crus; o resto vira %XX byte a byte.
    let codificado: String = nome
        .bytes()
        .map(|b| if b.is_ascii_alphanumeric() || b"-._~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") })
        .collect();
    let disposicao = format!("inline; filename*=UTF-8''{codificado}");
    Ok(([(header::CONTENT_TYPE, mime), (header::CONTENT_DISPOSITION, disposicao)], std::fs::read(arquivo)?))
}

#[derive(Debug, Deserialize)]
pub struct MoverPayload {
    #[serde(default)]
    pub espaco: Option<String>,
    /// Caminhos lógicos de arquivos e/ou pastas.
    pub itens: Vec<String>,
    /// Pasta de destino; vazio = raiz do espaço.
    #[serde(default)]
    pub destino: String,
}

/// `_anexos/<id>/` de uma nota/tarefa acompanha o `.md` quando ele muda de pasta.
async fn id_do_item(state: &AppState, relativo: String) -> AppResult<Option<String>> {
    Ok(state
        .db
        .with_read(move |conn| {
            conn.query_row("SELECT id FROM nota WHERE caminho_arquivo = ?1 UNION ALL SELECT id FROM tarefa WHERE caminho_arquivo = ?1", [&relativo], |r| r.get(0))
                .optional()
        })
        .await?)
}

fn mover_dir(de: &Path, para: &Path) -> std::io::Result<()> {
    if let Some(pai) = para.parent() {
        std::fs::create_dir_all(pai)?;
    }
    std::fs::rename(de, para)
}

/// Move arquivos e pastas para outra pasta do mesmo espaço. Cada arquivo continua na sua árvore física; pastas
/// se movem nas duas. Nome repetido no destino: arquivo ganha ` (2)`, pasta é recusada.
pub async fn mover(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Json(payload): Json<MoverPayload>) -> AppResult<Json<serde_json::Value>> {
    if payload.itens.is_empty() {
        return Err(invalido("itens", "nenhum item para mover"));
    }
    validar_caminho("destino", &payload.destino, true)?;
    for item in &payload.itens {
        validar_caminho("itens", item, false)?;
        if item.split('/').any(interna) {
            return Err(invalido("itens", "item interno do Ecos"));
        }
        if payload.destino == *item || payload.destino.starts_with(&format!("{item}/")) {
            return Err(invalido("destino", "uma pasta não pode ir para dentro dela mesma"));
        }
    }
    let raizes = raizes(&state, &usuario.0, payload.espaco.as_deref()).await?;
    let notes_root = state.config.notes_root.clone();
    let mut movidos = Vec::new();
    let mut falhas = Vec::new();

    for item in &payload.itens {
        let nome = item.rsplit('/').next().unwrap_or(item).to_string();
        let novo = juntar(&payload.destino, &nome);
        let pai_atual = item.rsplit_once('/').map(|(p, _)| p).unwrap_or("");
        if pai_atual == payload.destino {
            continue;
        }
        let com_pasta: Vec<&PathBuf> = raizes.iter().filter(|r| r.join(item).is_dir()).collect();
        let resultado: Result<String, String> = if !com_pasta.is_empty() {
            if com_pasta.iter().any(|r| r.join(&novo).exists()) {
                Err(format!("já existe uma pasta \"{nome}\" no destino"))
            } else {
                let mut erro = None;
                for raiz in &com_pasta {
                    if let Err(e) = mover_dir(&raiz.join(item), &raiz.join(&novo)) {
                        erro = Some(e.to_string());
                        break;
                    }
                    let mut meta = crate::routes::pastas::ler_meta(raiz);
                    crate::routes::pastas::mover_chaves(&mut meta, item, &novo);
                    crate::routes::pastas::gravar_meta(raiz, &meta)?;
                }
                erro.map_or(Ok(novo.clone()), Err)
            }
        } else if let Some(arquivo) = localizar(&raizes, item) {
            let raiz = raizes.iter().find(|r| arquivo.starts_with(r)).cloned().unwrap_or_else(|| raizes[0].clone());
            let dir_destino = raiz.join(&payload.destino);
            let (base, ext) = match nome.rsplit_once('.') {
                Some((b, e)) if !b.is_empty() => (b.to_string(), e.to_string()),
                _ => (nome.clone(), String::new()),
            };
            let id = if ext.eq_ignore_ascii_case("md") { id_do_item(&state, crate::db::reindex_incremental::relativo(&notes_root, &arquivo)).await? } else { None };
            let movido = (|| -> std::io::Result<PathBuf> {
                std::fs::create_dir_all(&dir_destino)?;
                let destino = if ext.is_empty() {
                    let direto = dir_destino.join(&base);
                    if direto.exists() { naming::caminho_sem_colisao(&dir_destino, &base, "") } else { direto }
                } else {
                    naming::caminho_sem_colisao(&dir_destino, &base, &ext)
                };
                std::fs::rename(&arquivo, &destino)?;
                if let (Some(id), Some(pai)) = (&id, arquivo.parent()) {
                    let anexos = pai.join("_anexos").join(id);
                    if anexos.is_dir() {
                        mover_dir(&anexos, &dir_destino.join("_anexos").join(id))?;
                    }
                }
                Ok(destino)
            })();
            movido
                .map(|d| d.strip_prefix(&raiz).map(|p| p.to_string_lossy().replace('\\', "/")).unwrap_or(novo.clone()))
                .map_err(|e| e.to_string())
        } else {
            Err("não encontrado".to_string())
        };
        match resultado {
            Ok(para) => {
                tracing::info!(de = %item, para = %para, "item movido pelo explorador");
                movidos.push(serde_json::json!({ "de": item, "para": para }));
            }
            Err(motivo) => falhas.push(serde_json::json!({ "caminho": item, "motivo": motivo })),
        }
    }
    if !movidos.is_empty() {
        reindexar_tudo(&state.db, &state.config.notes_root).await?;
    }
    Ok(Json(serde_json::json!({ "movidos": movidos, "falhas": falhas })))
}

/// Nota ou tarefa indexada num caminho (relativo à raiz das notas): `(é tarefa, id, título)`.
async fn item_indexado(state: &AppState, relativo: String) -> AppResult<Option<(bool, String, String)>> {
    Ok(state
        .db
        .with_read(move |conn| {
            conn.query_row(
                "SELECT 0, id, titulo FROM nota WHERE caminho_arquivo = ?1 UNION ALL SELECT 1, id, titulo FROM tarefa WHERE caminho_arquivo = ?1",
                [&relativo],
                |r| Ok((r.get::<_, i64>(0)? == 1, r.get(1)?, r.get(2)?)),
            )
            .optional()
        })
        .await?)
}

#[derive(Debug, Deserialize)]
pub struct RenomearPayload {
    #[serde(default)]
    pub espaco: Option<String>,
    pub caminho: String,
    /// Novo nome, na mesma pasta. Para nota/tarefa é o título: o arquivo segue o padrão e os links são atualizados.
    pub novo_nome: String,
}

/// Renomeia na mesma pasta. Pasta: nas duas árvores, com a aparência junto. Nota/tarefa: pelo título, igual a
/// renomear dentro do documento. Outro arquivo: só o nome (nome repetido é recusado).
pub async fn renomear(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Json(payload): Json<RenomearPayload>) -> AppResult<Json<serde_json::Value>> {
    validar_caminho("caminho", &payload.caminho, false)?;
    if payload.caminho.split('/').any(interna) {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    let novo_nome = payload.novo_nome.trim().to_string();
    if novo_nome.is_empty() {
        return Err(invalido("novo_nome", "o nome não pode ficar vazio"));
    }
    let raizes = raizes(&state, &usuario.0, payload.espaco.as_deref()).await?;
    let pai = payload.caminho.rsplit_once('/').map(|(p, _)| p).unwrap_or("");
    let nome_atual = payload.caminho.rsplit('/').next().unwrap_or(&payload.caminho);

    // Nota/tarefa: o nome é o título.
    if let Some(arquivo) = localizar(&raizes, &payload.caminho) {
        let relativo = crate::db::reindex_incremental::relativo(&state.config.notes_root, &arquivo);
        if let Some((tarefa, id, _)) = item_indexado(&state, relativo).await? {
            let sem_md = novo_nome.strip_suffix(".md").unwrap_or(&novo_nome);
            let titulo = sem_md.strip_prefix(naming::prefixo(tarefa)).unwrap_or(sem_md).trim().to_string();
            let corpo: crate::routes::renomear::CorpoRenomear =
                serde_json::from_value(serde_json::json!({ "titulo": titulo })).map_err(|_| AppError::new(ErrorCode::InternalError))?;
            let (s, u, p) = (State(state.clone()), Extension(usuario.clone()), axum::extract::Path(id.clone()));
            if tarefa {
                let _ = crate::routes::renomear::aplicar_tarefa(s, u, p, Json(corpo)).await?;
            } else {
                let _ = crate::routes::renomear::aplicar_nota(s, u, p, Json(corpo)).await?;
            }
            let tabela = if tarefa { "tarefa" } else { "nota" };
            let novo: Option<String> = state
                .db
                .with_read(move |conn| conn.query_row(&format!("SELECT caminho_arquivo FROM {tabela} WHERE id = ?1"), [&id], |r| r.get(0)).optional())
                .await?;
            let nome = novo.as_deref().and_then(|c| c.rsplit('/').next()).unwrap_or(nome_atual).to_string();
            return Ok(Json(serde_json::json!({ "caminho": juntar(pai, &nome) })));
        }
    }

    if novo_nome.contains('/') || novo_nome.contains('\\') || interna(&novo_nome) || naming::sanitizar_nome_arquivo(&novo_nome) != novo_nome {
        return Err(invalido("novo_nome", "nome inválido: não use / \\ : * ? \" < > | nem comece com ponto"));
    }
    if novo_nome == nome_atual {
        return Ok(Json(serde_json::json!({ "caminho": payload.caminho })));
    }
    let novo = juntar(pai, &novo_nome);
    // Só muda maiúscula/minúscula: no Windows o destino "já existe" (é o próprio item).
    let so_caixa = novo_nome.to_lowercase() == nome_atual.to_lowercase();

    let com_pasta: Vec<&PathBuf> = raizes.iter().filter(|r| r.join(&payload.caminho).is_dir()).collect();
    if !com_pasta.is_empty() {
        if !so_caixa && raizes.iter().any(|r| r.join(&novo).exists()) {
            return Err(AppError::new(ErrorCode::Conflict).with_message(format!("Já existe \"{novo_nome}\" nesta pasta.")));
        }
        for raiz in &com_pasta {
            std::fs::rename(raiz.join(&payload.caminho), raiz.join(&novo))?;
        }
        for raiz in &raizes {
            let mut meta = crate::routes::pastas::ler_meta(raiz);
            crate::routes::pastas::mover_chaves(&mut meta, &payload.caminho, &novo);
            crate::routes::pastas::gravar_meta(raiz, &meta)?;
        }
    } else {
        let arquivo = localizar(&raizes, &payload.caminho).ok_or(AppError::new(ErrorCode::NotFound))?;
        if !so_caixa && raizes.iter().any(|r| r.join(&novo).exists()) {
            return Err(AppError::new(ErrorCode::Conflict).with_message(format!("Já existe \"{novo_nome}\" nesta pasta.")));
        }
        std::fs::rename(&arquivo, arquivo.with_file_name(&novo_nome))?;
    }
    tracing::info!(de = %payload.caminho, para = %novo, "renomeado pelo explorador");
    reindexar_tudo(&state.db, &state.config.notes_root).await?;
    Ok(Json(serde_json::json!({ "caminho": novo })))
}

#[derive(Debug, Deserialize)]
pub struct ExcluirPayload {
    #[serde(default)]
    pub espaco: Option<String>,
    pub itens: Vec<String>,
}

/// Manda arquivos e pastas para a lixeira (nada é apagado de vez). Nota/tarefa vão com os anexos, como ao excluir
/// pelo documento; pasta vai inteira, das duas árvores, e volta igual ao restaurar.
pub async fn excluir(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Json(payload): Json<ExcluirPayload>) -> AppResult<Json<serde_json::Value>> {
    if payload.itens.is_empty() {
        return Err(invalido("itens", "nenhum item para excluir"));
    }
    for item in &payload.itens {
        validar_caminho("itens", item, false)?;
        if item.split('/').any(interna) {
            return Err(invalido("itens", "item interno do Ecos"));
        }
    }
    let espaco = payload.espaco.clone().filter(|e| !e.is_empty()).unwrap_or_else(|| "pessoal".into());
    let raizes = raizes(&state, &usuario.0, Some(&espaco)).await?;
    let fisica = crate::espacos::fisica(&espaco, &usuario.0);
    let notes_root = state.config.notes_root.clone();
    let mut excluidos = Vec::new();
    let mut falhas = Vec::new();

    for item in &payload.itens {
        let dirs: Vec<PathBuf> = raizes.iter().map(|r| r.join(item)).filter(|d| d.is_dir()).collect();
        let resultado: AppResult<()> = if !dirs.is_empty() {
            crate::routes::lixeira_arquivos::mover(&state, &fisica, item, &dirs)
        } else if let Some(arquivo) = localizar(&raizes, item) {
            let relativo = crate::db::reindex_incremental::relativo(&notes_root, &arquivo);
            match item_indexado(&state, relativo.clone()).await? {
                Some((tarefa, id, titulo)) => {
                    let anexos = arquivo.parent().map(|p| p.join("_anexos").join(&id)).unwrap_or_default();
                    crate::routes::lixeira::mover(&state, &relativo, if tarefa { "tarefa" } else { "nota" }, &titulo, &anexos)
                }
                None => crate::routes::lixeira_arquivos::mover(&state, &fisica, item, &[arquivo]),
            }
        } else {
            Err(AppError::new(ErrorCode::NotFound))
        };
        match resultado {
            Ok(()) => {
                tracing::info!(caminho = %item, "enviado para a lixeira pelo explorador");
                excluidos.push(item.clone());
            }
            Err(_) => falhas.push(serde_json::json!({ "caminho": item, "motivo": "não foi possível excluir" })),
        }
    }
    if !excluidos.is_empty() {
        reindexar_tudo(&state.db, &notes_root).await?;
    }
    Ok(Json(serde_json::json!({ "excluidos": excluidos, "falhas": falhas })))
}

#[derive(Debug, Deserialize)]
pub struct EnviarQuery {
    #[serde(default)]
    pub espaco: Option<String>,
    /// Pasta lógica de destino; vazio = raiz do espaço.
    #[serde(default)]
    pub pasta: String,
}

/// Envia um arquivo (campo `arquivo`) para uma pasta do espaço, com o nome original. Nome repetido ganha ` (2)`.
/// Fica na árvore física das notas; `.md` enviado entra no índice como nota (ou é adotado), igual a um arquivo
/// colocado na pasta por fora.
pub async fn enviar(
    State(state): State<AppState>,
    Extension(usuario): Extension<UsuarioAutenticado>,
    Query(q): Query<EnviarQuery>,
    mut multipart: axum::extract::Multipart,
) -> AppResult<Json<serde_json::Value>> {
    validar_caminho("pasta", &q.pasta, true)?;
    if q.pasta.split('/').any(interna) {
        return Err(invalido("pasta", "pasta interna do Ecos"));
    }
    let raizes = raizes(&state, &usuario.0, q.espaco.as_deref()).await?;
    let campo = multipart
        .next_field()
        .await
        .map_err(|_| AppError::new(ErrorCode::ValidationError).with_message("O envio do arquivo está incompleto. Tente de novo."))?
        .filter(|c| c.name() == Some("arquivo"))
        .ok_or_else(|| AppError::new(ErrorCode::ValidationError).with_message("Nenhum arquivo foi enviado."))?;
    let original = campo.file_name().unwrap_or("arquivo").to_string();
    let nome = naming::sanitizar_nome_arquivo(original.rsplit(['/', '\\']).next().unwrap_or(&original));
    if interna(&nome) {
        return Err(invalido("arquivo", "nome de arquivo começando com ponto não é aceito"));
    }
    let bytes = campo
        .bytes()
        .await
        .map_err(|_| AppError::new(ErrorCode::ValidationError).with_message("O envio foi interrompido ou passou de 120 MB."))?;
    if bytes.len() > crate::routes::anexos_comuns::TAMANHO_MAXIMO_BYTES {
        return Err(invalido("arquivo", "maior que 120 MB"));
    }

    // `.md` sem front-matter vira nota já agora (o envio chega inteiro; não precisa esperar o arquivo estabilizar
    // como na adoção do reindex). O corpo não muda.
    let mut bytes = bytes.to_vec();
    if categoria(&nome) == "markdown" {
        if let Ok(texto) = std::str::from_utf8(&bytes) {
            let nota = ecos_core::classificar::classificar(texto) == ecos_core::classificar::TipoArquivo::Nota;
            if nota && ecos_core::frontmatter::parse::<ecos_core::types::NotaFrontMatter>(texto).is_err() {
                let agora = chrono::Utc::now();
                let titulo = nome.strip_suffix(".md").unwrap_or(&nome);
                if let Ok(Some(novo)) = ecos_core::adotar::adotar(texto, titulo, agora, agora) {
                    bytes = novo.into_bytes();
                }
            }
        }
    }
    // Nota e tarefa já chegam com o nome no padrão (`note-`/`task-` + título), como ao criar pelo Ecos.
    let mut nome = nome;
    if categoria(&nome) == "markdown" {
        if let Ok(texto) = std::str::from_utf8(&bytes) {
            let padrao = match ecos_core::classificar::classificar(texto) {
                ecos_core::classificar::TipoArquivo::Nota => ecos_core::frontmatter::parse::<ecos_core::types::NotaFrontMatter>(texto).ok().map(|d| naming::nome_padrao(false, &d.front_matter.titulo)),
                ecos_core::classificar::TipoArquivo::Tarefa => ecos_core::frontmatter::parse::<ecos_core::types::TarefaFrontMatter>(texto).ok().map(|d| naming::nome_padrao(true, &d.front_matter.titulo)),
                ecos_core::classificar::TipoArquivo::Evento => None,
            };
            if let Some(base) = padrao {
                nome = format!("{base}.md");
            }
        }
    }

    let dir = raizes[0].join(&q.pasta);
    std::fs::create_dir_all(&dir)?;
    let (base, ext) = match nome.rsplit_once('.') {
        Some((b, e)) if !b.is_empty() && !e.is_empty() => (b.to_string(), e.to_string()),
        _ => (nome.clone(), String::new()),
    };
    // Nome livre nas duas árvores: a pasta lógica é uma só.
    let livre = |n: &str| raizes.iter().all(|r| !r.join(&q.pasta).join(n).exists());
    let mut final_nome = nome.clone();
    let mut contador = 2u32;
    while !livre(&final_nome) {
        final_nome = if ext.is_empty() { format!("{base} ({contador})") } else { format!("{base} ({contador}).{ext}") };
        contador += 1;
    }
    let destino = dir.join(&final_nome);
    // `create_new`: nunca sobrescreve um arquivo que apareceu entre a checagem e a gravação.
    let gravar = || -> std::io::Result<()> {
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new().write(true).create_new(true).open(&destino)?;
        f.write_all(&bytes)
    };
    if let Err(err) = gravar() {
        tracing::error!(error = %err, "falha ao gravar arquivo enviado pelo explorador");
        let _ = std::fs::remove_file(&destino);
        return Err(AppError::new(ErrorCode::InternalError).with_message("Não foi possível guardar o arquivo. Verifique o espaço em disco e tente de novo."));
    }
    if categoria(&final_nome) == "markdown" {
        reindexar_tudo(&state.db, &state.config.notes_root).await?;
    }
    tracing::info!(caminho = %juntar(&q.pasta, &final_nome), bytes = bytes.len(), "arquivo enviado pelo explorador");
    Ok(Json(serde_json::json!({ "caminho": juntar(&q.pasta, &final_nome), "nome": final_nome })))
}
