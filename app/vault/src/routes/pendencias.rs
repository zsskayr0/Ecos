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
    let result = state.db.with(move |c| {
        let tx = c.unchecked_transaction()?;
        let existente: Option<String> = tx.query_row("SELECT transacao_id FROM pendencia_convertida WHERE pendencia_id=?1", [&id], |r| r.get(0)).optional()?;
        if existente.is_some() { return Ok(existente); }
        let transacao_id = new_id();
        let n = tx.execute("INSERT INTO transacao (id,tipo,valor_centavos,data,descricao,categoria_id,beneficiario_id,observacoes,espaco,criado_por,conciliada) SELECT ?1,tipo,valor_centavos,?2,descricao,categoria_id,beneficiario_id,observacoes,espaco,'usuario_local',1 FROM pendencia_avulsa WHERE id=?3", rusqlite::params![transacao_id,payload.data.to_string(),id])?;
        if n == 0 { return Ok(None); }
        tx.execute("DELETE FROM pendencia_avulsa WHERE id=?1", [&id])?;
        tx.execute("INSERT INTO pendencia_convertida VALUES(?1,?2)", [&id,&transacao_id])?;
        tx.commit()?;
        Ok(Some(transacao_id))
    }).await?;
    let id = result.ok_or(AppError::new(ErrorCode::NotFound))?;
    Ok(Json(serde_json::json!({"transacao_id":id})))
}
