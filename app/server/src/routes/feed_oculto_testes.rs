//! Feed personalizado: ocultar item, pasta e tag (`/me/feed/ocultos`). Roteador real + índice SQLite temporário.

use crate::{auth::session, config::{Ambiente, Config}, db::IndexDb, state::AppState};
use axum::{body::{to_bytes, Body}, http::{Request, StatusCode}, Router};
use ecos_core::new_id;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use tower::Service;

async fn chamar(app: &Router, metodo: &str, uri: &str, token: &str, corpo: Option<Value>) -> (StatusCode, Value) {
    let mut pedido = Request::builder().method(metodo).uri(uri).header("authorization", format!("Bearer {token}"));
    let corpo = match corpo {
        Some(c) => { pedido = pedido.header("content-type", "application/json"); Body::from(c.to_string()) }
        None => Body::empty(),
    };
    let resposta = app.clone().call(pedido.body(corpo).unwrap()).await.unwrap();
    let status = resposta.status();
    let bytes = to_bytes(resposta.into_body(), 1024 * 1024).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

fn ids_do_feed(v: &Value) -> Vec<String> {
    let mut ids: Vec<String> = v["items"].as_array().unwrap().iter().map(|i| i["id"].as_str().unwrap().to_string()).collect();
    ids.sort();
    ids
}

#[tokio::test]
async fn oculta_item_pasta_e_tag() {
    let temp = std::env::temp_dir().join(format!("ecos-feed-oculto-{}", new_id()));
    std::fs::create_dir_all(&temp).unwrap();
    let segredo = b"segredo-efemero-exclusivo-do-teste-do-feed".to_vec();
    let state = AppState {
        db: IndexDb::open(&temp.join("index.db")).unwrap(),
        config: Arc::new(Config {
            ambiente: Ambiente::Desenvolvimento, porta: 0, notes_root: temp.clone(), index_db_path: temp.join("index.db"),
            vault_enabled: false, vault_internal_url: String::new(), session_secret: segredo.clone(), ranking_interval_secs: 300,
            static_dir: None, cookie_secure: false, google: None,
        }),
        http: reqwest::Client::new(), pareamentos: Arc::new(Mutex::new(Default::default())),
    };
    state.db.with(|c| { c.execute("INSERT INTO usuario (id, nome_usuario, senha_hash, recovery_key_hash) VALUES ('a', 'a', 'x', 'x')", [])?; Ok(()) }).await.unwrap();
    let app = crate::routes::montar(state.clone());
    let tok = session::emitir_access_token("a", &segredo).unwrap();

    let (_, solta) = chamar(&app, "POST", "/api/v1/notas", &tok, Some(json!({ "titulo": "Solta", "corpo": "x" }))).await;
    let (_, em_pasta) = chamar(&app, "POST", "/api/v1/notas", &tok, Some(json!({ "titulo": "Na pasta", "corpo": "x", "pasta": "Proj/Sub" }))).await;
    let (_, com_tag) = chamar(&app, "POST", "/api/v1/notas", &tok, Some(json!({ "titulo": "Com tag", "corpo": "x", "tags": ["chato"] }))).await;
    let (_, tarefa) = chamar(&app, "POST", "/api/v1/tarefas", &tok, Some(json!({ "titulo": "Tarefa" }))).await;
    let (solta, em_pasta, com_tag, tarefa) = (solta["id"].as_str().unwrap().to_string(), em_pasta["id"].as_str().unwrap().to_string(), com_tag["id"].as_str().unwrap().to_string(), tarefa["id"].as_str().unwrap().to_string());
    for (id, tipo) in [(&solta, "nota"), (&em_pasta, "nota"), (&com_tag, "nota"), (&tarefa, "tarefa_encaixada")] {
        let (id, tipo) = (id.clone(), tipo.to_string());
        state.db.with(move |c| c.execute("INSERT INTO feed_item (id, tipo, score_dominante, espaco, atualizado_em) VALUES (?1, ?2, 1.0, 'pessoal', '2026-09-21T10:00:00Z')", rusqlite::params![id, tipo])).await.unwrap();
    }
    let mut todos = vec![solta.clone(), em_pasta.clone(), com_tag.clone(), tarefa.clone()];
    todos.sort();
    let (st, feed) = chamar(&app, "GET", "/api/v1/feed", &tok, None).await;
    assert_eq!(st, StatusCode::OK, "{feed}");
    assert_eq!(ids_do_feed(&feed), todos, "sem ocultar, tarefa e notas aparecem");

    // por pasta (vale para subpastas)
    let (st, r) = chamar(&app, "PUT", "/api/v1/me/feed/ocultos", &tok, Some(json!({ "tipo": "pasta", "ref": "Proj", "espaco": "pessoal", "oculto": true }))).await;
    assert_eq!(st, StatusCode::OK, "{r}");
    assert_eq!(r["pastas"][0]["caminho"], "Proj");
    let (_, feed) = chamar(&app, "GET", "/api/v1/feed", &tok, None).await;
    assert!(!ids_do_feed(&feed).contains(&em_pasta));
    // por tag
    chamar(&app, "PUT", "/api/v1/me/feed/ocultos", &tok, Some(json!({ "tipo": "tag", "ref": "#chato", "oculto": true }))).await;
    let (_, feed) = chamar(&app, "GET", "/api/v1/feed", &tok, None).await;
    assert!(!ids_do_feed(&feed).contains(&com_tag));
    // por item (tarefa)
    let (_, r) = chamar(&app, "PUT", "/api/v1/me/feed/ocultos", &tok, Some(json!({ "tipo": "item", "ref": tarefa, "oculto": true }))).await;
    assert_eq!(r["itens"][0]["titulo"], "Tarefa");
    let (_, feed) = chamar(&app, "GET", "/api/v1/feed", &tok, None).await;
    assert_eq!(ids_do_feed(&feed), vec![solta.clone()]);
    // voltar a mostrar
    for corpo in [json!({ "tipo": "pasta", "ref": "Proj", "espaco": "pessoal", "oculto": false }), json!({ "tipo": "tag", "ref": "chato", "oculto": false }), json!({ "tipo": "item", "ref": tarefa, "oculto": false })] {
        chamar(&app, "PUT", "/api/v1/me/feed/ocultos", &tok, Some(corpo)).await;
    }
    let (_, feed) = chamar(&app, "GET", "/api/v1/feed", &tok, None).await;
    assert_eq!(ids_do_feed(&feed), todos);
    let (st, _) = chamar(&app, "PUT", "/api/v1/me/feed/ocultos", &tok, Some(json!({ "tipo": "pasta", "ref": "X", "oculto": true }))).await;
    assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY);
}
