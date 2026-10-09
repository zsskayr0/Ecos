//! O que a API mostra a quem chama: membros de Equipe só para membros e sem campos além do necessário, e nenhuma
//! resposta com hash de senha, hash da recovery key ou dados de sessão.

use axum::http::StatusCode;
use serde_json::{json, Value};

use crate::auth::session;
use crate::auth::testes::{chamar, novo_estado, SEGREDO};

#[tokio::test]
async fn membros_da_equipe_so_para_membros_e_so_com_id_cargo_e_nome() {
    let state = novo_estado();
    state.db.with(|c| {
        for u in ["u1", "u2"] {
            c.execute("INSERT INTO usuario (id, nome_usuario, senha_hash, recovery_key_hash) VALUES (?1, ?1, 'hash-secreto', 'rk-secreta')", [u])?;
        }
        c.execute("INSERT INTO equipe (id, nome) VALUES ('A', 'Time A'), ('B', 'Time B')", [])?;
        c.execute("INSERT INTO membro_equipe (equipe_id, usuario_id, cargo) VALUES ('A', 'u1', 'dono'), ('A', 'u2', 'membro'), ('B', 'u2', 'dono')", [])?;
        Ok(())
    }).await.unwrap();
    let token = session::emitir_access_token("u1", SEGREDO).unwrap();

    let (status, _) = chamar(&state, "GET", "/api/v1/equipes/B/membros", Some(&token), Value::Null).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "quem não é da Equipe não vê os membros nem confirma que ela existe");

    let (status, corpo) = chamar(&state, "GET", "/api/v1/equipes/A/membros", Some(&token), Value::Null).await;
    assert_eq!(status, StatusCode::OK);
    let membros = corpo.as_array().unwrap();
    assert_eq!(membros.len(), 2);
    for m in membros {
        let mut campos: Vec<&str> = m.as_object().unwrap().keys().map(String::as_str).collect();
        campos.sort();
        assert_eq!(campos, ["cargo", "nome", "usuario_id"], "nada além disso (nunca hash, recovery key, sessão)");
    }
}

#[tokio::test]
async fn nenhuma_resposta_expoe_hash_de_senha_recovery_key_hash_ou_sessao() {
    let state = novo_estado();
    let (status, cadastro) = chamar(&state, "POST", "/api/v1/auth/registrar", None, json!({
        "nome_usuario": "diogo", "senha": "Vq7-lampada-Pato-42", "declara_idade_minima": true, "aceita_termos": true
    })).await;
    assert_eq!(status, StatusCode::OK);
    let (status, login) = chamar(&state, "POST", "/api/v1/auth/login", None, json!({ "usuario": "diogo", "senha": "Vq7-lampada-Pato-42" })).await;
    assert_eq!(status, StatusCode::OK);
    let usuario_id = cadastro["usuario_id"].as_str().unwrap().to_string();
    let token = session::emitir_access_token(&usuario_id, SEGREDO).unwrap();

    // O login devolve o access token da própria sessão (o cliente desktop o usa); o refresh token só vai ao app
    // desktop, então para um navegador vem nulo — a sessão longa fica só no cookie HttpOnly.
    assert!(login["refresh_token"].is_null());
    let mut login = login;
    for chave in ["access_token", "refresh_token"] { login.as_object_mut().unwrap().remove(chave); } // sessão de quem acabou de entrar
    let mut respostas = vec![cadastro, login];
    for rota in ["/api/v1/auth/status", "/api/v1/me", "/api/v1/me/export", "/api/v1/equipes"] {
        let (status, corpo) = chamar(&state, "GET", rota, Some(&token), Value::Null).await;
        assert_eq!(status, StatusCode::OK, "{rota}");
        respostas.push(corpo);
    }
    for corpo in respostas {
        let texto = corpo.to_string().to_lowercase();
        for proibido in ["hash", "senha_hash", "$argon2", "refresh_token", "session_secret"] {
            assert!(!texto.contains(proibido), "resposta expõe `{proibido}`: {texto}");
        }
    }
}

#[tokio::test]
async fn equipe_tem_tipo_pessoal_ou_corporativo() {
    let state = novo_estado();
    state.db.with(|c| {
        c.execute("INSERT INTO usuario (id, nome_usuario, senha_hash, recovery_key_hash) VALUES ('u1', 'u1', 'h', 'r'), ('u2', 'u2', 'h', 'r')", [])?;
        Ok(())
    }).await.unwrap();
    let token = session::emitir_access_token("u1", SEGREDO).unwrap();

    let (status, nova) = chamar(&state, "POST", "/api/v1/equipes", Some(&token), json!({ "nome": "Casa" })).await;
    assert_eq!(status, StatusCode::OK);
    let casa = nova["id"].as_str().unwrap().to_string();
    let (_, corp) = chamar(&state, "POST", "/api/v1/equipes", Some(&token), json!({ "nome": "Empresa", "tipo": "corporativo" })).await;
    let empresa = corp["id"].as_str().unwrap().to_string();
    let (status, _) = chamar(&state, "POST", "/api/v1/equipes", Some(&token), json!({ "nome": "X", "tipo": "banana" })).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "tipo desconhecido é recusado");

    let (_, lista) = chamar(&state, "GET", "/api/v1/equipes", Some(&token), Value::Null).await;
    let tipo_de = |id: &str| lista.as_array().unwrap().iter().find(|e| e["id"] == id).unwrap()["tipo"].as_str().unwrap().to_string();
    assert_eq!((tipo_de(&casa).as_str(), tipo_de(&empresa).as_str()), ("pessoal", "corporativo"), "sem tipo, nasce pessoal/familiar");

    let (status, _) = chamar(&state, "PATCH", &format!("/api/v1/equipes/{casa}"), Some(&token), json!({ "nome": "Casa", "tipo": "corporativo" })).await;
    assert_eq!(status, StatusCode::OK);
    let (_, obtida) = chamar(&state, "GET", &format!("/api/v1/equipes/{casa}"), Some(&token), Value::Null).await;
    assert_eq!(obtida["tipo"], "corporativo");
    let (status, _) = chamar(&state, "PATCH", &format!("/api/v1/equipes/{casa}"), Some(&token), json!({ "nome": "Casa" })).await;
    assert_eq!(status, StatusCode::OK);
    let (_, obtida) = chamar(&state, "GET", &format!("/api/v1/equipes/{casa}"), Some(&token), Value::Null).await;
    assert_eq!(obtida["tipo"], "corporativo", "renomear sem mandar tipo não o altera");
}
