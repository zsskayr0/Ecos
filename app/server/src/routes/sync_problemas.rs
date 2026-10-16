//! Problemas de sincronização por item (Google Calendar) e as ações que a pessoa pode tomar sobre eles.
//! Nada é sobrescrito, apagado ou descartado sem `confirmar: true` explícito no corpo.

use axum::extract::{Path, State};
use axum::{Extension, Json};
use ecos_core::ErrorCode;
use rusqlite::OptionalExtension;
use serde::Deserialize;

use crate::calendario::problemas::{self, descrever};
use crate::calendario::sync::{self, Resolucao};
use crate::error::{AppError, AppResult, CampoInvalido};
use crate::middleware::auth_guard::UsuarioAutenticado;
use crate::routes::calendario::erro_de_sync;
use crate::state::AppState;

/// `GET /sync/problemas` — abertos (com texto e ações) e quantos estão ignorados.
pub async fn listar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>) -> AppResult<Json<serde_json::Value>> {
    let (itens, ignorados) = state
        .db
        .with(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT id, item_tipo, item_id, item_titulo, direcao, operacao, codigo, http_status, motivo_google, tentativas, primeira_vez, ultima_vez \
                 FROM sync_problema WHERE usuario_id = ?1 AND provider = 'google' AND estado = 'aberto' ORDER BY ultima_vez DESC",
            )?;
            let itens = stmt
                .query_map([&usuario.0], |r| {
                    let (codigo, tipo): (String, String) = (r.get(6)?, r.get(1)?);
                    let d = descrever(&codigo, &tipo);
                    Ok(serde_json::json!({
                        "id": r.get::<_, String>(0)?, "item_tipo": tipo, "item_id": r.get::<_, String>(2)?, "item_titulo": r.get::<_, String>(3)?,
                        "direcao": r.get::<_, String>(4)?, "operacao": r.get::<_, String>(5)?, "provider": "google",
                        "codigo": codigo, "titulo": d.titulo, "explicacao": d.explicacao, "acoes": d.acoes,
                        "http_status": r.get::<_, Option<i64>>(7)?, "motivo_google": r.get::<_, Option<String>>(8)?,
                        "tentativas": r.get::<_, i64>(9)?, "primeira_vez": r.get::<_, String>(10)?, "ultima_vez": r.get::<_, String>(11)?,
                    }))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            let ignorados: i64 = conn.query_row("SELECT COUNT(*) FROM sync_problema WHERE usuario_id = ?1 AND provider = 'google' AND estado = 'ignorado'", [&usuario.0], |r| r.get(0))?;
            Ok((itens, ignorados))
        })
        .await?;
    Ok(Json(serde_json::json!({ "items": itens, "ignorados": ignorados })))
}

/// `POST /sync/problemas/tentar-novamente` — roda a sincronização agora; o que passar é resolvido pelo próprio ciclo.
pub async fn tentar_todos(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>) -> AppResult<Json<sync::ResumoSync>> {
    Ok(Json(sync::sincronizar(&state, &usuario.0).await.map_err(erro_de_sync)?))
}

#[derive(Debug, Deserialize)]
pub struct AcaoPayload {
    pub acao: String,
    #[serde(default)]
    pub confirmar: bool,
}

/// Ações que mudam ou descartam dados: exigem confirmação explícita.
const EXIGEM_CONFIRMACAO: [&str; 4] = ["manter_local", "manter_google", "manter_ambos", "desvincular"];

/// `POST /sync/problemas/:id/acao` — `{ acao, confirmar }`.
pub async fn acao(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(id): Path<String>, Json(payload): Json<AcaoPayload>) -> AppResult<Json<serde_json::Value>> {
    let (uid, pid) = (usuario.0.clone(), id.clone());
    let linha: Option<(String, String, String, String)> = state
        .db
        .with(move |conn| {
            conn.query_row("SELECT item_tipo, item_id, codigo, estado FROM sync_problema WHERE id = ?1 AND usuario_id = ?2", [&pid, &uid], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).optional()
        })
        .await?;
    let (item_tipo, item_id, codigo, _estado) = linha.ok_or(AppError::new(ErrorCode::NotFound))?;
    let permitidas = descrever(&codigo, &item_tipo).acoes;
    let invalida = |motivo: &str| AppError::validation(vec![CampoInvalido { campo: "acao".into(), motivo: motivo.into() }]);
    if !permitidas.contains(&payload.acao.as_str()) || payload.acao == "abrir" || payload.acao == "reautorizar" {
        return Err(invalida("ação não disponível para este problema"));
    }
    if EXIGEM_CONFIRMACAO.contains(&payload.acao.as_str()) && !payload.confirmar {
        return Err(AppError::validation(vec![CampoInvalido { campo: "confirmar".into(), motivo: "confirme a ação para continuar".into() }]));
    }
    let marcar = |estado: &'static str| {
        let (uid, pid) = (usuario.0.clone(), id.clone());
        let state = state.clone();
        async move { state.db.with(move |conn| conn.execute("UPDATE sync_problema SET estado = ?1 WHERE id = ?2 AND usuario_id = ?3", rusqlite::params![estado, pid, uid])).await }
    };
    let resumo = match payload.acao.as_str() {
        "ignorar" => {
            marcar("ignorado").await?;
            None
        }
        "tentar_de_novo" => Some(sync::sincronizar(&state, &usuario.0).await.map_err(erro_de_sync)?),
        "manter_local" => {
            sync::resolver_item(&state, &usuario.0, &item_id, Resolucao::ManterLocal).await.map_err(erro_de_sync)?;
            Some(sync::sincronizar(&state, &usuario.0).await.map_err(erro_de_sync)?)
        }
        "manter_google" | "manter_ambos" => {
            let como = if payload.acao == "manter_google" { Resolucao::ManterGoogle } else { Resolucao::ManterAmbos };
            sync::resolver_item(&state, &usuario.0, &item_id, como).await.map_err(erro_de_sync)?;
            marcar("resolvido").await?;
            None
        }
        "desvincular" => {
            sync::resolver_item(&state, &usuario.0, &item_id, Resolucao::Desvincular).await.map_err(erro_de_sync)?;
            marcar("resolvido").await?;
            None
        }
        _ => return Err(invalida("ação desconhecida")),
    };
    let (uid, pid) = (usuario.0.clone(), id.clone());
    let estado_final: String = state.db.with(move |conn| conn.query_row("SELECT estado FROM sync_problema WHERE id = ?1 AND usuario_id = ?2", [&pid, &uid], |r| r.get(0))).await?;
    let abertos = {
        let uid = usuario.0.clone();
        state.db.with(move |conn| problemas::abertos(conn, &uid)).await?
    };
    Ok(Json(serde_json::json!({ "ok": true, "estado": estado_final, "problemas_abertos": abertos, "resumo": resumo })))
}
