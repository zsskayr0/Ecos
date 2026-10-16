//! Produtores de notificação: prazo próximo (idempotente), entrada em equipe e contador de não lidas.

mod comum;

use axum::http::StatusCode;
use comum::*;
use serde_json::json;

#[tokio::test]
async fn prazo_proximo_gera_uma_notificacao_e_o_contador_reflete_a_leitura() {
    let e = nova();
    let (_, token) = e.admin("ana").await;
    // Fuso fixo nas preferências: "hoje" é calculado nele, sem depender do fuso da máquina.
    e.chamar("PATCH", "/api/v1/me/preferencias/calendario", Some(&token), Some(json!({ "pais": "Brasil", "fuso": "UTC", "inicio": "07:00", "deadlines": true }))).await;
    let hoje = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let longe = (chrono::Utc::now() + chrono::Duration::days(30)).format("%Y-%m-%d").to_string();
    e.chamar("POST", "/api/v1/tarefas", Some(&token), Some(json!({ "titulo": "Entregar relatorio", "due_date": hoje }))).await;
    e.chamar("POST", "/api/v1/tarefas", Some(&token), Some(json!({ "titulo": "Longe", "due_date": longe }))).await;

    let (st, c) = e.chamar("GET", "/api/v1/notificacoes/nao-lidas", Some(&token), None).await;
    assert_eq!((st, c["total"].as_i64()), (StatusCode::OK, Some(1)));
    // Varrer de novo não duplica.
    let (_, lista) = e.chamar("GET", "/api/v1/notificacoes?categoria=agenda&lida=false", Some(&token), None).await;
    assert_eq!(lista["items"].as_array().unwrap().len(), 1);
    assert!(lista["items"][0]["corpo"].as_str().unwrap().contains("Entregar relatorio"));

    let id = lista["items"][0]["id"].as_str().unwrap().to_string();
    e.chamar("PATCH", &format!("/api/v1/notificacoes/{id}/lida"), Some(&token), None).await;
    let (_, c) = e.chamar("GET", "/api/v1/notificacoes/nao-lidas", Some(&token), None).await;
    assert_eq!(c["total"].as_i64(), Some(0));
    // Marcada como lida, a mesma tarefa não notifica de novo.
    let (_, lista) = e.chamar("GET", "/api/v1/notificacoes", Some(&token), None).await;
    assert_eq!(lista["items"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn varredura_repetida_nao_regrava_mas_tarefa_nova_do_dia_ainda_notifica() {
    let e = nova();
    let (_, token) = e.admin("ana").await;
    e.chamar("PATCH", "/api/v1/me/preferencias/calendario", Some(&token), Some(json!({ "pais": "Brasil", "fuso": "UTC", "inicio": "07:00", "deadlines": true }))).await;
    let hoje = chrono::Utc::now().format("%Y-%m-%d").to_string();
    e.chamar("POST", "/api/v1/tarefas", Some(&token), Some(json!({ "titulo": "Primeira", "due_date": hoje }))).await;
    for _ in 0..3 {
        let (_, c) = e.chamar("GET", "/api/v1/notificacoes/nao-lidas", Some(&token), None).await;
        assert_eq!(c["total"].as_i64(), Some(1));
    }
    e.chamar("POST", "/api/v1/tarefas", Some(&token), Some(json!({ "titulo": "Segunda", "due_date": hoje }))).await;
    let (_, c) = e.chamar("GET", "/api/v1/notificacoes/nao-lidas", Some(&token), None).await;
    assert_eq!(c["total"].as_i64(), Some(2), "a tarefa criada depois da primeira varredura também notifica");
    let linhas: i64 = e.state.db.with(|c| c.query_row("SELECT COUNT(*) FROM notificacao WHERE chave LIKE 'prazo:%'", [], |r| r.get(0))).await.unwrap();
    assert_eq!(linhas, 2);
}

#[tokio::test]
async fn adicionar_pessoa_a_equipe_notifica_a_pessoa() {
    let e = nova();
    let (_, admin) = e.admin("ana").await;
    let (bia_id, bia) = e.pessoa(&admin, "bia").await;
    let (st, eq) = e.chamar("POST", "/api/v1/equipes", Some(&admin), Some(json!({ "nome": "Time" }))).await;
    assert_eq!(st, StatusCode::OK, "{eq}");
    let eid = eq["id"].as_str().unwrap().to_string();
    let (st, _) = e.chamar("POST", &format!("/api/v1/admin/equipes/{eid}/membros"), Some(&admin), Some(json!({ "usuario_id": bia_id }))).await;
    assert_eq!(st, StatusCode::OK);
    let (_, lista) = e.chamar("GET", "/api/v1/notificacoes?categoria=equipes", Some(&bia), None).await;
    assert_eq!(lista["items"].as_array().unwrap().len(), 1, "{lista}");
}
