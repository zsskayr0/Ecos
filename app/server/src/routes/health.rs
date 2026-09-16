//! `GET /health` (liveness) e `GET /health/ready` (readiness — seção 3.3).

use axum::extract::State;
use axum::Json;
use serde_json::{json, Value};

use crate::state::AppState;

pub async fn liveness() -> Json<Value> {
    Json(json!({ "status": "ok" }))
}

pub async fn readiness(State(state): State<AppState>) -> Json<Value> {
    let indice_ok = state.db.with(|conn| conn.query_row("SELECT 1", [], |_| Ok(()))).await.is_ok();

    let vault_ok = if state.config.vault_enabled {
        let url = format!("{}/health", state.config.vault_internal_url);
        state
            .http
            .get(url)
            .timeout(std::time::Duration::from_secs(2))
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false)
    } else {
        true // desativado não é "não pronto" — só não se aplica (seção 5.3)
    };

    let status = if indice_ok && vault_ok { "ok" } else { "degraded" };
    Json(json!({
        "status": status,
        "indice_local": indice_ok,
        "vault_ativado": state.config.vault_enabled,
        "vault_conectado": vault_ok,
    }))
}
