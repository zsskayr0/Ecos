//! Cadastro do primeiro usuário, login, sessão e o que a rede de proteção do login precisa garantir.

mod comum;

use axum::http::StatusCode;
use comum::*;
use serde_json::json;

#[tokio::test]
async fn instancia_nova_aceita_so_o_primeiro_cadastro() {
    let e = nova();
    let (_, status) = e.chamar("GET", "/api/v1/auth/status", None, None).await;
    assert_eq!(status["instancia_vazia"], true);

    let (st, corpo) = e.registrar("diogo", SENHA_ADMIN).await;
    assert_eq!(st, StatusCode::OK, "{corpo}");
    assert!(!corpo["recovery_key"].as_str().unwrap().is_empty(), "a chave de recuperação aparece no cadastro");

    let (_, status) = e.chamar("GET", "/api/v1/auth/status", None, None).await;
    assert_eq!(status["instancia_vazia"], false);

    // O cadastro público fecha depois do primeiro usuário: as demais contas nascem pela administração.
    let (st, corpo) = e.registrar("intruso", SENHA_ADMIN).await;
    assert_eq!(st, StatusCode::CONFLICT, "{corpo}");
    let total: i64 = e.state.db.with(|c| c.query_row("SELECT COUNT(*) FROM usuario", [], |r| r.get(0))).await.unwrap();
    assert_eq!(total, 1);
}

#[tokio::test]
async fn cadastro_recusa_senha_fraca_nome_reservado_e_falta_de_aceite() {
    let e = nova();
    for (usuario, senha) in [("diogo", "curta"), ("diogo", "senhasenha1234"), ("admin", SENHA_ADMIN), ("a b", SENHA_ADMIN)] {
        let (st, corpo) = e.registrar(usuario, senha).await;
        assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY, "{usuario}/{senha}: {corpo}");
    }
    let (st, _) = e.chamar("POST", "/api/v1/auth/registrar", None, Some(json!({ "nome_usuario": "diogo", "senha": SENHA_ADMIN }))).await;
    assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY, "sem declarar idade nem aceitar os termos");
    let total: i64 = e.state.db.with(|c| c.query_row("SELECT COUNT(*) FROM usuario", [], |r| r.get(0))).await.unwrap();
    assert_eq!(total, 0, "nenhum cadastro inválido deixa conta para trás");
}

#[tokio::test]
async fn login_certo_abre_sessao_e_senha_errada_ou_usuario_inexistente_nao() {
    let e = nova();
    let (id, token) = e.admin("diogo").await;

    let (st, perfil) = e.chamar("GET", "/api/v1/me", Some(&token), None).await;
    assert_eq!(st, StatusCode::OK, "{perfil}");
    assert_eq!(perfil["nome_usuario"], "diogo");
    assert_eq!(perfil["id"], id.as_str());

    let (st, _) = e.login("diogo", "Senha-Errada-0000-xx").await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);
    let (st, _) = e.login("ninguem", SENHA_ADMIN).await;
    assert_eq!(st, StatusCode::UNAUTHORIZED, "usuário inexistente responde igual a senha errada");
    let (st, _) = e.login("DIOGO", SENHA_ADMIN).await;
    assert_eq!(st, StatusCode::OK, "o nome de usuário não diferencia maiúsculas");
}

#[tokio::test]
async fn rota_protegida_exige_token_valido_assinado_com_o_segredo_da_instancia() {
    let e = nova();
    let (id, _) = e.admin("diogo").await;

    for rota in ["/api/v1/me", "/api/v1/notas", "/api/v1/tarefas", "/api/v1/equipes", "/api/v1/admin/usuarios", "/api/v1/me/export"] {
        let (st, _) = e.chamar("GET", rota, None, None).await;
        assert_eq!(st, StatusCode::UNAUTHORIZED, "{rota} sem token");
    }
    let (st, _) = e.chamar("GET", "/api/v1/notas", Some("lixo.que.nao-e-jwt"), None).await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);

    // Token bem formado, mas assinado com outro segredo (instância diferente / segredo vazado de outro lugar).
    let forjado = ecos_app::auth::session::emitir_access_token(&id, b"outro-segredo-qualquer-de-32-bytes!!").unwrap();
    let (st, _) = e.chamar("GET", "/api/v1/notas", Some(&forjado), None).await;
    assert_eq!(st, StatusCode::UNAUTHORIZED, "o segredo da sessão é o que sustenta o login");

    // Token válido de uma pessoa que não existe (conta excluída) também não passa.
    let fantasma = ecos_app::auth::session::emitir_access_token("NAO-EXISTE", &e.segredo).unwrap();
    let (st, _) = e.chamar("GET", "/api/v1/notas", Some(&fantasma), None).await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);

    let (st, _) = e.chamar("GET", "/health", None, None).await;
    assert_eq!(st, StatusCode::OK, "health é público");
}

#[tokio::test]
async fn refresh_renova_a_sessao_e_logout_a_encerra() {
    let e = nova();
    e.registrar("diogo", SENHA_ADMIN).await;
    // O cliente nativo recebe o refresh no corpo (cabeçalho `x-ecos-native-client`); o navegador o guarda em cookie.
    let resposta = {
        use axum::body::Body;
        use axum::http::Request;
        use tower::Service;
        let pedido = Request::post("/api/v1/auth/login")
            .header("content-type", "application/json")
            .header("x-ecos-native-client", "1")
            .body(Body::from(json!({ "usuario": "diogo", "senha": SENHA_ADMIN }).to_string()))
            .unwrap();
        let r = e.app.clone().call(pedido).await.unwrap();
        assert_eq!(r.status(), StatusCode::OK);
        let cookies: Vec<String> = r.headers().get_all("set-cookie").iter().map(|v| v.to_str().unwrap().to_string()).collect();
        assert!(cookies.iter().any(|c| c.starts_with("ecos_sessao=") && c.contains("HttpOnly")), "{cookies:?}");
        serde_json::from_slice::<serde_json::Value>(&axum::body::to_bytes(r.into_body(), 8192).await.unwrap()).unwrap()
    };
    let refresh = resposta["refresh_token"].as_str().unwrap().to_string();

    let (st, novo) = e.chamar("POST", "/api/v1/auth/refresh", None, Some(json!({ "refresh_token": refresh }))).await;
    assert_eq!(st, StatusCode::OK, "{novo}");
    assert!(novo["access_token"].as_str().is_some());

    // O refresh antigo foi rotacionado: reapresentá-lo falha.
    let (st, _) = e.chamar("POST", "/api/v1/auth/refresh", None, Some(json!({ "refresh_token": refresh }))).await;
    assert_eq!(st, StatusCode::UNAUTHORIZED, "refresh token de uso único");

    let (st, _) = e.chamar("POST", "/api/v1/auth/refresh", None, Some(json!({ "refresh_token": "inventado" }))).await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn login_tem_limite_de_tentativas() {
    let e = nova();
    e.registrar("diogo", SENHA_ADMIN).await;
    let mut barrado = false;
    for _ in 0..15 {
        let (st, _) = e.login("diogo", "Senha-Errada-0000-xx").await;
        if st == StatusCode::TOO_MANY_REQUESTS {
            barrado = true;
            break;
        }
    }
    assert!(barrado, "força bruta no login tem de esbarrar no limite");
}

#[tokio::test]
async fn troca_de_senha_exige_a_atual_e_a_senha_antiga_deixa_de_valer() {
    let e = nova();
    let (_, token) = e.admin("diogo").await;

    let (st, _) = e.chamar("POST", "/api/v1/me/senha", Some(&token), Some(json!({ "senha_atual": "errada-errada-errada", "nova_senha": SENHA_NOVA }))).await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);
    let (st, _) = e.chamar("POST", "/api/v1/me/senha", Some(&token), Some(json!({ "senha_atual": SENHA_ADMIN, "nova_senha": "curta" }))).await;
    assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY);
    let (st, corpo) = e.chamar("POST", "/api/v1/me/senha", Some(&token), Some(json!({ "senha_atual": SENHA_ADMIN, "nova_senha": SENHA_NOVA }))).await;
    assert_eq!(st, StatusCode::OK, "{corpo}");

    assert_eq!(e.login("diogo", SENHA_ADMIN).await.0, StatusCode::UNAUTHORIZED);
    assert_eq!(e.login("diogo", SENHA_NOVA).await.0, StatusCode::OK);
}
