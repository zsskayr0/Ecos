//! Notificações (seção 11.11).

use axum::extract::{Path, Query, State};
use axum::{Extension, Json};
use ecos_core::ErrorCode;
use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::middleware::auth_guard::UsuarioAutenticado;
use crate::routes::pagination::{codificar, decodificar, limite_efetivo, Pagina};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct ListarQuery {
    pub categoria: Option<String>,
    pub lida: Option<bool>,
    pub cursor: Option<String>,
    pub limit: Option<i64>,
}

/// Grava uma notificação. Com `chave`, é idempotente por pessoa (a mesma chave nunca gera duas linhas).
pub fn criar(conn: &rusqlite::Connection, usuario_id: &str, categoria: &str, titulo: &str, corpo: &str, chave: Option<&str>) -> rusqlite::Result<bool> {
    let n = conn.execute(
        "INSERT OR IGNORE INTO notificacao (id, usuario_id, categoria, titulo, corpo, lida, criado_em, chave) VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7)",
        rusqlite::params![ecos_core::new_id(), usuario_id, categoria, titulo, corpo, chrono::Utc::now().to_rfc3339(), chave],
    )?;
    Ok(n > 0)
}

/// Produtor de "prazo próximo": tarefas pendentes da pessoa com prazo hoje ou amanhã (data civil no fuso das
/// preferências dela; sem preferência, America/Sao_Paulo). Uma notificação por tarefa e dia de prazo.
fn varrer_prazos(conn: &rusqlite::Connection, usuario_id: &str) -> rusqlite::Result<()> {
    let fuso: String = conn
        .query_row("SELECT fuso FROM preferencia_calendario WHERE usuario_id = ?1", [usuario_id], |r| r.get(0))
        .unwrap_or_else(|_| "America/Sao_Paulo".to_string());
    let tz: chrono_tz::Tz = fuso.parse().unwrap_or(chrono_tz::America::Sao_Paulo);
    let hoje = chrono::Utc::now().with_timezone(&tz).date_naive();
    let amanha = hoje + chrono::Duration::days(1);
    let (h, a) = (hoje.format("%Y-%m-%d").to_string(), amanha.format("%Y-%m-%d").to_string());
    let mut stmt = conn.prepare("SELECT id, titulo, due_date FROM tarefa WHERE espaco = 'pessoal' AND criado_por = ?1 AND status = 'pendente' AND due_date IN (?2, ?3)")?;
    let tarefas = stmt.query_map(rusqlite::params![usuario_id, h, a], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))?.collect::<Result<Vec<_>, _>>()?;
    for (id, titulo, due) in tarefas {
        let quando = if due == h { "vence hoje" } else { "vence amanhã" };
        criar(conn, usuario_id, "agenda", "Prazo próximo", &format!("A tarefa \"{titulo}\" {quando}."), Some(&format!("prazo:{id}:{due}")))?;
    }
    Ok(())
}

/// `GET /notificacoes/nao-lidas` — contador do sino.
pub async fn nao_lidas(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>) -> AppResult<Json<serde_json::Value>> {
    let total: i64 = state
        .db
        .with(move |conn| {
            let _ = varrer_prazos(conn, &usuario.0);
            conn.query_row("SELECT COUNT(*) FROM notificacao WHERE usuario_id = ?1 AND lida = 0", [&usuario.0], |r| r.get(0))
        })
        .await?;
    Ok(Json(serde_json::json!({ "total": total })))
}

pub async fn listar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Query(q): Query<ListarQuery>) -> AppResult<Json<Pagina<serde_json::Value>>> {
    let limite = limite_efetivo(q.limit);
    let cursor = q.cursor.as_deref().and_then(decodificar);

    let linhas: Vec<serde_json::Value> = state
        .db
        .with(move |conn| {
            let _ = varrer_prazos(conn, &usuario.0);
            let mut sql = String::from("SELECT id, categoria, titulo, corpo, lida, criado_em FROM notificacao WHERE usuario_id = ?");
            let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(usuario.0.clone())];

            if let Some(categoria) = &q.categoria {
                sql.push_str(" AND categoria = ?");
                params.push(Box::new(categoria.clone()));
            }
            if let Some(lida) = q.lida {
                sql.push_str(" AND lida = ?");
                params.push(Box::new(lida as i64));
            }
            if let Some(c) = &cursor {
                sql.push_str(" AND (criado_em, id) < (?, ?)");
                params.push(Box::new(c.valor_ordenacao.clone()));
                params.push(Box::new(c.id.clone()));
            }
            sql.push_str(" ORDER BY criado_em DESC, id DESC LIMIT ?");
            params.push(Box::new(limite + 1));

            let mut stmt = conn.prepare(&sql)?;
            let refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
            let linhas = stmt
                .query_map(refs.as_slice(), |r| {
                    Ok(serde_json::json!({
                        "id": r.get::<_, String>(0)?, "categoria": r.get::<_, String>(1)?,
                        "titulo": r.get::<_, String>(2)?, "corpo": r.get::<_, String>(3)?,
                        "lida": r.get::<_, i64>(4)? != 0, "criado_em": r.get::<_, String>(5)?,
                    }))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await?;

    let tem_mais = linhas.len() as i64 > limite;
    let items: Vec<serde_json::Value> = if tem_mais { linhas[..limite as usize].to_vec() } else { linhas };
    let next_cursor = if tem_mais {
        items.last().and_then(|v| Some(codificar(v["criado_em"].as_str()?, v["id"].as_str()?)))
    } else {
        None
    };

    Ok(Json(Pagina { items, next_cursor }))
}

pub async fn marcar_lida(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let afetadas = state
        .db
        .with(move |conn| conn.execute("UPDATE notificacao SET lida = 1 WHERE id = ?1 AND usuario_id = ?2", rusqlite::params![id, usuario.0]))
        .await?;
    if afetadas == 0 {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn marcar_todas_lidas(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>) -> AppResult<Json<serde_json::Value>> {
    state
        .db
        .with(move |conn| conn.execute("UPDATE notificacao SET lida = 1 WHERE usuario_id = ?1", [&usuario.0]))
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
