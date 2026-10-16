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
use rusqlite::OptionalExtension;
use serde::Deserialize;

use crate::error::{AppError, AppResult, CampoInvalido};
use crate::middleware::auth_guard::UsuarioAutenticado;
use crate::state::AppState;

const VALIDADE_CODIGO_MINUTOS: i64 = 5;

/// Estado do transporte de sincronização para o modo escolhido. Hoje nenhum modo move dados entre aparelhos
/// (só o pareamento e o anúncio mDNS existem), então a resposta nunca é "ok": o cliente não pode mostrar
/// "sincronizado" a partir disto.
pub fn estado_do_transporte(modo: &str) -> serde_json::Value {
    let motivo = match modo {
        "direto_lan" => "O transporte de sincronização pela rede local ainda não foi implementado: os aparelhos pareados não trocam dados.",
        "google_drive" => "A sincronização via Google Drive ainda não foi implementada.",
        _ => "Modo local: os dados ficam só neste servidor, sem sincronização com outros aparelhos.",
    };
    serde_json::json!({ "ativo": false, "estado": if modo == "local_unico" { "nao_aplicavel" } else { "indisponivel" }, "motivo": motivo })
}

pub async fn status(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>) -> AppResult<Json<serde_json::Value>> {
    let (modo, dispositivos): (String, Vec<serde_json::Value>) = state
        .db
        .with(move |conn| {
            let modo: String = conn
                .query_row("SELECT modo FROM config_sync WHERE usuario_id = ?1", [&usuario.0], |r| r.get(0))
                .optional()?
                .unwrap_or_else(|| "local_unico".to_string());
            let mut stmt = conn.prepare("SELECT id, nome, papel, ultima_sincronizacao, push_tipo FROM dispositivo WHERE usuario_id = ?1 ORDER BY papel, nome")?;
            let linhas = stmt
                .query_map([&usuario.0], |r| {
                    Ok(serde_json::json!({
                        "id": r.get::<_, String>(0)?, "nome": r.get::<_, String>(1)?,
                        "papel": r.get::<_, String>(2)?, "ultima_sincronizacao": r.get::<_, Option<String>>(3)?,
                        "push_tipo": r.get::<_, String>(4)?,
                    }))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok((modo, linhas))
        })
        .await?;
    let ultima = dispositivos.iter().filter_map(|d| d["ultima_sincronizacao"].as_str()).max().map(str::to_string);
    let transporte = estado_do_transporte(&modo);
    Ok(Json(serde_json::json!({ "modo": modo, "transporte": transporte, "ultima_sincronizacao": ultima, "dispositivos": dispositivos })))
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
pub async fn atualizar_dispositivo(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(id): Path<String>, Json(payload): Json<AtualizarDispositivoPayload>) -> AppResult<Json<serde_json::Value>> {
    if let Some(papel) = &payload.papel {
        if !["primario", "espelho"].contains(&papel.as_str()) {
            return Err(AppError::validation(vec![CampoInvalido { campo: "papel".into(), motivo: "deve ser 'primario' ou 'espelho'".into() }]));
        }
    }
    let afetadas = state
        .db
        .with(move |conn| {
            conn.execute(
                "UPDATE dispositivo SET papel = COALESCE(?1, papel), nome = COALESCE(?2, nome) WHERE id = ?3 AND usuario_id = ?4",
                rusqlite::params![payload.papel, payload.nome, id, usuario.0],
            )
        })
        .await?;
    if afetadas == 0 {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn excluir_dispositivo(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let afetadas = state.db.with(move |conn| conn.execute("DELETE FROM dispositivo WHERE id = ?1 AND usuario_id = ?2", [&id, &usuario.0])).await?;
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

pub async fn atualizar_push(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(id): Path<String>, Json(payload): Json<PushPayload>) -> AppResult<Json<serde_json::Value>> {
    if !["unifiedpush", "fcm", "nenhum"].contains(&payload.push_tipo.as_str()) {
        return Err(AppError::validation(vec![CampoInvalido { campo: "push_tipo".into(), motivo: "inválido".into() }]));
    }
    let afetadas = state
        .db
        .with(move |conn| {
            conn.execute(
                "UPDATE dispositivo SET push_tipo = ?1, push_endpoint = ?2 WHERE id = ?3 AND usuario_id = ?4",
                rusqlite::params![payload.push_tipo, payload.push_endpoint, id, usuario.0],
            )
        })
        .await?;
    if afetadas == 0 {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[cfg(test)]
mod testes {
    use crate::{auth::session, config::{Ambiente, Config}, db::IndexDb, state::AppState};
    use axum::{body::{to_bytes, Body}, http::{Request, StatusCode}, Router};
    use ecos_core::new_id;
    use std::sync::{Arc, Mutex};
    use tower::Service;

    async fn chamar(app: &Router, metodo: &str, uri: &str, token: &str, corpo: Option<serde_json::Value>) -> (StatusCode, serde_json::Value) {
        let mut pedido = Request::builder().method(metodo).uri(uri).header("authorization", format!("Bearer {token}"));
        let corpo = match corpo {
            Some(c) => { pedido = pedido.header("content-type", "application/json"); Body::from(c.to_string()) }
            None => Body::empty(),
        };
        let r = app.clone().call(pedido.body(corpo).unwrap()).await.unwrap();
        let st = r.status();
        let b = to_bytes(r.into_body(), 1024 * 1024).await.unwrap();
        (st, serde_json::from_slice(&b).unwrap_or(serde_json::Value::Null))
    }

    #[tokio::test]
    async fn status_traz_modo_dispositivos_e_nunca_afirma_transporte_ativo() {
        let temp = std::env::temp_dir().join(format!("ecos-sync-{}", new_id()));
        std::fs::create_dir_all(&temp).unwrap();
        let segredo = b"segredo-efemero-exclusivo-do-teste-de-sync".to_vec();
        let state = AppState {
            db: IndexDb::open(&temp.join("index.db")).unwrap(),
            config: Arc::new(Config {
                ambiente: Ambiente::Desenvolvimento, porta: 0, notes_root: temp.clone(), index_db_path: temp.join("index.db"),
                vault_enabled: false, vault_internal_url: String::new(), session_secret: segredo.clone(), ranking_interval_secs: 300,
                static_dir: None, cookie_secure: false, google: None,
            }),
            http: reqwest::Client::new(), pareamentos: Arc::new(Mutex::new(Default::default())),
        };
        state.db.with(|c| {
            c.execute("INSERT INTO usuario (id, nome_usuario, senha_hash, recovery_key_hash) VALUES ('U1', 'ana', 'x', 'x'), ('U2', 'bia', 'x', 'x')", [])?;
            c.execute("INSERT INTO dispositivo (id, usuario_id, nome, papel, ultima_sincronizacao) VALUES ('D1', 'U1', 'Celular', 'primario', '2026-05-01T10:00:00+00:00'), ('D2', 'U1', 'Notebook', 'espelho', '2026-05-02T10:00:00+00:00'), ('D3', 'U2', 'Da outra', 'primario', '2026-06-01T10:00:00+00:00')", [])?;
            Ok(())
        }).await.unwrap();
        let app = crate::routes::montar(state.clone());
        let tk = session::emitir_access_token("U1", &segredo).unwrap();

        let (st, s) = chamar(&app, "GET", "/api/v1/sync/status", &tk, None).await;
        assert_eq!(st, StatusCode::OK, "{s}");
        assert_eq!(s["modo"], "local_unico");
        assert_eq!(s["transporte"]["ativo"], false);
        assert_eq!(s["transporte"]["estado"], "nao_aplicavel");
        assert_eq!(s["dispositivos"].as_array().unwrap().len(), 2, "só os dispositivos da própria pessoa");
        assert_eq!(s["ultima_sincronizacao"], "2026-05-02T10:00:00+00:00");

        // Escolher LAN persiste o modo, mas o transporte segue indisponível (nada é sincronizado de verdade).
        assert_eq!(chamar(&app, "PATCH", "/api/v1/sync/config", &tk, Some(serde_json::json!({ "modo": "direto_lan" }))).await.0, StatusCode::OK);
        let (_, s) = chamar(&app, "GET", "/api/v1/sync/status", &tk, None).await;
        assert_eq!((s["modo"].as_str(), s["transporte"]["ativo"].as_bool(), s["transporte"]["estado"].as_str()), (Some("direto_lan"), Some(false), Some("indisponivel")));
        let _ = std::fs::remove_dir_all(&temp);
    }
}
