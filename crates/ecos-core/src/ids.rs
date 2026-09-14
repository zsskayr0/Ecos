//! Identidade estável de Nota/Tarefa/Transação/etc: sempre um ULID (seção 1.3
//! — ordenável por tempo de criação, ao contrário de UUID v4, o que ajuda
//! paginação por cursor sem campo extra de índice).

use ulid::Ulid;

/// Gera um novo identificador ULID (formato Crockford base32, 26 chars).
pub fn new_id() -> String {
    Ulid::new().to_string()
}

/// Valida que uma string é um ULID bem formado (usado na validação de
/// payload da seção 7.2 — nunca confiar em id vindo de fora sem checar).
pub fn is_valid_id(id: &str) -> bool {
    Ulid::from_string(id).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gera_ids_unicos_e_validos() {
        let a = new_id();
        let b = new_id();
        assert_ne!(a, b);
        assert!(is_valid_id(&a));
        assert!(is_valid_id(&b));
    }

    #[test]
    fn rejeita_id_invalido() {
        assert!(!is_valid_id("nao-e-um-ulid"));
        assert!(!is_valid_id(""));
    }
}
