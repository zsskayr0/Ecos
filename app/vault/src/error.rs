//! Catálogo de erros do Cofre (seção 7.3) — mesmo `ecos_core::ErrorCode` do
//! `ecos-app`, pra nunca divergir de mensagem entre os dois serviços.

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use ecos_core::ErrorCode;
use serde::Serialize;

use crate::db::VaultDbError;

#[derive(Debug)]
pub struct AppError {
    code: ErrorCode,
    message: Option<String>,
    details: Option<serde_json::Value>,
}

impl AppError {
    pub fn new(code: ErrorCode) -> Self {
        Self { code, message: None, details: None }
    }

    /// Dados estruturados do erro, para a tela agir sem interpretar a mensagem. Só aparece no corpo quando definido.
    pub fn with_details(mut self, details: serde_json::Value) -> Self {
        self.details = Some(details);
        self
    }

    pub fn with_message(mut self, message: impl Into<String>) -> Self {
        self.message = Some(message.into());
        self
    }
}

impl From<ErrorCode> for AppError {
    fn from(code: ErrorCode) -> Self {
        AppError::new(code)
    }
}

impl From<VaultDbError> for AppError {
    fn from(err: VaultDbError) -> Self {
        match err {
            VaultDbError::Bloqueado => AppError::new(ErrorCode::VaultLocked),
            VaultDbError::Sql(err) => {
                tracing::error!(error = %err, "erro de banco de dados no vault");
                AppError::new(ErrorCode::InternalError)
            }
        }
    }
}

impl From<anyhow::Error> for AppError {
    fn from(err: anyhow::Error) -> Self {
        tracing::error!(error = %err, "erro interno no vault");
        AppError::new(ErrorCode::InternalError)
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        tracing::error!(error = %err, "erro de I/O no vault");
        AppError::new(ErrorCode::InternalError)
    }
}

#[derive(Serialize)]
struct ErrorBody {
    error: ErrorCode,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    details: Option<serde_json::Value>,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = StatusCode::from_u16(self.code.http_status()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
        let body = ErrorBody {
            error: self.code,
            message: self.message.unwrap_or_else(|| self.code.message().to_string()),
            details: self.details,
        };
        (status, Json(body)).into_response()
    }
}

pub type AppResult<T> = Result<T, AppError>;
