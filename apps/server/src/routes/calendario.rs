//! Calendário externo (seção 11.13 / 6.5). `GET /calendario/config` e
//! `DELETE /calendario/:provider` são reais (leem/limpam
//! `config_calendario`); `conectar`/`callback` exigem client_id/secret OAuth
//! de um app registrado no Google/Microsoft, que não existe neste ambiente
//! — ficam com contrato correto e `501 NOT_IMPLEMENTED` explícito, nunca um
//! fluxo OAuth fingido.

use axum::extract::{Path, State};
use axum::{Extension, Json};
use ecos_core::ErrorCode;

use crate::error::{AppError, AppResult};
use crate::middleware::auth_guard::UsuarioAutenticado;
use crate::state::AppState;

pub async fn config(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>) -> AppResult<Json<serde_json::Value>> {
    let providers: Vec<(String, String)> = state
        .db
        .with(move |conn| {
            let mut stmt = conn.prepare("SELECT provider, conectado_em FROM config_calendario WHERE usuario_id = ?1")?;
            let linhas = stmt.query_map([&usuario.0], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await?;
    Ok(Json(serde_json::json!({
        "conectados": providers.into_iter().map(|(p, c)| serde_json::json!({"provider": p, "conectado_em": c})).collect::<Vec<_>>()
    })))
}

pub async fn conectar(Path(provider): Path<String>) -> AppResult<Json<serde_json::Value>> {
    if !["google", "microsoft"].contains(&provider.as_str()) {
        return Err(AppError::new(ErrorCode::ValidationError).with_message("provider deve ser 'google' ou 'microsoft'"));
    }
    Err(AppError::new(ErrorCode::NotImplemented)
        .with_message(format!("OAuth com {provider} exige um app registrado (client_id/secret) que esta instância não tem configurado.")))
}

pub async fn callback(Path(provider): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let _ = provider;
    Err(AppError::new(ErrorCode::NotImplemented))
}

pub async fn desconectar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(provider): Path<String>) -> AppResult<Json<serde_json::Value>> {
    // Desconecta preservando Tarefas — solta só o vínculo (seção 11.13), o
    // `evento_provider`/`evento_event_id` na Tarefa em si só é limpo no
    // próximo reindex a partir do `.md` (o backend não reescreve
    // front-matter fora de id/timestamps, seção 1.3).
    state
        .db
        .with(move |conn| conn.execute("DELETE FROM config_calendario WHERE usuario_id = ?1 AND provider = ?2", rusqlite::params![usuario.0, provider]))
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
