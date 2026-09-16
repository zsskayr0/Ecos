//! Paginação por cursor (seção 11.1): "nunca offset — mais estável com
//! Feed/Notas mudando em tempo real". O cursor é opaco pro cliente — por
//! dentro, é um keyset `(valor_ordenacao, id)` codificado em base64, usado
//! em `WHERE (coluna, id) < (?, ?)` (comparação de tupla, suportada pelo
//! SQLite moderno embutido via `bundled`).

use base64::Engine as _;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct Cursor {
    pub valor_ordenacao: String,
    pub id: String,
}

pub fn codificar(valor_ordenacao: &str, id: &str) -> String {
    let cursor = Cursor {
        valor_ordenacao: valor_ordenacao.to_string(),
        id: id.to_string(),
    };
    let json = serde_json::to_vec(&cursor).expect("Cursor sempre serializa");
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(json)
}

pub fn decodificar(cursor: &str) -> Option<Cursor> {
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(cursor).ok()?;
    serde_json::from_slice(&bytes).ok()
}

#[derive(Debug, Serialize)]
pub struct Pagina<T: Serialize> {
    pub items: Vec<T>,
    pub next_cursor: Option<String>,
}

/// Limite de página padrão quando `?limit=` não vem no request — pequeno o
/// bastante pra Feed continuar responsivo, grande o bastante pra evitar
/// round-trips excessivos numa instância pessoal.
pub fn limite_efetivo(limit: Option<i64>) -> i64 {
    limit.unwrap_or(30).clamp(1, 200)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cursor_roundtrip() {
        let codificado = codificar("2026-09-14T10:00:00Z", "01J1");
        let decodificado = decodificar(&codificado).unwrap();
        assert_eq!(decodificado.valor_ordenacao, "2026-09-14T10:00:00Z");
        assert_eq!(decodificado.id, "01J1");
    }

    #[test]
    fn cursor_invalido_retorna_none() {
        assert!(decodificar("isso-nao-e-um-cursor-valido!!").is_none());
    }
}
