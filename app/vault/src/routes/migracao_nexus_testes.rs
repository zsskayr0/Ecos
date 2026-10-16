//! Migração do Nexus pelo roteador real: simulação sem efeito, confirmação obrigatória, idempotência, verificação de
//! contagem/soma e desfazer tudo em caso de erro.

use crate::{config::Config, db::VaultDb, routes, state::AppState};
use axum::{body::{to_bytes, Body}, http::{Request, StatusCode}, Router};
use ecos_core::new_id;
use serde_json::{json, Value};
use std::sync::Arc;
use tower::Service;

fn app() -> (Router, Arc<Config>, std::path::PathBuf) {
    let raiz = std::env::temp_dir().join(format!("ecos-nexus-{}", new_id()));
    let config = Arc::new(Config { porta: 0, db_path: raiz.join("vault/ecos-vault.db"), meta_path: raiz.join("vault/ecos-vault.meta.json"), backups_dir: raiz.join("backups") });
    std::fs::create_dir_all(raiz.join("vault")).unwrap();
    std::fs::create_dir_all(raiz.join("backups")).unwrap();
    let state = AppState { db: VaultDb::trancado(), config: config.clone() };
    (routes::montar(state), config, raiz)
}

async fn chamar(app: &Router, metodo: &str, uri: &str, corpo: Option<Value>) -> (StatusCode, Value) {
    let mut pedido = Request::builder().method(metodo).uri(uri).header("x-ecos-usuario", "nx");
    let corpo = match corpo {
        Some(c) => {
            pedido = pedido.header("content-type", "application/json");
            Body::from(c.to_string())
        }
        None => Body::empty(),
    };
    let r = app.clone().call(pedido.body(corpo).unwrap()).await.unwrap();
    let s = r.status();
    let b = to_bytes(r.into_body(), 1 << 22).await.unwrap();
    (s, serde_json::from_slice(&b).unwrap_or(Value::Null))
}

fn pacote() -> Value {
    // Assinatura PNG suficiente para a detecção por conteúdo (o Cofre não renderiza na migração).
    let png = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, [0x89u8, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0]);
    json!({
        "categories": [
            {"id":"c1","name":"Mercado Nexus","type":"expense","icon":"ShoppingBag","color":"#112233"},
            {"id":"c2","name":"Salário Nexus","type":"income","icon":null,"color":"zzz"},
            {"id":"c3","name":"Alimentação","type":"expense","icon":null,"color":"#e4636b"}
        ],
        "payees": [{"id":"p1","name":"Super Perim","document":null,"notes":null}],
        "accounts": [{"id":"a1","name":"Conta Nexus","bank":"Itaú","agency":"1","accountNumber":"2","color":"#8a05be"}],
        "recurringTransactions": [{"id":"r1","type":"expense","description":"Internet","amountCents":9990,"categoryId":"c1","payeeId":"p1","accountId":"a1","paymentMethod":"pix",
            "recurrenceKind":"fixed","frequency":"monthly","intervalCount":1,"dueDay":10,"startDate":"2026-01-10","endDate":null,"totalInstallments":null,"installmentsGenerated":8,"isActive":true}],
        "transactions": [
            {"id":"t1","type":"expense","amountCents":9990,"occurredAt":"2026-08-10","description":"Internet","categoryId":"c1","payeeId":"p1","accountId":"a1","paymentMethod":"pix","source":"recurring_generated","recurringTransactionId":"r1","isReconciled":true},
            {"id":"t2","type":"income","amountCents":500000,"occurredAt":"2026-09-05","description":"Salário","categoryId":"c2","isReconciled":false},
            {"id":"t3","type":"expense","amountCents":1500,"occurredAt":"2026-09-06","description":"Café","categoryId":"c3"},
            {"id":"t4","type":"expense","amountCents":1500,"occurredAt":"2026-09-06","description":"Café","categoryId":"c3"}
        ],
        "pendingItems": [{"id":"pe1","type":"expense","description":"IPVA","amountCents":120000,"categoryId":"c1","payeeId":null,"recurringTransactionId":null,"notes":null}],
        "recurringExclusions": [{"recurringTransactionId":"r1","occurrenceDate":"2026-03-10"}],
        "attachments": [
            {"id":"x1","transactionId":"t2","fileName":"holerite.png","contentBase64":png},
            {"id":"x2","transactionId":"t3","fileName":"sem-arquivo.pdf"}
        ]
    })
}

/// (receitas + despesas do ano, quantidade de lançamentos listados)
async fn estado(app: &Router) -> (i64, i64) {
    let (_, p) = chamar(app, "GET", "/vault/painel?data_de=2026-01-01&data_ate=2026-12-31", None).await;
    let (_, t) = chamar(app, "GET", "/vault/transacoes?limit=200", None).await;
    (p["receitas"].as_i64().unwrap() + p["despesas"].as_i64().unwrap(), t["items"].as_array().unwrap().len() as i64)
}

#[tokio::test]
async fn dry_run_nao_altera_aplicacao_confirma_e_reaplicar_nao_duplica() {
    let (app, config, raiz) = app();
    chamar(&app, "POST", "/vault/ativar", Some(json!({"senha":"senha-do-cofre"}))).await;
    let antes = estado(&app).await;

    // 1. Simulação: relatório completo, banco intacto, sem backup.
    let (st, sim) = chamar(&app, "POST", "/vault/migracao/nexus", Some(json!({"dry_run":true,"dados":pacote()}))).await;
    assert_eq!(st, StatusCode::OK, "{sim}");
    assert_eq!(sim["aplicado"], false);
    assert_eq!(sim["erros"].as_array().unwrap().len(), 0, "{sim}");
    assert_eq!(sim["entidades"]["lancamentos"]["criadas"], 4);
    assert_eq!(sim["entidades"]["categorias"]["reaproveitadas"], 1, "Alimentação já veio do catálogo do Cofre");
    assert_eq!(sim["entidades"]["categorias"]["criadas"], 2);
    assert_eq!(sim["entidades"]["anexos"]["criadas"], 1);
    assert_eq!(sim["entidades"]["anexos"]["ignoradas"], 1);
    assert_eq!(sim["verificacao"]["confere"], true);
    assert_eq!(estado(&app).await, antes, "simulação não pode gravar");
    let (_, cats) = chamar(&app, "GET", "/vault/categorias", None).await;
    assert!(!cats.as_array().unwrap().iter().any(|c| c["nome"] == "Mercado Nexus"));

    // 2. Aplicar sem a frase de confirmação não grava.
    let (st, _) = chamar(&app, "POST", "/vault/migracao/nexus", Some(json!({"dry_run":false,"dados":pacote()}))).await;
    assert_ne!(st, StatusCode::OK);
    assert_eq!(estado(&app).await, antes);

    // 3. Aplicar: dois "Café" iguais do próprio pacote são dois lançamentos; contagem e soma conferem; backup gerado.
    let (st, ap) = chamar(&app, "POST", "/vault/migracao/nexus", Some(json!({"dry_run":false,"confirmar":"MIGRAR NEXUS","dados":pacote()}))).await;
    assert_eq!(st, StatusCode::OK, "{ap}");
    assert_eq!(ap["aplicado"], true, "{ap}");
    assert_eq!(ap["verificacao"]["depois"]["lancamentos"], 4);
    assert_eq!(ap["verificacao"]["depois"]["entradas_centavos"], 500000);
    assert_eq!(ap["verificacao"]["depois"]["saidas_centavos"], 9990 + 1500 + 1500);
    let backup = ap["backup"].as_str().unwrap();
    assert!(config.backups_de("nx").join(backup).exists());
    let (_, txs) = chamar(&app, "GET", "/vault/transacoes?limit=50", None).await;
    let itens = txs["items"].as_array().unwrap();
    let internet = itens.iter().find(|t| t["descricao"] == "Internet").unwrap();
    assert_eq!(internet["conciliada"], true);
    assert_eq!(internet["origem"], "recorrencia_gerada");
    assert!(internet["transacao_recorrente_id"].is_string());
    let salario = itens.iter().find(|t| t["descricao"] == "Salário").unwrap();
    let (_, anexos) = chamar(&app, "GET", &format!("/vault/transacoes/{}/anexos", salario["id"].as_str().unwrap()), None).await;
    assert_eq!(anexos.as_array().unwrap().len(), 1);
    let (_, pend) = chamar(&app, "GET", "/vault/pendencias", None).await;
    assert_eq!(pend.as_array().unwrap().len(), 1);
    let depois = estado(&app).await;
    assert_eq!(depois.1, antes.1 + 4);

    // 4. Reaplicar o mesmo pacote: tudo "já migrado", nada novo.
    let (_, de_novo) = chamar(&app, "POST", "/vault/migracao/nexus", Some(json!({"dry_run":false,"confirmar":"MIGRAR NEXUS","dados":pacote()}))).await;
    assert_eq!(de_novo["aplicado"], true);
    assert_eq!(de_novo["entidades"]["lancamentos"]["criadas"], 0);
    assert_eq!(de_novo["entidades"]["lancamentos"]["ja_migradas"], 4);
    assert_eq!(de_novo["entidades"]["anexos"]["criadas"], 0);
    assert_eq!(de_novo["entidades"]["exclusoes"]["ja_migradas"], 1);
    assert_eq!(estado(&app).await, depois);
    let (_, pend) = chamar(&app, "GET", "/vault/pendencias", None).await;
    assert_eq!(pend.as_array().unwrap().len(), 1);

    drop(app);
    let _ = std::fs::remove_dir_all(raiz);
}

#[tokio::test]
async fn erro_em_qualquer_registro_desfaz_tudo_e_nao_deixa_backup() {
    let (app, config, raiz) = app();
    chamar(&app, "POST", "/vault/ativar", Some(json!({"senha":"senha-do-cofre"}))).await;
    let antes = estado(&app).await;
    let mut p = pacote();
    p["transactions"].as_array_mut().unwrap().push(json!({"id":"tx","type":"expense","amountCents":100,"occurredAt":"2026-09-07","description":"Órfão","categoryId":"inexistente"}));
    let (st, r) = chamar(&app, "POST", "/vault/migracao/nexus", Some(json!({"dry_run":false,"confirmar":"MIGRAR NEXUS","dados":p}))).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(r["aplicado"], false);
    assert_eq!(r["erros"].as_array().unwrap().len(), 1);
    assert_eq!(r["erros"][0]["id"], "tx");
    assert_eq!(estado(&app).await, antes);
    let (_, cats) = chamar(&app, "GET", "/vault/categorias", None).await;
    assert!(!cats.as_array().unwrap().iter().any(|c| c["nome"] == "Mercado Nexus"), "categorias do pacote não podem ficar");
    let sobrou = std::fs::read_dir(config.backups_de("nx")).map(|d| d.flatten().any(|e| e.file_name().to_string_lossy().starts_with("pre-migracao-nexus"))).unwrap_or(false);
    assert!(!sobrou, "backup de uma migração que não aplicou não deve ficar");
    drop(app);
    let _ = std::fs::remove_dir_all(raiz);
}
