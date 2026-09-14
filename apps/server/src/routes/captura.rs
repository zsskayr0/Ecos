//! Captura universal (seção 11.3) — endpoint único do FAB, despacha pro
//! serializer/validator específico de cada tipo lógico (seção 7.2).
//! `transacao` é a única variante que não tem dado nenhum aqui: só repassa
//! pro `ecos-vault-db` via o mesmo mecanismo do proxy (seção 11.14).

use axum::extract::State;
use axum::Json;
use ecos_core::ErrorCode;
use serde::Deserialize;

use crate::error::{AppError, AppResult, CampoInvalido};
use crate::routes::{notas, tarefas};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct CapturaPayload {
    pub tipo: String,
    #[serde(flatten)]
    pub campos: serde_json::Value,
}

pub async fn capturar(State(state): State<AppState>, Json(payload): Json<CapturaPayload>) -> AppResult<Json<serde_json::Value>> {
    match payload.tipo.as_str() {
        "nota" => {
            let corpo: notas::CriarNotaPayload = serde_json::from_value(payload.campos)
                .map_err(|e| AppError::validation(vec![CampoInvalido { campo: "campos".into(), motivo: e.to_string() }]))?;
            notas::criar(State(state), Json(corpo)).await
        }
        "tarefa" => {
            let corpo: tarefas::CriarTarefaPayload = serde_json::from_value(payload.campos)
                .map_err(|e| AppError::validation(vec![CampoInvalido { campo: "campos".into(), motivo: e.to_string() }]))?;
            tarefas::criar(State(state), Json(corpo)).await
        }
        "transacao" => {
            if !state.config.vault_enabled {
                return Err(AppError::new(ErrorCode::VaultDisabled));
            }
            let url = format!("{}/vault/transacoes", state.config.vault_internal_url);
            let resposta = state
                .http
                .post(url)
                .json(&payload.campos)
                .send()
                .await
                .map_err(|_| AppError::new(ErrorCode::InternalError))?;
            let status = resposta.status();
            let corpo: serde_json::Value = resposta.json().await.unwrap_or(serde_json::json!({}));
            if !status.is_success() {
                return Err(AppError::new(ErrorCode::ValidationError).with_message(corpo.get("message").and_then(|v| v.as_str()).unwrap_or("Falha ao criar transação.").to_string()));
            }
            Ok(Json(corpo))
        }
        outro => Err(AppError::validation(vec![CampoInvalido {
            campo: "tipo".into(),
            motivo: format!("'{outro}' não é um tipo de Captura válido (nota|tarefa|transacao)"),
        }])),
    }
}

/// Mapa de campos que migram entre tipos ao trocar em runtime (seção 7.2) —
/// o front não precisa hardcodar essa lógica duas vezes.
pub async fn campos_compativeis() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "compartilhados": ["titulo"],
        "nota": ["titulo", "corpo", "tags", "pasta", "espaco", "modo"],
        "tarefa": ["titulo", "pasta", "espaco", "scheduled_at", "duration_min", "due_date"],
        "transacao": ["titulo (vira descricao)", "valor_centavos", "categoria_id", "conta_id", "forma_pagamento", "espaco"],
    }))
}
