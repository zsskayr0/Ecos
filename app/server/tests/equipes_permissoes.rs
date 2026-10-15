//! Equipes: isolamento entre equipes (participação exigida em leituras e convites).

mod comum;

use axum::http::StatusCode;
use comum::*;
use serde_json::json;

#[tokio::test]
async fn duas_equipes_isoladas_quem_nao_participa_nao_le_nem_convida() {
    let e = nova();
    let (_, admin) = e.admin("diogo").await;
    let (_, ana) = e.pessoa(&admin, "ana").await;
    let (_, bia) = e.pessoa(&admin, "bia").await;
    let (_, ea) = e.chamar("POST", "/api/v1/equipes", Some(&ana), Some(json!({ "nome": "Equipe da Ana" }))).await;
    let (_, eb) = e.chamar("POST", "/api/v1/equipes", Some(&bia), Some(json!({ "nome": "Equipe da Bia" }))).await;
    let (ea, eb) = (ea["id"].as_str().unwrap().to_string(), eb["id"].as_str().unwrap().to_string());

    for (quem, alheia) in [(&ana, &eb), (&bia, &ea)] {
        assert_eq!(e.chamar("GET", &format!("/api/v1/equipes/{alheia}"), Some(quem), None).await.0, StatusCode::NOT_FOUND);
        assert_eq!(e.chamar("GET", &format!("/api/v1/equipes/{alheia}/membros"), Some(quem), None).await.0, StatusCode::NOT_FOUND);
        assert_eq!(e.chamar("POST", &format!("/api/v1/equipes/{alheia}/convites"), Some(quem), None).await.0, StatusCode::NOT_FOUND);
        assert_eq!(e.chamar("PATCH", &format!("/api/v1/equipes/{alheia}"), Some(quem), Some(json!({ "nome": "x" }))).await.0, StatusCode::NOT_FOUND);
    }
    // Equipe inexistente responde igual a equipe alheia (não vaza existência).
    assert_eq!(e.chamar("GET", "/api/v1/equipes/NAO-EXISTE", Some(&ana), None).await.0, StatusCode::NOT_FOUND);
    // As donas continuam lendo e convidando nas próprias.
    assert_eq!(e.chamar("GET", &format!("/api/v1/equipes/{ea}/membros"), Some(&ana), None).await.0, StatusCode::OK);
    assert_eq!(e.chamar("POST", &format!("/api/v1/equipes/{ea}/convites"), Some(&ana), None).await.0, StatusCode::OK);
}
