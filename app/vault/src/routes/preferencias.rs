//! `/vault/preferencias` — escolhas de cada pessoa dentro do Cofre: conta padrão e a ordem das contas e das
//! categorias. São por pessoa (o autor da requisição), mesmo num Cofre de equipe compartilhado; `contas::listar`
//! e `categorias::listar` já devolvem tudo ordenado e com `padrao` por quem pergunta, então as telas não precisam
//! reaplicar nada.

use axum::extract::{Path, State};
use axum::Json;
use ecos_core::ErrorCode;
use rusqlite::{Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::Value;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

pub const CONTA_PADRAO: &str = "conta_padrao";
pub const ORDEM_CONTAS: &str = "ordem_contas";
pub const ORDEM_CATEGORIAS: &str = "ordem_categorias";
const CHAVES: [&str; 3] = [CONTA_PADRAO, ORDEM_CONTAS, ORDEM_CATEGORIAS];
const MAXIMO_ITENS: usize = 2000;

/// Lê uma preferência de `usuario`; `None` quando nunca foi definida (ou o valor guardado não é JSON).
pub(crate) fn ler(conn: &Connection, usuario: &str, chave: &str) -> rusqlite::Result<Option<Value>> {
    let texto: Option<String> = conn.query_row("SELECT valor FROM preferencia WHERE usuario_id = ?1 AND chave = ?2", [usuario, chave], |r| r.get(0)).optional()?;
    Ok(texto.and_then(|t| serde_json::from_str(&t).ok()))
}

pub(crate) fn ler_ordem(conn: &Connection, usuario: &str, chave: &str) -> rusqlite::Result<Vec<String>> {
    Ok(ler(conn, usuario, chave)?
        .and_then(|v| v.as_array().map(|a| a.iter().filter_map(|i| i.as_str().map(str::to_string)).collect()))
        .unwrap_or_default())
}

/// Itens da ordem escolhida primeiro, na ordem escolhida; o que não está nela (itens novos) vai depois, na ordem em que veio.
pub(crate) fn ordenar_por(itens: &mut [Value], ordem: &[String]) {
    let posicao = |v: &Value| v["id"].as_str().and_then(|id| ordem.iter().position(|o| o == id)).unwrap_or(usize::MAX);
    itens.sort_by_key(posicao); // sort estável: os sem posição mantêm a ordem alfabética do SQL
}

pub async fn obter(State(state): State<AppState>) -> AppResult<Json<Value>> {
    let usuario = crate::db::autor_atual().unwrap_or_default();
    let resposta = state
        .db
        .with(move |conn| {
            Ok(serde_json::json!({
                CONTA_PADRAO: ler(conn, &usuario, CONTA_PADRAO)?.filter(|v| v.is_string()),
                ORDEM_CONTAS: ler_ordem(conn, &usuario, ORDEM_CONTAS)?,
                ORDEM_CATEGORIAS: ler_ordem(conn, &usuario, ORDEM_CATEGORIAS)?,
            }))
        })
        .await?;
    Ok(Json(resposta))
}

#[derive(Debug, Deserialize)]
pub struct Corpo {
    pub valor: Value,
}

fn invalido(msg: &str) -> AppError {
    AppError::new(ErrorCode::ValidationError).with_message(msg)
}

pub async fn salvar(State(state): State<AppState>, Path(chave): Path<String>, Json(corpo): Json<Corpo>) -> AppResult<Json<Value>> {
    if !CHAVES.contains(&chave.as_str()) {
        return Err(invalido("preferência desconhecida"));
    }
    let usuario = crate::db::autor_atual().unwrap_or_default();
    let valor = if chave == CONTA_PADRAO {
        match &corpo.valor {
            Value::Null => None,
            Value::String(id) if !id.is_empty() && id.len() <= 64 => Some(corpo.valor.clone()),
            _ => return Err(invalido("conta padrão deve ser o id de uma conta ou nulo")),
        }
    } else {
        let Value::Array(itens) = &corpo.valor else { return Err(invalido("a ordem deve ser uma lista de ids")) };
        if itens.len() > MAXIMO_ITENS || !itens.iter().all(|i| i.as_str().is_some_and(|s| !s.is_empty() && s.len() <= 64)) {
            return Err(invalido("lista de ids inválida"));
        }
        // Sem repetição: o primeiro vale.
        let mut vistos = std::collections::HashSet::new();
        Some(Value::Array(itens.iter().filter(|i| vistos.insert(i.as_str().unwrap_or_default().to_string())).cloned().collect()))
    };
    let gravou = state
        .db
        .with(move |conn| {
            if chave == CONTA_PADRAO {
                if let Some(Value::String(id)) = &valor {
                    let existe: Option<i64> = conn.query_row("SELECT 1 FROM conta WHERE id = ?1", [id], |r| r.get(0)).optional()?;
                    if existe.is_none() {
                        return Ok(false);
                    }
                }
            }
            match valor {
                Some(v) => conn.execute(
                    "INSERT INTO preferencia (usuario_id, chave, valor) VALUES (?1, ?2, ?3) \
                     ON CONFLICT(usuario_id, chave) DO UPDATE SET valor = excluded.valor, atualizado_em = datetime('now')",
                    rusqlite::params![usuario, chave, v.to_string()],
                )?,
                None => conn.execute("DELETE FROM preferencia WHERE usuario_id = ?1 AND chave = ?2", [&usuario, &chave])?,
            };
            Ok(true)
        })
        .await?;
    if !gravou {
        return Err(AppError::new(ErrorCode::AccountNotFound));
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}
