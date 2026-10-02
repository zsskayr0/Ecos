//! `/vault/recorrencias` (seção 11.14) — fixa ou parcelada (seção 1.3). A
//! materialização das ocorrências vencidas em `transacao` roda como job
//! periódico (`crate::jobs::recorrencia`), usando
//! `ecos_core::recurrence::ocorrencias_vencidas`.

use axum::extract::{Path, State};
use axum::Json;
use chrono::NaiveDate;
use ecos_core::{new_id, ErrorCode};
use rusqlite::OptionalExtension;
use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

const COLUNAS: &str = "id, tipo, descricao, valor_centavos, categoria_id, conta_id, beneficiario_id, forma_pagamento, \
     tipo_recorrencia, frequencia, intervalo, dia_vencimento, data_inicio, data_fim, total_parcelas, parcelas_geradas, \
     observacoes, espaco, ativa, criado_em, atualizado_em, criado_por";

fn linha_para_json(r: &rusqlite::Row) -> rusqlite::Result<serde_json::Value> {
    Ok(serde_json::json!({
        "id": r.get::<_, String>(0)?, "tipo": r.get::<_, String>(1)?, "descricao": r.get::<_, String>(2)?,
        "valor_centavos": r.get::<_, i64>(3)?, "categoria_id": r.get::<_, Option<String>>(4)?,
        "conta_id": r.get::<_, Option<String>>(5)?, "beneficiario_id": r.get::<_, Option<String>>(6)?,
        "forma_pagamento": r.get::<_, Option<String>>(7)?, "tipo_recorrencia": r.get::<_, String>(8)?,
        "frequencia": r.get::<_, String>(9)?, "intervalo": r.get::<_, i64>(10)?, "dia_vencimento": r.get::<_, Option<i64>>(11)?,
        "data_inicio": r.get::<_, String>(12)?, "data_fim": r.get::<_, Option<String>>(13)?,
        "total_parcelas": r.get::<_, Option<i64>>(14)?, "parcelas_geradas": r.get::<_, i64>(15)?,
        "observacoes": r.get::<_, Option<String>>(16)?, "espaco": r.get::<_, String>(17)?,
        "ativa": r.get::<_, i64>(18)? != 0, "criado_em": r.get::<_, String>(19)?, "atualizado_em": r.get::<_, String>(20)?, "criado_por": r.get::<_, Option<String>>(21)?,
    }))
}

pub async fn listar(State(state): State<AppState>) -> AppResult<Json<serde_json::Value>> {
    let linhas: Vec<serde_json::Value> = state
        .db
        .with(|conn| {
            let mut stmt = conn.prepare(&format!("SELECT {COLUNAS} FROM transacao_recorrente ORDER BY criado_em DESC"))?;
            let linhas = stmt.query_map([], linha_para_json)?.collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await?;
    Ok(Json(serde_json::json!(linhas)))
}

#[derive(Debug, Deserialize)]
pub struct RecorrenciaPayload {
    pub tipo: String,
    pub descricao: String,
    pub valor_centavos: i64,
    #[serde(default)]
    pub categoria_id: Option<String>,
    #[serde(default)]
    pub conta_id: Option<String>,
    #[serde(default)]
    pub beneficiario_id: Option<String>,
    #[serde(default)]
    pub forma_pagamento: Option<String>,
    pub tipo_recorrencia: String,
    #[serde(default = "frequencia_padrao")]
    pub frequencia: String,
    #[serde(default = "intervalo_padrao")]
    pub intervalo: i64,
    #[serde(default)]
    pub dia_vencimento: Option<i64>,
    pub data_inicio: NaiveDate,
    #[serde(default)]
    pub data_fim: Option<NaiveDate>,
    #[serde(default)]
    pub total_parcelas: Option<i64>,
    #[serde(default)]
    pub observacoes: Option<String>,
    #[serde(default = "espaco_padrao")]
    pub espaco: String,
}

fn frequencia_padrao() -> String {
    "mensal".to_string()
}
fn intervalo_padrao() -> i64 {
    1
}
fn espaco_padrao() -> String {
    "pessoal".to_string()
}

fn validar(payload: &RecorrenciaPayload) -> AppResult<()> {
    if !(1..=1200).contains(&payload.intervalo) || payload.total_parcelas.is_some_and(|n| n <= 0 || n > 10000) || payload.dia_vencimento.is_some_and(|d| !(1..=31).contains(&d)) || payload.data_fim.is_some_and(|d| d < payload.data_inicio) {
        return Err(AppError::new(ErrorCode::ValidationError).with_message("Intervalo, parcelas, vencimento ou término inválido"));
    }

    if !["entrada", "saida"].contains(&payload.tipo.as_str()) {
        return Err(AppError::new(ErrorCode::ValidationError).with_message("tipo deve ser 'entrada' ou 'saida'"));
    }
    if payload.valor_centavos <= 0 {
        return Err(AppError::new(ErrorCode::TransactionInvalidAmount));
    }
    if !["fixa", "parcelada"].contains(&payload.tipo_recorrencia.as_str()) {
        return Err(AppError::new(ErrorCode::ValidationError).with_message("tipo_recorrencia deve ser 'fixa' ou 'parcelada'"));
    }
    if payload.tipo_recorrencia == "parcelada" && payload.total_parcelas.is_none() {
        return Err(AppError::new(ErrorCode::RecurringInstallmentsRequired));
    }
    if !["semanal", "mensal", "anual"].contains(&payload.frequencia.as_str()) {
        return Err(AppError::new(ErrorCode::ValidationError).with_message("frequencia deve ser 'semanal', 'mensal' ou 'anual'"));
    }
    Ok(())
}

pub async fn criar(State(state): State<AppState>, Json(payload): Json<RecorrenciaPayload>) -> AppResult<Json<serde_json::Value>> {
    validar(&payload)?;
    let id = new_id();
    let autor = crate::db::autor_atual();
    state
        .db
        .with({
            let id = id.clone();
            move |conn| {
                conn.execute(
                    "INSERT INTO transacao_recorrente (id, tipo, descricao, valor_centavos, categoria_id, conta_id, \
                     beneficiario_id, forma_pagamento, tipo_recorrencia, frequencia, intervalo, dia_vencimento, \
                     data_inicio, data_fim, total_parcelas, observacoes, espaco, criado_por) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
                    rusqlite::params![
                        id,
                        payload.tipo,
                        payload.descricao,
                        payload.valor_centavos,
                        payload.categoria_id,
                        payload.conta_id,
                        payload.beneficiario_id,
                        payload.forma_pagamento,
                        payload.tipo_recorrencia,
                        payload.frequencia,
                        payload.intervalo,
                        payload.dia_vencimento,
                        payload.data_inicio.to_string(),
                        payload.data_fim.map(|d| d.to_string()),
                        payload.total_parcelas,
                        payload.observacoes,
                        payload.espaco,
                        autor,
                    ],
                )
            }
        })
        .await?;
    Ok(Json(serde_json::json!({ "id": id })))
}

pub async fn obter(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let linha: Option<serde_json::Value> = state
        .db
        .with(move |conn| conn.query_row(&format!("SELECT {COLUNAS} FROM transacao_recorrente WHERE id = ?1"), [&id], linha_para_json).optional())
        .await?;
    linha.map(Json).ok_or(AppError::new(ErrorCode::RecurringTransactionNotFound))
}

pub async fn atualizar(State(state): State<AppState>, Path(id): Path<String>, Json(payload): Json<RecorrenciaPayload>) -> AppResult<Json<serde_json::Value>> {
    validar(&payload)?;
    let afetadas = state
        .db
        .with({
            let id = id.clone();
            move |conn| {
                conn.execute(
                    "UPDATE transacao_recorrente SET tipo=?1, descricao=?2, valor_centavos=?3, categoria_id=?4, conta_id=?5, \
                     beneficiario_id=?6, forma_pagamento=?7, frequencia=?8, intervalo=?9, dia_vencimento=?10, data_fim=?11, \
                     total_parcelas=?12, observacoes=?13, atualizado_em=datetime('now') WHERE id=?14",
                    rusqlite::params![
                        payload.tipo,
                        payload.descricao,
                        payload.valor_centavos,
                        payload.categoria_id,
                        payload.conta_id,
                        payload.beneficiario_id,
                        payload.forma_pagamento,
                        payload.frequencia,
                        payload.intervalo,
                        payload.dia_vencimento,
                        payload.data_fim.map(|d| d.to_string()),
                        payload.total_parcelas,
                        payload.observacoes,
                        id,
                    ],
                )
            }
        })
        .await?;
    if afetadas == 0 {
        return Err(AppError::new(ErrorCode::RecurringTransactionNotFound));
    }
    obter(State(state), Path(id)).await
}

pub async fn excluir(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let afetadas = state.db.with(move |conn| conn.execute("DELETE FROM transacao_recorrente WHERE id = ?1", [&id])).await?;
    if afetadas == 0 {
        return Err(AppError::new(ErrorCode::RecurringTransactionNotFound));
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn duplicar(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let nova_id = new_id();
    let afetadas = state
        .db
        .with({
            let id = id.clone();
            let nova_id = nova_id.clone();
            move |conn| {
                let colunas_sem_id = COLUNAS.trim_start_matches("id, ");
                conn.execute(
                    &format!("INSERT INTO transacao_recorrente (id, {colunas_sem_id}) SELECT ?1, {colunas_sem_id} FROM transacao_recorrente WHERE id = ?2"),
                    rusqlite::params![nova_id, id],
                )
            }
        })
        .await?;
    if afetadas == 0 {
        return Err(AppError::new(ErrorCode::RecurringTransactionNotFound));
    }
    Ok(Json(serde_json::json!({ "id": nova_id })))
}

#[derive(Debug, Deserialize)]
pub struct ExclusaoPayload {
    pub data_ocorrencia: NaiveDate,
}

/// Pula só uma ocorrência, sem gerar `transacao` e sem afetar os outros
/// meses (seção 1.3, `recorrencia_exclusao`).
pub async fn adicionar_exclusao(State(state): State<AppState>, Path(id): Path<String>, Json(payload): Json<ExclusaoPayload>) -> AppResult<Json<serde_json::Value>> {
    state
        .db
        .with(move |conn| {
            conn.execute(
                "INSERT OR IGNORE INTO recorrencia_exclusao (transacao_recorrente_id, data_ocorrencia) VALUES (?1, ?2)",
                rusqlite::params![id, payload.data_ocorrencia.to_string()],
            )
        })
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
