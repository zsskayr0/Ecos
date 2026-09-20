//! Pastas (seção 11.5) — sem `:id`, endereçadas por caminho (seção 1.3/1.5:
//! Pasta não é entidade persistida, é o diretório em si).

use axum::extract::{Query, State};
use axum::Json;
use ecos_core::ErrorCode;
use rusqlite::OptionalExtension;
use serde::Deserialize;

use crate::db::reindex::reindexar_tudo;
use crate::error::{AppError, AppResult, CampoInvalido};
use crate::state::AppState;

async fn raiz_da_arvore(state: &AppState, tipo: &str, espaco: Option<&str>) -> AppResult<std::path::PathBuf> {
    let arvore = if tipo == "tarefa" { "Tarefas" } else { "Notas" };
    let espaco = espaco.filter(|e| !e.is_empty()).unwrap_or("pessoal");
    espaco.parse::<ecos_core::types::Espaco>().map_err(|motivo| AppError::validation(vec![CampoInvalido { campo: "espaco".into(), motivo }]))?;
    crate::espacos::raiz(state, espaco, arvore).await
}

#[derive(Debug, Deserialize)]
pub struct ListarQuery {
    #[serde(default = "tipo_padrao")]
    pub tipo: String,
    #[serde(default)]
    pub pasta_pai: Option<String>,
    #[serde(default)]
    pub espaco: Option<String>,
}

fn tipo_padrao() -> String {
    "nota".to_string()
}

pub async fn listar(State(state): State<AppState>, Query(q): Query<ListarQuery>) -> AppResult<Json<serde_json::Value>> {
    let tipo = q.tipo.clone();
    let pasta_pai = q.pasta_pai.clone().unwrap_or_default();
    let espaco = q.espaco.clone();

    let pastas: Vec<(String, String, i64)> = state
        .db
        .with({
            let tipo = tipo.clone();
            let pasta_pai = pasta_pai.clone();
            let espaco = espaco.clone();
            move |conn| {
                let sql = if espaco.is_some() { "SELECT caminho, nome, contagem_itens FROM pasta_cache WHERE tipo = ?1 AND espaco = ?2" } else { "SELECT caminho, nome, contagem_itens FROM pasta_cache WHERE tipo = ?1" };
                let mut stmt = conn.prepare(sql)?;
                let converter = |r: &rusqlite::Row<'_>| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?));
                let bruto: Vec<(String, String, i64)> = if let Some(espaco) = espaco {
                    stmt.query_map(rusqlite::params![tipo, espaco], converter)?.filter_map(|r| r.ok()).collect()
                } else {
                    stmt.query_map([&tipo], converter)?.filter_map(|r| r.ok()).collect()
                };
                let linhas = bruto.into_iter().filter(|(caminho, _, _)| {
                    let pai_de_caminho = caminho.rsplit_once('/').map(|(pai, _)| pai).unwrap_or("");
                    pai_de_caminho == pasta_pai
                }).collect();
                Ok(linhas)
            }
        })
        .await?;

    let subpastas: Vec<_> = pastas
        .into_iter()
        .map(|(caminho, nome, contagem_itens)| serde_json::json!({ "caminho": caminho, "nome": nome, "contagem_itens": contagem_itens }))
        .collect();

    // Conteúdo direto (Notas e Documentos misturados, seção 11.5) — só faz
    // sentido pra árvore de Notas; Tarefas não tem Documento.
    let espaco_itens = q.espaco.clone();
    let itens: Vec<serde_json::Value> = if tipo == "tarefa" {
        state
            .db
            .with(move |conn| {
                let mut stmt = conn.prepare("SELECT id, titulo, status FROM tarefa WHERE COALESCE(pasta_id, '') = ?1 AND (?2 IS NULL OR espaco = ?2)")?;
                let linhas = stmt
                    .query_map(rusqlite::params![&pasta_pai, &espaco_itens], |r| {
                        Ok(serde_json::json!({ "tipo": "tarefa", "id": r.get::<_, String>(0)?, "titulo": r.get::<_, String>(1)?, "status": r.get::<_, String>(2)? }))
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(linhas)
            })
            .await?
    } else {
        let mut itens = state
            .db
            .with({
                let pasta_pai = pasta_pai.clone();
                let espaco_itens = espaco_itens.clone();
                move |conn| {
                    let mut stmt = conn.prepare("SELECT id, titulo, modo FROM nota WHERE COALESCE(pasta_id, '') = ?1 AND (?2 IS NULL OR espaco = ?2)")?;
                    let linhas = stmt
                        .query_map(rusqlite::params![&pasta_pai, &espaco_itens], |r| {
                            Ok(serde_json::json!({ "tipo": "nota", "id": r.get::<_, String>(0)?, "titulo": r.get::<_, String>(1)?, "modo": r.get::<_, String>(2)? }))
                        })?
                        .collect::<Result<Vec<_>, _>>()?;
                    Ok(linhas)
                }
            })
            .await?;
        let documentos = state
            .db
            .with(move |conn| {
                let mut stmt = conn.prepare("SELECT caminho, nome, tamanho_bytes, hash_conteudo FROM documento_cache WHERE COALESCE(pasta, '') = ?1")?;
                let linhas = stmt
                    .query_map([&pasta_pai], |r| {
                        Ok(serde_json::json!({
                            "tipo": "documento", "caminho": r.get::<_, String>(0)?, "nome": r.get::<_, String>(1)?,
                            "tamanho_bytes": r.get::<_, i64>(2)?, "hash": r.get::<_, String>(3)?,
                        }))
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(linhas)
            })
            .await?;
        itens.extend(documentos);
        itens
    };

    Ok(Json(serde_json::json!({ "subpastas": subpastas, "itens": itens })))
}

#[derive(Debug, Deserialize)]
pub struct CriarPastaPayload {
    #[serde(default)]
    pub espaco: Option<String>,
    #[serde(default = "tipo_padrao")]
    pub tipo: String,
    #[serde(default)]
    pub pasta_pai: Option<String>,
    pub nome: String,
}

pub async fn criar(State(state): State<AppState>, Json(payload): Json<CriarPastaPayload>) -> AppResult<Json<serde_json::Value>> {
    if payload.nome.trim().is_empty() {
        return Err(AppError::validation(vec![CampoInvalido {
            campo: "nome".into(),
            motivo: "não pode ser vazio".into(),
        }]));
    }
    let nome = ecos_core::naming::sanitizar_nome_arquivo(&payload.nome);
    let raiz = raiz_da_arvore(&state, &payload.tipo, payload.espaco.as_deref()).await?;
    let dir = match &payload.pasta_pai {
        Some(p) if !p.is_empty() => raiz.join(p).join(&nome),
        _ => raiz.join(&nome),
    };
    std::fs::create_dir_all(&dir)?;
    reindexar_tudo(&state.db, &state.config.notes_root).await?;
    let caminho_relativo = dir.strip_prefix(&raiz).unwrap_or(&dir).to_string_lossy().replace('\\', "/");
    Ok(Json(serde_json::json!({ "ok": true, "caminho": caminho_relativo })))
}

#[derive(Debug, Deserialize)]
pub struct RenomearPastaPayload {
    #[serde(default)]
    pub espaco: Option<String>,
    #[serde(default = "tipo_padrao")]
    pub tipo: String,
    pub caminho_atual: String,
    pub novo_caminho: String,
}

pub async fn renomear(State(state): State<AppState>, Json(payload): Json<RenomearPastaPayload>) -> AppResult<Json<serde_json::Value>> {
    let raiz = raiz_da_arvore(&state, &payload.tipo, payload.espaco.as_deref()).await?;
    let de = raiz.join(&payload.caminho_atual);
    let para = raiz.join(&payload.novo_caminho);
    if !de.is_dir() {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    if let Some(pai) = para.parent() {
        std::fs::create_dir_all(pai)?;
    }
    std::fs::rename(&de, &para)?;
    reindexar_tudo(&state.db, &state.config.notes_root).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Debug, Deserialize)]
pub struct ExcluirPastaPayload {
    #[serde(default)]
    pub espaco: Option<String>,
    #[serde(default = "tipo_padrao")]
    pub tipo: String,
    pub caminho: String,
}

pub async fn excluir(State(state): State<AppState>, Json(payload): Json<ExcluirPastaPayload>) -> AppResult<Json<serde_json::Value>> {
    let raiz = raiz_da_arvore(&state, &payload.tipo, payload.espaco.as_deref()).await?;
    let dir = raiz.join(&payload.caminho);
    if !dir.is_dir() {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    // Cascata pro conteúdo (mesma semântica do `escopo` de Nota/Tarefa,
    // seção 11.5) — remove a árvore inteira, inclusive `_anexos/`.
    std::fs::remove_dir_all(&dir)?;
    reindexar_tudo(&state.db, &state.config.notes_root).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn documento(
    State(state): State<AppState>,
    axum::extract::Path(hash): axum::extract::Path<String>,
) -> AppResult<([(axum::http::HeaderName, &'static str); 1], Vec<u8>)> {
    let caminho: Option<String> = state
        .db
        .with(move |conn| conn.query_row("SELECT caminho FROM documento_cache WHERE hash_conteudo = ?1", [&hash], |r| r.get(0)).optional())
        .await?;
    let caminho = caminho.ok_or(AppError::new(ErrorCode::NotFound))?;
    let bytes = std::fs::read(state.config.notes_root.join(caminho))?;
    Ok(([(axum::http::header::CONTENT_TYPE, "application/pdf")], bytes))
}
