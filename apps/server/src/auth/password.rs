//! Hash de senha e de recovery key — sempre Argon2id (seção 5.1).

use argon2::password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use ecos_core::ErrorCode;

use crate::error::AppError;

pub fn hash(segredo: &str) -> Result<String, AppError> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(segredo.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|err| {
            tracing::error!(error = %err, "falha ao gerar hash Argon2id");
            AppError::new(ErrorCode::InternalError)
        })
}

/// `true` só se `segredo` bate com o hash — nunca compara string crua (a
/// própria natureza do Argon2id já é resistente a timing attack, seção 5.4).
pub fn verify(segredo: &str, hash: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(hash) else {
        return false;
    };
    Argon2::default().verify_password(segredo.as_bytes(), &parsed).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_e_verify_fazem_roundtrip() {
        let h = hash("senha-super-secreta").unwrap();
        assert!(verify("senha-super-secreta", &h));
        assert!(!verify("senha-errada", &h));
    }
}
