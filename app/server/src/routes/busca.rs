//! `GET /busca` (seção 11.8) — full-text via FTS5, resultado agrupado por
//! tipo.

use axum::extract::{Query, State};
use axum::{Extension, Json};
use serde::Deserialize;

use crate::error::AppResult;
use crate::middleware::auth_guard::UsuarioAutenticado;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct BuscaQuery {
    pub q: String,
    /// `nota` | `tarefa` — ausente = os dois.
    pub tipo: Option<String>,
    pub espaco: Option<String>,
}

pub async fn buscar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Query(q): Query<BuscaQuery>) -> AppResult<Json<serde_json::Value>> {
    let visivel_nota = crate::espacos::visivel_sql("n", &usuario.0);
    let visivel_tarefa = crate::espacos::visivel_sql("t", &usuario.0);
    let termo = format!("{}*", q.q.replace('"', "\"\""));
    let incluir_notas = q.tipo.as_deref().map(|t| t == "nota").unwrap_or(true);
    let incluir_tarefas = q.tipo.as_deref().map(|t| t == "tarefa").unwrap_or(true);

    let notas: Vec<serde_json::Value> = if incluir_notas {
        let termo = termo.clone();
        let espaco = q.espaco.clone();
        state
            .db
            .with(move |conn| {
                let mut stmt = conn.prepare(&format!(
                    "SELECT n.id, n.titulo, n.espaco, snippet(nota_fts, 2, '[', ']', '…', 12) \
                     FROM nota_fts JOIN nota n ON n.id = nota_fts.id \
                     WHERE nota_fts MATCH ?1 AND (?2 IS NULL OR n.espaco = ?2) AND {visivel_nota} \
                     ORDER BY rank LIMIT 30",
                ))?;
                let linhas = stmt
                    .query_map(rusqlite::params![termo, espaco], |r| {
                        Ok(serde_json::json!({
                            "id": r.get::<_, String>(0)?, "titulo": r.get::<_, String>(1)?,
                            "espaco": r.get::<_, String>(2)?, "trecho": r.get::<_, String>(3)?,
                        }))
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(linhas)
            })
            .await?
    } else {
        Vec::new()
    };

    let tarefas: Vec<serde_json::Value> = if incluir_tarefas {
        let termo = termo.clone();
        let espaco = q.espaco.clone();
        state
            .db
            .with(move |conn| {
                let mut stmt = conn.prepare(&format!(
                    "SELECT t.id, t.titulo, t.espaco, t.status FROM tarefa_fts \
                     JOIN tarefa t ON t.id = tarefa_fts.id \
                     WHERE tarefa_fts MATCH ?1 AND (?2 IS NULL OR t.espaco = ?2) AND {visivel_tarefa} \
                     ORDER BY rank LIMIT 30",
                ))?;
                let linhas = stmt
                    .query_map(rusqlite::params![termo, espaco], |r| {
                        Ok(serde_json::json!({
                            "id": r.get::<_, String>(0)?, "titulo": r.get::<_, String>(1)?,
                            "espaco": r.get::<_, String>(2)?, "status": r.get::<_, String>(3)?,
                        }))
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(linhas)
            })
            .await?
    } else {
        Vec::new()
    };

    Ok(Json(serde_json::json!({ "notas": notas, "tarefas": tarefas })))
}
