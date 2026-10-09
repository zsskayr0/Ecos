//! Testes das formas de pagamento cadastráveis (`/vault/formas-pagamento`).

use crate::{config::Config, db::VaultDb, routes, state::AppState};
use axum::{body::{to_bytes, Body}, http::{Request, StatusCode}, Router};
use ecos_core::new_id;
use serde_json::{json, Value};
use std::sync::Arc;
use tower::Service;

fn app() -> (Router, std::path::PathBuf) {
    let raiz = std::env::temp_dir().join(format!("ecos-formas-{}", new_id()));
    let config = Arc::new(Config { porta: 0, db_path: raiz.join("vault/ecos-vault.db"), meta_path: raiz.join("vault/ecos-vault.meta.json"), backups_dir: raiz.join("backups") });
    std::fs::create_dir_all(raiz.join("vault")).unwrap();
    std::fs::create_dir_all(raiz.join("backups")).unwrap();
    (routes::montar(AppState { db: VaultDb::trancado(), config }), raiz)
}

async fn chamar(app: &Router, usuario: &str, metodo: &str, uri: &str, corpo: Option<Value>) -> (StatusCode, Value) {
    let mut p = Request::builder().method(metodo).uri(uri).header("x-ecos-usuario", usuario);
    let body = match corpo {
        Some(c) => { p = p.header("content-type", "application/json"); Body::from(c.to_string()) }
        None => Body::empty(),
    };
    let r = app.clone().call(p.body(body).unwrap()).await.unwrap();
    let s = r.status();
    let b = to_bytes(r.into_body(), 1 << 20).await.unwrap();
    (s, serde_json::from_slice(&b).unwrap_or(Value::Null))
}

async fn ativar(app: &Router, u: &str) {
    assert_eq!(chamar(app, u, "POST", "/vault/ativar", Some(json!({ "senha": "senha-financeiro-123" }))).await.0, StatusCode::OK);
}

async fn lancar(app: &Router, u: &str, forma: Option<&str>) -> (StatusCode, Value) {
    chamar(app, u, "POST", "/vault/transacoes", Some(json!({ "tipo": "saida", "valor_centavos": 1000, "data": "2026-09-30", "descricao": "Teste", "forma_pagamento": forma }))).await
}

async fn codigos(app: &Router, u: &str) -> Vec<String> {
    let (_, v) = chamar(app, u, "GET", "/vault/formas-pagamento", None).await;
    v.as_array().unwrap().iter().map(|f| f["codigo"].as_str().unwrap().to_string()).collect()
}

fn recorrencia(forma: &str) -> Value {
    json!({ "tipo": "saida", "descricao": "Aluguel", "valor_centavos": 100000, "tipo_recorrencia": "fixa", "frequencia": "mensal", "intervalo": 1, "data_inicio": "2026-10-05", "forma_pagamento": forma })
}

#[test]
fn codigo_sem_acento_e_sem_simbolos() {
    assert_eq!(routes::formas_pagamento::gerar_codigo("Cartão de Débito"), "cartao_de_debito");
    assert_eq!(routes::formas_pagamento::gerar_codigo("  Vale-Refeição! "), "vale_refeicao");
    assert_eq!(routes::formas_pagamento::gerar_codigo("???"), "forma");
}

#[tokio::test]
async fn nasce_com_as_sete_de_fabrica_em_ordem_e_com_contagem_de_uso() {
    let (app, raiz) = app();
    ativar(&app, "ana").await;
    assert_eq!(codigos(&app, "ana").await, ["pix", "pix_automatico", "ted", "cartao", "dinheiro", "boleto", "outro"]);
    // Cofre de equipe também nasce com elas: sem forma de pagamento nada se lança.
    ativar(&app, "eq_crbs").await;
    assert_eq!(codigos(&app, "eq_crbs").await.len(), 7);
    assert_eq!(lancar(&app, "ana", Some("pix")).await.0, StatusCode::OK);
    let (_, v) = chamar(&app, "ana", "GET", "/vault/formas-pagamento", None).await;
    assert_eq!(v[0]["usos"], 1);
    assert_eq!(v[0]["padrao"], true);
    drop(app);
    let _ = std::fs::remove_dir_all(raiz);
}

#[tokio::test]
async fn forma_criada_vale_em_lancamento_e_recorrencia_e_inexistente_e_recusada() {
    let (app, raiz) = app();
    ativar(&app, "ana").await;
    let (s, c) = chamar(&app, "ana", "POST", "/vault/formas-pagamento", Some(json!({ "nome": "Cartão de Débito", "icone": "CreditCard" }))).await;
    assert_eq!(s, StatusCode::OK, "{c}");
    assert_eq!(c["codigo"], "cartao_de_debito");
    assert_eq!(lancar(&app, "ana", Some("cartao_de_debito")).await.0, StatusCode::OK);
    let (s, e) = lancar(&app, "ana", Some("fantasma")).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{e}");
    assert_eq!(chamar(&app, "ana", "POST", "/vault/recorrencias", Some(recorrencia("cartao_de_debito"))).await.0, StatusCode::OK);
    assert_eq!(chamar(&app, "ana", "POST", "/vault/recorrencias", Some(recorrencia("fantasma"))).await.0, StatusCode::UNPROCESSABLE_ENTITY);
    // Importação também confere contra o cadastro.
    let linha = |forma: &str| json!({ "linha": 2, "tipo": "saida", "valor_centavos": 500, "data": "2026-09-01", "descricao": "Café", "status": "efetivada", "forma_pagamento": forma });
    let (_, ok) = chamar(&app, "ana", "POST", "/vault/financeiro/importar", Some(json!({ "linhas": [linha("cartao_de_debito")], "dry_run": true }))).await;
    assert_eq!(ok["validas"], 1, "{ok}");
    let (_, ruim) = chamar(&app, "ana", "POST", "/vault/financeiro/importar", Some(json!({ "linhas": [linha("fantasma")], "dry_run": true }))).await;
    assert_eq!(ruim["validas"], 0, "{ruim}");
    drop(app);
    let _ = std::fs::remove_dir_all(raiz);
}

#[tokio::test]
async fn nome_repetido_e_recusado_codigo_nao_colide_e_renomear_nao_mexe_nos_lancamentos() {
    let (app, raiz) = app();
    ativar(&app, "ana").await;
    assert_eq!(chamar(&app, "ana", "POST", "/vault/formas-pagamento", Some(json!({ "nome": "PIX" }))).await.0, StatusCode::CONFLICT, "igual a uma de fábrica, sem diferenciar maiúsculas");
    assert_eq!(chamar(&app, "ana", "POST", "/vault/formas-pagamento", Some(json!({ "nome": "  " }))).await.0, StatusCode::UNPROCESSABLE_ENTITY);
    let (_, a) = chamar(&app, "ana", "POST", "/vault/formas-pagamento", Some(json!({ "nome": "Vale-Refeição" }))).await;
    let (_, b) = chamar(&app, "ana", "POST", "/vault/formas-pagamento", Some(json!({ "nome": "Vale Refeição" }))).await;
    assert_eq!((a["codigo"].as_str(), b["codigo"].as_str()), (Some("vale_refeicao"), Some("vale_refeicao_2")));
    let (_, t) = lancar(&app, "ana", Some("vale_refeicao")).await;
    let id = t["id"].as_str().unwrap();
    assert_eq!(chamar(&app, "ana", "PATCH", "/vault/formas-pagamento/vale_refeicao", Some(json!({ "nome": "VR" }))).await.0, StatusCode::OK);
    assert_eq!(chamar(&app, "ana", "GET", &format!("/vault/transacoes/{id}"), None).await.1["forma_pagamento"], "vale_refeicao");
    // Renomear para o nome de outra é recusado; para o próprio nome (outra caixa) vale.
    assert_eq!(chamar(&app, "ana", "PATCH", "/vault/formas-pagamento/vale_refeicao", Some(json!({ "nome": "pix" }))).await.0, StatusCode::CONFLICT);
    assert_eq!(chamar(&app, "ana", "PATCH", "/vault/formas-pagamento/vale_refeicao", Some(json!({ "nome": "vr" }))).await.0, StatusCode::OK);
    assert_eq!(chamar(&app, "ana", "PATCH", "/vault/formas-pagamento/nao-existe", Some(json!({ "nome": "X" }))).await.0, StatusCode::NOT_FOUND);
    drop(app);
    let _ = std::fs::remove_dir_all(raiz);
}

#[tokio::test]
async fn desativar_nao_quebra_lancamentos_antigos_e_campos_omitidos_nao_mudam() {
    let (app, raiz) = app();
    ativar(&app, "ana").await;
    chamar(&app, "ana", "POST", "/vault/formas-pagamento", Some(json!({ "nome": "Carteira", "icone": "Wallet", "cor": "#ff0000" }))).await;
    assert_eq!(chamar(&app, "ana", "PATCH", "/vault/formas-pagamento/carteira", Some(json!({ "ativa": false }))).await.0, StatusCode::OK);
    let (_, v) = chamar(&app, "ana", "GET", "/vault/formas-pagamento", None).await;
    let c = v.as_array().unwrap().iter().find(|f| f["codigo"] == "carteira").unwrap();
    assert_eq!((c["ativa"].clone(), c["nome"].clone(), c["icone"].clone(), c["cor"].clone()), (json!(false), json!("Carteira"), json!("Wallet"), json!("#ff0000")));
    // Inativa continua válida para o que já existe; o front é que a esconde dos seletores.
    assert_eq!(lancar(&app, "ana", Some("carteira")).await.0, StatusCode::OK);
    // `null` limpa o ícone.
    chamar(&app, "ana", "PATCH", "/vault/formas-pagamento/carteira", Some(json!({ "icone": null }))).await;
    let (_, v) = chamar(&app, "ana", "GET", "/vault/formas-pagamento", None).await;
    assert_eq!(v.as_array().unwrap().iter().find(|f| f["codigo"] == "carteira").unwrap()["icone"], Value::Null);
    drop(app);
    let _ = std::fs::remove_dir_all(raiz);
}

#[tokio::test]
async fn excluir_exige_destino_move_tudo_junto_e_protege_as_de_fabrica() {
    let (app, raiz) = app();
    ativar(&app, "ana").await;
    chamar(&app, "ana", "POST", "/vault/formas-pagamento", Some(json!({ "nome": "Carteira" }))).await;
    let (_, t) = lancar(&app, "ana", Some("carteira")).await;
    let id = t["id"].as_str().unwrap().to_string();
    chamar(&app, "ana", "POST", "/vault/recorrencias", Some(recorrencia("carteira"))).await;
    let (s, uso) = chamar(&app, "ana", "GET", "/vault/formas-pagamento/carteira/uso", None).await;
    assert_eq!((s, uso["transacoes"].as_i64(), uso["recorrencias"].as_i64()), (StatusCode::OK, Some(1), Some(1)));

    let uri = "/vault/formas-pagamento/carteira";
    let (s, e) = chamar(&app, "ana", "DELETE", uri, None).await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert!(e["message"].as_str().unwrap().contains("2 itens"));
    assert!(codigos(&app, "ana").await.contains(&"carteira".to_string()), "nada some sem destino");
    assert_eq!(chamar(&app, "ana", "DELETE", uri, Some(json!({ "mover_para": "carteira" }))).await.0, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(chamar(&app, "ana", "DELETE", uri, Some(json!({ "mover_para": "fantasma" }))).await.0, StatusCode::NOT_FOUND);
    assert_eq!(chamar(&app, "ana", "DELETE", uri, Some(json!({ "mover_para": "pix", "sem_forma": true }))).await.0, StatusCode::UNPROCESSABLE_ENTITY);
    let (s, r) = chamar(&app, "ana", "DELETE", uri, Some(json!({ "mover_para": "pix" }))).await;
    assert_eq!((s, r["movidos"].as_i64()), (StatusCode::OK, Some(2)));
    assert!(!codigos(&app, "ana").await.contains(&"carteira".to_string()));
    assert_eq!(chamar(&app, "ana", "GET", &format!("/vault/transacoes/{id}"), None).await.1["forma_pagamento"], "pix");

    // Sem destino: os itens ficam sem forma.
    chamar(&app, "ana", "POST", "/vault/formas-pagamento", Some(json!({ "nome": "Cheque" }))).await;
    let (_, t2) = lancar(&app, "ana", Some("cheque")).await;
    assert_eq!(chamar(&app, "ana", "DELETE", "/vault/formas-pagamento/cheque", Some(json!({ "sem_forma": true }))).await.0, StatusCode::OK);
    assert_eq!(chamar(&app, "ana", "GET", &format!("/vault/transacoes/{}", t2["id"].as_str().unwrap()), None).await.1["forma_pagamento"], Value::Null);

    // De fábrica: só desativa.
    let (s, e) = chamar(&app, "ana", "DELETE", "/vault/formas-pagamento/pix", None).await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert!(e["message"].as_str().unwrap().contains("Desative"));
    assert_eq!(chamar(&app, "ana", "DELETE", "/vault/formas-pagamento/nao-existe", None).await.0, StatusCode::NOT_FOUND);
    drop(app);
    let _ = std::fs::remove_dir_all(raiz);
}

#[tokio::test]
async fn busca_acha_pelo_nome_da_forma_cadastrada() {
    let (app, raiz) = app();
    ativar(&app, "ana").await;
    chamar(&app, "ana", "POST", "/vault/formas-pagamento", Some(json!({ "nome": "Carteira" }))).await;
    let (_, t) = lancar(&app, "ana", Some("carteira")).await;
    let (_, r) = chamar(&app, "ana", "GET", "/vault/busca?q=carteira", None).await;
    assert!(r["items"].as_array().unwrap().iter().any(|i| i["id"] == t["id"]), "{r}");
    drop(app);
    let _ = std::fs::remove_dir_all(raiz);
}
