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

pub async fn listar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Query(q): Query<ListarQuery>) -> AppResult<Json<Pagina<serde_json::Value>>> {
    let limite = limite_efetivo(q.limit);
    let cursor = q.cursor.as_deref().and_then(decodificar);

    let linhas: Vec<serde_json::Value> = state
        .db
        .with(move |conn| {
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
