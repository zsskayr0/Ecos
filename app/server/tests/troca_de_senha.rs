//! Troca de senha autenticada: valida a atual, aplica as regras do cadastro e encerra as outras sessões.

mod comum;

use axum::http::StatusCode;
use comum::*;
use serde_json::json;

#[tokio::test]
async fn troca_encerra_as_outras_sessoes_e_mantem_a_atual() {
    let e = nova();
    let (_, sessao_a) = e.admin("diogo").await;
    // Segunda sessão (outro dispositivo) da mesma conta.
    let (_, b) = e.login("diogo", SENHA_ADMIN).await;
    let sessao_b = b["access_token"].as_str().unwrap().to_string();
    let refresh_b = b["refresh_token"].as_str().map(str::to_string);
    assert_eq!(e.chamar("GET", "/api/v1/me", Some(&sessao_b), None).await.0, StatusCode::OK);

    // Senha atual errada, curta ou com espaço: nada muda e a outra sessão segue valendo.
    for corpo in [
        json!({ "senha_atual": "errada-errada-errada", "nova_senha": SENHA_NOVA }),
        json!({ "senha_atual": SENHA_ADMIN, "nova_senha": "curta1" }),
        json!({ "senha_atual": SENHA_ADMIN, "nova_senha": "Frase Com Espacos 77" }),
    ] {
        let (st, _) = e.chamar("POST", "/api/v1/me/senha", Some(&sessao_a), Some(corpo)).await;
        assert!(matches!(st, StatusCode::UNAUTHORIZED | StatusCode::UNPROCESSABLE_ENTITY), "{st}");
    }
    assert_eq!(e.login("diogo", SENHA_ADMIN).await.0, StatusCode::OK, "a senha antiga segue valendo");
    assert_eq!(e.chamar("GET", "/api/v1/me", Some(&sessao_b), None).await.0, StatusCode::OK, "nenhuma sessão foi tocada");

    let (st, corpo) = e.chamar("POST", "/api/v1/me/senha", Some(&sessao_a), Some(json!({ "senha_atual": SENHA_ADMIN, "nova_senha": SENHA_NOVA }))).await;
    assert_eq!(st, StatusCode::OK, "{corpo}");

    assert_eq!(e.chamar("GET", "/api/v1/me", Some(&sessao_a), None).await.0, StatusCode::OK, "a sessão que trocou segue");
    assert_eq!(e.chamar("GET", "/api/v1/me", Some(&sessao_b), None).await.0, StatusCode::UNAUTHORIZED, "as outras deixam de autenticar");
    if let Some(r) = refresh_b {
        let (st, _) = e.chamar("POST", "/api/v1/auth/refresh", None, Some(json!({ "refresh_token": r }))).await;
        assert_eq!(st, StatusCode::UNAUTHORIZED, "o refresh da outra sessão também morreu");
    }
    assert_eq!(e.login("diogo", SENHA_ADMIN).await.0, StatusCode::UNAUTHORIZED);
    assert_eq!(e.login("diogo", SENHA_NOVA).await.0, StatusCode::OK);
}

#[tokio::test]
async fn recuperacao_por_recovery_key_e_reset_da_administracao_revogam_todas_as_sessoes() {
    let e = nova();
    let (st, cadastro) = e.registrar("diogo", SENHA_ADMIN).await;
    assert_eq!(st, StatusCode::OK, "{cadastro}");
    let chave = cadastro["recovery_key"].as_str().unwrap().to_string();
    let (_, s1) = e.login("diogo", SENHA_ADMIN).await;
    let (_, s2) = e.login("diogo", SENHA_ADMIN).await;
    let (a1, r1) = (s1["access_token"].as_str().unwrap().to_string(), s1["refresh_token"].as_str().map(str::to_string));
    let a2 = s2["access_token"].as_str().unwrap().to_string();
    assert_eq!(e.chamar("GET", "/api/v1/me", Some(&a1), None).await.0, StatusCode::OK);

    let (st, corpo) = e.chamar("POST", "/api/v1/auth/recuperar-senha", None, Some(json!({ "recovery_key": chave, "nova_senha": SENHA_NOVA }))).await;
    assert_eq!(st, StatusCode::OK, "{corpo}");
    for a in [&a1, &a2] {
        assert_eq!(e.chamar("GET", "/api/v1/me", Some(a), None).await.0, StatusCode::UNAUTHORIZED, "access antigo morreu");
    }
    if let Some(r) = r1 {
        let (st, _) = e.chamar("POST", "/api/v1/auth/refresh", None, Some(json!({ "refresh_token": r }))).await;
        assert_eq!(st, StatusCode::UNAUTHORIZED, "refresh antigo morreu");
    }
    assert_eq!(e.login("diogo", SENHA_NOVA).await.0, StatusCode::OK);
}

#[tokio::test]
async fn reset_da_administracao_derruba_access_e_refresh_antigos() {
    let e = nova();
    let (_, admin) = e.admin("ana").await;
    let (id, token) = e.pessoa(&admin, "bia").await;
    let (_, s) = e.login("bia", SENHA_NOVA).await;
    let refresh = s["refresh_token"].as_str().map(str::to_string);
    assert_eq!(e.chamar("GET", "/api/v1/me", Some(&token), None).await.0, StatusCode::OK);
    let (st, _) = e.chamar("POST", &format!("/api/v1/admin/usuarios/{id}/redefinir-senha"), Some(&admin), None).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(e.chamar("GET", "/api/v1/me", Some(&token), None).await.0, StatusCode::UNAUTHORIZED);
    if let Some(r) = refresh {
        assert_eq!(e.chamar("POST", "/api/v1/auth/refresh", None, Some(json!({ "refresh_token": r }))).await.0, StatusCode::UNAUTHORIZED);
    }
}
