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
/// Respeita as preferências da categoria: com a caixa desligada nada é gravado; com o push desligado grava mas não
/// enfileira entrega. Falha ao enfileirar push nunca derruba a ação que gerou o aviso (o polling cobre).
pub fn criar(conn: &rusqlite::Connection, usuario_id: &str, categoria: &str, titulo: &str, corpo: &str, chave: Option<&str>) -> rusqlite::Result<bool> {
    criar_com_acao(conn, usuario_id, categoria, titulo, corpo, chave, None)
}

/// Como `criar`, com um link de ação (rota interna do app, ex. `/configuracoes/calendario/problemas`).
pub fn criar_com_acao(conn: &rusqlite::Connection, usuario_id: &str, categoria: &str, titulo: &str, corpo: &str, chave: Option<&str>, acao_url: Option<&str>) -> rusqlite::Result<bool> {
    let (caixa, push) = crate::push::preferencia(conn, usuario_id, categoria).unwrap_or((true, true));
    if !caixa {
        return Ok(false);
    }
    let (id, agora) = (ecos_core::new_id(), chrono::Utc::now());
    let n = conn.execute(
        "INSERT OR IGNORE INTO notificacao (id, usuario_id, categoria, titulo, corpo, lida, criado_em, chave, acao_url) VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7, ?8)",
        rusqlite::params![id, usuario_id, categoria, titulo, corpo, agora.to_rfc3339(), chave, acao_url],
    )?;
    if n > 0 && push {
        if let Err(e) = crate::push::enfileirar(conn, usuario_id, &id, agora) {
            tracing::error!(error = %e, "push: não foi possível enfileirar a entrega");
        }
    }
    Ok(n > 0)
}

/// `GET /notificacoes/preferencias` — por categoria, se o aviso vai para a caixa e se vai por push.
pub async fn listar_preferencias(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>) -> AppResult<Json<serde_json::Value>> {
    let itens: Vec<serde_json::Value> = state
        .db
        .with(move |conn| {
            crate::push::CATEGORIAS
                .iter()
                .map(|c| {
                    let (caixa, push) = crate::push::preferencia(conn, &usuario.0, c)?;
                    Ok(serde_json::json!({ "categoria": c, "caixa": caixa, "push": push }))
                })
                .collect::<rusqlite::Result<Vec<_>>>()
        })
        .await?;
    Ok(Json(serde_json::json!({ "items": itens })))
}

#[derive(Debug, Deserialize)]
pub struct PreferenciaPayload {
    pub caixa: Option<bool>,
    pub push: Option<bool>,
}

/// `PATCH /notificacoes/preferencias/:categoria` — só os campos enviados mudam.
pub async fn atualizar_preferencia(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(categoria): Path<String>, Json(payload): Json<PreferenciaPayload>) -> AppResult<Json<serde_json::Value>> {
    if !crate::push::CATEGORIAS.contains(&categoria.as_str()) {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    state
        .db
        .with(move |conn| {
            let (caixa, push) = crate::push::preferencia(conn, &usuario.0, &categoria)?;
            let (caixa, push) = (payload.caixa.unwrap_or(caixa) as i64, payload.push.unwrap_or(push) as i64);
            conn.execute(
                "INSERT INTO notificacao_preferencia (usuario_id, categoria, caixa, push) VALUES (?1, ?2, ?3, ?4) \
                 ON CONFLICT (usuario_id, categoria) DO UPDATE SET caixa = excluded.caixa, push = excluded.push",
                rusqlite::params![usuario.0, categoria, caixa, push],
            )
        })
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
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
            let mut sql = String::from("SELECT id, categoria, titulo, corpo, lida, criado_em, acao_url FROM notificacao WHERE usuario_id = ?");
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
                        "acao_url": r.get::<_, Option<String>>(6)?,
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
