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
