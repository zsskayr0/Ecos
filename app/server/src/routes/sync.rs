//! Sincronização & Dispositivos (seção 11.12). O pareamento por código
//! (posse física dos dois aparelhos, seção 6.1) e o CRUD de `dispositivo`
//! são reais; a transferência de arquivo cifrada IP-a-IP entre pareados
//! (seção 6.1/5.4 — "sync LAN não é rede confiável por padrão") ainda não
//! está implementada — anúncio mDNS já roda (`jobs::mdns`), o transporte
//! em si fica `TODO` documentado aqui, não fingido.

use axum::extract::{Path, State};
use axum::{Extension, Json};
use chrono::{Duration, Utc};
use ecos_core::{new_id, ErrorCode};
use rand::Rng;
use serde::Deserialize;

use crate::error::{AppError, AppResult, CampoInvalido};
use crate::middleware::auth_guard::UsuarioAutenticado;
use crate::state::AppState;

const VALIDADE_CODIGO_MINUTOS: i64 = 5;

pub async fn status(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>) -> AppResult<Json<serde_json::Value>> {
    let dispositivos: Vec<serde_json::Value> = state
        .db
        .with(move |conn| {
            let mut stmt = conn.prepare("SELECT id, nome, papel, ultima_sincronizacao FROM dispositivo WHERE usuario_id = ?1")?;
            let linhas = stmt
                .query_map([&usuario.0], |r| {
                    Ok(serde_json::json!({
                        "id": r.get::<_, String>(0)?, "nome": r.get::<_, String>(1)?,
                        "papel": r.get::<_, String>(2)?, "ultima_sincronizacao": r.get::<_, Option<String>>(3)?,
                    }))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await?;
    Ok(Json(serde_json::json!({ "dispositivos": dispositivos })))
}

pub async fn listar_dispositivos(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>) -> AppResult<Json<serde_json::Value>> {
    status(State(state), Extension(usuario)).await.map(|Json(v)| Json(v["dispositivos"].clone()))
}

pub async fn parear(State(state): State<AppState>) -> AppResult<Json<serde_json::Value>> {
    let codigo: String = {
        let mut rng = rand::thread_rng();
        (0..6).map(|_| rng.gen_range(0..10).to_string()).collect()
    };
    let expira_em = Utc::now() + Duration::minutes(VALIDADE_CODIGO_MINUTOS);
    state
        .pareamentos
        .lock()
        .expect("mutex de pareamentos nunca deve ser envenenado")
        .insert(codigo.clone(), expira_em);
    Ok(Json(serde_json::json!({ "codigo": codigo, "expira_em": expira_em.to_rfc3339() })))
}

#[derive(Debug, Deserialize)]
pub struct ConfirmarPareamentoPayload {
    pub codigo: String,
    #[serde(default = "nome_padrao_dispositivo")]
    pub nome: String,
}

fn nome_padrao_dispositivo() -> String {
    "Novo dispositivo".to_string()
}

pub async fn confirmar_pareamento(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Json(payload): Json<ConfirmarPareamentoPayload>) -> AppResult<Json<serde_json::Value>> {
    let valido = {
        let mut mapa = state.pareamentos.lock().expect("mutex de pareamentos nunca deve ser envenenado");
        match mapa.remove(&payload.codigo) {
            Some(expira_em) if expira_em > Utc::now() => true,
            _ => false,
        }
    };
    if !valido {
        return Err(AppError::new(ErrorCode::InvalidCredentials).with_message("Código de pareamento inválido ou expirado."));
    }

    let ja_existe_primario: i64 = state
        .db
        .with({
            let usuario_id = usuario.0.clone();
            move |conn| conn.query_row("SELECT COUNT(*) FROM dispositivo WHERE usuario_id = ?1 AND papel = 'primario'", [&usuario_id], |r| r.get(0))
        })
        .await?;
    let papel = if ja_existe_primario == 0 { "primario" } else { "espelho" };

    let id = new_id();
    state
        .db
        .with({
            let id = id.clone();
            let papel = papel.to_string();
            move |conn| {
                conn.execute(
                    "INSERT INTO dispositivo (id, usuario_id, nome, papel, push_tipo) VALUES (?1, ?2, ?3, ?4, 'nenhum')",
                    rusqlite::params![id, usuario.0, payload.nome, papel],
                )
            }
        })
        .await?;

    Ok(Json(serde_json::json!({ "id": id, "papel": papel })))
}

#[derive(Debug, Deserialize)]
pub struct AtualizarDispositivoPayload {
    #[serde(default)]
    pub papel: Option<String>,
    #[serde(default)]
    pub nome: Option<String>,
}

/// Troca de dispositivo primário é sempre explícita (seção 6.2) — nunca
/// automática/heurística; este endpoint é exatamente essa ação explícita.
pub async fn atualizar_dispositivo(State(state): State<AppState>, Path(id): Path<String>, Json(payload): Json<AtualizarDispositivoPayload>) -> AppResult<Json<serde_json::Value>> {
    if let Some(papel) = &payload.papel {
        if !["primario", "espelho"].contains(&papel.as_str()) {
            return Err(AppError::validation(vec![CampoInvalido { campo: "papel".into(), motivo: "deve ser 'primario' ou 'espelho'".into() }]));
        }
    }
    let afetadas = state
        .db
        .with(move |conn| {
            conn.execute(
                "UPDATE dispositivo SET papel = COALESCE(?1, papel), nome = COALESCE(?2, nome) WHERE id = ?3",
                rusqlite::params![payload.papel, payload.nome, id],
            )
        })
        .await?;
    if afetadas == 0 {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn excluir_dispositivo(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let afetadas = state.db.with(move |conn| conn.execute("DELETE FROM dispositivo WHERE id = ?1", [&id])).await?;
    if afetadas == 0 {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Debug, Deserialize)]
pub struct ConfigSyncPayload {
    pub modo: String,
}

pub async fn atualizar_config(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Json(payload): Json<ConfigSyncPayload>) -> AppResult<Json<serde_json::Value>> {
    if !["local_unico", "direto_lan", "google_drive"].contains(&payload.modo.as_str()) {
        return Err(AppError::validation(vec![CampoInvalido { campo: "modo".into(), motivo: "inválido".into() }]));
    }
    state
        .db
        .with(move |conn| {
            conn.execute(
                "INSERT INTO config_sync (usuario_id, modo) VALUES (?1, ?2) \
                 ON CONFLICT (usuario_id) DO UPDATE SET modo = excluded.modo",
                rusqlite::params![usuario.0, payload.modo],
            )
        })
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Debug, Deserialize)]
pub struct PushPayload {
    pub push_tipo: String,
    #[serde(default)]
    pub push_endpoint: Option<String>,
}

pub async fn atualizar_push(State(state): State<AppState>, Path(id): Path<String>, Json(payload): Json<PushPayload>) -> AppResult<Json<serde_json::Value>> {
    if !["unifiedpush", "fcm", "nenhum"].contains(&payload.push_tipo.as_str()) {
        return Err(AppError::validation(vec![CampoInvalido { campo: "push_tipo".into(), motivo: "inválido".into() }]));
    }
    let afetadas = state
        .db
        .with(move |conn| {
            conn.execute(
                "UPDATE dispositivo SET push_tipo = ?1, push_endpoint = ?2 WHERE id = ?3",
                rusqlite::params![payload.push_tipo, payload.push_endpoint, id],
            )
        })
        .await?;
    if afetadas == 0 {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}
