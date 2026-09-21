//! Administração no estilo Jellyfin: quem administra cria a conta, a pessoa entra com senha temporária e é obrigada a
//! trocá-la antes de qualquer outra coisa; e as permissões de equipe (convite/QR code e menu de administração).

use crate::{auth::{password, session}, config::{Ambiente, Config}, db::IndexDb, state::AppState};
use axum::{body::{to_bytes, Body}, http::{Request, StatusCode}, Router};
use ecos_core::new_id;
use std::sync::{Arc, Mutex};
use tower::Service;

async fn chamar(app: &Router, metodo: &str, uri: &str, token: Option<&str>, corpo: Option<serde_json::Value>) -> (StatusCode, serde_json::Value) {
    let mut pedido = Request::builder().method(metodo).uri(uri);
    if let Some(t) = token { pedido = pedido.header("authorization", format!("Bearer {t}")); }
    let corpo = match corpo {
        Some(c) => { pedido = pedido.header("content-type", "application/json"); Body::from(c.to_string()) }
        None => Body::empty(),
    };
    let resposta = app.clone().call(pedido.body(corpo).unwrap()).await.unwrap();
    let status = resposta.status();
    let bytes = to_bytes(resposta.into_body(), 1024 * 1024).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null))
}

async fn entrar(app: &Router, usuario: &str, senha: &str) -> (StatusCode, Option<String>) {
    let (st, r) = chamar(app, "POST", "/api/v1/auth/login", None, Some(serde_json::json!({ "usuario": usuario, "senha": senha }))).await;
    (st, r["access_token"].as_str().map(str::to_string))
}

#[tokio::test]
async fn admin_cria_conta_com_senha_temporaria_e_a_pessoa_e_obrigada_a_trocar() {
    let temp = std::env::temp_dir().join(format!("ecos-admin-{}", new_id()));
    std::fs::create_dir_all(&temp).unwrap();
    let segredo = b"segredo-efemero-exclusivo-do-teste-de-admin".to_vec();
    let state = AppState {
        db: IndexDb::open(&temp.join("index.db")).unwrap(),
        config: Arc::new(Config {
            ambiente: Ambiente::Desenvolvimento, porta: 0, notes_root: temp.clone(), index_db_path: temp.join("index.db"),
            vault_enabled: false, vault_internal_url: String::new(), session_secret: segredo.clone(), ranking_interval_secs: 300,
            static_dir: None, cookie_secure: false, google: None,
        }),
        http: reqwest::Client::new(), pareamentos: Arc::new(Mutex::new(Default::default())),
    };
    let hash_admin = password::hash("Vq7-lampada-Pato-42").unwrap();
    state.db.with(move |c| {
        c.execute("INSERT INTO usuario (id, nome_usuario, senha_hash, recovery_key_hash, papel) VALUES ('ADM', 'diogo', ?1, 'x', 'admin')", [&hash_admin])?;
        c.execute("INSERT INTO usuario (id, nome_usuario, senha_hash, recovery_key_hash) VALUES ('VIS', 'visita', 'x', 'x')", [])?;
        Ok(())
    }).await.unwrap();
    let app = crate::routes::montar(state.clone());
    let admin = session::emitir_access_token("ADM", &segredo).unwrap();
    let visita = session::emitir_access_token("VIS", &segredo).unwrap();

    // Quem não administra não vê nem que as rotas existem.
    for (m, r, c) in [("GET", "/api/v1/admin/usuarios", None), ("POST", "/api/v1/admin/usuarios", Some(serde_json::json!({ "nome_usuario": "intrusa" }))), ("GET", "/api/v1/admin/equipes", None)] {
        assert_eq!(chamar(&app, m, r, Some(&visita), c).await.0, StatusCode::NOT_FOUND, "{m} {r}");
    }

    // Criação: valida o nome, recusa duplicado (sem diferenciar maiúsculas) e devolve a senha temporária uma vez.
    for ruim in ["joão", "com espaço", "Admin", "ab"] {
        let (st, _) = chamar(&app, "POST", "/api/v1/admin/usuarios", Some(&admin), Some(serde_json::json!({ "nome_usuario": ruim }))).await;
        assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY, "{ruim}");
    }
    let (st, _) = chamar(&app, "POST", "/api/v1/admin/usuarios", Some(&admin), Some(serde_json::json!({ "nome_usuario": "DIOGO" }))).await;
    assert_eq!(st, StatusCode::CONFLICT);
    let (st, criada) = chamar(&app, "POST", "/api/v1/admin/usuarios", Some(&admin), Some(serde_json::json!({ "nome_usuario": "thaty", "nome": "Thaty Silva" }))).await;
    assert_eq!(st, StatusCode::OK, "{criada}");
    let temporaria = criada["senha_temporaria"].as_str().unwrap().to_string();
    let id_thaty = criada["id"].as_str().unwrap().to_string();
    assert_eq!(criada["papel"], "usuario");
    let (_, lista) = chamar(&app, "GET", "/api/v1/admin/usuarios", Some(&admin), None).await;
    let thaty_na_lista = lista.as_array().unwrap().iter().find(|u| u["id"] == id_thaty.as_str()).unwrap();
    assert_eq!((thaty_na_lista["deve_trocar_senha"].as_bool(), thaty_na_lista["papel"].as_str()), (Some(true), Some("usuario")));
    assert!(!lista.to_string().contains(&temporaria), "a senha temporária não volta na listagem");

    // Ela entra com a senha temporária, mas só consegue ver o perfil e trocar a senha.
    assert_eq!(entrar(&app, "thaty", "senha-errada").await.0, StatusCode::UNAUTHORIZED);
    let (st, token) = entrar(&app, "THATY", &temporaria).await; // login sem diferenciar maiúsculas
    assert_eq!(st, StatusCode::OK);
    let thaty = token.unwrap();
    let (st, eu) = chamar(&app, "GET", "/api/v1/me", Some(&thaty), None).await;
    assert_eq!((st, eu["deve_trocar_senha"].as_bool(), eu["papel"].as_str()), (StatusCode::OK, Some(true), Some("usuario")));
    for (m, r) in [("GET", "/api/v1/notas"), ("GET", "/api/v1/tarefas"), ("GET", "/api/v1/equipes"), ("GET", "/api/v1/vault/config"), ("GET", "/api/v1/feed")] {
        let (st, corpo) = chamar(&app, m, r, Some(&thaty), None).await;
        assert_eq!((st, corpo["error"].as_str()), (StatusCode::FORBIDDEN, Some("PASSWORD_CHANGE_REQUIRED")), "{m} {r}");
    }
    assert_eq!(chamar(&app, "POST", "/api/v1/notas", Some(&thaty), Some(serde_json::json!({ "titulo": "x" }))).await.0, StatusCode::FORBIDDEN);

    // A troca: exige a senha atual, a política de senhas e uma senha diferente da temporária.
    let troca = |atual: &str, nova: &str| serde_json::json!({ "senha_atual": atual, "nova_senha": nova });
    assert_eq!(chamar(&app, "POST", "/api/v1/me/senha", Some(&thaty), Some(troca("errada-errada-1A", "Nova-senha-Forte-77"))).await.0, StatusCode::UNAUTHORIZED);
    assert_eq!(chamar(&app, "POST", "/api/v1/me/senha", Some(&thaty), Some(troca(&temporaria, &temporaria))).await.0, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(chamar(&app, "POST", "/api/v1/me/senha", Some(&thaty), Some(troca(&temporaria, "curta1"))).await.0, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(chamar(&app, "POST", "/api/v1/me/senha", Some(&thaty), Some(troca(&temporaria, "thaty-Bateria-Grampo-9"))).await.0, StatusCode::UNPROCESSABLE_ENTITY, "contém o usuário");
    let (st, ok) = chamar(&app, "POST", "/api/v1/me/senha", Some(&thaty), Some(troca(&temporaria, "Nova-senha-Forte-77"))).await;
    assert_eq!(st, StatusCode::OK, "{ok}");
    assert!(ok["recovery_key"].as_str().is_some_and(|k| k.split_whitespace().count() == 24), "recebe uma recovery key nova, só dela");

    // Liberada: usa o app normalmente; a senha antiga (temporária) não vale mais.
    assert_eq!(chamar(&app, "GET", "/api/v1/notas", Some(&thaty), None).await.0, StatusCode::OK);
    let (_, eu) = chamar(&app, "GET", "/api/v1/me", Some(&thaty), None).await;
    assert_eq!(eu["deve_trocar_senha"].as_bool(), Some(false));
    assert_eq!(entrar(&app, "thaty", &temporaria).await.0, StatusCode::UNAUTHORIZED);
    assert_eq!(entrar(&app, "thaty", "Nova-senha-Forte-77").await.0, StatusCode::OK);
    // Troca voluntária depois: não rotaciona a recovery key.
    let (_, ok) = chamar(&app, "POST", "/api/v1/me/senha", Some(&thaty), Some(troca("Nova-senha-Forte-77", "Outra-senha-Forte-88"))).await;
    assert!(ok["recovery_key"].is_null());

    // Redefinir a senha dela: nova temporária, sessões encerradas, troca obrigatória de novo. Não vale para si mesmo.
    assert_eq!(chamar(&app, "POST", "/api/v1/admin/usuarios/ADM/redefinir-senha", Some(&admin), None).await.0, StatusCode::CONFLICT);
    assert_eq!(chamar(&app, "POST", "/api/v1/admin/usuarios/NAO-EXISTE/redefinir-senha", Some(&admin), None).await.0, StatusCode::NOT_FOUND);
    assert_eq!(chamar(&app, "POST", &format!("/api/v1/admin/usuarios/{id_thaty}/redefinir-senha"), Some(&visita), None).await.0, StatusCode::NOT_FOUND);
    let (st, nova) = chamar(&app, "POST", &format!("/api/v1/admin/usuarios/{id_thaty}/redefinir-senha"), Some(&admin), None).await;
    assert_eq!(st, StatusCode::OK);
    let temporaria2 = nova["senha_temporaria"].as_str().unwrap();
    assert_ne!(temporaria2, temporaria);
    assert_eq!(entrar(&app, "thaty", "Outra-senha-Forte-88").await.0, StatusCode::UNAUTHORIZED);
    let (st, token2) = entrar(&app, "thaty", temporaria2).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(chamar(&app, "GET", "/api/v1/notas", token2.as_deref(), None).await.0, StatusCode::FORBIDDEN);

    let _ = std::fs::remove_dir_all(&temp);
}

#[tokio::test]
async fn equipe_convite_por_qr_code_e_menu_de_administracao() {
    let temp = std::env::temp_dir().join(format!("ecos-admin-eq-{}", new_id()));
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
        c.execute("INSERT INTO usuario (id, nome_usuario, senha_hash, recovery_key_hash, papel) VALUES ('ADM', 'diogo', 'x', 'x', 'admin')", [])?;
        c.execute("INSERT INTO usuario (id, nome_usuario, senha_hash, recovery_key_hash) VALUES ('DONA', 'ana', 'x', 'x'), ('MEM', 'bia', 'x', 'x'), ('NOVA', 'caio', 'x', 'x'), ('FORA', 'duda', 'x', 'x')", [])?;
        c.execute("INSERT INTO equipe (id, nome) VALUES ('EQ', 'Casa')", [])?;
        c.execute("INSERT INTO membro_equipe (equipe_id, usuario_id, cargo) VALUES ('EQ', 'DONA', 'dono'), ('EQ', 'MEM', 'membro')", [])?;
        Ok(())
    }).await.unwrap();
    let app = crate::routes::montar(state.clone());
    let t = |id: &str| session::emitir_access_token(id, &segredo).unwrap();
    let (adm, dona, mem, nova, fora) = (t("ADM"), t("DONA"), t("MEM"), t("NOVA"), t("FORA"));

    // Só quem é da equipe a enxerga; o convite (QR code) só sai de dono/admin da equipe.
    assert_eq!(chamar(&app, "GET", "/api/v1/equipes/EQ", Some(&fora), None).await.0, StatusCode::NOT_FOUND);
    assert_eq!(chamar(&app, "GET", "/api/v1/equipes/EQ", Some(&mem), None).await.0, StatusCode::OK);
    assert_eq!(chamar(&app, "POST", "/api/v1/equipes/EQ/convites", Some(&fora), None).await.0, StatusCode::FORBIDDEN);
    assert_eq!(chamar(&app, "POST", "/api/v1/equipes/EQ/convites", Some(&mem), None).await.0, StatusCode::FORBIDDEN, "membro comum não convida");
    let (st, convite) = chamar(&app, "POST", "/api/v1/equipes/EQ/convites", Some(&dona), None).await;
    assert_eq!(st, StatusCode::OK, "{convite}");
    let codigo = convite["codigo"].as_str().unwrap().to_string();

    // Quem escaneia entra; o convite é de uso único e o código aceita minúsculas (link digitado à mão).
    assert_eq!(chamar(&app, "POST", &format!("/api/v1/convites/{}/aceitar", codigo.to_lowercase()), Some(&nova), None).await.0, StatusCode::OK);
    assert_eq!(chamar(&app, "GET", "/api/v1/equipes/EQ", Some(&nova), None).await.0, StatusCode::OK);
    assert_eq!(chamar(&app, "POST", &format!("/api/v1/convites/{codigo}/aceitar"), Some(&fora), None).await.0, StatusCode::CONFLICT, "já usado");
    assert_eq!(chamar(&app, "GET", "/api/v1/equipes/EQ", Some(&fora), None).await.0, StatusCode::NOT_FOUND);

    // Convite vencido não vale.
    let (_, velho) = chamar(&app, "POST", "/api/v1/equipes/EQ/convites", Some(&dona), None).await;
    let cod_velho = velho["codigo"].as_str().unwrap().to_string();
    let cv = cod_velho.clone();
    state.db.with(move |c| c.execute("UPDATE convite_equipe SET expira_em = '2020-01-01T00:00:00+00:00' WHERE codigo = ?1", [&cv])).await.unwrap();
    assert_eq!(chamar(&app, "POST", &format!("/api/v1/convites/{cod_velho}/aceitar"), Some(&fora), None).await.0, StatusCode::CONFLICT);
    assert_eq!(chamar(&app, "POST", "/api/v1/convites/NAOEXISTE/aceitar", Some(&fora), None).await.0, StatusCode::NOT_FOUND);

    // Só o dono passa a propriedade.
    state.db.with(|c| c.execute("UPDATE membro_equipe SET cargo = 'admin' WHERE equipe_id = 'EQ' AND usuario_id = 'MEM'", [])).await.unwrap();
    assert_eq!(chamar(&app, "PATCH", "/api/v1/equipes/EQ/membros/MEM", Some(&mem), Some(serde_json::json!({ "cargo": "dono" }))).await.0, StatusCode::FORBIDDEN);
    assert_eq!(chamar(&app, "PATCH", "/api/v1/equipes/EQ/membros/MEM", Some(&dona), Some(serde_json::json!({ "cargo": "dono" }))).await.0, StatusCode::OK);

    // Menu de administração: vê todas as equipes e coloca/tira qualquer conta.
    assert_eq!(chamar(&app, "POST", "/api/v1/admin/equipes/EQ/membros", Some(&dona), Some(serde_json::json!({ "usuario_id": "FORA" }))).await.0, StatusCode::NOT_FOUND, "dona da equipe não é admin da instância");
    let (_, equipes) = chamar(&app, "GET", "/api/v1/admin/equipes", Some(&adm), None).await;
    assert_eq!(equipes[0]["membros"].as_array().unwrap().len(), 3);
    assert_eq!(chamar(&app, "POST", "/api/v1/admin/equipes/EQ/membros", Some(&adm), Some(serde_json::json!({ "usuario_id": "FORA" }))).await.0, StatusCode::OK);
    assert_eq!(chamar(&app, "GET", "/api/v1/equipes/EQ", Some(&fora), None).await.0, StatusCode::OK);
    assert_eq!(chamar(&app, "POST", "/api/v1/admin/equipes/EQ/membros", Some(&adm), Some(serde_json::json!({ "usuario_id": "NAO-EXISTE" }))).await.0, StatusCode::NOT_FOUND);
    assert_eq!(chamar(&app, "POST", "/api/v1/admin/equipes/EQ/membros", Some(&adm), Some(serde_json::json!({ "usuario_id": "FORA", "cargo": "dono" }))).await.0, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(chamar(&app, "DELETE", "/api/v1/admin/equipes/EQ/membros/FORA", Some(&adm), None).await.0, StatusCode::OK);
    assert_eq!(chamar(&app, "GET", "/api/v1/equipes/EQ", Some(&fora), None).await.0, StatusCode::NOT_FOUND);
    // Re-adicionar quem já é dono não rebaixa; e a equipe nunca fica sem dono.
    assert_eq!(chamar(&app, "POST", "/api/v1/admin/equipes/EQ/membros", Some(&adm), Some(serde_json::json!({ "usuario_id": "MEM", "cargo": "membro" }))).await.0, StatusCode::OK);
    let cargo_mem: String = state.db.with(|c| c.query_row("SELECT cargo FROM membro_equipe WHERE equipe_id = 'EQ' AND usuario_id = 'MEM'", [], |r| r.get(0))).await.unwrap();
    assert_eq!(cargo_mem, "dono");
    state.db.with(|c| c.execute("DELETE FROM membro_equipe WHERE equipe_id = 'EQ' AND usuario_id = 'DONA'", [])).await.unwrap();
    assert_eq!(chamar(&app, "DELETE", "/api/v1/admin/equipes/EQ/membros/MEM", Some(&adm), None).await.0, StatusCode::CONFLICT, "última dona/dono");

    let _ = std::fs::remove_dir_all(&temp);
}
