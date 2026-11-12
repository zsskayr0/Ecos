//! Tags padrão por pasta: guardadas junto da cor/ícone, na forma canônica, e devolvidas na listagem.

mod comum;

use axum::http::StatusCode;
use comum::*;
use serde_json::{json, Value};

fn tags_de(lista: &Value, caminho: &str) -> Value {
    lista["subpastas"].as_array().unwrap().iter().find(|p| p["caminho"] == caminho).map(|p| p["tags"].clone()).unwrap_or(Value::Null)
}

#[tokio::test]
async fn tags_padrao_da_pasta_sao_guardadas_canonicas_e_sobrevivem_a_renomear() {
    let e = nova();
    let (_, token) = e.admin("diogo").await;
    let t = Some(token.as_str());

    let (st, r) = e.chamar("POST", "/api/v1/pastas", t, Some(json!({ "tipo": "tarefa", "nome": "Mods", "tags": ["#Minecraft", "mods ", "minecraft"] }))).await;
    assert_eq!(st, StatusCode::OK, "{r}");
    let (_, lista) = e.chamar("GET", "/api/v1/pastas?tipo=tarefa&recursivo=true", t, None).await;
    assert_eq!(tags_de(&lista, "Mods"), json!(["minecraft", "mods"]), "{lista}");

    // Renomear sem `tags` mantém; com lista troca; com lista vazia limpa.
    let (st, r) = e.chamar("PATCH", "/api/v1/pastas", t, Some(json!({ "tipo": "tarefa", "caminho_atual": "Mods", "novo_caminho": "Jogos" }))).await;
    assert_eq!(st, StatusCode::OK, "{r}");
    let (_, lista) = e.chamar("GET", "/api/v1/pastas?tipo=tarefa&recursivo=true", t, None).await;
    assert_eq!(tags_de(&lista, "Jogos"), json!(["minecraft", "mods"]), "{lista}");

    let (_, _) = e.chamar("PATCH", "/api/v1/pastas", t, Some(json!({ "tipo": "tarefa", "caminho_atual": "Jogos", "novo_caminho": "Jogos", "tags": ["Lazer"] }))).await;
    let (_, lista) = e.chamar("GET", "/api/v1/pastas?tipo=tarefa&recursivo=true", t, None).await;
    assert_eq!(tags_de(&lista, "Jogos"), json!(["lazer"]), "{lista}");

    let (_, _) = e.chamar("PATCH", "/api/v1/pastas", t, Some(json!({ "tipo": "tarefa", "caminho_atual": "Jogos", "novo_caminho": "Jogos", "tags": [] }))).await;
    let (_, lista) = e.chamar("GET", "/api/v1/pastas?tipo=tarefa&recursivo=true", t, None).await;
    assert!(tags_de(&lista, "Jogos").is_null(), "{lista}");
}

#[tokio::test]
async fn ajustes_extras_da_pasta_sao_validados_guardados_e_limpos() {
    let e = nova();
    let (_, token) = e.admin("diogo").await;
    let t = Some(token.as_str());
    let (st, _) = e.chamar("POST", "/api/v1/pastas", t, Some(json!({ "tipo": "tarefa", "nome": "Estudo", "descricao": "  Cursos e leituras ", "fixada": true, "prioridade_padrao": "alta", "duracao_padrao_min": 45 }))).await;
    assert_eq!(st, StatusCode::OK);
    let (_, lista) = e.chamar("GET", "/api/v1/pastas?tipo=tarefa&recursivo=true", t, None).await;
    let p = lista["subpastas"].as_array().unwrap().iter().find(|p| p["caminho"] == "Estudo").unwrap().clone();
    assert_eq!((p["descricao"].as_str(), p["fixada"].as_bool(), p["prioridade_padrao"].as_str(), p["duracao_padrao_min"].as_u64()), (Some("Cursos e leituras"), Some(true), Some("alta"), Some(45)), "{p}");

    let (st, _) = e.chamar("PATCH", "/api/v1/pastas", t, Some(json!({ "tipo": "tarefa", "caminho_atual": "Estudo", "novo_caminho": "Estudo", "prioridade_padrao": "urgente" }))).await;
    assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY, "prioridade fora da lista");

    let (st, _) = e.chamar("PATCH", "/api/v1/pastas", t, Some(json!({ "tipo": "tarefa", "caminho_atual": "Estudo", "novo_caminho": "Estudo", "fixada": false, "descricao": "", "prioridade_padrao": "", "duracao_padrao_min": 0 }))).await;
    assert_eq!(st, StatusCode::OK);
    let (_, lista) = e.chamar("GET", "/api/v1/pastas?tipo=tarefa&recursivo=true", t, None).await;
    let p = lista["subpastas"].as_array().unwrap().iter().find(|p| p["caminho"] == "Estudo").unwrap().clone();
    assert!(p["descricao"].is_null() && p["fixada"].is_null() && p["prioridade_padrao"].is_null() && p["duracao_padrao_min"].is_null(), "{p}");
}
