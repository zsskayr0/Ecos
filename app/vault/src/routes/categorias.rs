//! `/vault/categorias` (seção 11.14).

use axum::extract::{Path, State};
use axum::Json;
use ecos_core::{new_id, ErrorCode};
use rusqlite::OptionalExtension;
use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

pub async fn listar(State(state): State<AppState>) -> AppResult<Json<serde_json::Value>> {
    let linhas: Vec<serde_json::Value> = state
        .db
        .with(|conn| {
            let mut stmt = conn.prepare("SELECT id, nome, tipo, icone, cor, padrao, espaco FROM categoria ORDER BY nome")?;
            let linhas = stmt
                .query_map([], |r| {
                    Ok(serde_json::json!({
                        "id": r.get::<_, String>(0)?, "nome": r.get::<_, String>(1)?, "tipo": r.get::<_, String>(2)?,
                        "icone": r.get::<_, Option<String>>(3)?, "cor": r.get::<_, String>(4)?,
                        "padrao": r.get::<_, i64>(5)? != 0, "espaco": r.get::<_, String>(6)?,
                    }))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await?;
    Ok(Json(serde_json::json!(linhas)))
}

#[derive(Debug, Deserialize)]
pub struct CategoriaPayload {
    pub nome: String,
    #[serde(default = "tipo_padrao")]
    pub tipo: String,
    #[serde(default)]
    pub icone: Option<String>,
    #[serde(default = "cor_padrao")]
    pub cor: String,
    #[serde(default = "espaco_padrao")]
    pub espaco: String,
}

fn tipo_padrao() -> String {
    "saida".to_string()
}
fn cor_padrao() -> String {
    "#7DD3FC".to_string()
}
fn espaco_padrao() -> String {
    "pessoal".to_string()
}

pub async fn criar(State(state): State<AppState>, Json(payload): Json<CategoriaPayload>) -> AppResult<Json<serde_json::Value>> {
    if !["entrada", "saida", "ambos"].contains(&payload.tipo.as_str()) {
        return Err(AppError::new(ErrorCode::ValidationError).with_message("tipo deve ser 'entrada', 'saida' ou 'ambos'"));
    }
    let id = new_id();
    state
        .db
        .with({
            let id = id.clone();
            move |conn| {
                conn.execute(
                    "INSERT INTO categoria (id, nome, tipo, icone, cor, espaco) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    rusqlite::params![id, payload.nome, payload.tipo, payload.icone, payload.cor, payload.espaco],
                )
            }
        })
        .await?;
    Ok(Json(serde_json::json!({ "id": id })))
}

pub async fn atualizar(State(state): State<AppState>, Path(id): Path<String>, Json(payload): Json<CategoriaPayload>) -> AppResult<Json<serde_json::Value>> {
    let afetadas = state
        .db
        .with(move |conn| {
            conn.execute(
                "UPDATE categoria SET nome = ?1, tipo = ?2, icone = ?3, cor = ?4, atualizado_em = datetime('now') WHERE id = ?5",
                rusqlite::params![payload.nome, payload.tipo, payload.icone, payload.cor, id],
            )
        })
        .await?;
    if afetadas == 0 {
        return Err(AppError::new(ErrorCode::CategoryNotFound));
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn excluir(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let e_padrao: Option<i64> = state
        .db
        .with({
            let id = id.clone();
            move |conn| conn.query_row("SELECT padrao FROM categoria WHERE id = ?1", [&id], |r| r.get(0)).optional()
        })
        .await?;
    if e_padrao == Some(1) {
        return Err(AppError::new(ErrorCode::ValidationError).with_message("Categoria de sistema não pode ser excluída."));
    }
    let afetadas = state.db.with(move |conn| conn.execute("DELETE FROM categoria WHERE id = ?1", [&id])).await?;
    if afetadas == 0 {
        return Err(AppError::new(ErrorCode::CategoryNotFound));
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}
