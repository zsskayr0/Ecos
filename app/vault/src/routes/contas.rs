//! `/vault/contas` (seção 11.14) — de onde/pra onde o dinheiro sai/entra,
//! incluindo carteira física (`banco = null`).

use axum::extract::{Path, State};
use axum::Json;
use ecos_core::{new_id, ErrorCode};
use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

pub async fn listar(State(state): State<AppState>) -> AppResult<Json<serde_json::Value>> {
    let linhas: Vec<serde_json::Value> = state
        .db
        .with(|conn| {
            let mut stmt = conn.prepare("SELECT id, nome, banco, agencia, numero_conta, cor, padrao, espaco FROM conta ORDER BY nome")?;
            let linhas = stmt
                .query_map([], |r| {
                    Ok(serde_json::json!({
                        "id": r.get::<_, String>(0)?, "nome": r.get::<_, String>(1)?, "banco": r.get::<_, Option<String>>(2)?,
                        "agencia": r.get::<_, Option<String>>(3)?, "numero_conta": r.get::<_, Option<String>>(4)?,
                        "cor": r.get::<_, String>(5)?, "padrao": r.get::<_, i64>(6)? != 0, "espaco": r.get::<_, String>(7)?,
                    }))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await?;
    Ok(Json(serde_json::json!(linhas)))
}

#[derive(Debug, Deserialize)]
pub struct ContaPayload {
    pub nome: String,
    #[serde(default)]
    pub banco: Option<String>,
    #[serde(default)]
    pub agencia: Option<String>,
    #[serde(default)]
    pub numero_conta: Option<String>,
    #[serde(default = "cor_padrao")]
    pub cor: String,
    #[serde(default = "espaco_padrao")]
    pub espaco: String,
}

fn cor_padrao() -> String {
    "#8f8f96".to_string()
}
fn espaco_padrao() -> String {
    "pessoal".to_string()
}

pub async fn criar(State(state): State<AppState>, Json(payload): Json<ContaPayload>) -> AppResult<Json<serde_json::Value>> {
    if payload.nome.trim().is_empty() {
        return Err(AppError::new(ErrorCode::ValidationError).with_message("nome não pode ser vazio"));
    }
    let id = new_id();
    state
        .db
        .with({
            let id = id.clone();
            move |conn| {
                conn.execute(
                    "INSERT INTO conta (id, nome, banco, agencia, numero_conta, cor, espaco) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    rusqlite::params![id, payload.nome, payload.banco, payload.agencia, payload.numero_conta, payload.cor, payload.espaco],
                )
            }
        })
        .await?;
    Ok(Json(serde_json::json!({ "id": id })))
}

pub async fn atualizar(State(state): State<AppState>, Path(id): Path<String>, Json(payload): Json<ContaPayload>) -> AppResult<Json<serde_json::Value>> {
    let afetadas = state
        .db
        .with(move |conn| {
            conn.execute(
                "UPDATE conta SET nome = ?1, banco = ?2, agencia = ?3, numero_conta = ?4, cor = ?5, atualizado_em = datetime('now') WHERE id = ?6",
                rusqlite::params![payload.nome, payload.banco, payload.agencia, payload.numero_conta, payload.cor, id],
            )
        })
        .await?;
    if afetadas == 0 {
        return Err(AppError::new(ErrorCode::AccountNotFound));
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn excluir(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let afetadas = state.db.with(move |conn| conn.execute("DELETE FROM conta WHERE id = ?1", [&id])).await?;
    if afetadas == 0 {
        return Err(AppError::new(ErrorCode::AccountNotFound));
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}
