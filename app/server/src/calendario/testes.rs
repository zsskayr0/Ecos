//! Testes de integração do Google Calendar: roteador real + índice SQLite temporário + um "Google" de mentira
//! (servidor axum em 127.0.0.1) que responde token, calendário primário, eventos e revogação.

use super::crypto::Cofre;
use crate::config::{Ambiente, Config, GoogleConfig};
use crate::{auth::session, db::IndexDb, state::AppState};
use axum::extract::{Form, Path, Query, State};
use axum::http::{HeaderMap, Request, StatusCode};
use axum::routing::{get, patch, post};
use axum::{body::{to_bytes, Body}, Json, Router};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{Duration, Utc};
use ecos_core::new_id;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use tower::Service;

// ---------------------------------------------------------------- Google de mentira

#[derive(Default)]
struct Mock {
    /// Respostas de `events.list`, na ordem; fila vazia = página vazia com `nextSyncToken: "tok-vazio"`.
    eventos: VecDeque<(u16, Value)>,
    consultas: Vec<HashMap<String, String>>,
    bearers: Vec<String>,
    tokens: Vec<HashMap<String, String>>,
    revogacoes: Vec<HashMap<String, String>>,
    refresh_invalido: bool,
    /// Corpos recebidos em `events.insert`.
    insercoes: Vec<Value>,
    /// `(id, If-Match, corpo)` de cada `events.patch`.
    patches: Vec<(String, Option<String>, Value)>,
    delecoes: Vec<String>,
    /// Resposta de `events.instances` e as consultas recebidas (`(id da série, query)`).
    instancias: Vec<Value>,
    consultas_instancias: Vec<(String, HashMap<String, String>)>,
    /// Status a devolver nas próximas chamadas (vazio = sucesso).
    status_patch: VecDeque<u16>,
    status_delete: VecDeque<u16>,
    status_insert: VecDeque<u16>,
    contador: u32,
}

type Compartilhado = Arc<Mutex<Mock>>;

async fn h_token(State(m): State<Compartilhado>, Form(f): Form<HashMap<String, String>>) -> (StatusCode, Json<Value>) {
    let mut g = m.lock().unwrap();
    g.tokens.push(f.clone());
    if f.get("grant_type").map(String::as_str) == Some("refresh_token") {
        if g.refresh_invalido {
            return (StatusCode::BAD_REQUEST, Json(json!({ "error": "invalid_grant", "error_description": "Token has been expired or revoked." })));
        }
        return (StatusCode::OK, Json(json!({ "access_token": "at-renovado", "expires_in": 3600 })));
    }
    (StatusCode::OK, Json(json!({ "access_token": "at-1", "refresh_token": "rt-1", "expires_in": 3600 })))
}

async fn h_revoke(State(m): State<Compartilhado>, Form(f): Form<HashMap<String, String>>) -> StatusCode {
    m.lock().unwrap().revogacoes.push(f);
    StatusCode::OK
}

async fn h_primario() -> Json<Value> {
    Json(json!({ "id": "eu@gmail.com", "timeZone": "America/Sao_Paulo" }))
}

async fn h_eventos(State(m): State<Compartilhado>, Path(_id): Path<String>, Query(q): Query<HashMap<String, String>>, headers: HeaderMap) -> (StatusCode, Json<Value>) {
    let mut g = m.lock().unwrap();
    g.consultas.push(q);
    g.bearers.push(headers.get("authorization").and_then(|h| h.to_str().ok()).unwrap_or_default().to_string());
    match g.eventos.pop_front() {
        Some((status, corpo)) => (StatusCode::from_u16(status).unwrap(), Json(corpo)),
        None => (StatusCode::OK, Json(json!({ "items": [], "nextSyncToken": "tok-vazio" }))),
    }
}

fn resposta_de_erro(status: u16) -> (StatusCode, Json<Value>) {
    (StatusCode::from_u16(status).unwrap(), Json(json!({ "error": { "code": status, "message": "erro do mock" } })))
}

async fn h_inserir(State(m): State<Compartilhado>, Path(_id): Path<String>, Json(corpo): Json<Value>) -> (StatusCode, Json<Value>) {
    let mut g = m.lock().unwrap();
    g.insercoes.push(corpo);
    if let Some(status) = g.status_insert.pop_front() {
        return resposta_de_erro(status);
    }
    g.contador += 1;
    let n = g.contador;
    (StatusCode::OK, Json(json!({ "id": format!("g-novo-{n}"), "etag": format!("\"ins{n}\""), "updated": "2026-09-20T12:00:00.000Z" })))
}

async fn h_patch(State(m): State<Compartilhado>, Path((_id, eid)): Path<(String, String)>, headers: HeaderMap, Json(corpo): Json<Value>) -> (StatusCode, Json<Value>) {
    let mut g = m.lock().unwrap();
    g.patches.push((eid.clone(), headers.get("if-match").and_then(|h| h.to_str().ok()).map(str::to_string), corpo));
    if let Some(status) = g.status_patch.pop_front() {
        return resposta_de_erro(status);
    }
    g.contador += 1;
    let n = g.contador;
    (StatusCode::OK, Json(json!({ "id": eid, "etag": format!("\"pat{n}\""), "updated": "2026-09-20T13:00:00.000Z" })))
}

async fn h_instancias(State(m): State<Compartilhado>, Path((_id, eid)): Path<(String, String)>, Query(q): Query<HashMap<String, String>>) -> Json<Value> {
    let mut g = m.lock().unwrap();
    g.consultas_instancias.push((eid, q));
    Json(json!({ "items": g.instancias.clone() }))
}

async fn h_apagar(State(m): State<Compartilhado>, Path((_id, eid)): Path<(String, String)>) -> StatusCode {
    let mut g = m.lock().unwrap();
    g.delecoes.push(eid);
    StatusCode::from_u16(g.status_delete.pop_front().unwrap_or(204)).unwrap()
}

async fn iniciar_mock() -> (String, Compartilhado) {
    let m = Compartilhado::default();
    let app = Router::new()
        .route("/token", post(h_token))
        .route("/revoke", post(h_revoke))
        .route("/calendars/primary", get(h_primario))
        .route("/calendars/:id/events", get(h_eventos).post(h_inserir))
        .route("/calendars/:id/events/:eid", patch(h_patch).delete(h_apagar))
        .route("/calendars/:id/events/:eid/instances", get(h_instancias))
        .with_state(m.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (base, m)
}

// ---------------------------------------------------------------- Ecos de teste

struct Ambiente_ {
    app: Router,
    token: String,
    raiz: std::path::PathBuf,
    state: AppState,
    mock: Compartilhado,
}

async fn montar(com_google: bool) -> Ambiente_ {
    montar_com(com_google, false).await
}

async fn montar_com(com_google: bool, envio_imediato: bool) -> Ambiente_ {
    let (base, mock) = iniciar_mock().await;
    let raiz = std::env::temp_dir().join(format!("ecos-google-test-{}", new_id()));
    std::fs::create_dir_all(&raiz).unwrap();
    let segredo = b"segredo-efemero-exclusivo-do-teste-de-google".to_vec();
    let state = AppState {
        db: IndexDb::open(&raiz.join("index.db")).unwrap(),
        config: Arc::new(Config {
            ambiente: Ambiente::Desenvolvimento, porta: 0, notes_root: raiz.clone(), index_db_path: raiz.join("index.db"),
            vault_enabled: false, vault_internal_url: String::new(), session_secret: segredo.clone(), ranking_interval_secs: 300,
            static_dir: None, cookie_secure: false,
            google: com_google.then(|| GoogleConfig {
                client_id: "cid".into(), client_secret: "sec".into(), auth_url: "https://accounts.example/auth".into(),
                token_url: format!("{base}/token"), revoke_url: format!("{base}/revoke"), api_base: base, intervalo_secs: 300, envio_imediato,
            }),
        }),
        http: reqwest::Client::new(),
        pareamentos: Arc::new(Mutex::new(Default::default())),
    };
    state.db.with(|c| c.execute("INSERT INTO usuario (id, nome_usuario, senha_hash, recovery_key_hash) VALUES ('usuario-teste', 'teste', 'efemero', 'efemero')", [])).await.unwrap();
    let token = session::emitir_access_token("usuario-teste", &segredo).unwrap();
    Ambiente_ { app: crate::routes::montar(state.clone()), token, raiz, state, mock }
}

async fn req(app: &Router, metodo: &str, uri: &str, token: Option<&str>, host: &str, corpo: Option<Value>) -> (StatusCode, String) {
    let mut b = Request::builder().method(metodo).uri(uri).header("host", host);
    if let Some(t) = token {
        b = b.header("authorization", format!("Bearer {t}"));
    }
    let corpo = match corpo {
        Some(c) => { b = b.header("content-type", "application/json"); Body::from(c.to_string()) }
        None => Body::empty(),
    };
    let resp = app.clone().call(b.body(corpo).unwrap()).await.unwrap();
    let status = resp.status();
    (status, String::from_utf8_lossy(&to_bytes(resp.into_body(), 4 * 1024 * 1024).await.unwrap()).into_owned())
}

async fn api(e: &Ambiente_, metodo: &str, uri: &str, corpo: Option<Value>) -> (StatusCode, Value) {
    let (s, t) = req(&e.app, metodo, uri, Some(&e.token), "127.0.0.1:7023", corpo).await;
    (s, serde_json::from_str(&t).unwrap_or(Value::Null))
}

/// Simula uma conexão já feita (sem passar pelo OAuth), com tokens cifrados como em produção.
async fn conectar_direto(e: &Ambiente_, expira_em: String) {
    let cofre = Cofre::carregar(&e.raiz).unwrap();
    let (a, r) = (cofre.cifrar(b"at-seed").unwrap(), cofre.cifrar(b"rt-seed").unwrap());
    e.state
        .db
        .with(move |c| {
            c.execute(
                "INSERT INTO config_calendario (usuario_id, provider, access_token_encrypted, refresh_token_encrypted, calendar_id, conectado_em, email, fuso, access_expira_em) \
                 VALUES ('usuario-teste', 'google', ?1, ?2, 'eu@gmail.com', datetime('now'), 'eu@gmail.com', 'America/Sao_Paulo', ?3)",
                rusqlite::params![a, r, expira_em],
            )
        })
        .await
        .unwrap();
}

fn em_uma_hora() -> String {
    (Utc::now() + Duration::hours(1)).to_rfc3339()
}

fn ev_hora(id: &str, resumo: &str, ini: &str, fim: &str, etag: &str, updated: &str) -> Value {
    json!({ "id": id, "status": "confirmed", "etag": etag, "updated": updated, "summary": resumo, "start": { "dateTime": ini }, "end": { "dateTime": fim } })
}

fn cursor(e: &Ambiente_) -> Option<String> {
    let db = e.state.db.clone();
    futures_executor_block(async move { db.with(|c| c.query_row("SELECT sync_cursor FROM config_calendario", [], |r| r.get::<_, Option<String>>(0))).await.unwrap() })
}

fn futures_executor_block<T>(f: impl std::future::Future<Output = T>) -> T {
    tokio::task::block_in_place(|| tokio::runtime::Handle::current().block_on(f))
}

// ---------------------------------------------------------------- testes

#[tokio::test(flavor = "multi_thread")]
async fn oauth_pkce_state_de_uso_unico_e_tokens_cifrados_no_banco() {
    let e = montar(true).await;

    // Host fora do loopback: o Google não aceitaria o redirect.
    let (status, _) = req(&e.app, "GET", "/api/v1/calendario/conectar/google", Some(&e.token), "192.168.0.10:7023", None).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    let (status, corpo) = api(&e, "GET", "/api/v1/calendario/conectar/google", None).await;
    assert_eq!(status, StatusCode::OK, "{corpo}");
    let url = reqwest::Url::parse(corpo["url"].as_str().unwrap()).unwrap();
    let param = |k: &str| url.query_pairs().find(|(n, _)| n == k).map(|(_, v)| v.into_owned()).unwrap();
    assert_eq!(param("client_id"), "cid");
    assert_eq!(param("redirect_uri"), "http://127.0.0.1:7023/api/v1/calendario/callback/google");
    assert_eq!(param("code_challenge_method"), "S256");
    assert!(!corpo["url"].as_str().unwrap().contains("sec"), "o secret não pode ir na URL");
    let (estado, challenge) = (param("state"), param("code_challenge"));

    // O callback chega SEM cookie/Bearer.
    let (status, html) = req(&e.app, "GET", &format!("/api/v1/calendario/callback/google?code=abc&state={estado}"), None, "127.0.0.1:7023", None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(html.contains("conectado"), "{html}");

    {
        let g = e.mock.lock().unwrap();
        let troca = g.tokens.iter().find(|t| t.get("grant_type").map(String::as_str) == Some("authorization_code")).expect("trocou o código");
        assert_eq!(troca["code"], "abc");
        assert_eq!(troca["client_secret"], "sec");
        assert_eq!(troca["redirect_uri"], "http://127.0.0.1:7023/api/v1/calendario/callback/google");
        // PKCE: o verifier enviado precisa ser o que gerou o challenge da URL.
        assert_eq!(URL_SAFE_NO_PAD.encode(Sha256::digest(troca["code_verifier"].as_bytes())), challenge);
    }

    // Tokens cifrados em repouso: o refresh token em claro não aparece no blob.
    let (refresh, email): (Vec<u8>, Option<String>) = e.state.db.with(|c| c.query_row("SELECT refresh_token_encrypted, email FROM config_calendario", [], |r| Ok((r.get(0)?, r.get(1)?)))).await.unwrap();
    assert!(!refresh.windows(4).any(|w| w == b"rt-1"));
    assert_eq!(Cofre::carregar(&e.raiz).unwrap().decifrar(&refresh).unwrap(), b"rt-1");
    assert_eq!(email.as_deref(), Some("eu@gmail.com"));

    // O state é de uso único: repetir não conecta de novo.
    let (_, html) = req(&e.app, "GET", &format!("/api/v1/calendario/callback/google?code=abc&state={estado}"), None, "127.0.0.1:7023", None).await;
    assert!(html.contains("já foi usada"), "{html}");
    let (_, html) = req(&e.app, "GET", "/api/v1/calendario/callback/google?code=abc&state=inventado", None, "127.0.0.1:7023", None).await;
    assert!(html.contains("Não foi possível"), "{html}");

    let (_, cfg) = api(&e, "GET", "/api/v1/calendario/config", None).await;
    assert_eq!(cfg["google_configurado"], true);
    assert_eq!(cfg["conectados"][0]["email"], "eu@gmail.com");
    let _ = std::fs::remove_dir_all(&e.raiz);
}

#[tokio::test(flavor = "multi_thread")]
async fn autorizacao_negada_no_google_nao_conecta_e_sem_credenciais_e_501() {
    let e = montar(true).await;
    let (_, corpo) = api(&e, "GET", "/api/v1/calendario/conectar/google", None).await;
    let url = reqwest::Url::parse(corpo["url"].as_str().unwrap()).unwrap();
    let estado = url.query_pairs().find(|(n, _)| n == "state").unwrap().1.into_owned();
    let (_, html) = req(&e.app, "GET", &format!("/api/v1/calendario/callback/google?error=access_denied&state={estado}"), None, "127.0.0.1:7023", None).await;
    assert!(html.contains("cancelada"), "{html}");
    let n: i64 = e.state.db.with(|c| c.query_row("SELECT COUNT(*) FROM config_calendario", [], |r| r.get(0))).await.unwrap();
    assert_eq!(n, 0);
    let _ = std::fs::remove_dir_all(&e.raiz);

    let sem = montar(false).await;
    let (status, _) = api(&sem, "GET", "/api/v1/calendario/conectar/google", None).await;
    assert_eq!(status, StatusCode::NOT_IMPLEMENTED);
    let (status, _) = api(&sem, "POST", "/api/v1/calendario/sincronizar", None).await;
    assert_eq!(status, StatusCode::NOT_IMPLEMENTED);
    let (_, cfg) = api(&sem, "GET", "/api/v1/calendario/config", None).await;
    assert_eq!(cfg["google_configurado"], false);
    let _ = std::fs::remove_dir_all(&sem.raiz);
}

#[tokio::test(flavor = "multi_thread")]
async fn sem_conexao_o_sync_manual_e_404() {
    let e = montar(true).await;
    let (status, _) = api(&e, "POST", "/api/v1/calendario/sincronizar", None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let _ = std::fs::remove_dir_all(&e.raiz);
}

#[tokio::test(flavor = "multi_thread")]
async fn carga_inicial_pagina_converte_fusos_dia_inteiro_serie_e_ignora_excecoes() {
    let e = montar(true).await;
    conectar_direto(&e, em_uma_hora()).await;
    {
        let mut g = e.mock.lock().unwrap();
        g.eventos.push_back((200, json!({
            "items": [
                ev_hora("g-hora", "Reunião", "2026-09-21T13:00:00-03:00", "2026-09-21T14:30:00-03:00", "\"e1\"", "2026-01-01T10:00:00Z"),
                { "id": "g-dia", "status": "confirmed", "etag": "\"d1\"", "summary": "Feriado", "start": { "date": "2026-09-22" }, "end": { "date": "2026-09-23" } },
            ],
            "nextPageToken": "pagina-2"
        })));
        let mut serie = ev_hora("g-serie", "Semanal", "2026-09-21T09:00:00Z", "2026-09-21T10:00:00Z", "\"s1\"", "2026-01-01T10:00:00Z");
        serie["recurrence"] = json!(["RRULE:FREQ=WEEKLY;BYDAY=MO"]);
        let mut excecao = ev_hora("g-serie_20260928", "Semanal (remarcada)", "2026-09-28T11:00:00Z", "2026-09-28T12:00:00Z", "\"x1\"", "2026-01-01T10:00:00Z");
        excecao["recurringEventId"] = json!("g-serie");
        g.eventos.push_back((200, json!({ "items": [serie, excecao, { "id": "g-apagado-antes", "status": "cancelled" }], "nextSyncToken": "tok-1" })));
    }

    let (status, r) = api(&e, "POST", "/api/v1/calendario/sincronizar", None).await;
    assert_eq!(status, StatusCode::OK, "{r}");
    assert_eq!((r["criados"].as_u64(), r["excecoes_ignoradas"].as_u64(), r["completa"].as_bool()), (Some(3), Some(1), Some(true)), "{r}");

    let (_, lista) = api(&e, "GET", "/api/v1/eventos", None).await;
    let lista = lista.as_array().unwrap();
    assert_eq!(lista.len(), 3);
    let por = |t: &str| lista.iter().find(|x| x["titulo"] == t).unwrap_or_else(|| panic!("sem {t}"));
    assert_eq!(por("Reunião")["inicio"], "2026-09-21T16:00:00+00:00", "13:00-03:00 vira 16:00Z");
    assert_eq!(por("Reunião")["visibilidade"], "google");
    assert_eq!(por("Reunião")["origem_google"], true);
    assert_eq!(por("Reunião")["sync_pendente"], false);
    assert_eq!((por("Feriado")["dia_inteiro"].as_bool(), por("Feriado")["inicio"].as_str()), (Some(true), Some("2026-09-22T03:00:00+00:00")), "meia-noite de Brasília");
    assert_eq!(por("Semanal")["rrule"], "RRULE:FREQ=WEEKLY;BYDAY=MO");

    {
        let g = e.mock.lock().unwrap();
        assert_eq!(g.consultas.len(), 2);
        assert!(g.consultas[0].contains_key("timeMin") && !g.consultas[0].contains_key("syncToken"), "carga inicial usa timeMin");
        assert_eq!(g.consultas[1]["pageToken"], "pagina-2");
        assert!(g.bearers.iter().all(|b| b == "Bearer at-seed"), "usou o access token decifrado: {:?}", g.bearers);
        assert!(g.tokens.is_empty(), "token ainda valia: nada de refresh");
    }
    assert_eq!(cursor(&e).as_deref(), Some("tok-1"));
    let (_, cfg) = api(&e, "GET", "/api/v1/calendario/config", None).await;
    assert!(cfg["conectados"][0]["ultima_sync_em"].is_string() && cfg["conectados"][0]["ultimo_erro"].is_null());
    let _ = std::fs::remove_dir_all(&e.raiz);
}

#[tokio::test(flavor = "multi_thread")]
async fn incremental_atualiza_renomeia_remove_ignora_repetidos_e_resolve_conflito_por_data() {
    let e = montar(true).await;
    conectar_direto(&e, em_uma_hora()).await;
    e.mock.lock().unwrap().eventos.push_back((200, json!({
        "items": [
            ev_hora("g-a", "Alfa", "2026-09-21T13:00:00Z", "2026-09-21T14:00:00Z", "\"a1\"", "2026-01-01T10:00:00Z"),
            { "id": "g-b", "status": "confirmed", "etag": "\"b1\"", "summary": "Beta", "start": { "date": "2026-09-22" }, "end": { "date": "2026-09-23" } },
        ],
        "nextSyncToken": "tok-1"
    })));
    assert_eq!(api(&e, "POST", "/api/v1/calendario/sincronizar", None).await.0, StatusCode::OK);

    // Delta: Alfa renomeado e remarcado; Beta apagado no Google; um evento novo aparecendo duas vezes no lote (vale o último).
    e.mock.lock().unwrap().eventos.push_back((200, json!({
        "items": [
            ev_hora("g-a", "Alfa v2", "2026-09-21T15:00:00Z", "2026-09-21T16:00:00Z", "\"a2\"", "2026-02-01T10:00:00Z"),
            { "id": "g-b", "status": "cancelled" },
            ev_hora("g-c", "Gama rascunho", "2026-09-23T13:00:00Z", "2026-09-23T14:00:00Z", "\"c1\"", "2026-02-01T10:00:00Z"),
            ev_hora("g-c", "Gama", "2026-09-23T13:00:00Z", "2026-09-23T14:00:00Z", "\"c2\"", "2026-02-01T11:00:00Z"),
        ],
        "nextSyncToken": "tok-2"
    })));
    let (_, r) = api(&e, "POST", "/api/v1/calendario/sincronizar", None).await;
    assert_eq!((r["atualizados"].as_u64(), r["removidos"].as_u64(), r["criados"].as_u64(), r["completa"].as_bool()), (Some(1), Some(1), Some(1), Some(false)), "{r}");
    {
        let g = e.mock.lock().unwrap();
        assert_eq!(g.consultas.last().unwrap()["syncToken"], "tok-1");
        assert!(!g.consultas.last().unwrap().contains_key("timeMin"), "o Google não aceita timeMin com syncToken");
    }
    let (_, lista) = api(&e, "GET", "/api/v1/eventos", None).await;
    let mut titulos: Vec<&str> = lista.as_array().unwrap().iter().map(|x| x["titulo"].as_str().unwrap()).collect();
    titulos.sort();
    assert_eq!(titulos, ["Alfa v2", "Gama"]);
    assert!(e.raiz.join("Pessoal/Eventos/Alfa v2.md").is_file() && !e.raiz.join("Pessoal/Eventos/Alfa.md").exists(), "o arquivo acompanha o título");
    let (_, lix) = api(&e, "GET", "/api/v1/lixeira", None).await;
    assert!(lix.as_array().unwrap().iter().any(|i| i["nome"] == "Beta" && i["tipo"] == "evento"), "apagado no Google vai para a lixeira: {lix}");

    // Mesmo etag = nada a fazer.
    e.mock.lock().unwrap().eventos.push_back((200, json!({ "items": [ev_hora("g-a", "Alfa v2", "2026-09-21T15:00:00Z", "2026-09-21T16:00:00Z", "\"a2\"", "2026-02-01T10:00:00Z")], "nextSyncToken": "tok-3" })));
    let (_, r) = api(&e, "POST", "/api/v1/calendario/sincronizar", None).await;
    assert_eq!((r["inalterados"].as_u64(), r["atualizados"].as_u64()), (Some(1), Some(0)));

    // Conflito: edição local ainda não enviada. Google MAIS ANTIGO => o local vence.
    let alfa = lista.as_array().unwrap().iter().find(|x| x["titulo"] == "Alfa v2").unwrap()["id"].as_str().unwrap().to_string();
    let (status, _) = api(&e, "PATCH", &format!("/api/v1/eventos/{alfa}"), Some(json!({ "titulo": "Alfa local" }))).await;
    assert_eq!(status, StatusCode::OK);
    e.mock.lock().unwrap().eventos.push_back((200, json!({ "items": [ev_hora("g-a", "Alfa do Google", "2026-09-21T15:00:00Z", "2026-09-21T16:00:00Z", "\"a3\"", "2020-01-01T00:00:00Z")], "nextSyncToken": "tok-4" })));
    let (_, r) = api(&e, "POST", "/api/v1/calendario/sincronizar", None).await;
    assert_eq!(r["conflitos_mantidos_locais"], 1, "{r}");
    // A edição local venceu o pull e, no mesmo ciclo, foi ao Google com o etag que o pull acabou de ler (sem tomar 412).
    assert_eq!(r["enviados_atualizados"], 1, "{r}");
    {
        let g = e.mock.lock().unwrap();
        let (id_google, if_match, corpo) = g.patches.last().unwrap();
        assert_eq!((id_google.as_str(), if_match.as_deref(), corpo["summary"].as_str()), ("g-a", Some("\"a3\""), Some("Alfa local")));
    }
    let (_, d) = api(&e, "GET", &format!("/api/v1/eventos/{alfa}"), None).await;
    assert_eq!((d["titulo"].as_str(), d["sync_pendente"].as_bool()), (Some("Alfa local"), Some(false)));

    // Google MAIS NOVO => o Google vence e a pendência some.
    e.mock.lock().unwrap().eventos.push_back((200, json!({ "items": [ev_hora("g-a", "Alfa do Google", "2026-09-21T15:00:00Z", "2026-09-21T16:00:00Z", "\"a4\"", "2099-01-01T00:00:00Z")], "nextSyncToken": "tok-5" })));
    api(&e, "POST", "/api/v1/calendario/sincronizar", None).await;
    let (_, d) = api(&e, "GET", &format!("/api/v1/eventos/{alfa}"), None).await;
    assert_eq!((d["titulo"].as_str(), d["sync_pendente"].as_bool()), (Some("Alfa do Google"), Some(false)));
    let _ = std::fs::remove_dir_all(&e.raiz);
}

#[tokio::test(flavor = "multi_thread")]
async fn cursor_vencido_410_refaz_a_carga_completa() {
    let e = montar(true).await;
    conectar_direto(&e, em_uma_hora()).await;
    e.state.db.with(|c| c.execute("UPDATE config_calendario SET sync_cursor = 'tok-velho'", [])).await.unwrap();
    {
        let mut g = e.mock.lock().unwrap();
        g.eventos.push_back((410, json!({ "error": { "code": 410, "message": "Sync token is no longer valid" } })));
        g.eventos.push_back((200, json!({ "items": [ev_hora("g-a", "Alfa", "2026-09-21T13:00:00Z", "2026-09-21T14:00:00Z", "\"a1\"", "2026-01-01T10:00:00Z")], "nextSyncToken": "tok-novo" })));
    }
    let (status, r) = api(&e, "POST", "/api/v1/calendario/sincronizar", None).await;
    assert_eq!(status, StatusCode::OK, "{r}");
    assert_eq!((r["completa"].as_bool(), r["criados"].as_u64()), (Some(true), Some(1)));
    {
        let g = e.mock.lock().unwrap();
        assert_eq!(g.consultas[0]["syncToken"], "tok-velho");
        assert!(!g.consultas[1].contains_key("syncToken") && g.consultas[1].contains_key("timeMin"));
    }
    assert_eq!(cursor(&e).as_deref(), Some("tok-novo"));
    let _ = std::fs::remove_dir_all(&e.raiz);
}

#[tokio::test(flavor = "multi_thread")]
async fn token_vencido_renova_e_refresh_revogado_pede_reconexao_sem_martelar_o_google() {
    let e = montar(true).await;
    conectar_direto(&e, "2000-01-01T00:00:00+00:00".into()).await;

    let (status, r) = api(&e, "POST", "/api/v1/calendario/sincronizar", None).await;
    assert_eq!(status, StatusCode::OK, "{r}");
    {
        let g = e.mock.lock().unwrap();
        assert_eq!((g.tokens.len(), g.tokens[0]["grant_type"].as_str(), g.tokens[0]["refresh_token"].as_str()), (1, "refresh_token", "rt-seed"));
        assert_eq!(g.bearers[0], "Bearer at-renovado");
    }
    let (novo, expira): (Vec<u8>, String) = e.state.db.with(|c| c.query_row("SELECT access_token_encrypted, access_expira_em FROM config_calendario", [], |r| Ok((r.get(0)?, r.get(1)?)))).await.unwrap();
    assert_eq!(Cofre::carregar(&e.raiz).unwrap().decifrar(&novo).unwrap(), b"at-renovado");
    assert!(expira > Utc::now().to_rfc3339());

    // O Google revoga o acesso: o próximo refresh falha com invalid_grant.
    e.mock.lock().unwrap().refresh_invalido = true;
    e.state.db.with(|c| c.execute("UPDATE config_calendario SET access_expira_em = '2000-01-01T00:00:00+00:00'", [])).await.unwrap();
    let (status, _) = api(&e, "POST", "/api/v1/calendario/sincronizar", None).await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (_, cfg) = api(&e, "GET", "/api/v1/calendario/config", None).await;
    assert_eq!(cfg["conectados"][0]["precisa_reconectar"], true);
    assert!(cfg["conectados"][0]["ultimo_erro"].as_str().unwrap().contains("reconecte"));

    // Marcado: nem o job nem outro clique voltam a bater no Google até reconectar.
    let antes = e.mock.lock().unwrap().tokens.len();
    let (status, _) = api(&e, "POST", "/api/v1/calendario/sincronizar", None).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(e.mock.lock().unwrap().tokens.len(), antes);
    assert!(super::sync::usuarios_para_sincronizar(&e.state).await.unwrap().is_empty());
    let _ = std::fs::remove_dir_all(&e.raiz);
}

#[tokio::test(flavor = "multi_thread")]
async fn desconectar_revoga_no_google_e_deixa_os_eventos_privados_e_sem_vinculo() {
    let e = montar(true).await;
    conectar_direto(&e, em_uma_hora()).await;
    let (_, privado) = api(&e, "POST", "/api/v1/eventos", Some(json!({ "titulo": "Só meu", "inicio": "2026-09-24T13:00:00Z", "fim": "2026-09-24T14:00:00Z" }))).await;
    e.mock.lock().unwrap().eventos.push_back((200, json!({ "items": [ev_hora("g-a", "Do Google", "2026-09-21T13:00:00Z", "2026-09-21T14:00:00Z", "\"a1\"", "2026-01-01T10:00:00Z")], "nextSyncToken": "tok-1" })));
    api(&e, "POST", "/api/v1/calendario/sincronizar", None).await;
    let (_, antes) = api(&e, "GET", "/api/v1/eventos", None).await;
    assert!(antes.as_array().unwrap().iter().any(|x| x["titulo"] == "Do Google" && x["origem_google"] == true));

    let (status, _) = api(&e, "DELETE", "/api/v1/calendario/google", None).await;
    assert_eq!(status, StatusCode::OK);

    let (_, depois) = api(&e, "GET", "/api/v1/eventos", None).await;
    let depois = depois.as_array().unwrap();
    assert_eq!(depois.len(), 2, "nenhum evento é apagado ao desconectar");
    assert!(depois.iter().all(|x| x["visibilidade"] == "privado" && x["origem_google"] == false && x["sync_pendente"] == false), "{depois:?}");
    assert!(depois.iter().any(|x| x["id"] == privado["id"]));
    let arquivo = std::fs::read_to_string(e.raiz.join("Pessoal/Eventos/Do Google.md")).unwrap();
    assert!(!arquivo.contains("google:") && !arquivo.contains("g-a"), "{arquivo}");

    assert_eq!(e.mock.lock().unwrap().revogacoes.len(), 1);
    assert_eq!(e.mock.lock().unwrap().revogacoes[0]["token"], "rt-seed");
    let n: i64 = e.state.db.with(|c| c.query_row("SELECT COUNT(*) FROM config_calendario", [], |r| r.get(0))).await.unwrap();
    assert_eq!(n, 0);
    let _ = std::fs::remove_dir_all(&e.raiz);
}

#[tokio::test(flavor = "multi_thread")]
async fn evento_do_ecos_com_ecos_id_no_google_e_vinculado_em_vez_de_duplicado() {
    let e = montar(true).await;
    conectar_direto(&e, em_uma_hora()).await;
    let (_, local) = api(&e, "POST", "/api/v1/eventos", Some(json!({ "titulo": "Nasceu no Ecos", "inicio": "2026-09-21T13:00:00Z", "fim": "2026-09-21T14:00:00Z" }))).await;
    let id = local["id"].as_str().unwrap();
    let mut ev = ev_hora("g-novo", "Nasceu no Ecos", "2026-09-21T13:00:00Z", "2026-09-21T14:00:00Z", "\"n1\"", "2026-01-01T10:00:00Z");
    ev["extendedProperties"] = json!({ "private": { "ecos_id": id } });
    e.mock.lock().unwrap().eventos.push_back((200, json!({ "items": [ev], "nextSyncToken": "tok-1" })));

    let (_, r) = api(&e, "POST", "/api/v1/calendario/sincronizar", None).await;
    assert_eq!((r["criados"].as_u64(), r["atualizados"].as_u64()), (Some(0), Some(1)), "{r}");
    let (_, lista) = api(&e, "GET", "/api/v1/eventos", None).await;
    assert_eq!(lista.as_array().unwrap().len(), 1);
    assert_eq!((lista[0]["id"].as_str(), lista[0]["origem_google"].as_bool()), (Some(id), Some(true)));
    let _ = std::fs::remove_dir_all(&e.raiz);
}

#[tokio::test(flavor = "multi_thread")]
async fn pagina_de_retorno_e_estilizada_sem_nada_que_a_csp_bloqueie() {
    let e = montar(true).await;
    // O CSS é público (o navegador o pede sem cookie) e tem o tipo certo (com `nosniff`, tipo errado = ignorado).
    let resp = e.app.clone().call(Request::builder().uri("/api/v1/calendario/retorno.css").body(Body::empty()).unwrap()).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert!(resp.headers()["content-type"].to_str().unwrap().starts_with("text/css"));
    let css = String::from_utf8(to_bytes(resp.into_body(), 1 << 20).await.unwrap().to_vec()).unwrap();
    assert!(css.contains("prefers-color-scheme: light") && css.contains("main.erro"));

    for (uri, tom) in [
        ("/api/v1/calendario/callback/google", "erro"),
        ("/api/v1/calendario/callback/google?error=access_denied&state=inventado", "erro"),
        ("/api/v1/calendario/callback/microsoft", "erro"),
    ] {
        let (status, html) = req(&e.app, "GET", uri, None, "127.0.0.1:7023", None).await;
        assert_eq!(status, StatusCode::OK);
        assert!(html.contains(r#"href="/api/v1/calendario/retorno.css""#) && html.contains(&format!(r#"<main class="{tom}">"#)), "{html}");
        // A CSP do servidor é `default-src 'self'`: estilo/script embutido não rodaria.
        assert!(!html.contains("<style") && !html.contains("style=") && !html.contains("<script") && !html.contains("onclick"), "{html}");
    }
    let _ = std::fs::remove_dir_all(&e.raiz);
}

// ---------------------------------------------------------------- Ecos -> Google

fn evento_json(titulo: &str, ini: &str, fim: &str, extra: Value) -> Value {
    let mut base = json!({ "titulo": titulo, "inicio": ini, "fim": fim, "visibilidade": "google" });
    base.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
    base
}

async fn sincronizar_ok(e: &Ambiente_) -> Value {
    let (status, r) = api(e, "POST", "/api/v1/calendario/sincronizar", None).await;
    assert_eq!(status, StatusCode::OK, "{r}");
    r
}

#[tokio::test(flavor = "multi_thread")]
async fn push_cria_no_google_com_fuso_categoria_e_id_do_ecos_e_grava_o_vinculo() {
    let e = montar(true).await;
    conectar_direto(&e, em_uma_hora()).await;
    let (_, cat) = api(&e, "POST", "/api/v1/eventos/categorias", Some(json!({ "nome": "Trabalho", "cor": "#E11D48" }))).await;
    let (_, timed) = api(&e, "POST", "/api/v1/eventos", Some(evento_json("Reunião", "2026-09-21T16:00:00Z", "2026-09-21T17:30:00Z", json!({ "categoria_id": cat["id"], "local": "Sala 2", "descricao": "pauta do dia", "fuso": "America/Sao_Paulo" })))).await;
    api(&e, "POST", "/api/v1/eventos", Some(evento_json("Feriado", "2026-09-22T03:00:00Z", "2026-09-23T03:00:00Z", json!({ "dia_inteiro": true, "fuso": "America/Sao_Paulo" })))).await;
    api(&e, "POST", "/api/v1/eventos", Some(evento_json("Semanal", "2026-09-21T12:00:00Z", "2026-09-21T13:00:00Z", json!({ "rrule": "RRULE:FREQ=WEEKLY;BYDAY=MO", "fuso": "America/Sao_Paulo" })))).await;
    // Privado nunca sai do Ecos.
    api(&e, "POST", "/api/v1/eventos", Some(json!({ "titulo": "Só meu", "inicio": "2026-09-24T13:00:00Z", "fim": "2026-09-24T14:00:00Z" }))).await;

    let r = sincronizar_ok(&e).await;
    assert_eq!((r["enviados_criados"].as_u64(), r["envios_com_erro"].as_u64()), (Some(3), Some(0)), "{r}");
    {
        let g = e.mock.lock().unwrap();
        assert_eq!(g.insercoes.len(), 3, "o evento privado não foi enviado");
        let reuniao = g.insercoes.iter().find(|c| c["summary"] == "Reunião").unwrap();
        assert_eq!(reuniao["start"], json!({ "dateTime": "2026-09-21T16:00:00Z", "timeZone": "America/Sao_Paulo" }));
        assert_eq!((reuniao["location"].as_str(), reuniao["description"].as_str()), (Some("Sala 2"), Some("pauta do dia")));
        assert_eq!(reuniao["extendedProperties"]["private"], json!({ "ecos_id": timed["id"], "ecos_categoria": cat["id"] }));
        assert!(reuniao.get("recurrence").is_none(), "campo vazio não vai na criação");
        let feriado = g.insercoes.iter().find(|c| c["summary"] == "Feriado").unwrap();
        assert_eq!((&feriado["start"], &feriado["end"]), (&json!({ "date": "2026-09-22" }), &json!({ "date": "2026-09-23" })), "dia inteiro é só a data, no fuso");
        let semanal = g.insercoes.iter().find(|c| c["summary"] == "Semanal").unwrap();
        assert_eq!(semanal["recurrence"], json!(["RRULE:FREQ=WEEKLY;BYDAY=MO"]));
    }

    // Vínculo gravado no .md: o evento agora é do Google e não está mais pendente.
    let (_, d) = api(&e, "GET", &format!("/api/v1/eventos/{}", timed["id"].as_str().unwrap()), None).await;
    assert_eq!((d["origem_google"].as_bool(), d["sync_pendente"].as_bool()), (Some(true), Some(false)));
    let arquivo = std::fs::read_to_string(e.raiz.join("Pessoal/Eventos/Reunião.md")).unwrap();
    assert!(arquivo.contains("event_id: g-novo-") && arquivo.contains("etag:"), "{arquivo}");

    // O eco no pull seguinte (mesmo etag) não duplica nem é tratado como mudança.
    let id_google = e.mock.lock().unwrap().insercoes.iter().position(|c| c["summary"] == "Reunião").map(|i| format!("g-novo-{}", i + 1)).unwrap();
    e.mock.lock().unwrap().eventos.push_back((200, json!({ "items": [ev_hora(&id_google, "Reunião", "2026-09-21T16:00:00Z", "2026-09-21T17:30:00Z", &format!("\"ins{}\"", &id_google[7..]), "2026-09-20T12:00:00.000Z")], "nextSyncToken": "tok-2" })));
    let r = sincronizar_ok(&e).await;
    assert_eq!((r["criados"].as_u64(), r["inalterados"].as_u64(), r["enviados_criados"].as_u64()), (Some(0), Some(1), Some(0)), "{r}");
    let (_, lista) = api(&e, "GET", "/api/v1/eventos", None).await;
    assert_eq!(lista.as_array().unwrap().len(), 4);
    let _ = std::fs::remove_dir_all(&e.raiz);
}

#[tokio::test(flavor = "multi_thread")]
async fn push_atualiza_com_if_match_adia_no_412_e_recria_no_404() {
    let e = montar(true).await;
    conectar_direto(&e, em_uma_hora()).await;
    let (_, ev) = api(&e, "POST", "/api/v1/eventos", Some(evento_json("Reunião", "2026-09-21T16:00:00Z", "2026-09-21T17:00:00Z", json!({})))).await;
    let id = ev["id"].as_str().unwrap().to_string();
    sincronizar_ok(&e).await; // cria: g-novo-1, etag "ins1"

    // Edição local -> PATCH com o etag conhecido; o etag novo fica guardado.
    api(&e, "PATCH", &format!("/api/v1/eventos/{id}"), Some(json!({ "titulo": "Reunião v2", "local": null }))).await;
    let r = sincronizar_ok(&e).await;
    assert_eq!(r["enviados_atualizados"], 1, "{r}");
    {
        let g = e.mock.lock().unwrap();
        let (eid, if_match, corpo) = &g.patches[0];
        assert_eq!((eid.as_str(), if_match.as_deref(), corpo["summary"].as_str()), ("g-novo-1", Some("\"ins1\""), Some("Reunião v2")));
        assert!(corpo["location"].is_null() && corpo.get("location").is_some(), "no PATCH, null limpa o campo");
    }

    // 412: mudou no Google desde a última leitura -> não sobrescreve; continua pendente para o próximo ciclo decidir.
    api(&e, "PATCH", &format!("/api/v1/eventos/{id}"), Some(json!({ "titulo": "Reunião v3" }))).await;
    e.mock.lock().unwrap().status_patch.push_back(412);
    let r = sincronizar_ok(&e).await;
    assert_eq!((r["envios_adiados"].as_u64(), r["enviados_atualizados"].as_u64()), (Some(1), Some(0)), "{r}");
    let (_, d) = api(&e, "GET", &format!("/api/v1/eventos/{id}"), None).await;
    assert_eq!((d["titulo"].as_str(), d["sync_pendente"].as_bool()), (Some("Reunião v3"), Some(true)));

    // 404: apagado no Google enquanto aqui havia edição pendente -> recria em vez de perder a edição.
    e.mock.lock().unwrap().status_patch.push_back(404);
    let r = sincronizar_ok(&e).await;
    assert_eq!((r["enviados_criados"].as_u64(), r["enviados_atualizados"].as_u64()), (Some(1), Some(0)), "{r}");
    assert_eq!(e.mock.lock().unwrap().insercoes.len(), 2);
    let arquivo = std::fs::read_to_string(e.raiz.join("Pessoal/Eventos/Reunião v3.md")).unwrap();
    assert!(arquivo.contains("event_id: g-novo-"), "{arquivo}");
    let (_, d) = api(&e, "GET", &format!("/api/v1/eventos/{id}"), None).await;
    assert_eq!(d["sync_pendente"], false);
    let _ = std::fs::remove_dir_all(&e.raiz);
}

#[tokio::test(flavor = "multi_thread")]
async fn tornar_privado_apaga_no_google_e_excluir_no_ecos_envia_a_exclusao_mesmo_com_404() {
    let e = montar(true).await;
    conectar_direto(&e, em_uma_hora()).await;
    let (_, a) = api(&e, "POST", "/api/v1/eventos", Some(evento_json("Alfa", "2026-09-21T16:00:00Z", "2026-09-21T17:00:00Z", json!({})))).await;
    let (_, b) = api(&e, "POST", "/api/v1/eventos", Some(evento_json("Beta", "2026-09-22T16:00:00Z", "2026-09-22T17:00:00Z", json!({})))).await;
    let (_, c) = api(&e, "POST", "/api/v1/eventos", Some(evento_json("Gama", "2026-09-23T16:00:00Z", "2026-09-23T17:00:00Z", json!({})))).await;
    assert_eq!(sincronizar_ok(&e).await["enviados_criados"], 3); // g-novo-1..3

    // Alfa vira privado: some do Google, fica no Ecos sem vínculo.
    let (status, _) = api(&e, "PATCH", &format!("/api/v1/eventos/{}", a["id"].as_str().unwrap()), Some(json!({ "visibilidade": "privado" }))).await;
    assert_eq!(status, StatusCode::OK);
    let r = sincronizar_ok(&e).await;
    assert_eq!(r["removidos_no_google"], 1, "{r}");
    assert_eq!(e.mock.lock().unwrap().delecoes, ["g-novo-1"]);
    let (_, d) = api(&e, "GET", &format!("/api/v1/eventos/{}", a["id"].as_str().unwrap()), None).await;
    assert_eq!((d["visibilidade"].as_str(), d["origem_google"].as_bool()), (Some("privado"), Some(false)));
    assert_eq!(sincronizar_ok(&e).await["removidos_no_google"], 0, "não apaga de novo");

    // Beta excluído no Ecos: o pedido sobrevive (o .md já foi para a lixeira) e é enviado no ciclo.
    api(&e, "DELETE", &format!("/api/v1/eventos/{}", b["id"].as_str().unwrap()), None).await;
    let pendentes: i64 = e.state.db.with(|c| c.query_row("SELECT COUNT(*) FROM evento_exclusao_google", [], |r| r.get(0))).await.unwrap();
    assert_eq!(pendentes, 1);
    assert_eq!(sincronizar_ok(&e).await["removidos_no_google"], 1);
    assert_eq!(e.mock.lock().unwrap().delecoes, ["g-novo-1", "g-novo-2"]);
    let pendentes: i64 = e.state.db.with(|c| c.query_row("SELECT COUNT(*) FROM evento_exclusao_google", [], |r| r.get(0))).await.unwrap();
    assert_eq!(pendentes, 0);

    // Gama excluído, mas já não existe no Google (404): resultado desejado já vale, o pedido some.
    api(&e, "DELETE", &format!("/api/v1/eventos/{}", c["id"].as_str().unwrap()), None).await;
    e.mock.lock().unwrap().status_delete.push_back(404);
    assert_eq!(sincronizar_ok(&e).await["removidos_no_google"], 1);
    let pendentes: i64 = e.state.db.with(|c| c.query_row("SELECT COUNT(*) FROM evento_exclusao_google", [], |r| r.get(0))).await.unwrap();
    assert_eq!(pendentes, 0);
    let _ = std::fs::remove_dir_all(&e.raiz);
}

#[tokio::test(flavor = "multi_thread")]
async fn evento_privado_excluido_no_ecos_nao_gera_pedido_ao_google() {
    let e = montar(true).await;
    conectar_direto(&e, em_uma_hora()).await;
    let (_, p) = api(&e, "POST", "/api/v1/eventos", Some(json!({ "titulo": "Só meu", "inicio": "2026-09-24T13:00:00Z", "fim": "2026-09-24T14:00:00Z" }))).await;
    api(&e, "DELETE", &format!("/api/v1/eventos/{}", p["id"].as_str().unwrap()), None).await;
    let pendentes: i64 = e.state.db.with(|c| c.query_row("SELECT COUNT(*) FROM evento_exclusao_google", [], |r| r.get(0))).await.unwrap();
    assert_eq!(pendentes, 0);
    sincronizar_ok(&e).await;
    assert!(e.mock.lock().unwrap().delecoes.is_empty());
    let _ = std::fs::remove_dir_all(&e.raiz);
}

#[tokio::test(flavor = "multi_thread")]
async fn recusa_do_google_deixa_pendente_e_falha_transitoria_interrompe_sem_perder_o_que_ja_foi() {
    let e = montar(true).await;
    conectar_direto(&e, em_uma_hora()).await;
    api(&e, "POST", "/api/v1/eventos", Some(evento_json("Primeiro", "2026-09-21T16:00:00Z", "2026-09-21T17:00:00Z", json!({})))).await;
    api(&e, "POST", "/api/v1/eventos", Some(evento_json("Segundo", "2026-09-22T16:00:00Z", "2026-09-22T17:00:00Z", json!({})))).await;

    // 400 num evento: conta o erro, segue com os outros, e o recusado continua pendente.
    e.mock.lock().unwrap().status_insert.push_back(400);
    let r = sincronizar_ok(&e).await;
    assert_eq!((r["envios_com_erro"].as_u64(), r["enviados_criados"].as_u64()), (Some(1), Some(1)), "{r}");
    let (_, lista) = api(&e, "GET", "/api/v1/eventos", None).await;
    let pendentes: Vec<&Value> = lista.as_array().unwrap().iter().filter(|x| x["sync_pendente"] == true).collect();
    assert_eq!(pendentes.len(), 1);

    // 503: para o ciclo (o job tenta de novo depois) e continua pendente; nada foi perdido.
    e.mock.lock().unwrap().status_insert.push_back(503);
    let (status, _) = api(&e, "POST", "/api/v1/calendario/sincronizar", None).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    let (_, lista) = api(&e, "GET", "/api/v1/eventos", None).await;
    assert_eq!(lista.as_array().unwrap().iter().filter(|x| x["sync_pendente"] == true).count(), 1);

    // Google volta: o pendente vai.
    let r = sincronizar_ok(&e).await;
    assert_eq!(r["enviados_criados"], 1, "{r}");
    let (_, lista) = api(&e, "GET", "/api/v1/eventos", None).await;
    assert!(lista.as_array().unwrap().iter().all(|x| x["sync_pendente"] == false && x["origem_google"] == true));
    let _ = std::fs::remove_dir_all(&e.raiz);
}

#[tokio::test(flavor = "multi_thread")]
async fn envio_imediato_manda_sem_esperar_o_proximo_ciclo() {
    let e = montar_com(true, true).await;
    conectar_direto(&e, em_uma_hora()).await;
    let (status, _) = api(&e, "POST", "/api/v1/eventos", Some(evento_json("Agora", "2026-09-21T16:00:00Z", "2026-09-21T17:00:00Z", json!({})))).await;
    assert_eq!(status, StatusCode::OK);
    for _ in 0..60 {
        if !e.mock.lock().unwrap().insercoes.is_empty() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    assert_eq!(e.mock.lock().unwrap().insercoes.len(), 1, "o evento deveria ter ido ao Google sozinho");
    let (_, lista) = api(&e, "GET", "/api/v1/eventos", None).await;
    assert_eq!((lista[0]["origem_google"].as_bool(), lista[0]["sync_pendente"].as_bool()), (Some(true), Some(false)));
    let _ = std::fs::remove_dir_all(&e.raiz);
}

#[test]
fn corpo_google_dia_inteiro_com_fim_invalido_vira_um_dia_e_patch_mantem_nulos() {
    use ecos_core::types::{Espaco, EventoFrontMatter, EventoVisibilidade, GoogleRef};
    let t: chrono::DateTime<Utc> = "2026-09-22T03:00:00Z".parse().unwrap();
    let fm = EventoFrontMatter {
        id: "e1".into(), titulo: "Feriado".into(), inicio: t, fim: t, dia_inteiro: true, fuso: Some("America/Sao_Paulo".into()), local: None, categoria_id: None, cor: None,
        visibilidade: EventoVisibilidade::Google, rrule: None, recorrencia_extra: vec![], excecoes: vec![], tarefas: vec![], notas: vec![], google: GoogleRef::default(), sync_pendente: true,
        espaco: Espaco::Pessoal, criado_em: t, atualizado_em: t, criado_por: None,
    };
    let patch = super::sync::corpo_google(&fm, "", "UTC", false);
    assert_eq!((&patch["start"], &patch["end"]), (&json!({ "date": "2026-09-22" }), &json!({ "date": "2026-09-23" })), "fim <= início vira 1 dia");
    assert!(patch["location"].is_null() && patch["recurrence"].is_null(), "no PATCH os nulos limpam o campo");
    assert!(patch["extendedProperties"]["private"]["ecos_categoria"].is_null());
    let criar = super::sync::corpo_google(&fm, "", "UTC", true);
    assert!(criar.get("location").is_none() && criar.get("recurrence").is_none());
    assert_eq!(criar["extendedProperties"]["private"], json!({ "ecos_id": "e1" }));
    // EXDATE/RDATE da série vão junto da RRULE (senão o PATCH apagaria as datas excluídas no Google).
    let mut serie = fm.clone();
    (serie.rrule, serie.recorrencia_extra) = (Some("RRULE:FREQ=WEEKLY".into()), vec!["EXDATE:20261012T130000Z".into()]);
    assert_eq!(super::sync::corpo_google(&serie, "", "UTC", false)["recurrence"], json!(["RRULE:FREQ=WEEKLY", "EXDATE:20261012T130000Z"]));
    // Fuso inválido no evento cai no do calendário; sem nenhum válido, UTC.
    let mut hora = fm.clone();
    (hora.dia_inteiro, hora.fuso) = (false, Some("Fuso/Invalido".into()));
    assert_eq!(super::sync::corpo_google(&hora, "", "America/Sao_Paulo", true)["start"]["timeZone"], "America/Sao_Paulo");
    assert_eq!(super::sync::corpo_google(&hora, "", "Nada/Valido", true)["start"]["timeZone"], "UTC");
}

// ---------------------------------------------------------------- Séries e ocorrências

fn serie_google(id: &str, etag: &str) -> Value {
    let mut s = ev_hora(id, "Semanal", "2026-09-21T13:00:00Z", "2026-09-21T14:00:00Z", etag, "2026-01-01T10:00:00Z");
    s["recurrence"] = json!(["RRULE:FREQ=WEEKLY;BYDAY=MO"]);
    s
}

fn excecao_google(id: &str, mestre: &str, original: &str, extra: Value) -> Value {
    let mut e = json!({ "id": id, "status": "confirmed", "etag": "\"x1\"", "updated": "2026-02-01T10:00:00Z", "recurringEventId": mestre, "originalStartTime": { "dateTime": original } });
    e.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
    e
}

/// Traz uma série do Google para o Ecos e devolve o id local dela.
async fn serie_no_ecos(e: &Ambiente_) -> String {
    e.mock.lock().unwrap().eventos.push_back((200, json!({ "items": [serie_google("g-serie", "\"s1\"")], "nextSyncToken": "tok-1" })));
    sincronizar_ok(e).await;
    let (_, lista) = api(e, "GET", "/api/v1/eventos", None).await;
    lista[0]["id"].as_str().unwrap().to_string()
}

#[tokio::test(flavor = "multi_thread")]
async fn excecoes_do_google_entram_na_serie_em_qualquer_ordem_e_guardam_so_o_que_mudou() {
    let e = montar(true).await;
    conectar_direto(&e, em_uma_hora()).await;
    let mut mestre = serie_google("g-serie", "\"s1\"");
    mestre["recurrence"] = json!(["RRULE:FREQ=WEEKLY;BYDAY=MO", "EXDATE:20261012T130000Z"]);
    e.mock.lock().unwrap().eventos.push_back((200, json!({
        "items": [
            // A exceção vem ANTES da série no lote: precisa esperar a série existir.
            excecao_google("g-serie_20260928T130000Z", "g-serie", "2026-09-28T13:00:00Z", json!({ "summary": "Semanal (remarcada)", "location": "Sala 3", "start": { "dateTime": "2026-09-29T14:00:00Z" }, "end": { "dateTime": "2026-09-29T15:00:00Z" } })),
            excecao_google("g-serie_20261005T130000Z", "g-serie", "2026-10-05T13:00:00Z", json!({ "status": "cancelled" })),
            excecao_google("g-orfa_20260928T130000Z", "g-desconhecida", "2026-09-28T13:00:00Z", json!({ "summary": "x", "start": { "dateTime": "2026-09-28T13:00:00Z" }, "end": { "dateTime": "2026-09-28T14:00:00Z" } })),
            mestre,
        ],
        "nextSyncToken": "tok-1"
    })));
    let r = sincronizar_ok(&e).await;
    assert_eq!((r["criados"].as_u64(), r["excecoes_aplicadas"].as_u64(), r["excecoes_ignoradas"].as_u64()), (Some(1), Some(2), Some(1)), "{r}");

    let (_, lista) = api(&e, "GET", "/api/v1/eventos", None).await;
    assert_eq!(lista.as_array().unwrap().len(), 1, "a exceção não vira um evento à parte");
    let serie = &lista[0];
    assert_eq!(serie["recorrencia_extra"], json!(["EXDATE:20261012T130000Z"]));
    let excecoes = serie["excecoes"].as_array().unwrap();
    assert_eq!(excecoes.len(), 2);
    let remarcada = &excecoes[0];
    assert_eq!(remarcada["original"], "2026-09-28T13:00:00+00:00");
    assert_eq!((remarcada["titulo"].as_str(), remarcada["inicio"].as_str(), remarcada["local"].as_str()), (Some("Semanal (remarcada)"), Some("2026-09-29T14:00:00+00:00"), Some("Sala 3")));
    assert!(remarcada["fim"].is_null() && remarcada["descricao"].is_null(), "mesma duração e descrição da série: nada a guardar: {remarcada}");
    assert_eq!((excecoes[1]["cancelada"].as_bool(), excecoes[1]["titulo"].is_null()), (Some(true), true));

    // O mesmo lote de novo (mesmos etags) não muda nada.
    let mut mestre = serie_google("g-serie", "\"s1\"");
    mestre["recurrence"] = json!(["RRULE:FREQ=WEEKLY;BYDAY=MO", "EXDATE:20261012T130000Z"]);
    e.mock.lock().unwrap().eventos.push_back((200, json!({ "items": [excecao_google("g-serie_20260928T130000Z", "g-serie", "2026-09-28T13:00:00Z", json!({ "summary": "Semanal (remarcada)", "start": { "dateTime": "2026-09-29T14:00:00Z" }, "end": { "dateTime": "2026-09-29T15:00:00Z" } })), mestre], "nextSyncToken": "tok-2" })));
    let r = sincronizar_ok(&e).await;
    assert_eq!((r["excecoes_aplicadas"].as_u64(), r["inalterados"].as_u64()), (Some(0), Some(2)), "{r}");
    let _ = std::fs::remove_dir_all(&e.raiz);
}

#[tokio::test(flavor = "multi_thread")]
async fn editar_uma_ocorrencia_no_ecos_vai_como_excecao_da_instancia_sem_reescrever_a_serie() {
    let e = montar(true).await;
    conectar_direto(&e, em_uma_hora()).await;
    let id = serie_no_ecos(&e).await;

    let (status, d) = api(&e, "PATCH", &format!("/api/v1/eventos/{id}/ocorrencias"), Some(json!({
        "original": "2026-09-28T13:00:00Z", "titulo": "Só esta", "inicio": "2026-09-29T14:00:00Z", "fim": "2026-09-29T15:30:00Z", "local": "Sala 9",
    }))).await;
    assert_eq!(status, StatusCode::OK, "{d}");
    assert_eq!(d["excecoes"][0]["sync_pendente"], true);
    assert_eq!(d["titulo"], "Semanal", "a série continua igual");

    e.mock.lock().unwrap().instancias = vec![json!({ "id": "g-serie_20260928T130000Z", "originalStartTime": { "dateTime": "2026-09-28T13:00:00Z" } })];
    let r = sincronizar_ok(&e).await;
    assert_eq!((r["enviados_atualizados"].as_u64(), r["envios_com_erro"].as_u64()), (Some(1), Some(0)), "{r}");
    {
        let g = e.mock.lock().unwrap();
        assert_eq!(g.patches.len(), 1, "só a instância foi tocada, nunca a série");
        let (alvo, if_match, corpo) = &g.patches[0];
        assert_eq!((alvo.as_str(), if_match.as_deref()), ("g-serie_20260928T130000Z", None));
        assert_eq!((corpo["summary"].as_str(), corpo["location"].as_str()), (Some("Só esta"), Some("Sala 9")));
        assert_eq!((&corpo["start"]["dateTime"], &corpo["end"]["dateTime"]), (&json!("2026-09-29T14:00:00Z"), &json!("2026-09-29T15:30:00Z")));
        assert!(corpo.get("recurrence").is_none() && corpo.get("extendedProperties").is_none(), "instância não tem regra própria: {corpo}");
        let (serie, consulta) = &g.consultas_instancias[0];
        assert_eq!(serie, "g-serie");
        assert!(consulta.contains_key("timeMin") && consulta["showDeleted"] == "true");
    }
    let (_, d) = api(&e, "GET", &format!("/api/v1/eventos/{id}"), None).await;
    assert_eq!((d["excecoes"][0]["sync_pendente"].as_bool(), d["sync_pendente"].as_bool()), (Some(false), Some(false)));
    assert_eq!(sincronizar_ok(&e).await["enviados_atualizados"], 0, "nada a reenviar");

    // Editar a MESMA ocorrência de novo usa o id e o etag que já temos (sem procurar a instância outra vez).
    e.mock.lock().unwrap().consultas_instancias.clear();
    api(&e, "PATCH", &format!("/api/v1/eventos/{id}/ocorrencias"), Some(json!({ "original": "2026-09-28T13:00:00Z", "local": null }))).await;
    sincronizar_ok(&e).await;
    let g = e.mock.lock().unwrap();
    assert!(g.consultas_instancias.is_empty());
    assert_eq!(g.patches.len(), 2);
    assert_eq!(g.patches[1].1.as_deref(), Some("\"pat1\""), "If-Match com o etag devolvido pelo envio anterior");
    assert!(g.patches[1].2["location"].is_null(), "local apagado só nesta ocorrência");
    drop(g);
    let _ = std::fs::remove_dir_all(&e.raiz);
}

#[tokio::test(flavor = "multi_thread")]
async fn cancelar_uma_ocorrencia_apaga_so_a_instancia_e_ocorrencia_sumida_no_google_nao_trava_o_envio() {
    let e = montar(true).await;
    conectar_direto(&e, em_uma_hora()).await;
    let id = serie_no_ecos(&e).await;

    let (status, d) = api(&e, "DELETE", &format!("/api/v1/eventos/{id}/ocorrencias?original=2026-10-05T13:00:00Z"), None).await;
    assert_eq!(status, StatusCode::OK, "{d}");
    assert_eq!((d["excecoes"][0]["cancelada"].as_bool(), d["excecoes"][0]["sync_pendente"].as_bool()), (Some(true), Some(true)));
    e.mock.lock().unwrap().instancias = vec![json!({ "id": "g-serie_20261005T130000Z", "originalStartTime": { "dateTime": "2026-10-05T13:00:00Z" } })];
    let r = sincronizar_ok(&e).await;
    assert_eq!(r["removidos_no_google"], 1, "{r}");
    assert_eq!(e.mock.lock().unwrap().delecoes, ["g-serie_20261005T130000Z"], "só a instância; a série fica");

    // Outra ocorrência que já não existe no Google: não há o que enviar, e a pendência é desfeita (sem erro, sem laço).
    api(&e, "DELETE", &format!("/api/v1/eventos/{id}/ocorrencias?original=2026-10-12T13:00:00Z"), None).await;
    e.mock.lock().unwrap().instancias = vec![];
    let r = sincronizar_ok(&e).await;
    assert_eq!((r["removidos_no_google"].as_u64(), r["envios_com_erro"].as_u64()), (Some(0), Some(0)), "{r}");
    let (_, d) = api(&e, "GET", &format!("/api/v1/eventos/{id}"), None).await;
    assert!(d["excecoes"].as_array().unwrap().iter().all(|x| x["sync_pendente"] == false), "{d}");
    let _ = std::fs::remove_dir_all(&e.raiz);
}

#[tokio::test(flavor = "multi_thread")]
async fn serie_do_google_e_protegida_no_ecos_so_categoria_e_vinculos_mudam() {
    let e = montar(true).await;
    conectar_direto(&e, em_uma_hora()).await;
    let id = serie_no_ecos(&e).await;
    let url = format!("/api/v1/eventos/{id}");

    for corpo in [json!({ "titulo": "Outro" }), json!({ "inicio": "2026-09-22T13:00:00Z" }), json!({ "visibilidade": "privado" }), json!({ "local": "Sala" }), json!({ "rrule": null }), json!({ "rrule": "RRULE:FREQ=DAILY" })] {
        let (status, d) = api(&e, "PATCH", &url, Some(corpo.clone())).await;
        assert_eq!(status, StatusCode::CONFLICT, "{corpo} -> {d}");
    }
    let (status, _) = api(&e, "DELETE", &url, None).await;
    assert_eq!(status, StatusCode::CONFLICT, "a série só se apaga no Google");
    let (_, d) = api(&e, "GET", &url, None).await;
    assert_eq!(d["visibilidade"], "google");

    // A cor é só do Ecos: também é livre numa série do Google e não marca nada para enviar.
    let (status, d) = api(&e, "PATCH", &url, Some(json!({ "cor": "#22AA55" }))).await;
    assert_eq!((status, d["cor"].as_str(), d["sync_pendente"].as_bool()), (StatusCode::OK, Some("#22AA55"), Some(false)), "{d}");
    assert!(e.mock.lock().unwrap().patches.is_empty());

    // Categoria pode: e ao Google vai SÓ o metadado (nunca horário/regra), com o etag.
    let (_, cat) = api(&e, "POST", "/api/v1/eventos/categorias", Some(json!({ "nome": "Trabalho", "cor": "#E11D48" }))).await;
    let (status, _) = api(&e, "PATCH", &url, Some(json!({ "categoria_id": cat["id"] }))).await;
    assert_eq!(status, StatusCode::OK);
    sincronizar_ok(&e).await;
    let g = e.mock.lock().unwrap();
    let (alvo, if_match, corpo) = &g.patches[0];
    assert_eq!((alvo.as_str(), if_match.as_deref()), ("g-serie", Some("\"s1\"")));
    assert_eq!(corpo.as_object().unwrap().keys().collect::<Vec<_>>(), ["extendedProperties"], "{corpo}");
    assert_eq!(corpo["extendedProperties"]["private"]["ecos_categoria"], cat["id"]);
    drop(g);

    // Ocorrência: precisa ser de uma série, dentro dela, com fim depois do início, e não cancelada.
    let (_, simples) = api(&e, "POST", "/api/v1/eventos", Some(json!({ "titulo": "Simples", "inicio": "2026-09-24T13:00:00Z", "fim": "2026-09-24T14:00:00Z" }))).await;
    let (status, _) = api(&e, "PATCH", &format!("/api/v1/eventos/{}/ocorrencias", simples["id"].as_str().unwrap()), Some(json!({ "original": "2026-09-24T13:00:00Z", "titulo": "x" }))).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let ocorrencia = format!("{url}/ocorrencias");
    let (status, _) = api(&e, "PATCH", &ocorrencia, Some(json!({ "original": "2020-01-01T13:00:00Z", "titulo": "x" }))).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "antes do início da série");
    let (status, _) = api(&e, "PATCH", &ocorrencia, Some(json!({ "original": "2026-09-28T13:00:00Z", "inicio": "2026-09-28T15:00:00Z", "fim": "2026-09-28T14:00:00Z" }))).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "fim antes do início");
    api(&e, "DELETE", &format!("{ocorrencia}?original=2026-10-05T13:00:00Z"), None).await;
    let (status, _) = api(&e, "PATCH", &ocorrencia, Some(json!({ "original": "2026-10-05T13:00:00Z", "titulo": "x" }))).await;
    assert_eq!(status, StatusCode::CONFLICT, "não se edita uma ocorrência cancelada");
    let _ = std::fs::remove_dir_all(&e.raiz);
}

#[tokio::test(flavor = "multi_thread")]
async fn ao_desconectar_as_excecoes_perdem_o_vinculo_com_o_google() {
    let e = montar(true).await;
    conectar_direto(&e, em_uma_hora()).await;
    let id = serie_no_ecos(&e).await;
    api(&e, "PATCH", &format!("/api/v1/eventos/{id}/ocorrencias"), Some(json!({ "original": "2026-09-28T13:00:00Z", "titulo": "Só esta" }))).await;
    api(&e, "DELETE", "/api/v1/calendario/google", None).await;
    let (_, d) = api(&e, "GET", &format!("/api/v1/eventos/{id}"), None).await;
    assert_eq!((d["visibilidade"].as_str(), d["origem_google"].as_bool()), (Some("privado"), Some(false)));
    assert_eq!(d["excecoes"][0]["sync_pendente"], false, "nada fica esperando um Google que não está mais lá");
    assert_eq!(d["excecoes"][0]["titulo"], "Só esta", "mas a mudança local continua");
    let _ = std::fs::remove_dir_all(&e.raiz);
}
