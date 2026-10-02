//! Um Cofre por pessoa: arquivo, senha e estado (aberto/trancado) independentes, e o cofre único das versões
//! anteriores passa ao primeiro usuário sem perder a senha. Roteador real + arquivos temporários.

use crate::{config::Config, db::VaultDb, routes, state::AppState};
use axum::{body::{to_bytes, Body}, http::{Request, StatusCode}, Router};
use ecos_core::new_id;
use std::sync::Arc;
use tower::Service;

fn app_de_teste() -> (Router, Arc<Config>, std::path::PathBuf) {
    let raiz = std::env::temp_dir().join(format!("ecos-cofre-{}", new_id()));
    let config = Arc::new(Config {
        porta: 0,
        db_path: raiz.join("vault/ecos-vault.db"),
        meta_path: raiz.join("vault/ecos-vault.meta.json"),
        backups_dir: raiz.join("backups"),
    });
    std::fs::create_dir_all(raiz.join("vault")).unwrap();
    std::fs::create_dir_all(raiz.join("backups")).unwrap();
    let state = AppState { db: VaultDb::trancado(), config: config.clone() };
    (routes::montar(state), config, raiz)
}

async fn chamar(app: &Router, usuario: Option<&str>, legado: bool, metodo: &str, uri: &str, corpo: Option<serde_json::Value>) -> (StatusCode, serde_json::Value) {
    let mut pedido = Request::builder().method(metodo).uri(uri);
    if let Some(u) = usuario { pedido = pedido.header("x-ecos-usuario", u); }
    if legado { pedido = pedido.header("x-ecos-dono-legado", "1"); }
    let corpo = match corpo {
        Some(c) => { pedido = pedido.header("content-type", "application/json"); Body::from(c.to_string()) }
        None => Body::empty(),
    };
    let resposta = app.clone().call(pedido.body(corpo).unwrap()).await.unwrap();
    let status = resposta.status();
    let bytes = to_bytes(resposta.into_body(), 1 << 20).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null))
}

fn senha(s: &str) -> Option<serde_json::Value> { Some(serde_json::json!({ "senha": s })) }

#[tokio::test]
async fn financeiro_importacao_dry_run_dedup_totais_e_lote_atomico() {
    use serde_json::json;
    let (app, _, raiz) = app_de_teste();
    chamar(&app,Some("fin"),false,"POST","/vault/ativar",senha("senha-financeiro")).await;
    let linhas: Vec<_>=(0..251).map(|i|json!({"linha":i+2,"tipo":"entrada","valor_centavos":12345,"data":"2026-09-30","descricao":format!("Receita {i}")})).collect();
    let (_,preview)=chamar(&app,Some("fin"),false,"POST","/vault/financeiro/importar",Some(json!({"linhas":linhas,"dry_run":true}))).await;
    assert_eq!(preview["validas"],251); assert_eq!(preview["importadas"],0);
    let (_,antes)=chamar(&app,Some("fin"),false,"GET","/vault/painel?data_de=2026-09-01&data_ate=2026-09-30",None).await;
    assert_eq!(antes["receitas"],0);
    let (_,import)=chamar(&app,Some("fin"),false,"POST","/vault/financeiro/importar",Some(json!({"linhas":linhas,"dry_run":false}))).await;
    assert_eq!(import["importadas"],251);
    let (_,dedup)=chamar(&app,Some("fin"),false,"POST","/vault/financeiro/importar",Some(json!({"linhas":linhas,"dry_run":false}))).await;
    assert_eq!(dedup["importadas"],0);assert_eq!(dedup["duplicadas"].as_array().unwrap().len(),251);
    let (_,painel)=chamar(&app,Some("fin"),false,"GET","/vault/painel?data_de=2026-09-01&data_ate=2026-09-30",None).await;
    assert_eq!(painel["receitas"],251*12345); assert_eq!(painel["saldo"],251*12345);
    let (_,page)=chamar(&app,Some("fin"),false,"GET","/vault/transacoes?limit=200",None).await;
    assert_eq!(page["items"].as_array().unwrap().len(),200);assert!(page["next_cursor"].is_string());
    let id=page["items"][0]["id"].as_str().unwrap();
    let (_,lote)=chamar(&app,Some("fin"),false,"POST","/vault/financeiro/lote",Some(json!({"ids":[id,"inexistente"],"acao":"conciliar"}))).await;
    assert_eq!(lote["aplicadas"],0);
    let (_,tx)=chamar(&app,Some("fin"),false,"GET",&format!("/vault/transacoes/{id}"),None).await;
    assert_eq!(tx["conciliada"],false);
    let (_,lote)=chamar(&app,Some("fin"),false,"POST","/vault/financeiro/lote",Some(json!({"ids":[id],"acao":"conciliar"}))).await;
    assert_eq!(lote["aplicadas"],1);
    let (_,csv)=chamar(&app,Some("fin"),false,"GET","/vault/financeiro/exportar?data_de=2026-09-01&data_ate=2026-09-30",None).await;
    assert!(csv["csv"].as_str().unwrap().starts_with('\u{feff}'));assert!(csv["csv"].as_str().unwrap().contains("123,45"));
    chamar(&app,Some("fin"),false,"POST","/vault/bloquear",None).await;
    assert_eq!(chamar(&app,Some("fin"),false,"GET","/vault/painel?data_de=2026-09-01&data_ate=2026-09-30",None).await.0,StatusCode::UNAUTHORIZED);
    drop(app);let _=std::fs::remove_dir_all(raiz);
}

#[tokio::test]
async fn financeiro_pendencia_e_recorrencia_sao_idempotentes_apos_reagendar() {
    use serde_json::json;
    let (app, _, raiz) = app_de_teste();
    chamar(&app,Some("fluxo"),false,"POST","/vault/ativar",senha("senha-financeiro")).await;
    let (_,p)=chamar(&app,Some("fluxo"),false,"POST","/vault/pendencias",Some(json!({"tipo":"saida","descricao":"Conta","valor_centavos":500}))).await;
    let path=format!("/vault/pendencias/{}/converter",p["id"].as_str().unwrap());
    let (a,b)=tokio::join!(chamar(&app,Some("fluxo"),false,"POST",&path,Some(json!({"data":"2026-09-20"}))),chamar(&app,Some("fluxo"),false,"POST",&path,Some(json!({"data":"2026-09-20"}))));
    assert_eq!(a.0,StatusCode::OK);assert_eq!(a.1["transacao_id"],b.1["transacao_id"]);
    let (_,r)=chamar(&app,Some("fluxo"),false,"POST","/vault/recorrencias",Some(json!({"tipo":"saida","descricao":"Mensal","valor_centavos":1000,"data_inicio":"2026-01-31","tipo_recorrencia":"parcelada","total_parcelas":4}))).await;
    let (_,oc)=chamar(&app,Some("fluxo"),false,"GET","/vault/fluxo/ocorrencias?data_de=2026-01-01&data_ate=2026-04-30",None).await;
    assert_eq!(oc[1]["data"],"2026-02-28");assert_eq!(oc[2]["data"],"2026-03-31");
    let path=format!("/vault/recorrencias/{}/concluir",r["id"].as_str().unwrap());
    let (_,a)=chamar(&app,Some("fluxo"),false,"POST",&path,Some(json!({"data_ocorrencia":"2026-02-28","data":"2026-03-05"}))).await;
    let (_,b)=chamar(&app,Some("fluxo"),false,"POST",&path,Some(json!({"data_ocorrencia":"2026-02-28","data":"2026-03-05"}))).await;
    assert_eq!(a["transacao_id"],b["transacao_id"]);
    let (_,oc)=chamar(&app,Some("fluxo"),false,"GET","/vault/fluxo/ocorrencias?data_de=2026-01-01&data_ate=2026-04-30",None).await;
    assert_eq!(oc.as_array().unwrap().len(),3);
    let (_,tx)=chamar(&app,Some("fluxo"),false,"GET","/vault/transacoes",None).await;
    assert_eq!(tx["items"].as_array().unwrap().len(),2);
    drop(app);let _=std::fs::remove_dir_all(raiz);
}

#[tokio::test]
async fn financeiro_importacao_invalida_nao_grava_linhas_validas() {
    use serde_json::json;
    let (app, _, raiz) = app_de_teste();
    chamar(&app,Some("csv"),false,"POST","/vault/ativar",senha("senha-financeiro")).await;
    let (_,r)=chamar(&app,Some("csv"),false,"POST","/vault/financeiro/importar",Some(json!({"dry_run":false,"linhas":[
        {"linha":2,"tipo":"entrada","valor_centavos":100,"data":"2026-09-30","descricao":"Válida"},
        {"linha":3,"tipo":"entrada","valor_centavos":100,"data":"2026-02-30","descricao":"Inválida"}
    ]}))).await;
    assert_eq!(r["importadas"],0);assert_eq!(r["erros"][0]["linha"],3);
    let (_,tx)=chamar(&app,Some("csv"),false,"GET","/vault/transacoes",None).await;
    assert!(tx["items"].as_array().unwrap().is_empty());
    drop(app);let _=std::fs::remove_dir_all(raiz);
}

#[tokio::test]
async fn cada_pessoa_tem_o_proprio_cofre_com_senha_e_dados_separados() {
    let (app, config, raiz) = app_de_teste();

    // Sem identificação (ou com id que tentaria sair da pasta) não há acesso a nada; o liveness segue aberto.
    assert_eq!(chamar(&app, None, false, "GET", "/vault/contas", None).await.0, StatusCode::UNAUTHORIZED);
    assert_eq!(chamar(&app, Some("../x"), false, "GET", "/vault/contas", None).await.0, StatusCode::UNAUTHORIZED);
    assert_eq!(chamar(&app, None, false, "GET", "/health", None).await.0, StatusCode::OK);

    // Cada uma ativa o seu, com senhas diferentes.
    assert_eq!(chamar(&app, Some("diogo"), false, "POST", "/vault/ativar", senha("senha-do-diogo")).await.0, StatusCode::OK);
    assert_eq!(chamar(&app, Some("thaty"), false, "POST", "/vault/ativar", senha("senha-da-thaty")).await.0, StatusCode::OK);
    assert_eq!(chamar(&app, Some("diogo"), false, "POST", "/vault/ativar", senha("outra-senha-qualquer")).await.0, StatusCode::CONFLICT, "não reativa o próprio cofre");
    assert!(config.db_de("diogo").is_file() && config.db_de("thaty").is_file());
    assert_ne!(config.db_de("diogo"), config.db_de("thaty"));

    // Os dados de uma não aparecem para a outra.
    let (st, _) = chamar(&app, Some("diogo"), false, "POST", "/vault/contas", Some(serde_json::json!({ "nome": "Conta do Diogo" }))).await;
    assert_eq!(st, StatusCode::OK);
    let (_, contas) = chamar(&app, Some("diogo"), false, "GET", "/vault/contas", None).await;
    assert_eq!(contas.as_array().unwrap().len(), 1);
    let (_, contas) = chamar(&app, Some("thaty"), false, "GET", "/vault/contas", None).await;
    assert!(contas.as_array().unwrap().is_empty(), "a Thaty não vê a conta do Diogo");

    // Trancar é individual: o Diogo tranca e a Thaty segue com o dela aberto.
    assert_eq!(chamar(&app, Some("diogo"), false, "POST", "/vault/bloquear", None).await.0, StatusCode::OK);
    assert_ne!(chamar(&app, Some("diogo"), false, "GET", "/vault/contas", None).await.0, StatusCode::OK, "trancado");
    assert_eq!(chamar(&app, Some("thaty"), false, "GET", "/vault/contas", None).await.0, StatusCode::OK);
    // (Que a senha da Thaty não abra o cofre do Diogo depende da cifra real, `--features real-sqlcipher`: esta
    // build de teste é SQLite puro, como avisa `crypto.rs`. Aqui vale só a separação de arquivos e de estado.)
    assert_eq!(chamar(&app, Some("diogo"), false, "POST", "/vault/desbloquear", senha("senha-do-diogo")).await.0, StatusCode::OK);

    // Backup manual vai para a pasta de quem pediu.
    assert_eq!(chamar(&app, Some("diogo"), false, "POST", "/vault/backup/exportar", None).await.0, StatusCode::OK);
    assert_eq!(std::fs::read_dir(config.backups_de("diogo")).unwrap().count(), 1);
    assert!(!config.backups_de("thaty").exists());
    let (_, historico) = chamar(&app, Some("thaty"), false, "GET", "/vault/backup/historico", None).await;
    assert!(historico.as_array().unwrap().is_empty());

    // Reset atinge só o próprio cofre.
    let (st, _) = chamar(&app, Some("thaty"), false, "POST", "/vault/contas", Some(serde_json::json!({ "nome": "Conta da Thaty" }))).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(chamar(&app, Some("diogo"), false, "POST", "/vault/reset", Some(serde_json::json!({ "confirm": "APAGAR TUDO" }))).await.0, StatusCode::OK);
    let (_, contas) = chamar(&app, Some("diogo"), false, "GET", "/vault/contas", None).await;
    assert!(contas.as_array().unwrap().is_empty());
    let (_, contas) = chamar(&app, Some("thaty"), false, "GET", "/vault/contas", None).await;
    assert_eq!(contas.as_array().unwrap().len(), 1, "o reset do Diogo não apaga a conta da Thaty");

    // Excluir cofre (exclusão da conta): trancado recusa; aberto apaga tudo dela e só dela.
    let frase = Some(serde_json::json!({ "confirm": "APAGAR TUDO" }));
    assert!(!chamar(&app, Some("thaty"), false, "POST", "/vault/excluir", Some(serde_json::json!({ "confirm": "errada" }))).await.0.is_success());
    assert_eq!(chamar(&app, Some("thaty"), false, "POST", "/vault/bloquear", None).await.0, StatusCode::OK);
    assert!(!chamar(&app, Some("thaty"), false, "POST", "/vault/excluir", frase.clone()).await.0.is_success(), "trancado não exclui");
    assert!(config.db_de("thaty").is_file());
    assert_eq!(chamar(&app, Some("thaty"), false, "POST", "/vault/desbloquear", senha("senha-da-thaty")).await.0, StatusCode::OK);
    assert_eq!(chamar(&app, Some("thaty"), false, "POST", "/vault/excluir", frase.clone()).await.0, StatusCode::OK);
    assert!(!config.dir_do_usuario("thaty").exists() && !config.backups_de("thaty").exists());
    assert!(config.db_de("diogo").is_file(), "o cofre do Diogo segue intacto");
    // Quem nunca ativou o cofre exclui sem drama.
    let (st, r) = chamar(&app, Some("visita"), false, "POST", "/vault/excluir", frase).await;
    assert_eq!((st, r["existia"].as_bool()), (StatusCode::OK, Some(false)));

    let _ = std::fs::remove_dir_all(&raiz);
}

#[tokio::test]
async fn o_cofre_unico_anterior_passa_ao_primeiro_usuario_com_a_mesma_senha() {
    let (app, config, raiz) = app_de_teste();

    // Como era antes: um cofre só, na raiz. Crio via um usuário temporário e movo os arquivos de volta para o layout antigo.
    assert_eq!(chamar(&app, Some("tmp"), false, "POST", "/vault/ativar", senha("senha-antiga-do-dono")).await.0, StatusCode::OK);
    chamar(&app, Some("tmp"), false, "POST", "/vault/contas", Some(serde_json::json!({ "nome": "Conta antiga" }))).await;
    chamar(&app, Some("tmp"), false, "POST", "/vault/backup/exportar", None).await;
    chamar(&app, Some("tmp"), false, "POST", "/vault/bloquear", None).await;
    std::fs::rename(config.db_de("tmp"), &config.db_path).unwrap();
    std::fs::rename(config.meta_de("tmp"), &config.meta_path).unwrap();
    for e in std::fs::read_dir(config.backups_de("tmp")).unwrap().flatten() {
        std::fs::rename(e.path(), config.backups_dir.join(e.file_name())).unwrap();
    }
    std::fs::remove_dir_all(config.dir_do_usuario("tmp")).unwrap();
    std::fs::remove_dir_all(config.backups_de("tmp")).unwrap();

    // Um segundo usuário (que NÃO é o dono) não herda nada: ativa o dele do zero e o legado continua no lugar.
    assert_eq!(chamar(&app, Some("thaty"), false, "POST", "/vault/ativar", senha("senha-da-thaty")).await.0, StatusCode::OK);
    assert!(config.db_path.is_file(), "o cofre antigo não foi tocado por quem não é o dono");
    assert!(chamar(&app, Some("thaty"), false, "GET", "/vault/contas", None).await.1.as_array().unwrap().is_empty());

    // O primeiro usuário (o `ecos-app` marca com o cabeçalho) recebe o cofre antigo, backups incluídos.
    let (st, _) = chamar(&app, Some("diogo"), true, "POST", "/vault/desbloquear", senha("senha-antiga-do-dono")).await;
    assert_eq!(st, StatusCode::OK);
    assert!(!config.db_path.exists() && !config.meta_path.exists(), "saiu da raiz");
    assert!(config.db_de("diogo").is_file());
    assert_eq!(std::fs::read_dir(config.backups_de("diogo")).unwrap().count(), 1);
    let (_, contas) = chamar(&app, Some("diogo"), true, "GET", "/vault/contas", None).await;
    assert_eq!(contas[0]["nome"], "Conta antiga");
    // E o cabeçalho num pedido seguinte não faz nada (idempotente, não sobrescreve).
    assert_eq!(chamar(&app, Some("diogo"), true, "GET", "/vault/contas", None).await.0, StatusCode::OK);

    let _ = std::fs::remove_dir_all(&raiz);
}

#[tokio::test]
async fn a_autoria_vem_do_pedido_e_nao_muda_na_edicao() {
    use serde_json::json;
    let (app, _, raiz) = app_de_teste();
    chamar(&app, Some("eq_x"), false, "POST", "/vault/ativar", senha("senha-da-equipe")).await;
    let como = |autor: &'static str, metodo: &'static str, uri: String, corpo: serde_json::Value| {
        let app = app.clone();
        async move {
            let pedido = Request::builder().method(metodo).uri(uri).header("x-ecos-usuario", "eq_x").header("x-ecos-autor", autor).header("content-type", "application/json");
            let r = app.clone().call(pedido.body(Body::from(corpo.to_string())).unwrap()).await.unwrap();
            serde_json::from_slice::<serde_json::Value>(&to_bytes(r.into_body(), 1 << 20).await.unwrap()).unwrap_or_default()
        }
    };
    let nova = como("ana", "POST", "/vault/transacoes".into(), json!({"tipo":"saida","valor_centavos":100,"data":"2026-09-30","descricao":"Mercado","criado_por":"outra"})).await;
    assert_eq!(nova["criado_por"], "ana", "o corpo não define a autoria");
    let id = nova["id"].as_str().unwrap().to_string();
    let editada = como("beto", "PATCH", format!("/vault/transacoes/{id}"), json!({"tipo":"saida","valor_centavos":200,"data":"2026-09-30","descricao":"Mercado 2","criado_por":"beto"})).await;
    assert_eq!(editada["criado_por"], "ana", "editar não troca o autor");
    let conta = como("beto", "POST", "/vault/contas".into(), json!({"nome":"Corrente"})).await;
    let (_, contas) = chamar(&app, Some("eq_x"), false, "GET", "/vault/contas", None).await;
    assert_eq!(contas[0]["criado_por"], "beto");
    assert!(conta["id"].is_string());
    drop(app);
    let _ = std::fs::remove_dir_all(raiz);
}
