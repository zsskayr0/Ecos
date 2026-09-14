//! `/vault/beneficiarios` (seção 11.14) — `POST` é find-or-create por nome.

use axum::extract::State;
use axum::Json;
use ecos_core::new_id;
use rusqlite::OptionalExtension;
use serde::Deserialize;

use crate::error::AppResult;
use crate::state::AppState;

pub async fn listar(State(state): State<AppState>) -> AppResult<Json<serde_json::Value>> {
    let linhas: Vec<serde_json::Value> = state
        .db
        .with(|conn| {
            let mut stmt = conn.prepare("SELECT id, nome, documento, observacoes FROM beneficiario ORDER BY nome")?;
            let linhas = stmt
                .query_map([], |r| {
                    Ok(serde_json::json!({ "id": r.get::<_, String>(0)?, "nome": r.get::<_, String>(1)?, "documento": r.get::<_, Option<String>>(2)?, "observacoes": r.get::<_, Option<String>>(3)? }))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await?;
    Ok(Json(serde_json::json!(linhas)))
}

#[derive(Debug, Deserialize)]
pub struct BeneficiarioPayload {
    pub nome: String,
    #[serde(default)]
    pub documento: Option<String>,
    #[serde(default)]
    pub observacoes: Option<String>,
}

pub async fn criar_ou_encontrar(State(state): State<AppState>, Json(payload): Json<BeneficiarioPayload>) -> AppResult<Json<serde_json::Value>> {
    let nome = payload.nome.trim().to_string();
    let existente: Option<String> = state
        .db
        .with({
            let nome = nome.clone();
            move |conn| conn.query_row("SELECT id FROM beneficiario WHERE nome = ?1", [&nome], |r| r.get(0)).optional()
        })
        .await?;
    if let Some(id) = existente {
        return Ok(Json(serde_json::json!({ "id": id, "nome": nome, "novo": false })));
    }

    let id = new_id();
    state
        .db
        .with({
            let id = id.clone();
            let nome = nome.clone();
            move |conn| conn.execute("INSERT INTO beneficiario (id, nome, documento, observacoes) VALUES (?1, ?2, ?3, ?4)", rusqlite::params![id, nome, payload.documento, payload.observacoes])
        })
        .await?;
    Ok(Json(serde_json::json!({ "id": id, "nome": nome, "novo": true })))
}
