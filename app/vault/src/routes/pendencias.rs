//! `/vault/pendencias` (seção 11.14) — lembrete de receita/despesa sem data
//! definida ainda; `converter` vira `transacao` e apaga a pendência.

use axum::extract::{Path, State};
use axum::Json;
use chrono::NaiveDate;
use ecos_core::{new_id, ErrorCode};
use rusqlite::OptionalExtension;
use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

fn linha_para_json(r: &rusqlite::Row) -> rusqlite::Result<serde_json::Value> {
    Ok(serde_json::json!({
        "id": r.get::<_, String>(0)?, "tipo": r.get::<_, String>(1)?, "descricao": r.get::<_, String>(2)?,
        "valor_centavos": r.get::<_, i64>(3)?, "categoria_id": r.get::<_, Option<String>>(4)?,
        "beneficiario_id": r.get::<_, Option<String>>(5)?, "transacao_recorrente_id": r.get::<_, Option<String>>(6)?,
        "observacoes": r.get::<_, Option<String>>(7)?, "espaco": r.get::<_, String>(8)?,
        "criado_em": r.get::<_, String>(9)?, "atualizado_em": r.get::<_, String>(10)?,
    }))
}

const COLUNAS: &str = "id, tipo, descricao, valor_centavos, categoria_id, beneficiario_id, transacao_recorrente_id, \
     observacoes, espaco, criado_em, atualizado_em";

pub async fn listar(State(state): State<AppState>) -> AppResult<Json<serde_json::Value>> {
    let linhas: Vec<serde_json::Value> = state
        .db
        .with(|conn| {
            let mut stmt = conn.prepare(&format!("SELECT {COLUNAS} FROM pendencia_avulsa ORDER BY criado_em DESC"))?;
            let linhas = stmt.query_map([], linha_para_json)?.collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await?;
    Ok(Json(serde_json::json!(linhas)))
}

#[derive(Debug, Deserialize)]
pub struct PendenciaPayload {
    pub tipo: String,
    pub descricao: String,
    pub valor_centavos: i64,
    #[serde(default)]
    pub categoria_id: Option<String>,
    #[serde(default)]
    pub beneficiario_id: Option<String>,
    #[serde(default)]
    pub observacoes: Option<String>,
    #[serde(default = "espaco_padrao")]
    pub espaco: String,
}

fn espaco_padrao() -> String {
    "pessoal".to_string()
}

pub async fn criar(State(state): State<AppState>, Json(payload): Json<PendenciaPayload>) -> AppResult<Json<serde_json::Value>> {
    if !["entrada", "saida"].contains(&payload.tipo.as_str()) {
        return Err(AppError::new(ErrorCode::ValidationError).with_message("tipo deve ser 'entrada' ou 'saida'"));
    }
    if payload.valor_centavos <= 0 {
        return Err(AppError::new(ErrorCode::TransactionInvalidAmount));
    }
    let id = new_id();
    state
        .db
        .with({
            let id = id.clone();
            move |conn| {
                conn.execute(
                    "INSERT INTO pendencia_avulsa (id, tipo, descricao, valor_centavos, categoria_id, beneficiario_id, observacoes, espaco) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    rusqlite::params![id, payload.tipo, payload.descricao, payload.valor_centavos, payload.categoria_id, payload.beneficiario_id, payload.observacoes, payload.espaco],
                )
            }
        })
        .await?;
    Ok(Json(serde_json::json!({ "id": id })))
}

pub async fn excluir(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let afetadas = state.db.with(move |conn| conn.execute("DELETE FROM pendencia_avulsa WHERE id = ?1", [&id])).await?;
    if afetadas == 0 {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Debug, Deserialize)]
pub struct ConverterPayload {
    pub data: NaiveDate,
}

pub async fn converter(State(state): State<AppState>, Path(id): Path<String>, Json(payload): Json<ConverterPayload>) -> AppResult<Json<serde_json::Value>> {
    let pendencia: Option<(String, String, i64, Option<String>, Option<String>, Option<String>, String)> = state
        .db
        .with({
            let id = id.clone();
            move |conn| {
                conn.query_row(
                    "SELECT tipo, descricao, valor_centavos, categoria_id, beneficiario_id, observacoes, espaco FROM pendencia_avulsa WHERE id = ?1",
                    [&id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
                )
                .optional()
            }
        })
        .await?;
    let (tipo, descricao, valor_centavos, categoria_id, beneficiario_id, observacoes, espaco) = pendencia.ok_or(AppError::new(ErrorCode::NotFound))?;

    let transacao_id = new_id();
    state
        .db
        .with({
            let transacao_id = transacao_id.clone();
            let id = id.clone();
            move |conn| {
                let tx = conn.unchecked_transaction()?;
                tx.execute(
                    "INSERT INTO transacao (id, tipo, valor_centavos, data, descricao, categoria_id, beneficiario_id, observacoes, origem, espaco, criado_por) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'manual', ?9, 'usuario_local')",
                    rusqlite::params![transacao_id, tipo, valor_centavos, payload.data.to_string(), descricao, categoria_id, beneficiario_id, observacoes, espaco],
                )?;
                tx.execute("DELETE FROM pendencia_avulsa WHERE id = ?1", [&id])?;
                tx.commit()
            }
        })
        .await?;

    Ok(Json(serde_json::json!({ "transacao_id": transacao_id })))
}
