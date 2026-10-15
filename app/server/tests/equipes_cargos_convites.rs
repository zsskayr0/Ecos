//! Equipes: convites (expiração e uso único), cargos e exclusão de conta.

mod comum;

use axum::http::StatusCode;
use comum::*;
use serde_json::json;

#[tokio::test]
async fn convite_expirado_nao_vale_e_nome_da_equipe_nao_pode_ser_vazio() {
    let e = nova();
    let (_, admin) = e.admin("diogo").await;
    let (_, ana) = e.pessoa(&admin, "ana").await;
    let (_, bia) = e.pessoa(&admin, "bia").await;
    let (_, equipe) = e.chamar("POST", "/api/v1/equipes", Some(&ana), Some(json!({ "nome": "Casa" }))).await;
    let eq = equipe["id"].as_str().unwrap().to_string();

    let (st, _) = e.chamar("PATCH", &format!("/api/v1/equipes/{eq}"), Some(&ana), Some(json!({ "nome": "   " }))).await;
    assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY, "nome vazio");
    let (_, depois) = e.chamar("GET", &format!("/api/v1/equipes/{eq}"), Some(&ana), None).await;
    assert_eq!(depois["nome"], "Casa");

    let (_, convite) = e.chamar("POST", &format!("/api/v1/equipes/{eq}/convites"), Some(&ana), None).await;
    let codigo = convite["codigo"].as_str().unwrap().to_string();
    e.state.db.with(|c| c.execute("UPDATE convite_equipe SET expira_em = '2000-01-01T00:00:00+00:00'", [])).await.unwrap();
    let (st, _) = e.chamar("POST", &format!("/api/v1/convites/{codigo}/aceitar"), Some(&bia), None).await;
    assert_eq!(st, StatusCode::CONFLICT, "convite vencido");
    assert_eq!(e.chamar("GET", &format!("/api/v1/equipes/{eq}"), Some(&bia), None).await.0, StatusCode::NOT_FOUND, "não entrou");
}

#[tokio::test]
async fn cargos_so_o_dono_concede_e_retira_e_a_equipe_nunca_fica_sem_dono() {
    let e = nova();
    let (_, admin) = e.admin("diogo").await;
    let (id_ana, ana) = e.pessoa(&admin, "ana").await;
    let (id_bia, bia) = e.pessoa(&admin, "bia").await;
    let (id_cai, cai) = e.pessoa(&admin, "cai").await;
    let (_, equipe) = e.chamar("POST", "/api/v1/equipes", Some(&ana), Some(json!({ "nome": "Casa" }))).await;
    let eq = equipe["id"].as_str().unwrap().to_string();
    for t in [&bia, &cai] {
        let (_, c) = e.chamar("POST", &format!("/api/v1/equipes/{eq}/convites"), Some(&ana), None).await;
        e.chamar("POST", &format!("/api/v1/convites/{}/aceitar", c["codigo"].as_str().unwrap()), Some(t), None).await;
    }
    let url = |alvo: &str| format!("/api/v1/equipes/{eq}/membros/{alvo}");
    // Dono promove Bia a admin; admin não promove Cai a dono nem rebaixa/remove a dona.
    assert_eq!(e.chamar("PATCH", &url(&id_bia), Some(&ana), Some(json!({ "cargo": "admin" }))).await.0, StatusCode::OK);
    assert_eq!(e.chamar("PATCH", &url(&id_cai), Some(&bia), Some(json!({ "cargo": "dono" }))).await.0, StatusCode::FORBIDDEN);
    assert_eq!(e.chamar("PATCH", &url(&id_ana), Some(&bia), Some(json!({ "cargo": "membro" }))).await.0, StatusCode::FORBIDDEN);
    assert_eq!(e.chamar("DELETE", &url(&id_ana), Some(&bia), None).await.0, StatusCode::FORBIDDEN);
    // Último dono não se rebaixa; com outro dono, sim.
    assert_eq!(e.chamar("PATCH", &url(&id_ana), Some(&ana), Some(json!({ "cargo": "admin" }))).await.0, StatusCode::CONFLICT);
    assert_eq!(e.chamar("PATCH", &url(&id_bia), Some(&ana), Some(json!({ "cargo": "dono" }))).await.0, StatusCode::OK);
    assert_eq!(e.chamar("PATCH", &url(&id_ana), Some(&ana), Some(json!({ "cargo": "admin" }))).await.0, StatusCode::OK);
}

#[tokio::test]
async fn excluir_conta_e_barrado_enquanto_for_dono_de_equipe_com_outras_pessoas() {
    let e = nova();
    let (_, admin) = e.admin("diogo").await;
    let (_, ana) = e.pessoa(&admin, "ana").await;
    let (_, bia) = e.pessoa(&admin, "bia").await;
    let (_, equipe) = e.chamar("POST", "/api/v1/equipes", Some(&ana), Some(json!({ "nome": "Casa" }))).await;
    let eq = equipe["id"].as_str().unwrap().to_string();
    let (_, c) = e.chamar("POST", &format!("/api/v1/equipes/{eq}/convites"), Some(&ana), None).await;
    e.chamar("POST", &format!("/api/v1/convites/{}/aceitar", c["codigo"].as_str().unwrap()), Some(&bia), None).await;

    let (st, _) = e.chamar("DELETE", "/api/v1/me", Some(&ana), Some(json!({ "confirm": "EXCLUIR CONTA" }))).await;
    assert_eq!(st, StatusCode::CONFLICT, "dono não deixa a equipe órfã");
    assert_eq!(e.chamar("GET", "/api/v1/me", Some(&ana), None).await.0, StatusCode::OK, "a conta segue de pé");
}
