//! CRUD de notas e tarefas pela API, com login real, e o isolamento entre duas pessoas da mesma instância.

mod comum;

use axum::http::StatusCode;
use comum::*;
use serde_json::json;

#[tokio::test]
async fn nota_criar_ler_editar_buscar_e_excluir() {
    let e = nova();
    let (_, token) = e.admin("diogo").await;

    let (st, criada) = e.chamar("POST", "/api/v1/notas", Some(&token), Some(json!({ "titulo": "Ideias de viagem", "corpo": "visitar Lisboa" }))).await;
    assert_eq!(st, StatusCode::OK, "{criada}");
    let id = criada["id"].as_str().unwrap().to_string();
    assert!(e.raiz.join("diogo").is_dir(), "a nota vira arquivo .md na pasta da pessoa");

    let (st, lida) = e.chamar("GET", &format!("/api/v1/notas/{id}"), Some(&token), None).await;
    assert_eq!((st, lida["titulo"].as_str()), (StatusCode::OK, Some("Ideias de viagem")), "{lida}");
    assert!(lida["corpo"].as_str().unwrap().contains("Lisboa"));

    let (st, editada) = e.chamar("PATCH", &format!("/api/v1/notas/{id}"), Some(&token), Some(json!({ "titulo": "Viagem 2027", "corpo": "visitar Porto" }))).await;
    assert_eq!(st, StatusCode::OK, "{editada}");
    let (_, lida) = e.chamar("GET", &format!("/api/v1/notas/{id}"), Some(&token), None).await;
    assert_eq!(lida["titulo"], "Viagem 2027");
    assert!(lida["corpo"].as_str().unwrap().contains("Porto"));

    let (_, lista) = e.chamar("GET", "/api/v1/notas", Some(&token), None).await;
    assert_eq!(ids(&lista), vec![id.clone()]);
    let (_, busca) = e.chamar("GET", "/api/v1/busca?q=Porto", Some(&token), None).await;
    assert_eq!(busca["notas"].as_array().unwrap().len(), 1, "{busca}");

    let (st, _) = e.chamar("DELETE", &format!("/api/v1/notas/{id}"), Some(&token), None).await;
    assert_eq!(st, StatusCode::OK);
    let (st, _) = e.chamar("GET", &format!("/api/v1/notas/{id}"), Some(&token), None).await;
    assert_eq!(st, StatusCode::NOT_FOUND);
    let (_, lista) = e.chamar("GET", "/api/v1/notas", Some(&token), None).await;
    assert!(ids(&lista).is_empty());
}

#[tokio::test]
async fn nota_sem_titulo_e_recusada() {
    let e = nova();
    let (_, token) = e.admin("diogo").await;
    let (st, corpo) = e.chamar("POST", "/api/v1/notas", Some(&token), Some(json!({ "titulo": "   " }))).await;
    assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY, "{corpo}");
}

#[tokio::test]
async fn titulo_em_branco_com_corpo_nasce_do_corpo_e_patch_em_branco_mantem_o_titulo() {
    let e = nova();
    let (_, token) = e.admin("diogo").await;

    // O front deixa passar tudo: sem título mas com texto, a nota existe e o título vem da primeira linha.
    let (st, criada) = e.chamar("POST", "/api/v1/notas", Some(&token), Some(json!({ "titulo": "", "corpo": "\n# Reunião de quinta\ncomprar café" }))).await;
    assert_eq!(st, StatusCode::OK, "{criada}");
    assert_eq!(criada["titulo"], "Reunião de quinta");
    let id = criada["id"].as_str().unwrap().to_string();

    // Título apagado no meio da digitação: o corpo grava e o título atual fica (sem renomear nem recusar).
    let (st, r) = e.chamar("PATCH", &format!("/api/v1/notas/{id}"), Some(&token), Some(json!({ "titulo": "  ", "corpo": "novo texto", "reescrever_links": true }))).await;
    assert_eq!(st, StatusCode::OK, "{r}");
    let (_, lida) = e.chamar("GET", &format!("/api/v1/notas/{id}"), Some(&token), None).await;
    assert_eq!((lida["titulo"].as_str(), lida["corpo"].as_str().map(str::trim)), (Some("Reunião de quinta"), Some("novo texto")), "{lida}");

    // A tarefa segue a mesma regra.
    let (st, tarefa) = e.chamar("POST", "/api/v1/tarefas", Some(&token), Some(json!({ "titulo": "", "corpo": "Pagar a luz" }))).await;
    assert_eq!(st, StatusCode::OK, "{tarefa}");
    assert_eq!(tarefa["titulo"], "Pagar a luz");
}

#[tokio::test]
async fn tarefa_criar_ler_editar_e_excluir() {
    let e = nova();
    let (_, token) = e.admin("diogo").await;

    let (st, criada) = e.chamar("POST", "/api/v1/tarefas", Some(&token), Some(json!({ "titulo": "Pagar o IPTU" }))).await;
    assert_eq!(st, StatusCode::OK, "{criada}");
    let id = criada["id"].as_str().unwrap().to_string();
    assert!(e.raiz.join("diogo").is_dir());

    let (st, lida) = e.chamar("GET", &format!("/api/v1/tarefas/{id}"), Some(&token), None).await;
    assert_eq!((st, lida["titulo"].as_str()), (StatusCode::OK, Some("Pagar o IPTU")), "{lida}");

    let (st, editada) = e.chamar("PATCH", &format!("/api/v1/tarefas/{id}"), Some(&token), Some(json!({ "titulo": "Pagar o IPTU e o IPVA" }))).await;
    assert_eq!(st, StatusCode::OK, "{editada}");
    let (_, lida) = e.chamar("GET", &format!("/api/v1/tarefas/{id}"), Some(&token), None).await;
    assert_eq!(lida["titulo"], "Pagar o IPTU e o IPVA");

    let (_, lista) = e.chamar("GET", "/api/v1/tarefas", Some(&token), None).await;
    assert_eq!(ids(&lista), vec![id.clone()]);

    let (st, _) = e.chamar("DELETE", &format!("/api/v1/tarefas/{id}"), Some(&token), None).await;
    assert_eq!(st, StatusCode::OK);
    let (st, _) = e.chamar("GET", &format!("/api/v1/tarefas/{id}"), Some(&token), None).await;
    assert_eq!(st, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn tarefa_sem_titulo_e_recusada() {
    let e = nova();
    let (_, token) = e.admin("diogo").await;
    let (st, corpo) = e.chamar("POST", "/api/v1/tarefas", Some(&token), Some(json!({ "titulo": "" }))).await;
    assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY, "{corpo}");
}

#[tokio::test]
async fn uma_pessoa_nao_le_nem_altera_nem_apaga_o_que_e_da_outra() {
    let e = nova();
    let (_, admin) = e.admin("diogo").await;
    let (_, thaty) = e.pessoa(&admin, "thaty").await;

    let (_, nota) = e.chamar("POST", "/api/v1/notas", Some(&admin), Some(json!({ "titulo": "Segredo do Diogo", "corpo": "abacaxi" }))).await;
    let (_, tarefa) = e.chamar("POST", "/api/v1/tarefas", Some(&admin), Some(json!({ "titulo": "Tarefa do Diogo" }))).await;
    let (nota_id, tarefa_id) = (nota["id"].as_str().unwrap(), tarefa["id"].as_str().unwrap());

    for (metodo, rota, corpo) in [
        ("GET", format!("/api/v1/notas/{nota_id}"), None),
        ("PATCH", format!("/api/v1/notas/{nota_id}"), Some(json!({ "titulo": "hackeada" }))),
        ("DELETE", format!("/api/v1/notas/{nota_id}"), None),
        ("GET", format!("/api/v1/tarefas/{tarefa_id}"), None),
        ("PATCH", format!("/api/v1/tarefas/{tarefa_id}"), Some(json!({ "titulo": "hackeada" }))),
        ("DELETE", format!("/api/v1/tarefas/{tarefa_id}"), None),
    ] {
        let (st, _) = e.chamar(metodo, &rota, Some(&thaty), corpo).await;
        assert_eq!(st, StatusCode::NOT_FOUND, "{metodo} {rota} como outra pessoa (404, para não confirmar que existe)");
    }
    for rota in ["/api/v1/notas", "/api/v1/tarefas"] {
        let (_, lista) = e.chamar("GET", rota, Some(&thaty), None).await;
        assert!(ids(&lista).is_empty(), "{rota} da Thaty não mostra nada do Diogo");
    }
    let (_, busca) = e.chamar("GET", "/api/v1/busca?q=abacaxi", Some(&thaty), None).await;
    assert!(busca["notas"].as_array().unwrap().is_empty(), "{busca}");

    // Nada disso mexeu no que é do dono.
    let (st, lida) = e.chamar("GET", &format!("/api/v1/notas/{nota_id}"), Some(&admin), None).await;
    assert_eq!((st, lida["titulo"].as_str()), (StatusCode::OK, Some("Segredo do Diogo")));
}

#[tokio::test]
async fn conta_comum_nao_acessa_a_administracao() {
    let e = nova();
    let (_, admin) = e.admin("diogo").await;
    let (_, thaty) = e.pessoa(&admin, "thaty").await;

    assert_eq!(e.chamar("GET", "/api/v1/admin/usuarios", Some(&admin), None).await.0, StatusCode::OK);
    // A administração nem confirma que existe para quem não é admin (404).
    assert_eq!(e.chamar("GET", "/api/v1/admin/usuarios", Some(&thaty), None).await.0, StatusCode::NOT_FOUND);
    let (st, _) = e.chamar("POST", "/api/v1/admin/usuarios", Some(&thaty), Some(json!({ "nome_usuario": "terceira" }))).await;
    assert_eq!(st, StatusCode::NOT_FOUND);
    let (_, lista) = e.chamar("GET", "/api/v1/admin/usuarios", Some(&admin), None).await;
    assert_eq!(lista.as_array().or(lista["items"].as_array()).map(|l| l.len()), Some(2), "nenhuma conta nova: {lista}");
}

#[tokio::test]
async fn conta_com_senha_temporaria_so_acessa_o_perfil_ate_trocar() {
    let e = nova();
    let (_, admin) = e.admin("diogo").await;
    let (_, criada) = e.chamar("POST", "/api/v1/admin/usuarios", Some(&admin), Some(json!({ "nome_usuario": "thaty" }))).await;
    let (_, sessao) = e.login("thaty", criada["senha_temporaria"].as_str().unwrap()).await;
    let provisorio = sessao["access_token"].as_str().unwrap();

    let (st, corpo) = e.chamar("GET", "/api/v1/notas", Some(provisorio), None).await;
    assert_eq!((st, corpo["error"].as_str()), (StatusCode::FORBIDDEN, Some("PASSWORD_CHANGE_REQUIRED")), "{corpo}");
    assert_eq!(e.chamar("GET", "/api/v1/me", Some(provisorio), None).await.0, StatusCode::OK);
}
