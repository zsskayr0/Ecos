//! Mapeia o catálogo de erros de `ecos-core` para respostas HTTP do Axum —
//! contrato `{error: CODE, message}` (seção 7), nunca stack trace vazando.

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use ecos_core::ErrorCode;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct CampoInvalido {
    pub campo: String,
    pub motivo: String,
}

#[derive(Debug)]
pub struct AppError {
    code: ErrorCode,
    message: Option<String>,
    /// Lista de campos inválidos — seção 7.2: "erro por campo, nunca
    /// mensagem genérica única".
    campos: Option<Vec<CampoInvalido>>,
}

impl AppError {
    pub fn new(code: ErrorCode) -> Self {
        Self {
            code,
            message: None,
            campos: None,
        }
    }

    pub fn validation(campos: Vec<CampoInvalido>) -> Self {
        Self {
            code: ErrorCode::ValidationError,
            message: None,
            campos: Some(campos),
        }
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

impl From<rusqlite::Error> for AppError {
    fn from(err: rusqlite::Error) -> Self {
        // Detalhe fica só no log estruturado (seção 3.2) — nunca no corpo
        // da resposta.
        tracing::error!(error = %err, "erro de banco de dados no índice local");
        AppError::new(ErrorCode::InternalError)
    }
}

impl From<ecos_core::frontmatter::FrontMatterError> for AppError {
    fn from(err: ecos_core::frontmatter::FrontMatterError) -> Self {
        AppError::validation(vec![CampoInvalido {
            campo: "corpo".into(),
            motivo: err.to_string(),
        }])
    }
}

impl From<anyhow::Error> for AppError {
    fn from(err: anyhow::Error) -> Self {
        tracing::error!(error = %err, "erro interno");
        AppError::new(ErrorCode::InternalError)
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        tracing::error!(error = %err, "erro de I/O no vault de arquivos");
        AppError::new(ErrorCode::InternalError)
    }
}

#[derive(Serialize)]
struct ErrorBody {
    error: ErrorCode,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    campos: Option<Vec<CampoInvalido>>,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = StatusCode::from_u16(self.code.http_status()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
        let body = ErrorBody {
            error: self.code,
            message: self.message.unwrap_or_else(|| self.code.message().to_string()),
            campos: self.campos,
        };
        (status, Json(body)).into_response()
    }
}

pub type AppResult<T> = Result<T, AppError>;
