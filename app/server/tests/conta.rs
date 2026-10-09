//! Exclusão de conta (LGPD): apaga a pessoa e os dados dela, sem tocar nos dos outros, e derruba a sessão.

mod comum;

use axum::http::StatusCode;
use comum::*;
use serde_json::json;

#[tokio::test]
async fn excluir_conta_exige_a_frase_e_apaga_dados_arquivos_e_acesso() {
    let e = nova();
    let (_, admin) = e.admin("diogo").await;
    let (id_thaty, thaty) = e.pessoa(&admin, "thaty").await;
    let (_, da_thaty) = e.chamar("POST", "/api/v1/notas", Some(&thaty), Some(json!({ "titulo": "Diário", "corpo": "caju" }))).await;
    let (_, do_diogo) = e.chamar("POST", "/api/v1/notas", Some(&admin), Some(json!({ "titulo": "Do Diogo", "corpo": "abacaxi" }))).await;
    e.chamar("POST", "/api/v1/tarefas", Some(&thaty), Some(json!({ "titulo": "Tarefa da Thaty" }))).await;
    assert!(e.raiz.join("thaty/Notas").is_dir());
    let _ = da_thaty;

    // Sem a frase: nada acontece.
    let (st, _) = e.chamar("DELETE", "/api/v1/me", Some(&thaty), Some(json!({ "confirm": "excluir" }))).await;
    assert_ne!(st, StatusCode::OK);
    assert_eq!(e.chamar("GET", "/api/v1/me", Some(&thaty), None).await.0, StatusCode::OK);
    assert!(e.raiz.join("thaty/Notas").is_dir());

    let (st, corpo) = e.chamar("DELETE", "/api/v1/me", Some(&thaty), Some(json!({ "confirm": "EXCLUIR CONTA" }))).await;
    assert_eq!(st, StatusCode::OK, "{corpo}");

    // O token ainda é um JWT válido, mas a conta não existe mais; a senha também não entra.
    assert_eq!(e.chamar("GET", "/api/v1/me", Some(&thaty), None).await.0, StatusCode::UNAUTHORIZED);
    assert_eq!(e.login("thaty", SENHA_NOVA).await.0, StatusCode::UNAUTHORIZED);
    assert!(!e.raiz.join("thaty").exists(), "a pasta da pessoa some do disco");
    let restantes: i64 = e.state.db.with(move |c| {
        let n: i64 = c.query_row("SELECT COUNT(*) FROM usuario WHERE id = ?1", [&id_thaty], |r| r.get(0))?;
        let t: i64 = c.query_row("SELECT COUNT(*) FROM tarefa WHERE titulo = 'Tarefa da Thaty'", [], |r| r.get(0))?;
        Ok(n + t)
    }).await.unwrap();
    assert_eq!(restantes, 0, "usuário e tarefas saem do banco");

    // O que é do Diogo não foi tocado.
    let (st, nota) = e.chamar("GET", &format!("/api/v1/notas/{}", do_diogo["id"].as_str().unwrap()), Some(&admin), None).await;
    assert_eq!((st, nota["titulo"].as_str()), (StatusCode::OK, Some("Do Diogo")));
}

#[tokio::test]
async fn dono_de_equipe_com_outras_pessoas_nao_exclui_a_conta_antes_de_transferir() {
    let e = nova();
    let (_, dono) = e.admin("diogo").await;
    let (_, thaty) = e.pessoa(&dono, "thaty").await;
    let (_, equipe) = e.chamar("POST", "/api/v1/equipes", Some(&dono), Some(json!({ "nome": "Casa" }))).await;
    let eq = equipe["id"].as_str().unwrap().to_string();
    let (_, convite) = e.chamar("POST", &format!("/api/v1/equipes/{eq}/convites"), Some(&dono), None).await;
    e.chamar("POST", &format!("/api/v1/convites/{}/aceitar", convite["codigo"].as_str().unwrap()), Some(&thaty), None).await;

    let (st, corpo) = e.chamar("DELETE", "/api/v1/me", Some(&dono), Some(json!({ "confirm": "EXCLUIR CONTA" }))).await;
    assert_eq!(st, StatusCode::CONFLICT, "{corpo}");
    assert_eq!(e.chamar("GET", "/api/v1/me", Some(&dono), None).await.0, StatusCode::OK, "a conta segue intacta");
}

#[tokio::test]
async fn exportacao_devolve_um_zip_so_com_os_dados_de_quem_pede() {
    let e = nova();
    let (_, admin) = e.admin("diogo").await;
    e.chamar("POST", "/api/v1/notas", Some(&admin), Some(json!({ "titulo": "Minha nota", "corpo": "conteudo" }))).await;

    use axum::body::{to_bytes, Body};
    use axum::http::Request;
    use tower::Service;
    let r = e.app.clone().call(Request::get("/api/v1/me/export").header("authorization", format!("Bearer {admin}")).body(Body::empty()).unwrap()).await.unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    let bytes = to_bytes(r.into_body(), 8 * 1024 * 1024).await.unwrap();
    assert_eq!(&bytes[..4], b"PK\x03\x04", "é um .zip");
    assert!(bytes.windows(b"Minha nota".len()).any(|w| w == b"Minha nota"));

    let sem_token = e.app.clone().call(Request::get("/api/v1/me/export").body(Body::empty()).unwrap()).await.unwrap();
    assert_eq!(sem_token.status(), StatusCode::UNAUTHORIZED);
}
