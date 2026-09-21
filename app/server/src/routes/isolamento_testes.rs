//! Duas pessoas no mesmo servidor: o que é de uma não aparece, não abre e não pode ser mexido pela outra,
//! e o que é de equipe só aparece para quem é membro. Roteador real + índice SQLite temporário.

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

fn ids(lista: &serde_json::Value) -> Vec<String> {
    let itens = lista.get("items").unwrap_or(lista);
    itens.as_array().unwrap().iter().map(|i| i["id"].as_str().unwrap().to_string()).collect()
}

#[tokio::test]
async fn uma_pessoa_nao_ve_nem_mexe_no_que_e_da_outra() {
    let temp = std::env::temp_dir().join(format!("ecos-isolamento-{}", new_id()));
    std::fs::create_dir_all(&temp).unwrap();
    let segredo = b"segredo-efemero-exclusivo-do-teste-de-isolamento".to_vec();
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
        c.execute("INSERT INTO usuario (id, nome_usuario, senha_hash, recovery_key_hash) VALUES ('U1', 'diogo', 'x', 'x'), ('U2', 'thaty', 'x', 'x'), ('U3', 'visita', 'x', 'x')", [])?;
        c.execute("INSERT INTO equipe (id, nome) VALUES ('EQ', 'Casa')", [])?;
        c.execute("INSERT INTO membro_equipe (equipe_id, usuario_id, cargo) VALUES ('EQ', 'U1', 'dono'), ('EQ', 'U2', 'membro')", [])?;
        Ok(())
    }).await.unwrap();
    let app = crate::routes::montar(state.clone());
    let diogo = session::emitir_access_token("U1", &segredo).unwrap();
    let thaty = session::emitir_access_token("U2", &segredo).unwrap();
    let visita = session::emitir_access_token("U3", &segredo).unwrap();

    // Cada pessoa cria uma nota e uma tarefa pessoais, e o Diogo cria uma nota na equipe.
    let (st, nota_d) = chamar(&app, "POST", "/api/v1/notas", &diogo, Some(serde_json::json!({ "titulo": "Segredo do Diogo", "corpo": "abacaxi" }))).await;
    assert_eq!(st, StatusCode::OK, "{nota_d}");
    let (_, nota_t) = chamar(&app, "POST", "/api/v1/notas", &thaty, Some(serde_json::json!({ "titulo": "Diário da Thaty", "corpo": "caju" }))).await;
    let (_, tarefa_d) = chamar(&app, "POST", "/api/v1/tarefas", &diogo, Some(serde_json::json!({ "titulo": "Tarefa do Diogo" }))).await;
    let (st, nota_eq) = chamar(&app, "POST", "/api/v1/notas", &diogo, Some(serde_json::json!({ "titulo": "Lista da casa", "espaco": "equipe:EQ" }))).await;
    assert_eq!(st, StatusCode::OK, "{nota_eq}");
    let (id_d, id_t, id_tarefa_d, id_eq) = (nota_d["id"].as_str().unwrap(), nota_t["id"].as_str().unwrap(), tarefa_d["id"].as_str().unwrap(), nota_eq["id"].as_str().unwrap());

    // Cada um em sua pasta, com o login no nome; a equipe na dela.
    assert!(temp.join("diogo/Notas").is_dir() && temp.join("thaty/Notas").is_dir() && temp.join("Casa/Notas").is_dir());
    assert!(!temp.join("Pessoal").exists(), "não existe mais um Pessoal comum");
    assert_eq!(std::fs::read_to_string(temp.join("diogo/.espaco")).unwrap(), "pessoal:U1");

    // Listagens: só o que cada um enxerga.
    let (_, lista) = chamar(&app, "GET", "/api/v1/notas", &diogo, None).await;
    let mut vistas = ids(&lista); vistas.sort();
    let mut esperadas = vec![id_d.to_string(), id_eq.to_string()]; esperadas.sort();
    assert_eq!(vistas, esperadas, "Diogo: as dele + a da equipe");
    let (_, lista) = chamar(&app, "GET", "/api/v1/notas", &thaty, None).await;
    let mut vistas = ids(&lista); vistas.sort();
    let mut esperadas = vec![id_t.to_string(), id_eq.to_string()]; esperadas.sort();
    assert_eq!(vistas, esperadas, "Thaty: as dela + a da equipe (é membro)");
    let (_, lista) = chamar(&app, "GET", "/api/v1/notas", &visita, None).await;
    assert!(ids(&lista).is_empty(), "quem não é de nada não vê nada");
    let (_, lista) = chamar(&app, "GET", "/api/v1/tarefas", &thaty, None).await;
    assert!(ids(&lista).is_empty(), "a tarefa do Diogo não aparece para a Thaty");

    // Por id: 404 (não 403) para não confirmar que existe; leitura, escrita, exclusão e anexos.
    for (metodo, rota, corpo) in [
        ("GET", format!("/api/v1/notas/{id_d}"), None),
        ("PATCH", format!("/api/v1/notas/{id_d}"), Some(serde_json::json!({ "titulo": "hackeada" }))),
        ("DELETE", format!("/api/v1/notas/{id_d}"), None),
        ("GET", format!("/api/v1/notas/{id_d}/links"), None),
        ("GET", format!("/api/v1/tarefas/{id_tarefa_d}"), None),
        ("PATCH", format!("/api/v1/tarefas/{id_tarefa_d}"), Some(serde_json::json!({ "titulo": "hackeada" }))),
        ("DELETE", format!("/api/v1/tarefas/{id_tarefa_d}"), None),
        ("GET", format!("/api/v1/tarefas/{id_tarefa_d}/time-entries"), None),
    ] {
        let (st, _) = chamar(&app, metodo, &rota, &thaty, corpo).await;
        assert_eq!(st, StatusCode::NOT_FOUND, "{metodo} {rota} como Thaty");
    }
    let (st, nota) = chamar(&app, "GET", &format!("/api/v1/notas/{id_d}"), &diogo, None).await;
    assert_eq!((st, nota["titulo"].as_str()), (StatusCode::OK, Some("Segredo do Diogo")), "a nota continua intacta para o dono");

    // Equipe: membro lê e edita; quem não é membro nem lê, nem cria dentro.
    let (st, _) = chamar(&app, "GET", &format!("/api/v1/notas/{id_eq}"), &thaty, None).await;
    assert_eq!(st, StatusCode::OK);
    let (st, _) = chamar(&app, "GET", &format!("/api/v1/notas/{id_eq}"), &visita, None).await;
    assert_eq!(st, StatusCode::NOT_FOUND);
    let (st, _) = chamar(&app, "POST", "/api/v1/notas", &visita, Some(serde_json::json!({ "titulo": "intrusa", "espaco": "equipe:EQ" }))).await;
    assert_eq!(st, StatusCode::FORBIDDEN, "criar em equipe alheia");
    let (st, _) = chamar(&app, "PATCH", &format!("/api/v1/notas/{id_eq}"), &thaty, Some(serde_json::json!({ "espaco": "pessoal" }))).await;
    assert_eq!(st, StatusCode::OK, "membro pode trazer a nota da equipe para o próprio pessoal");
    assert!(std::fs::read_dir(temp.join("thaty/Notas")).unwrap().count() >= 2, "foi para a pasta da Thaty, não para a do Diogo");
    let (st, _) = chamar(&app, "PATCH", &format!("/api/v1/notas/{id_d}"), &diogo, Some(serde_json::json!({ "espaco": "equipe:EQ" }))).await;
    assert_eq!(st, StatusCode::OK, "dono pode compartilhar a própria nota com a equipe");
    let (st, _) = chamar(&app, "PATCH", &format!("/api/v1/notas/{id_d}"), &visita, Some(serde_json::json!({ "espaco": "equipe:EQ" }))).await;
    assert_eq!(st, StatusCode::NOT_FOUND);

    // Busca só devolve o que a pessoa enxerga.
    let (_, busca) = chamar(&app, "GET", "/api/v1/busca?q=caju", &diogo, None).await;
    assert!(busca["notas"].as_array().unwrap().is_empty(), "a nota da Thaty não aparece na busca do Diogo: {busca}");
    let (_, busca) = chamar(&app, "GET", "/api/v1/busca?q=caju", &thaty, None).await;
    assert_eq!(busca["notas"].as_array().unwrap().len(), 1);

    // Pastas: cada um só vê as suas (mesmo nome de pasta não colide).
    for token in [&diogo, &thaty] {
        let (st, _) = chamar(&app, "POST", "/api/v1/pastas", token, Some(serde_json::json!({ "nome": "Ideias" }))).await;
        assert_eq!(st, StatusCode::OK);
    }
    assert!(temp.join("diogo/Notas/Ideias").is_dir() && temp.join("thaty/Notas/Ideias").is_dir());
    let (_, pastas) = chamar(&app, "GET", "/api/v1/pastas?tipo=nota", &diogo, None).await;
    assert_eq!(pastas["subpastas"].as_array().unwrap().len(), 1, "{pastas}");
    let (_, pastas) = chamar(&app, "GET", "/api/v1/pastas?tipo=nota", &visita, None).await;
    assert!(pastas["subpastas"].as_array().unwrap().is_empty());

    // Mídia: o arquivo de uma pessoa não abre para a outra.
    let mut corpo = b"--x\r\nContent-Disposition: form-data; name=\"arquivo\"; filename=\"foto.txt\"\r\nContent-Type: text/plain\r\n\r\nconteudo".to_vec();
    corpo.extend_from_slice(b"\r\n--x--\r\n");
    let subida = app.clone().call(Request::post("/api/v1/media").header("authorization", format!("Bearer {diogo}")).header("content-type", "multipart/form-data; boundary=x").body(Body::from(corpo)).unwrap()).await.unwrap();
    assert_eq!(subida.status(), StatusCode::OK);
    let subida: serde_json::Value = serde_json::from_slice(&to_bytes(subida.into_body(), 8192).await.unwrap()).unwrap();
    assert_eq!(subida["espaco"], "pessoal");
    let rel = subida["caminho"].as_str().unwrap().trim_start_matches("src/Media/").to_string();
    assert!(temp.join("diogo/src/Media").join(&rel).is_file());
    let (st, _) = chamar(&app, "GET", &format!("/api/v1/media/arquivo/{rel}"), &diogo, None).await;
    assert_eq!(st, StatusCode::OK);
    let (st, _) = chamar(&app, "GET", &format!("/api/v1/media/arquivo/{rel}"), &thaty, None).await;
    assert_eq!(st, StatusCode::NOT_FOUND, "mídia pessoal de outra pessoa");
    let (st, _) = chamar(&app, "DELETE", &format!("/api/v1/media/arquivo/{rel}"), &thaty, None).await;
    assert_eq!(st, StatusCode::NOT_FOUND);
    let (_, minha) = chamar(&app, "GET", "/api/v1/media", &thaty, None).await;
    assert!(minha.as_array().unwrap().is_empty());
    let (st, _) = chamar(&app, "GET", &format!("/api/v1/media?espaco=equipe:EQ"), &visita, None).await;
    assert_eq!(st, StatusCode::OK);

    // Lixeira: o que o Diogo apagou só ele vê e só ele restaura.
    let (st, _) = chamar(&app, "DELETE", &format!("/api/v1/tarefas/{id_tarefa_d}"), &diogo, None).await;
    assert_eq!(st, StatusCode::OK);
    let (_, lixo_d) = chamar(&app, "GET", "/api/v1/lixeira", &diogo, None).await;
    assert_eq!(lixo_d.as_array().unwrap().len(), 1, "{lixo_d}");
    let (_, lixo_t) = chamar(&app, "GET", "/api/v1/lixeira", &thaty, None).await;
    assert!(lixo_t.as_array().unwrap().is_empty(), "{lixo_t}");
    let item = lixo_d[0]["id"].as_str().unwrap().to_string();
    let (st, _) = chamar(&app, "POST", &format!("/api/v1/lixeira/{item}/restaurar"), &thaty, None).await;
    assert_eq!(st, StatusCode::NOT_FOUND);
    let (st, _) = chamar(&app, "POST", &format!("/api/v1/lixeira/{item}/restaurar"), &diogo, None).await;
    assert_eq!(st, StatusCode::OK);

    // Eventos e categorias.
    let evento = serde_json::json!({ "titulo": "Dentista", "inicio": "2026-09-21T10:00:00Z", "fim": "2026-09-21T11:00:00Z" });
    let (st, ev) = chamar(&app, "POST", "/api/v1/eventos", &diogo, Some(evento)).await;
    assert_eq!(st, StatusCode::OK, "{ev}");
    let id_ev = ev["id"].as_str().unwrap();
    assert!(temp.join("diogo/Eventos").is_dir());
    let (_, eventos) = chamar(&app, "GET", "/api/v1/eventos", &thaty, None).await;
    assert!(eventos.as_array().unwrap().is_empty(), "{eventos}");
    let (st, _) = chamar(&app, "GET", &format!("/api/v1/eventos/{id_ev}"), &thaty, None).await;
    assert_eq!(st, StatusCode::NOT_FOUND);
    let (st, _) = chamar(&app, "DELETE", &format!("/api/v1/eventos/{id_ev}"), &thaty, None).await;
    assert_eq!(st, StatusCode::NOT_FOUND);
    let (st, cat) = chamar(&app, "POST", "/api/v1/eventos/categorias", &diogo, Some(serde_json::json!({ "nome": "Saúde", "cor": "#00aa00" }))).await;
    assert_eq!(st, StatusCode::OK, "{cat}");
    assert_eq!(cat["espaco"], "pessoal");
    let (_, cats) = chamar(&app, "GET", "/api/v1/eventos/categorias", &thaty, None).await;
    assert!(cats.as_array().unwrap().is_empty(), "{cats}");
    let (_, cats) = chamar(&app, "GET", "/api/v1/eventos/categorias?espaco=pessoal", &diogo, None).await;
    assert_eq!((cats.as_array().unwrap().len(), cats[0]["espaco"].as_str()), (1, Some("pessoal")), "{cats}");
    let (st, _) = chamar(&app, "DELETE", &format!("/api/v1/eventos/categorias/{}", cat["id"].as_str().unwrap()), &thaty, None).await;
    assert_eq!(st, StatusCode::NOT_FOUND);

    // O nome de usuário (login e nome da pasta) não muda; o nome de exibição sim.
    let (st, r) = chamar(&app, "PATCH", "/api/v1/me", &diogo, Some(serde_json::json!({ "nome_usuario": "outro-nome" }))).await;
    assert!(st.is_client_error(), "{st} {r}");
    let (st, _) = chamar(&app, "PATCH", "/api/v1/me", &diogo, Some(serde_json::json!({ "nome_usuario": "diogo", "nome": "Diogo M. Roque" }))).await;
    assert_eq!(st, StatusCode::OK, "reenviar o mesmo valor é aceito");
    let (_, eu) = chamar(&app, "GET", "/api/v1/me", &diogo, None).await;
    assert_eq!((eu["nome_usuario"].as_str(), eu["nome"].as_str()), (Some("diogo"), Some("Diogo M. Roque")));
    assert!(temp.join("diogo").is_dir(), "a pasta segue o nome de usuário, não o de exibição");

    let _ = std::fs::remove_dir_all(&temp);
}
