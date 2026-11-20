//! Integridade das notas: `versao` + 409 de conflito, snapshot de redução e restauração.

mod comum;

use axum::http::StatusCode;
use comum::*;
use serde_json::json;

#[tokio::test]
async fn duas_escritas_com_a_mesma_base_a_segunda_leva_409() {
    let e = nova();
    let (_, token) = e.admin("diogo").await;
    let (_, criada) = e.chamar("POST", "/api/v1/notas", Some(&token), Some(json!({ "titulo": "Plano", "corpo": "v0" }))).await;
    let id = criada["id"].as_str().unwrap().to_string();
    let (_, lida) = e.chamar("GET", &format!("/api/v1/notas/{id}"), Some(&token), None).await;
    let base = lida["versao"].as_u64().expect("GET devolve versao");

    let (st, r1) = e.chamar("PATCH", &format!("/api/v1/notas/{id}"), Some(&token), Some(json!({ "corpo": "aba A", "base_versao": base }))).await;
    assert_eq!(st, StatusCode::OK, "{r1}");
    assert_eq!(r1["versao"].as_u64(), Some(base + 1));

    let (st, r2) = e.chamar("PATCH", &format!("/api/v1/notas/{id}"), Some(&token), Some(json!({ "corpo": "aba B", "base_versao": base }))).await;
    assert_eq!(st, StatusCode::CONFLICT, "{r2}");
    assert_eq!(r2["error"], "CONFLICT");
    assert_eq!(r2["message"], "Esta nota mudou em outro lugar.");
    assert_eq!(r2["atual"]["corpo"], "aba A");
    assert_eq!(r2["atual"]["versao"].as_u64(), Some(base + 1));

    // Sem base: comportamento antigo, grava.
    let (st, r3) = e.chamar("PATCH", &format!("/api/v1/notas/{id}"), Some(&token), Some(json!({ "corpo": "sem base" }))).await;
    assert_eq!(st, StatusCode::OK, "{r3}");
    let (_, lida) = e.chamar("GET", &format!("/api/v1/notas/{id}"), Some(&token), None).await;
    assert_eq!(lida["corpo"], "sem base");
}

#[tokio::test]
async fn reducao_grande_tira_snapshot_e_restaurar_volta_o_texto() {
    let e = nova();
    let (_, token) = e.admin("diogo").await;
    let longo = "texto importante ".repeat(50);
    let (_, criada) = e.chamar("POST", "/api/v1/notas", Some(&token), Some(json!({ "titulo": "Diário", "corpo": longo }))).await;
    let id = criada["id"].as_str().unwrap().to_string();

    // Esvaziar o corpo: snapshot "reducao" (o 1º PATCH também conta como periódico, mas redução tem prioridade).
    let (st, _) = e.chamar("PATCH", &format!("/api/v1/notas/{id}"), Some(&token), Some(json!({ "corpo": "" }))).await;
    assert_eq!(st, StatusCode::OK);
    let (st, lista) = e.chamar("GET", &format!("/api/v1/notas/{id}/versoes"), Some(&token), None).await;
    assert_eq!(st, StatusCode::OK, "{lista}");
    let lista = lista.as_array().unwrap().clone();
    assert_eq!(lista.len(), 1, "{lista:?}");
    assert_eq!(lista[0]["motivo"], "reducao");
    assert!(lista[0]["tamanho_bytes"].as_u64().unwrap() > 0);
    let vid = lista[0]["id"].as_str().unwrap().to_string();

    let (st, v) = e.chamar("GET", &format!("/api/v1/notas/{id}/versoes/{vid}"), Some(&token), None).await;
    assert_eq!(st, StatusCode::OK, "{v}");
    assert_eq!(v["corpo"], longo.as_str());
    assert_eq!(v["titulo"], "Diário");

    let (_, antes) = e.chamar("GET", &format!("/api/v1/notas/{id}"), Some(&token), None).await;
    let (st, rest) = e.chamar("POST", &format!("/api/v1/notas/{id}/versoes/{vid}/restaurar"), Some(&token), Some(json!({}))).await;
    assert_eq!(st, StatusCode::OK, "{rest}");
    assert!(rest["versao"].as_u64().unwrap() > antes["versao"].as_u64().unwrap());
    let (_, lida) = e.chamar("GET", &format!("/api/v1/notas/{id}"), Some(&token), None).await;
    assert_eq!(lida["corpo"], longo.as_str());
    assert_eq!(lida["versao"], rest["versao"]);

    let (_, lista) = e.chamar("GET", &format!("/api/v1/notas/{id}/versoes"), Some(&token), None).await;
    let lista = lista.as_array().unwrap();
    assert_eq!(lista.len(), 2);
    assert_eq!(lista[0]["motivo"], "restauracao", "mais recente primeiro");

    // Fechamento: cria um; repetir sem mudança não duplica.
    let (_, f1) = e.chamar("POST", &format!("/api/v1/notas/{id}/versoes"), Some(&token), Some(json!({}))).await;
    let (_, f2) = e.chamar("POST", &format!("/api/v1/notas/{id}/versoes"), Some(&token), Some(json!({}))).await;
    assert_eq!((f1["criado"].as_bool(), f2["criado"].as_bool()), (Some(true), Some(false)));

    let (st, _) = e.chamar("GET", &format!("/api/v1/notas/{id}/versoes/0-inexistente"), Some(&token), None).await;
    assert_eq!(st, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn patches_concorrentes_nao_se_perdem() {
    let e = nova();
    let (_, token) = e.admin("diogo").await;
    let (_, criada) = e.chamar("POST", "/api/v1/notas", Some(&token), Some(json!({ "titulo": "Corrida", "corpo": "x" }))).await;
    let id = criada["id"].as_str().unwrap().to_string();
    let url = format!("/api/v1/notas/{id}");
    let p = |i: u32| e.chamar("PATCH", &url, Some(&token), Some(json!({ "tags": [format!("t{i}")] })));
    let (a, b, c, d) = tokio::join!(p(0), p(1), p(2), p(3));
    for (st, r) in [a, b, c, d] {
        assert_eq!(st, StatusCode::OK, "{r}");
    }
    let (_, lida) = e.chamar("GET", &url, Some(&token), None).await;
    assert_eq!(lida["versao"].as_u64(), Some(5), "cada PATCH somou 1 sob a trava: {lida}");
}
