//! Renomear nota ou tarefa reescreve os wikilinks que apontavam para ela: prévia, aplicação, título duplicado e desfazer.

mod comum;

use axum::http::StatusCode;
use comum::*;
use serde_json::{json, Value};

async fn criar(e: &Instancia, rota: &str, token: &str, corpo: Value) -> String {
    let (st, r) = e.chamar("POST", rota, Some(token), Some(corpo)).await;
    assert_eq!(st, StatusCode::OK, "{rota}: {r}");
    r["id"].as_str().unwrap().to_string()
}

async fn corpo_de(e: &Instancia, rota: &str, token: &str) -> String {
    let (st, r) = e.chamar("GET", rota, Some(token), None).await;
    assert_eq!(st, StatusCode::OK, "{r}");
    r["corpo"].as_str().unwrap().to_string()
}

async fn entradas(e: &Instancia, rota: &str, token: &str) -> usize {
    let (st, r) = e.chamar("GET", rota, Some(token), None).await;
    assert_eq!(st, StatusCode::OK, "{r}");
    r["entrada"].as_array().unwrap().len()
}

#[tokio::test]
async fn renomear_atualiza_links_e_mantem_backlinks() {
    let e = nova();
    let (_, a) = e.admin("ana").await;
    let (_, b) = e.pessoa(&a, "bia").await;
    let alvo = criar(&e, "/api/v1/notas", &a, json!({ "titulo": "Hell Forge", "corpo": "[[Hell Forge]] a si mesma" })).await;
    let n1 = criar(&e, "/api/v1/notas", &a, json!({ "titulo": "Diário", "corpo": "[[Hell Forge]], [[hell forge|a forja]] e [[ nota : Hell Forge ]].\n```\n[[Hell Forge]]\n```\nem linha `[[Hell Forge]]`" })).await;
    let t1 = criar(&e, "/api/v1/tarefas", &a, json!({ "titulo": "Visitar", "corpo": "ver [[nota:Hell Forge|forja]] e [[Outra coisa]]" })).await;
    let da_bia = criar(&e, "/api/v1/notas", &b, json!({ "titulo": "Da Bia", "corpo": "[[Hell Forge]]" })).await;
    let rota_links = format!("/api/v1/notas/{alvo}/links");
    assert_eq!(entradas(&e, &rota_links, &a).await, 2);

    // Prévia: lista os afetados e não mexe em nada.
    let (st, p) = e.chamar("POST", &format!("/api/v1/notas/{alvo}/renomear/previa"), Some(&a), Some(json!({ "titulo": "Hellforge" }))).await;
    assert_eq!(st, StatusCode::OK, "{p}");
    assert_eq!(p["total_links"], 4);
    let afetados: Vec<String> = p["afetados"].as_array().unwrap().iter().map(|x| x["id"].as_str().unwrap().to_string()).collect();
    assert_eq!(afetados.len(), 2);
    assert!(afetados.contains(&n1) && afetados.contains(&t1) && !afetados.contains(&da_bia) && !afetados.contains(&alvo));
    assert!(corpo_de(&e, &format!("/api/v1/notas/{n1}"), &a).await.contains("[[Hell Forge]]"));

    // Aplicação.
    let (st, r) = e.chamar("POST", &format!("/api/v1/notas/{alvo}/renomear"), Some(&a), Some(json!({ "titulo": "Hellforge" }))).await;
    assert_eq!(st, StatusCode::OK, "{r}");
    assert_eq!(r["atualizados"], 2);
    let n1_corpo = corpo_de(&e, &format!("/api/v1/notas/{n1}"), &a).await;
    assert_eq!(n1_corpo, "[[Hellforge]], [[Hellforge|a forja]] e [[ nota : Hellforge ]].\n```\n[[Hell Forge]]\n```\nem linha `[[Hell Forge]]`");
    assert_eq!(corpo_de(&e, &format!("/api/v1/tarefas/{t1}"), &a).await, "ver [[nota:Hellforge|forja]] e [[Outra coisa]]");
    assert_eq!(corpo_de(&e, &format!("/api/v1/notas/{alvo}"), &a).await, "[[Hell Forge]] a si mesma", "autolink não é tocado");
    assert_eq!(corpo_de(&e, &format!("/api/v1/notas/{da_bia}"), &b).await, "[[Hell Forge]]", "outro espaço nunca é tocado");
    assert_eq!(entradas(&e, &rota_links, &a).await, 2, "a contagem de backlinks permanece");

    // Desfazer devolve título e textos.
    let id_desfazer = r["desfazer_id"].as_str().unwrap().to_string();
    let (st, d) = e.chamar("POST", &format!("/api/v1/renomeacoes/{id_desfazer}/desfazer"), Some(&a), None).await;
    assert_eq!(st, StatusCode::OK, "{d}");
    assert_eq!(d["restaurados"], 2);
    assert!(corpo_de(&e, &format!("/api/v1/notas/{n1}"), &a).await.starts_with("[[Hell Forge]], [[hell forge|a forja]]"));
    assert_eq!(entradas(&e, &rota_links, &a).await, 2);
    // Só uma vez, e só a própria pessoa.
    let (st, _) = e.chamar("POST", &format!("/api/v1/renomeacoes/{id_desfazer}/desfazer"), Some(&a), None).await;
    assert_eq!(st, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn titulo_duplicado_entre_nota_e_tarefa_so_mexe_no_que_resolvia_para_o_item() {
    let e = nova();
    let (_, a) = e.admin("ana").await;
    let nota = criar(&e, "/api/v1/notas", &a, json!({ "titulo": "Plano" })).await;
    let tarefa = criar(&e, "/api/v1/tarefas", &a, json!({ "titulo": "Plano" })).await;
    let fonte = criar(&e, "/api/v1/notas", &a, json!({ "titulo": "Fonte", "corpo": "[[Plano]] [[nota:Plano]] [[tarefa:Plano|t]]" })).await;

    // Renomear a TAREFA: só `[[tarefa:Plano]]` (o sem prefixo vai para a nota).
    let (st, r) = e.chamar("POST", &format!("/api/v1/tarefas/{tarefa}/renomear"), Some(&a), Some(json!({ "titulo": "Plano B" }))).await;
    assert_eq!(st, StatusCode::OK, "{r}");
    assert_eq!(corpo_de(&e, &format!("/api/v1/notas/{fonte}"), &a).await, "[[Plano]] [[nota:Plano]] [[tarefa:Plano B|t]]");

    // Renomear a NOTA para o título que a tarefa acabou de ganhar: o link sem prefixo ganharia a nota; o prefixo da tarefa fica.
    let (st, r) = e.chamar("POST", &format!("/api/v1/notas/{nota}/renomear"), Some(&a), Some(json!({ "titulo": "Plano B" }))).await;
    assert_eq!(st, StatusCode::OK, "{r}");
    assert_eq!(corpo_de(&e, &format!("/api/v1/notas/{fonte}"), &a).await, "[[Plano B]] [[nota:Plano B]] [[tarefa:Plano B|t]]");
    assert_eq!(entradas(&e, &format!("/api/v1/notas/{nota}/links"), &a).await, 1);
    assert_eq!(entradas(&e, &format!("/api/v1/tarefas/{tarefa}/links"), &a).await, 1);

    // Tarefa volta a "Plano": o sem prefixo continua na nota (nota vence), então só o `tarefa:` muda.
    let (st, r) = e.chamar("POST", &format!("/api/v1/tarefas/{tarefa}/renomear"), Some(&a), Some(json!({ "titulo": "Plano" }))).await;
    assert_eq!(st, StatusCode::OK, "{r}");
    assert_eq!(corpo_de(&e, &format!("/api/v1/notas/{fonte}"), &a).await, "[[Plano B]] [[nota:Plano B]] [[tarefa:Plano|t]]");
}

#[tokio::test]
async fn colisao_de_titulo_novo_fixa_o_tipo_com_prefixo() {
    let e = nova();
    let (_, a) = e.admin("ana").await;
    let _nota = criar(&e, "/api/v1/notas", &a, json!({ "titulo": "Destino" })).await;
    let tarefa = criar(&e, "/api/v1/tarefas", &a, json!({ "titulo": "Origem" })).await;
    let fonte = criar(&e, "/api/v1/notas", &a, json!({ "titulo": "Fonte", "corpo": "[[Origem]]" })).await;
    let (st, p) = e.chamar("POST", &format!("/api/v1/tarefas/{tarefa}/renomear"), Some(&a), Some(json!({ "titulo": "Destino" }))).await;
    assert_eq!(st, StatusCode::OK, "{p}");
    assert_eq!(corpo_de(&e, &format!("/api/v1/notas/{fonte}"), &a).await, "[[tarefa:Destino]]");
    assert_eq!(entradas(&e, &format!("/api/v1/tarefas/{tarefa}/links"), &a).await, 1);
}

#[tokio::test]
async fn sem_reescrever_so_renomeia_e_titulo_vazio_e_recusado() {
    let e = nova();
    let (_, a) = e.admin("ana").await;
    let alvo = criar(&e, "/api/v1/notas", &a, json!({ "titulo": "Velho" })).await;
    let fonte = criar(&e, "/api/v1/notas", &a, json!({ "titulo": "Fonte", "corpo": "[[Velho]]" })).await;
    let (st, _) = e.chamar("POST", &format!("/api/v1/notas/{alvo}/renomear"), Some(&a), Some(json!({ "titulo": "  " }))).await;
    assert!(st.is_client_error(), "título vazio: {st}");
    let (st, r) = e.chamar("POST", &format!("/api/v1/notas/{alvo}/renomear"), Some(&a), Some(json!({ "titulo": "Novo", "reescrever_links": false }))).await;
    assert_eq!(st, StatusCode::OK, "{r}");
    assert!(r["desfazer_id"].is_null());
    assert_eq!(corpo_de(&e, &format!("/api/v1/notas/{fonte}"), &a).await, "[[Velho]]");
    // Item de outra pessoa não existe para quem pergunta.
    let (_, b) = e.pessoa(&a, "bia").await;
    let (st, _) = e.chamar("POST", &format!("/api/v1/notas/{alvo}/renomear/previa"), Some(&b), Some(json!({ "titulo": "X" }))).await;
    assert_eq!(st, StatusCode::NOT_FOUND);
}
