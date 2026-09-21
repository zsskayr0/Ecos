//! Catálogo fechado de erros do domínio (seção 7). Compartilhado por
//! `ecos-app` e `ecos-vault-db` para que a mesma condição nunca produza
//! mensagens divergentes entre os dois serviços — regra "nunca mensagem
//! genérica de framework, nunca stack trace vazando" (seção 7.3).
//!
//! Esta crate não conhece HTTP (ver seção 10.1: sem `axum` aqui) — cada
//! aplicação mapeia `ErrorCode::http_status()` pro tipo de status da sua
//! própria stack web.

use serde::{Deserialize, Serialize};

/// Códigos de erro do catálogo. As variantes do Cofre (seção 7.3) usam o
/// texto **literal** do documento — nunca reformular a mensagem por conta
/// própria.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    // --- Cofre (seção 7.3) — catálogo fechado, mensagem literal ---
    VaultLocked,
    VaultDisabled,
    TransactionInvalidAmount,
    CategoryNotFound,
    AccountNotFound,
    PaymentMethodInvalid,
    RecurringTransactionNotFound,
    RecurringInstallmentsRequired,
    AttachmentTooLarge,
    VaultBackupFailed,

    // --- Gerais (seção 7.1 e regras de segurança da seção 5.4) ---
    ValidationError,
    NotFound,
    Unauthorized,
    Forbidden,
    Conflict,
    RateLimited,
    InvalidCredentials,
    ConfirmationPhraseRequired,
    /// Conta criada pela administração (ou com a senha redefinida): só a troca de senha é permitida até ser feita.
    PasswordChangeRequired,
    NotImplemented,
    InternalError,
}

impl ErrorCode {
    /// Mensagem fixa em português, tom literal/sem humor (regra do domínio
    /// financeiro, extendida a todo erro pela seção 5.4/7.3).
    pub fn message(self) -> &'static str {
        match self {
            ErrorCode::VaultLocked => "O Cofre está bloqueado. Autentique-se com biometria para continuar.",
            ErrorCode::VaultDisabled => "O módulo Cofre não está ativado nesta instância.",
            ErrorCode::TransactionInvalidAmount => "O valor da transação deve ser maior que zero.",
            ErrorCode::CategoryNotFound => "Categoria informada não existe.",
            ErrorCode::AccountNotFound => "Conta informada não existe.",
            ErrorCode::PaymentMethodInvalid => "Forma de pagamento inválida.",
            ErrorCode::RecurringTransactionNotFound => "Recorrência informada não existe.",
            ErrorCode::RecurringInstallmentsRequired => {
                "Recorrência parcelada exige o número total de parcelas."
            }
            ErrorCode::AttachmentTooLarge => "O comprovante excede o tamanho máximo permitido (8MB).",
            ErrorCode::VaultBackupFailed => "Falha ao gerar backup do Cofre. Nenhum dado foi alterado.",

            ErrorCode::ValidationError => "Um ou mais campos são inválidos.",
            ErrorCode::NotFound => "Recurso não encontrado.",
            ErrorCode::Unauthorized => "Autenticação necessária.",
            ErrorCode::Forbidden => "Você não tem permissão para esta ação.",
            ErrorCode::Conflict => "O estado atual do recurso não permite esta operação.",
            ErrorCode::RateLimited => "Muitas tentativas em pouco tempo. Aguarde antes de tentar novamente.",
            ErrorCode::InvalidCredentials => "Usuário ou senha inválidos.",
            ErrorCode::ConfirmationPhraseRequired => "Esta ação exige a frase de confirmação exata.",
            ErrorCode::PasswordChangeRequired => "Você precisa trocar a senha temporária antes de continuar.",
            ErrorCode::NotImplemented => "Esta funcionalidade ainda não está disponível nesta instância.",
            ErrorCode::InternalError => "Erro interno. Nenhum dado foi alterado.",
        }
    }

    /// Status HTTP convencional para o código — cada serviço converte para
    /// o tipo de status da sua própria stack web (seção 10.1: esta crate
    /// não depende de `axum`).
    pub fn http_status(self) -> u16 {
        match self {
            ErrorCode::VaultDisabled => 404, // nunca 403 — não revela nem a existência (seção 5.3)
            ErrorCode::NotFound
            | ErrorCode::CategoryNotFound
            | ErrorCode::AccountNotFound
            | ErrorCode::RecurringTransactionNotFound => 404,
            ErrorCode::VaultLocked | ErrorCode::Unauthorized | ErrorCode::InvalidCredentials => 401,
            ErrorCode::Forbidden | ErrorCode::PasswordChangeRequired => 403,
            ErrorCode::Conflict => 409,
            ErrorCode::RateLimited => 429,
            ErrorCode::ValidationError
            | ErrorCode::TransactionInvalidAmount
            | ErrorCode::PaymentMethodInvalid
            | ErrorCode::RecurringInstallmentsRequired
            | ErrorCode::AttachmentTooLarge
            | ErrorCode::ConfirmationPhraseRequired => 422,
            ErrorCode::NotImplemented => 501,
            ErrorCode::VaultBackupFailed | ErrorCode::InternalError => 500,
        }
    }
}

/// Corpo de resposta de erro — contrato `{error: CODE, message}` (seção 7).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorInfo {
    pub error: ErrorCode,
    pub message: String,
}

impl From<ErrorCode> for ErrorInfo {
    fn from(code: ErrorCode) -> Self {
        Self {
            error: code,
            message: code.message().to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializa_como_screaming_snake_case() {
        let json = serde_json::to_string(&ErrorCode::VaultLocked).unwrap();
        assert_eq!(json, "\"VAULT_LOCKED\"");
    }

    #[test]
    fn vault_disabled_nunca_e_403() {
        assert_eq!(ErrorCode::VaultDisabled.http_status(), 404);
    }

    #[test]
    fn error_info_carrega_mensagem_literal() {
        let info: ErrorInfo = ErrorCode::TransactionInvalidAmount.into();
        assert_eq!(info.message, "O valor da transação deve ser maior que zero.");
    }
}
