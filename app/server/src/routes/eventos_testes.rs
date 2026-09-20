//! Testes de integração das rotas de eventos (roteador real + índice SQLite temporário).

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
    let resposta = app.clone().call(pedido.body(corpo).unwrap()).await.unwrap();
    let status = resposta.status();
    let bytes = to_bytes(resposta.into_body(), 1024 * 1024).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null))
}

async fn app_de_teste() -> (Router, String, std::path::PathBuf, AppState) {
    let temp = std::env::temp_dir().join(format!("ecos-eventos-test-{}", new_id()));
    std::fs::create_dir_all(&temp).unwrap();
    let segredo = b"segredo-efemero-exclusivo-do-teste-de-eventos".to_vec();
    let state = AppState {
        db: IndexDb::open(&temp.join("index.db")).unwrap(),
        config: Arc::new(Config {
            ambiente: Ambiente::Desenvolvimento, porta: 0, notes_root: temp.clone(), index_db_path: temp.join("index.db"),
            vault_enabled: false, vault_internal_url: String::new(), session_secret: segredo.clone(), ranking_interval_secs: 300,
            static_dir: None, cookie_secure: false, google: None,
        }),
        http: reqwest::Client::new(), pareamentos: Arc::new(Mutex::new(Default::default())),
    };
    state.db.with(|conn| {
        conn.execute("INSERT INTO usuario (id, nome_usuario, senha_hash, recovery_key_hash) VALUES ('usuario-teste', 'teste', 'efemero', 'efemero')", [])?;
        Ok(())
    }).await.unwrap();
    let token = session::emitir_access_token("usuario-teste", &segredo).unwrap();
    (crate::routes::montar(state.clone()), token, temp, state)
}

async fn categoria(app: &Router, token: &str, nome: &str, cor: &str) -> String {
    let (status, c) = chamar(app, "POST", "/api/v1/eventos/categorias", token, Some(serde_json::json!({ "nome": nome, "cor": cor }))).await;
    assert_eq!(status, StatusCode::OK, "{c}");
    c["id"].as_str().unwrap().to_string()
}

fn evento(titulo: &str, inicio: &str, fim: &str, extra: serde_json::Value) -> serde_json::Value {
    let mut base = serde_json::json!({ "titulo": titulo, "inicio": inicio, "fim": fim });
    base.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
    base
}

#[tokio::test]
async fn crud_categoria_validacoes_e_privado_por_padrao() {
    let (app, token, raiz, _) = app_de_teste().await;
    let cat = categoria(&app, &token, "Reunião", "#3366ff").await;

    let (status, dup) = chamar(&app, "POST", "/api/v1/eventos/categorias", &token, Some(serde_json::json!({ "nome": "reunião", "cor": "#000000" }))).await;
    assert_eq!(status, StatusCode::CONFLICT, "{dup}");
    let (status, _) = chamar(&app, "POST", "/api/v1/eventos/categorias", &token, Some(serde_json::json!({ "nome": "X", "cor": "azul" }))).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    let (status, e) = chamar(&app, "POST", "/api/v1/eventos", &token, Some(evento("Daily", "2026-09-21T13:00:00Z", "2026-09-21T13:30:00Z", serde_json::json!({ "categoria_id": cat, "descricao": "pauta" })))).await;
    assert_eq!(status, StatusCode::OK, "{e}");
    assert_eq!(e["visibilidade"], "privado");
    assert_eq!(e["sync_pendente"], false, "evento privado nunca fica pendente de envio ao Google");
    assert_eq!(e["categoria"]["nome"], "Reunião");
    assert_eq!(e["descricao"], "pauta");
    assert!(raiz.join("Pessoal/Eventos/Daily.md").is_file(), "fonte da verdade é o .md");

    // fim antes do início e categoria inexistente => 422
    let (status, _) = chamar(&app, "POST", "/api/v1/eventos", &token, Some(evento("Ruim", "2026-09-21T14:00:00Z", "2026-09-21T13:00:00Z", serde_json::json!({})))).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let (status, _) = chamar(&app, "POST", "/api/v1/eventos", &token, Some(evento("Ruim", "2026-09-21T13:00:00Z", "2026-09-21T14:00:00Z", serde_json::json!({ "categoria_id": "nao-existe" })))).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // excluir categoria devolve os eventos para "sem categoria"
    let id = e["id"].as_str().unwrap();
    let (status, r) = chamar(&app, "DELETE", &format!("/api/v1/eventos/categorias/{cat}"), &token, None).await;
    assert_eq!(status, StatusCode::OK, "{r}");
    assert_eq!(r["eventos_afetados"], 1);
    let (_, e) = chamar(&app, "GET", &format!("/api/v1/eventos/{id}"), &token, None).await;
    assert!(e["categoria_id"].is_null() && e["categoria"].is_null());
    let _ = std::fs::remove_dir_all(raiz);
}

#[tokio::test]
async fn listar_por_intervalo_patch_e_indice_reconstruivel_a_partir_dos_arquivos() {
    let (app, token, raiz, state) = app_de_teste().await;
    let (_, a) = chamar(&app, "POST", "/api/v1/eventos", &token, Some(evento("A", "2026-09-21T13:00:00Z", "2026-09-21T14:00:00Z", serde_json::json!({})))).await;
    chamar(&app, "POST", "/api/v1/eventos", &token, Some(evento("B", "2026-09-25T13:00:00Z", "2026-09-25T14:00:00Z", serde_json::json!({})))).await;
    let a_id = a["id"].as_str().unwrap().to_string();

    let (_, lista) = chamar(&app, "GET", "/api/v1/eventos?de=2026-09-21T00:00:00Z&ate=2026-09-22T00:00:00Z", &token, None).await;
    assert_eq!(lista.as_array().unwrap().len(), 1);
    assert_eq!(lista[0]["titulo"], "A");

    // PATCH: renomeia (arquivo acompanha), limpa local com null, preserva o que não veio
    let (status, p) = chamar(&app, "PATCH", &format!("/api/v1/eventos/{a_id}"), &token, Some(serde_json::json!({ "titulo": "A2", "local": null }))).await;
    assert_eq!(status, StatusCode::OK, "{p}");
    assert_eq!(p["titulo"], "A2");
    assert_eq!(p["fim"], "2026-09-21T14:00:00+00:00");
    assert!(raiz.join("Pessoal/Eventos/A2.md").is_file() && !raiz.join("Pessoal/Eventos/A.md").exists());

    // marcar como google levanta sync_pendente
    let (_, g) = chamar(&app, "PATCH", &format!("/api/v1/eventos/{a_id}"), &token, Some(serde_json::json!({ "visibilidade": "google" }))).await;
    assert_eq!(g["sync_pendente"], true);

    // apagar o índice e reindexar devolve o mesmo estado (o .md é a fonte da verdade)
    state.db.with(|c| { c.execute("DELETE FROM evento", [])?; Ok(()) }).await.unwrap();
    crate::db::reindex::reindexar_tudo(&state.db, &state.config.notes_root).await.unwrap();
    let (_, lista) = chamar(&app, "GET", "/api/v1/eventos", &token, None).await;
    assert_eq!(lista.as_array().unwrap().len(), 2);

    let (status, _) = chamar(&app, "DELETE", &format!("/api/v1/eventos/{a_id}"), &token, None).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = chamar(&app, "GET", &format!("/api/v1/eventos/{a_id}"), &token, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let _ = std::fs::remove_dir_all(raiz);
}

#[tokio::test]
async fn vinculos_com_tarefa_e_nota_backlinks_e_orfaos_descartados() {
    let (app, token, raiz, _) = app_de_teste().await;
    let (_, t) = chamar(&app, "POST", "/api/v1/tarefas", &token, Some(serde_json::json!({ "titulo": "Preparar pauta" }))).await;
    let (_, n) = chamar(&app, "POST", "/api/v1/notas", &token, Some(serde_json::json!({ "titulo": "Ata" }))).await;
    let (tid, nid) = (t["id"].as_str().unwrap().to_string(), n["id"].as_str().unwrap().to_string());

    let (status, e) = chamar(&app, "POST", "/api/v1/eventos", &token, Some(evento("Reunião", "2026-09-21T13:00:00Z", "2026-09-21T14:00:00Z", serde_json::json!({ "tarefas": [tid, tid], "notas": [nid] })))).await;
    assert_eq!(status, StatusCode::OK, "{e}");
    assert_eq!(e["tarefas"].as_array().unwrap().len(), 1, "duplicados caem");
    assert_eq!(e["tarefas"][0]["titulo"], "Preparar pauta");
    assert_eq!(e["notas"][0]["titulo"], "Ata");
    let eid = e["id"].as_str().unwrap().to_string();

    let (_, da_tarefa) = chamar(&app, "GET", &format!("/api/v1/tarefas/{tid}/eventos"), &token, None).await;
    assert_eq!(da_tarefa[0]["id"], eid.as_str());
    let (_, da_nota) = chamar(&app, "GET", &format!("/api/v1/notas/{nid}/eventos"), &token, None).await;
    assert_eq!(da_nota[0]["id"], eid.as_str());
    let (_, filtrado) = chamar(&app, "GET", &format!("/api/v1/eventos?tarefa={tid}"), &token, None).await;
    assert_eq!(filtrado.as_array().unwrap().len(), 1);

    // id inexistente é rejeitado na escrita
    let (status, _) = chamar(&app, "PUT", &format!("/api/v1/eventos/{eid}/vinculos"), &token, Some(serde_json::json!({ "tarefas": ["fantasma"], "notas": [] }))).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // vínculo vai no .md (fonte da verdade), não só no índice
    let arquivo = std::fs::read_to_string(raiz.join("Pessoal/Eventos/Reunião.md")).unwrap();
    assert!(arquivo.contains(&tid));

    // apagar a tarefa: o vínculo some do índice sem erro
    chamar(&app, "DELETE", &format!("/api/v1/tarefas/{tid}"), &token, None).await;
    let (_, e) = chamar(&app, "GET", &format!("/api/v1/eventos/{eid}"), &token, None).await;
    assert!(e["tarefas"].as_array().unwrap().is_empty());
    assert_eq!(e["notas"].as_array().unwrap().len(), 1);
    let _ = std::fs::remove_dir_all(raiz);
}

#[tokio::test]
async fn vinculo_nao_marca_evento_para_o_google() {
    let (app, token, raiz, state) = app_de_teste().await;
    let (_, t) = chamar(&app, "POST", "/api/v1/tarefas", &token, Some(serde_json::json!({ "titulo": "T" }))).await;
    let tid = t["id"].as_str().unwrap().to_string();
    let (_, e) = chamar(&app, "POST", "/api/v1/eventos", &token, Some(evento("G", "2026-09-21T13:00:00Z", "2026-09-21T14:00:00Z", serde_json::json!({ "visibilidade": "google" })))).await;
    assert_eq!(e["sync_pendente"], true);
    // simula o job de sync já ter enviado: zera o flag direto no arquivo
    let caminho = raiz.join("Pessoal/Eventos/G.md");
    let texto = std::fs::read_to_string(&caminho).unwrap().replace("sync_pendente: true\n", "");
    std::fs::write(&caminho, texto).unwrap();
    crate::db::reindex::reindexar_tudo(&state.db, &state.config.notes_root).await.unwrap();
    let eid = e["id"].as_str().unwrap();
    let (_, antes) = chamar(&app, "GET", &format!("/api/v1/eventos/{eid}"), &token, None).await;
    assert_eq!(antes["sync_pendente"], false);
    let (status, depois) = chamar(&app, "PUT", &format!("/api/v1/eventos/{eid}/vinculos"), &token, Some(serde_json::json!({ "tarefas": [tid], "notas": [] }))).await;
    assert_eq!(status, StatusCode::OK, "{depois}");
    assert_eq!(depois["sync_pendente"], false, "vínculos são só do Ecos");
    let _ = std::fs::remove_dir_all(raiz);
}

#[tokio::test]
async fn tempo_por_categoria_corta_nas_bordas_ignora_dia_inteiro_e_conta_recorrentes() {
    let (app, token, raiz, _) = app_de_teste().await;
    let reuniao = categoria(&app, &token, "Reunião", "#3366ff").await;
    let foco = categoria(&app, &token, "Foco", "#22aa55").await;
    let mk = |t: &str, i: &str, f: &str, extra: serde_json::Value| {
        let (app, token, corpo) = (app.clone(), token.clone(), evento(t, i, f, extra));
        async move { chamar(&app, "POST", "/api/v1/eventos", &token, Some(corpo)).await }
    };
    mk("R1", "2026-09-21T13:00:00Z", "2026-09-21T14:00:00Z", serde_json::json!({ "categoria_id": reuniao })).await; // 60
    mk("R2", "2026-09-22T13:00:00Z", "2026-09-22T13:30:00Z", serde_json::json!({ "categoria_id": reuniao })).await; // fora do dia
    mk("F1", "2026-09-21T15:00:00Z", "2026-09-21T17:00:00Z", serde_json::json!({ "categoria_id": foco })).await; // 120
    mk("Solta", "2026-09-21T18:00:00Z", "2026-09-21T18:15:00Z", serde_json::json!({})).await; // 15 sem categoria
    // atravessa a borda: só 30 min caem dentro de [21 00:00, 22 00:00)
    mk("Noite", "2026-09-21T23:30:00Z", "2026-09-22T01:00:00Z", serde_json::json!({ "categoria_id": foco })).await;
    mk("Feriado", "2026-09-21T00:00:00Z", "2026-09-22T00:00:00Z", serde_json::json!({ "dia_inteiro": true, "categoria_id": foco })).await;
    mk("Semanal", "2026-09-21T09:00:00Z", "2026-09-21T10:00:00Z", serde_json::json!({ "rrule": "RRULE:FREQ=WEEKLY", "categoria_id": foco })).await;

    let (status, t) = chamar(&app, "GET", "/api/v1/eventos/tempo?de=2026-09-21T00:00:00Z&ate=2026-09-22T00:00:00Z", &token, None).await;
    assert_eq!(status, StatusCode::OK, "{t}");
    let minutos = |nome: &str| t["itens"].as_array().unwrap().iter().find(|i| i["nome"] == nome).map(|i| i["minutos"].as_i64().unwrap());
    assert_eq!(minutos("Reunião"), Some(60));
    assert_eq!(minutos("Foco"), Some(150), "120 + 30 cortados na borda; dia inteiro e série ficam de fora");
    assert_eq!(minutos("Sem categoria"), Some(15));
    assert_eq!(t["total_min"], 225);
    assert_eq!(t["recorrentes_ignorados"], 1);

    let (status, _) = chamar(&app, "GET", "/api/v1/eventos/tempo?de=2026-09-22T00:00:00Z&ate=2026-09-21T00:00:00Z", &token, None).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let _ = std::fs::remove_dir_all(raiz);
}

#[tokio::test]
async fn cor_propria_do_evento_e_so_do_ecos_valida_e_pode_ser_limpa() {
    let (app, token, raiz, _) = app_de_teste().await;
    let (status, e) = chamar(&app, "POST", "/api/v1/eventos", &token, Some(evento("Colorido", "2026-09-21T13:00:00Z", "2026-09-21T14:00:00Z", serde_json::json!({ "cor": "#123ABC", "visibilidade": "google" })))).await;
    assert_eq!(status, StatusCode::OK, "{e}");
    assert_eq!(e["cor"], "#123ABC");
    let arquivo = std::fs::read_to_string(raiz.join("Pessoal/Eventos/Colorido.md")).unwrap();
    assert!(arquivo.contains("cor: '#123ABC'") || arquivo.contains("cor: \"#123ABC\"") || arquivo.contains("cor: #123ABC"), "{arquivo}");

    // Inválida: recusada na criação e na edição.
    let (status, _) = chamar(&app, "POST", "/api/v1/eventos", &token, Some(evento("Ruim", "2026-09-21T13:00:00Z", "2026-09-21T14:00:00Z", serde_json::json!({ "cor": "azul" })))).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let id = e["id"].as_str().unwrap();
    let (status, _) = chamar(&app, "PATCH", &format!("/api/v1/eventos/{id}"), &token, Some(serde_json::json!({ "cor": "#12" }))).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // Trocar a cor não marca o evento para o Google (a cor nunca vai lá); `null` a tira (volta a valer a da categoria).
    let (_, antes) = chamar(&app, "PATCH", &format!("/api/v1/eventos/{id}"), &token, Some(serde_json::json!({ "visibilidade": "privado" }))).await;
    assert_eq!(antes["sync_pendente"], false);
    let (status, d) = chamar(&app, "PATCH", &format!("/api/v1/eventos/{id}"), &token, Some(serde_json::json!({ "cor": "#00FF00" }))).await;
    assert_eq!((status, d["cor"].as_str(), d["sync_pendente"].as_bool()), (StatusCode::OK, Some("#00FF00"), Some(false)));
    let (_, d) = chamar(&app, "PATCH", &format!("/api/v1/eventos/{id}"), &token, Some(serde_json::json!({ "cor": null }))).await;
    assert!(d["cor"].is_null());
    let (_, lista) = chamar(&app, "GET", "/api/v1/eventos", &token, None).await;
    assert!(lista[0]["cor"].is_null(), "a lista também devolve a cor");
    let _ = std::fs::remove_dir_all(raiz);
}
