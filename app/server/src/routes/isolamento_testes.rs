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

// ---------------------------------------------------------------------------------------------------------------
// Duas pessoas, duas equipes: nenhuma consegue ler, editar ou apagar o que é da outra, por id ou por listagem.
// ---------------------------------------------------------------------------------------------------------------

async fn enviar_arquivo(app: &Router, uri: &str, token: &str) -> StatusCode {
    let mut corpo = b"--x\r\nContent-Disposition: form-data; name=\"arquivo\"; filename=\"a.txt\"\r\nContent-Type: text/plain\r\n\r\nconteudo".to_vec();
    corpo.extend_from_slice(b"\r\n--x--\r\n");
    let pedido = Request::builder().method("POST").uri(uri).header("authorization", format!("Bearer {token}")).header("content-type", "multipart/form-data; boundary=x").body(Body::from(corpo)).unwrap();
    app.clone().call(pedido).await.unwrap().status()
}

#[tokio::test]
async fn duas_pessoas_e_duas_equipes_nao_alcancam_o_que_e_do_outro() {
    let temp = std::env::temp_dir().join(format!("ecos-isolamento-equipes-{}", new_id()));
    std::fs::create_dir_all(&temp).unwrap();
    let segredo = b"segredo-efemero-exclusivo-do-teste-de-equipes".to_vec();
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
        c.execute("INSERT INTO usuario (id, nome_usuario, senha_hash, recovery_key_hash) VALUES ('UA', 'alice', 'x', 'x'), ('UB', 'bruno', 'x', 'x'), ('UC', 'carla', 'x', 'x')", [])?;
        c.execute("INSERT INTO equipe (id, nome) VALUES ('EQA', 'Time A'), ('EQB', 'Time B')", [])?;
        c.execute("INSERT INTO membro_equipe (equipe_id, usuario_id, cargo) VALUES ('EQA', 'UA', 'dono'), ('EQA', 'UC', 'admin'), ('EQB', 'UB', 'dono')", [])?;
        c.execute("INSERT INTO perfil_rotina (usuario_id) VALUES ('UA')", [])?;
        c.execute("INSERT INTO bloco_rotina (id, usuario_id, tipo, hora_inicio, hora_fim, dias_semana, classificacao) VALUES ('BL1', 'UA', 'sono', '22:00', '06:00', 'diario', 'indisponivel')", [])?;
        c.execute("INSERT INTO dispositivo (id, usuario_id, nome, papel) VALUES ('DISP1', 'UA', 'Celular da Alice', 'primario')", [])?;
        Ok(())
    }).await.unwrap();
    let app = crate::routes::montar(state.clone());
    let alice = session::emitir_access_token("UA", &segredo).unwrap();
    let bruno = session::emitir_access_token("UB", &segredo).unwrap();
    let carla = session::emitir_access_token("UC", &segredo).unwrap();

    // Cada dono cria notas, tarefas e tempo dentro da própria equipe.
    let (st, nota_a) = chamar(&app, "POST", "/api/v1/notas", &alice, Some(serde_json::json!({ "titulo": "Segredo da A", "corpo": "jabuticaba", "espaco": "equipe:EQA" }))).await;
    assert_eq!(st, StatusCode::OK, "{nota_a}");
    let (_, tarefa_a) = chamar(&app, "POST", "/api/v1/tarefas", &alice, Some(serde_json::json!({ "titulo": "Tarefa da A", "espaco": "equipe:EQA" }))).await;
    let (_, nota_b) = chamar(&app, "POST", "/api/v1/notas", &bruno, Some(serde_json::json!({ "titulo": "Segredo do B", "corpo": "pitanga", "espaco": "equipe:EQB" }))).await;
    let (_, tarefa_b) = chamar(&app, "POST", "/api/v1/tarefas", &bruno, Some(serde_json::json!({ "titulo": "Tarefa do B", "espaco": "equipe:EQB" }))).await;
    let (id_na, id_ta, id_nb, id_tb) = (nota_a["id"].as_str().unwrap().to_string(), tarefa_a["id"].as_str().unwrap().to_string(), nota_b["id"].as_str().unwrap().to_string(), tarefa_b["id"].as_str().unwrap().to_string());
    let tempo = serde_json::json!({ "tipo": "planejado", "inicio_em": "2026-09-21T10:00:00Z", "duracao_min": 30 });
    let (st, entrada_a) = chamar(&app, "POST", &format!("/api/v1/tarefas/{id_ta}/time-entries"), &alice, Some(tempo.clone())).await;
    assert_eq!(st, StatusCode::OK, "{entrada_a}");
    let id_ea = entrada_a["id"].as_str().unwrap().to_string();
    let (_, entrada_b) = chamar(&app, "POST", &format!("/api/v1/tarefas/{id_tb}/time-entries"), &bruno, Some(tempo.clone())).await;
    let id_eb = entrada_b["id"].as_str().unwrap().to_string();
    for (id, tipo, espaco) in [(&id_na, "nota", "equipe:EQA"), (&id_ta, "tarefa_encaixada", "equipe:EQA"), (&id_nb, "nota", "equipe:EQB")] {
        let (id, tipo, espaco) = (id.clone(), tipo.to_string(), espaco.to_string());
        state.db.with(move |c| c.execute("INSERT INTO feed_item (id, tipo, score_dominante, espaco, atualizado_em) VALUES (?1, ?2, 1.0, ?3, '2026-09-21T10:00:00Z')", rusqlite::params![id, tipo, espaco])).await.unwrap();
    }
    let tarefa_do_evento = id_ta.clone();
    state.db.with(move |c| c.execute("INSERT INTO evento_externo_cache (id, provider, event_id_externo, tarefa_id, inicio, fim, atualizado_em_externo, atualizado_em_local) VALUES ('EV1', 'google', 'x', ?1, '2026-09-21T10:00:00Z', '2026-09-21T11:00:00Z', '2026-09-21T09:00:00Z', '2026-09-21T09:00:00Z')", [&tarefa_do_evento])).await.unwrap();

    // Controle: quem é da equipe vê e lê o que é dela.
    for rota in ["/api/v1/equipes/EQA".to_string(), "/api/v1/equipes/EQA/membros".to_string(), format!("/api/v1/notas/{id_na}"), format!("/api/v1/tarefas/{id_ta}"), format!("/api/v1/tarefas/{id_ta}/time-entries")] {
        assert_eq!(chamar(&app, "GET", &rota, &alice, None).await.0, StatusCode::OK, "{rota} como dona");
    }

    // Equipes: quem não participa recebe 404 em tudo, nas duas direções.
    for (token, alheia, dono) in [(&bruno, "EQA", "UA"), (&alice, "EQB", "UB")] {
        for (metodo, rota, corpo) in [
            ("GET", format!("/api/v1/equipes/{alheia}"), None),
            ("GET", format!("/api/v1/equipes/{alheia}/membros"), None),
            ("PATCH", format!("/api/v1/equipes/{alheia}"), Some(serde_json::json!({ "nome": "invadida" }))),
            ("DELETE", format!("/api/v1/equipes/{alheia}"), Some(serde_json::json!({ "confirm": "EXCLUIR EQUIPE" }))),
            ("POST", format!("/api/v1/equipes/{alheia}/convites"), None),
            ("POST", format!("/api/v1/equipes/{alheia}/sair"), None),
            ("PATCH", format!("/api/v1/equipes/{alheia}/membros/{dono}"), Some(serde_json::json!({ "cargo": "membro" }))),
            ("DELETE", format!("/api/v1/equipes/{alheia}/membros/{dono}"), None),
        ] {
            let (st, resposta) = chamar(&app, metodo, &rota, token, corpo).await;
            assert_eq!(st, StatusCode::NOT_FOUND, "{metodo} {rota}: {resposta}");
        }
    }
    let nomes: Vec<String> = state.db.with(|c| { let mut s = c.prepare("SELECT nome FROM equipe ORDER BY id")?; let l = s.query_map([], |r| r.get(0))?.collect::<Result<Vec<_>, _>>()?; Ok(l) }).await.unwrap();
    assert_eq!(nomes, ["Time A", "Time B"], "nada foi alterado nem apagado");
    let (_, minhas) = chamar(&app, "GET", "/api/v1/equipes", &bruno, None).await;
    assert_eq!(ids(&minhas), ["EQB"], "a lista de equipes só traz as dele");

    // Itens por id: 404 para leitura, edição, exclusão, anexos e tempo.
    for (token, nota, tarefa, entrada) in [(&bruno, &id_na, &id_ta, &id_ea), (&alice, &id_nb, &id_tb, &id_eb)] {
        for (metodo, rota, corpo) in [
            ("GET", format!("/api/v1/notas/{nota}"), None),
            ("PATCH", format!("/api/v1/notas/{nota}"), Some(serde_json::json!({ "titulo": "hackeada" }))),
            ("DELETE", format!("/api/v1/notas/{nota}"), None),
            ("GET", format!("/api/v1/notas/{nota}/links"), None),
            ("GET", format!("/api/v1/notas/{nota}/pagina"), None),
            ("GET", format!("/api/v1/notas/{nota}/anexos/a.txt"), None),
            ("GET", format!("/api/v1/tarefas/{tarefa}"), None),
            ("PATCH", format!("/api/v1/tarefas/{tarefa}"), Some(serde_json::json!({ "titulo": "hackeada" }))),
            ("PATCH", format!("/api/v1/tarefas/{tarefa}/status"), Some(serde_json::json!({ "status": "pendente" }))),
            ("DELETE", format!("/api/v1/tarefas/{tarefa}"), None),
            ("GET", format!("/api/v1/tarefas/{tarefa}/anexos/a.txt"), None),
            ("GET", format!("/api/v1/tarefas/{tarefa}/time-entries"), None),
            ("POST", format!("/api/v1/tarefas/{tarefa}/time-entries"), Some(tempo.clone())),
            ("DELETE", format!("/api/v1/tarefas/{tarefa}/time-entries/{entrada}"), None),
        ] {
            let (st, resposta) = chamar(&app, metodo, &rota, token, corpo).await;
            assert_eq!(st, StatusCode::NOT_FOUND, "{metodo} {rota}: {resposta}");
        }
        assert_eq!(enviar_arquivo(&app, &format!("/api/v1/notas/{nota}/anexos"), token).await, StatusCode::NOT_FOUND, "anexo em nota alheia");
        assert_eq!(enviar_arquivo(&app, &format!("/api/v1/tarefas/{tarefa}/anexos"), token).await, StatusCode::NOT_FOUND, "anexo em tarefa alheia");
        let (_, evs) = chamar(&app, "GET", &format!("/api/v1/tarefas/{tarefa}/eventos"), token, None).await;
        assert!(evs.as_array().unwrap().is_empty());
    }
    let (_, lida) = chamar(&app, "GET", &format!("/api/v1/notas/{id_na}"), &alice, None).await;
    assert_eq!((lida["titulo"].as_str(), lida["corpo"].as_str()), (Some("Segredo da A"), Some("jabuticaba")), "a nota seguiu intacta");
    assert_eq!(chamar(&app, "GET", &format!("/api/v1/tarefas/{id_ta}"), &alice, None).await.0, StatusCode::OK, "a tarefa não foi apagada");

    // Listagens, busca, pastas, Feed e agenda: nada da equipe alheia, com ou sem `espaco`.
    for rota in ["/api/v1/notas?espaco=equipe:EQA", "/api/v1/tarefas?espaco=equipe:EQA", "/api/v1/notas", "/api/v1/tarefas"] {
        let (st, lista) = chamar(&app, "GET", rota, &bruno, None).await;
        let alheios: Vec<String> = ids(&lista).into_iter().filter(|i| *i != id_nb && *i != id_tb).collect();
        assert!(st == StatusCode::OK && alheios.is_empty(), "{rota}: {lista}");
    }
    let (_, feed) = chamar(&app, "GET", "/api/v1/feed?espaco=equipe:EQA", &bruno, None).await;
    assert!(ids(&feed).is_empty(), "{feed}");
    let (_, feed) = chamar(&app, "GET", "/api/v1/feed", &bruno, None).await;
    assert_eq!(ids(&feed), [id_nb.clone()], "o Feed do Bruno só tem o item da equipe dele");
    let (_, feed) = chamar(&app, "GET", "/api/v1/feed", &carla, None).await;
    let mut vistos = ids(&feed); vistos.sort();
    let mut esperados = vec![id_na.clone(), id_ta.clone()]; esperados.sort();
    assert_eq!(vistos, esperados, "a Carla é admin da equipe A: vê os dela, não os da B");
    for rota in ["/api/v1/busca?q=jabuticaba", "/api/v1/busca?q=jabuticaba&espaco=equipe:EQA", "/api/v1/busca?q=Tarefa"] {
        let (_, busca) = chamar(&app, "GET", rota, &bruno, None).await;
        let achados: Vec<&str> = busca["notas"].as_array().unwrap().iter().chain(busca["tarefas"].as_array().unwrap()).map(|i| i["id"].as_str().unwrap()).collect();
        assert!(!achados.contains(&id_na.as_str()) && !achados.contains(&id_ta.as_str()), "{rota}: {busca}");
    }
    let (_, busca) = chamar(&app, "GET", "/api/v1/busca?q=jabuticaba", &alice, None).await;
    assert_eq!(busca["notas"].as_array().unwrap().len(), 1, "controle: a dona acha");
    let (_, pastas) = chamar(&app, "GET", "/api/v1/pastas?tipo=nota&espaco=equipe:EQA", &bruno, None).await;
    assert!(pastas["subpastas"].as_array().unwrap().is_empty() && pastas["itens"].as_array().unwrap().is_empty(), "{pastas}");
    let (_, cap) = chamar(&app, "GET", "/api/v1/agenda/capacidade?data=2026-09-21", &bruno, None).await;
    assert_eq!(cap["consumido_eventos_externos_min"], 0, "evento externo de tarefa alheia não entra na agenda dele: {cap}");
    let (_, cap) = chamar(&app, "GET", "/api/v1/agenda/capacidade?data=2026-09-21", &alice, None).await;
    assert_eq!(cap["consumido_eventos_externos_min"], 60, "controle: entra na da dona: {cap}");
    let (_, blocos) = chamar(&app, "GET", "/api/v1/agenda/blocos?data_de=2026-09-21&data_ate=2026-09-21", &bruno, None).await;
    assert!(blocos.as_array().unwrap().iter().all(|b| b["tarefa_id"] != id_ta.as_str()), "{blocos}");

    // Criar, mover ou subir arquivo para a equipe alheia: 403.
    for (metodo, rota, corpo) in [
        ("POST", "/api/v1/notas".to_string(), serde_json::json!({ "titulo": "intrusa", "espaco": "equipe:EQA" })),
        ("POST", "/api/v1/tarefas".to_string(), serde_json::json!({ "titulo": "intrusa", "espaco": "equipe:EQA" })),
        ("POST", "/api/v1/pastas".to_string(), serde_json::json!({ "nome": "intrusa", "espaco": "equipe:EQA" })),
        ("PATCH", format!("/api/v1/notas/{id_nb}"), serde_json::json!({ "espaco": "equipe:EQA" })),
        ("PATCH", format!("/api/v1/tarefas/{id_tb}"), serde_json::json!({ "espaco": "equipe:EQA" })),
    ] {
        let (st, resposta) = chamar(&app, metodo, &rota, &bruno, Some(corpo)).await;
        assert_eq!(st, StatusCode::FORBIDDEN, "{metodo} {rota}: {resposta}");
    }
    assert_eq!(enviar_arquivo(&app, "/api/v1/media?espaco=equipe:EQA", &bruno).await, StatusCode::FORBIDDEN);

    // Cargos: admin da equipe não rebaixa nem remove o dono, e a equipe nunca fica sem dono.
    let (st, _) = chamar(&app, "PATCH", "/api/v1/equipes/EQA/membros/UA", &carla, Some(serde_json::json!({ "cargo": "membro" }))).await;
    assert_eq!(st, StatusCode::FORBIDDEN, "admin não rebaixa o dono");
    let (st, _) = chamar(&app, "DELETE", "/api/v1/equipes/EQA/membros/UA", &carla, None).await;
    assert_eq!(st, StatusCode::FORBIDDEN, "admin não remove o dono");
    let (st, _) = chamar(&app, "PATCH", "/api/v1/equipes/EQA/membros/UA", &alice, Some(serde_json::json!({ "cargo": "admin" }))).await;
    assert_eq!(st, StatusCode::CONFLICT, "o único dono não se rebaixa");
    let (st, _) = chamar(&app, "PATCH", "/api/v1/equipes/EQA/membros/UC", &alice, Some(serde_json::json!({ "cargo": "membro" }))).await;
    assert_eq!(st, StatusCode::OK, "o dono mexe no cargo dos outros");

    // Caminhos: `..` não leva à pasta de outra pessoa (renomear, apagar, criar e mover).
    let (st, _) = chamar(&app, "POST", "/api/v1/pastas", &alice, Some(serde_json::json!({ "nome": "Ideias" }))).await;
    assert_eq!(st, StatusCode::OK);
    let pasta_da_alice = temp.join("alice/Notas/Ideias");
    assert!(pasta_da_alice.is_dir());
    for (metodo, corpo) in [
        ("DELETE", serde_json::json!({ "caminho": "../../alice/Notas/Ideias" })),
        ("DELETE", serde_json::json!({ "caminho": "" })),
        ("DELETE", serde_json::json!({ "caminho": "/alice/Notas/Ideias" })),
        ("PATCH", serde_json::json!({ "caminho_atual": "../../alice/Notas/Ideias", "novo_caminho": "roubada" })),
        ("PATCH", serde_json::json!({ "caminho_atual": "x", "novo_caminho": "../../alice/Notas/roubada" })),
        ("POST", serde_json::json!({ "nome": "x", "pasta_pai": "../../alice/Notas" })),
    ] {
        let (st, resposta) = chamar(&app, metodo, "/api/v1/pastas", &bruno, Some(corpo.clone())).await;
        assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY, "{metodo} {corpo}: {resposta}");
    }
    assert!(pasta_da_alice.is_dir() && !temp.join("alice/Notas/roubada").exists() && !temp.join("alice/Notas/x").exists());
    let (st, minha) = chamar(&app, "POST", "/api/v1/notas", &bruno, Some(serde_json::json!({ "titulo": "Minha" }))).await;
    assert_eq!(st, StatusCode::OK);
    let id_min = minha["id"].as_str().unwrap().to_string();
    for (metodo, rota, corpo) in [
        ("POST", "/api/v1/notas".to_string(), serde_json::json!({ "titulo": "fuga", "pasta": "../../alice/Notas" })),
        ("PATCH", format!("/api/v1/notas/{id_min}"), serde_json::json!({ "pasta": "../../alice/Notas" })),
        ("POST", "/api/v1/tarefas".to_string(), serde_json::json!({ "titulo": "fuga", "pasta": "../../alice/Tarefas" })),
    ] {
        let (st, resposta) = chamar(&app, metodo, &rota, &bruno, Some(corpo)).await;
        assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY, "{metodo} {rota}: {resposta}");
    }

    // Nome de anexo com `..` (chega decodificado de `%2F`) não sai da pasta de anexos.
    let (_, alice_nota) = chamar(&app, "POST", "/api/v1/notas", &alice, Some(serde_json::json!({ "titulo": "Diario" }))).await;
    let (_, alice_lida) = chamar(&app, "GET", &format!("/api/v1/notas/{}", alice_nota["id"].as_str().unwrap()), &alice, None).await;
    let alvo = alice_lida["caminho_arquivo"].as_str().unwrap().to_string();
    assert!(temp.join(&alvo).is_file(), "{alvo}");
    let (_, min) = chamar(&app, "GET", &format!("/api/v1/notas/{id_min}"), &bruno, None).await;
    let dir_anexos = temp.join(min["caminho_arquivo"].as_str().unwrap()).parent().unwrap().join("_anexos").join(&id_min);
    std::fs::create_dir_all(&dir_anexos).unwrap();
    let fuga = format!("..%2F..%2F..%2F..%2F{}", alvo.replace('/', "%2F"));
    let (st, _) = chamar(&app, "GET", &format!("/api/v1/notas/{id_min}/anexos/{fuga}"), &bruno, None).await;
    assert_eq!(st, StatusCode::NOT_FOUND, "anexo não pode apontar para arquivo de outra pessoa");

    // Rotina e dispositivos: o id sozinho não dá acesso ao registro de outra pessoa.
    let bloco = serde_json::json!({ "tipo": "sono", "hora_inicio": "01:00", "hora_fim": "02:00", "dias_semana": "diario", "classificacao": "indisponivel" });
    for (metodo, rota, corpo) in [
        ("PATCH", "/api/v1/rotina/blocos/BL1", Some(bloco.clone())),
        ("DELETE", "/api/v1/rotina/blocos/BL1", None),
        ("PATCH", "/api/v1/sync/dispositivos/DISP1", Some(serde_json::json!({ "nome": "invadido", "papel": "espelho" }))),
        ("DELETE", "/api/v1/sync/dispositivos/DISP1", None),
        ("PATCH", "/api/v1/sync/dispositivos/DISP1/push", Some(serde_json::json!({ "push_tipo": "fcm", "push_endpoint": "https://invasor.example" }))),
    ] {
        let (st, resposta) = chamar(&app, metodo, rota, &bruno, corpo).await;
        assert_eq!(st, StatusCode::NOT_FOUND, "{metodo} {rota}: {resposta}");
    }
    let (hora, nome, papel, push): (String, String, String, String) = state.db.with(|c| Ok((
        c.query_row("SELECT hora_inicio FROM bloco_rotina WHERE id = 'BL1'", [], |r| r.get(0))?,
        c.query_row("SELECT nome FROM dispositivo WHERE id = 'DISP1'", [], |r| r.get(0))?,
        c.query_row("SELECT papel FROM dispositivo WHERE id = 'DISP1'", [], |r| r.get(0))?,
        c.query_row("SELECT push_tipo FROM dispositivo WHERE id = 'DISP1'", [], |r| r.get(0))?,
    ))).await.unwrap();
    assert_eq!((hora.as_str(), nome.as_str(), papel.as_str(), push.as_str()), ("22:00", "Celular da Alice", "primario", "nenhum"));
    assert_eq!(chamar(&app, "PATCH", "/api/v1/rotina/blocos/BL1", &alice, Some(bloco)).await.0, StatusCode::OK, "controle: a dona edita o bloco");
    assert_eq!(chamar(&app, "PATCH", "/api/v1/sync/dispositivos/DISP1", &alice, Some(serde_json::json!({ "nome": "Novo nome" }))).await.0, StatusCode::OK, "controle: a dona edita o dispositivo");

    // Avatar: só de quem divide uma equipe.
    std::fs::create_dir_all(temp.join(".ecos/avatares")).unwrap();
    std::fs::write(temp.join(".ecos/avatares/UA.png"), [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0]).unwrap();
    assert_eq!(chamar(&app, "GET", "/api/v1/usuarios/UA/avatar", &bruno, None).await.0, StatusCode::NOT_FOUND, "sem equipe em comum");
    assert_eq!(chamar(&app, "GET", "/api/v1/usuarios/UA/avatar", &carla, None).await.0, StatusCode::OK, "divide a equipe A");
    assert_eq!(chamar(&app, "GET", "/api/v1/usuarios/UA/avatar", &alice, None).await.0, StatusCode::OK);

    let _ = std::fs::remove_dir_all(&temp);
}
