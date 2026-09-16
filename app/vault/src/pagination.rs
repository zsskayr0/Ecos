//! Paginação por cursor (seção 11.1) — mesma convenção do `ecos-app`
//! (`routes::pagination` lá, este módulo aqui — pequeno demais pra virar
//! dependência compartilhada, mas o formato do cursor é idêntico).

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
