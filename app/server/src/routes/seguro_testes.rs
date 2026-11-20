//! Pastas trancadas de ponta a ponta: o que está dentro de pasta trancada e fechada some de todo o app (listas, busca,
//! métricas, tarefas, arquivos, exportação), não se escreve nela, e as regras de senha (mestra/própria), um nível só e prazo.

use crate::{auth::{password, session}, config::{Ambiente, Config}, db::IndexDb, state::AppState};
use axum::{body::{to_bytes, Body}, http::{Request, StatusCode}, Router};
use ecos_core::new_id;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use tower::Service;

async fn chamar_bytes(app: &Router, metodo: &str, uri: &str, token: &str, corpo: Option<Value>) -> (StatusCode, Vec<u8>) {
    let mut pedido = Request::builder().method(metodo).uri(uri).header("authorization", format!("Bearer {token}"));
    let corpo = match corpo {
        Some(c) => { pedido = pedido.header("content-type", "application/json"); Body::from(c.to_string()) }
        None => Body::empty(),
    };
    let resposta = app.clone().call(pedido.body(corpo).unwrap()).await.unwrap();
    let status = resposta.status();
    (status, to_bytes(resposta.into_body(), 16 * 1024 * 1024).await.unwrap().to_vec())
}

async fn chamar(app: &Router, metodo: &str, uri: &str, token: &str, corpo: Option<Value>) -> (StatusCode, Value) {
    let (status, bytes) = chamar_bytes(app, metodo, uri, token, corpo).await;
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

struct Cenario { app: Router, state: AppState, token: String }

async fn cenario() -> Cenario {
    let temp = std::env::temp_dir().join(format!("ecos-trancas-{}", new_id()));
    std::fs::create_dir_all(&temp).unwrap();
    let segredo = b"segredo-efemero-exclusivo-do-teste-de-trancas".to_vec();
    let state = AppState {
        db: IndexDb::open(&temp.join("index.db")).unwrap(),
        config: Arc::new(Config {
            ambiente: Ambiente::Desenvolvimento, porta: 0, notes_root: temp.join("notas"), index_db_path: temp.join("index.db"),
            vault_enabled: false, vault_internal_url: String::new(), session_secret: segredo.clone(), ranking_interval_secs: 300,
            static_dir: None, cookie_secure: false, google: None,
        }),
        http: reqwest::Client::new(), pareamentos: Arc::new(Mutex::new(Default::default())),
    };
    std::fs::create_dir_all(&state.config.notes_root).unwrap();
    let hash_conta = password::hash("senha-da-conta-123").unwrap();
    state.db.with(move |c| {
        c.execute("INSERT INTO usuario (id, nome_usuario, senha_hash, recovery_key_hash) VALUES ('U1', 'diogo', ?1, 'x'), ('U2', 'thaty', ?1, 'x')", [&hash_conta])?;
        Ok(())
    }).await.unwrap();
    let app = crate::routes::montar(state.clone());
    let token = session::emitir_access_token("U1", &segredo).unwrap();
    Cenario { app, state, token }
}

/// Lista as notas de todas as pastas do cenário (a listagem do app é por pasta).
async fn todas_notas(app: &Router, token: &str) -> Value {
    let mut tudo = vec![];
    for pasta in ["", "Diário", "Diário/2026", "Casa", "Aberta"] {
        let uri = if pasta.is_empty() { "/api/v1/notas".to_string() } else { format!("/api/v1/notas?pasta={}", pasta.replace('á', "%C3%A1").replace('í', "%C3%AD")) };
        let (_, v) = chamar(app, "GET", &uri, token, None).await;
        tudo.extend(v["items"].as_array().cloned().unwrap_or_default());
    }
    json!({ "items": tudo })
}

fn contem(v: &Value, trecho: &str) -> bool { v.to_string().contains(trecho) }

#[tokio::test]
async fn pasta_trancada_some_do_app_inteiro_e_nao_aceita_escrita() {
    let Cenario { app, state, token } = cenario().await;
    let t = token.as_str();

    // Estrutura: "Diário" (com subpasta), "Casa" e uma pasta aberta.
    for (nome, pai) in [("Diário", None), ("Casa", None), ("Aberta", None), ("2026", Some("Diário"))] {
        let (st, r) = chamar(&app, "POST", "/api/v1/pastas", t, Some(json!({ "nome": nome, "tipo": "nota", "pasta_pai": pai }))).await;
        assert_eq!(st, StatusCode::OK, "{r}");
    }
    let (st, n) = chamar(&app, "POST", "/api/v1/notas", t, Some(json!({ "titulo": "Querido diário", "corpo": "segredodiarioxyz", "pasta": "Diário/2026" }))).await;
    assert_eq!(st, StatusCode::OK, "{n}");
    let id_nota = n["id"].as_str().unwrap().to_string();
    let (_, tarefa) = chamar(&app, "POST", "/api/v1/tarefas", t, Some(json!({ "titulo": "Ligar para o advogado-xyz", "pasta": "Diário", "due_date": "2026-12-01" }))).await;
    chamar(&app, "POST", "/api/v1/notas", t, Some(json!({ "titulo": "Nota pública", "corpo": "textopublicoabc", "pasta": "Aberta" }))).await;
    chamar(&app, "POST", "/api/v1/notas", t, Some(json!({ "titulo": "Obra da casa", "corpo": "segredo-da-casa-xyz", "pasta": "Casa" }))).await;

    // Sem senha-mestra não dá para trancar com ela.
    let (st, _) = chamar(&app, "POST", "/api/v1/seguro/pastas", t, Some(json!({ "pasta": "Diário" }))).await;
    assert_eq!(st, StatusCode::CONFLICT);
    // Pasta inexistente / caminho perigoso.
    chamar(&app, "POST", "/api/v1/seguro/configurar", t, Some(json!({ "senha": "mestra-do-diogo" }))).await;
    let (st, _) = chamar(&app, "POST", "/api/v1/seguro/pastas", t, Some(json!({ "pasta": "Nao/existe" }))).await;
    assert_eq!(st, StatusCode::NOT_FOUND);
    let (st, _) = chamar(&app, "POST", "/api/v1/seguro/pastas", t, Some(json!({ "pasta": "../x" }))).await;
    assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY);

    // Tranca "Diário" (e, por herança, "Diário/2026"). A mestra está aberta (acabou de ser criada): segue visível.
    let (st, e) = chamar(&app, "POST", "/api/v1/seguro/pastas", t, Some(json!({ "pasta": "Diário" }))).await;
    assert_eq!(st, StatusCode::OK, "{e}");
    assert_eq!(e["pastas"][0]["pasta"], "Diário");
    let notas = todas_notas(&app, t).await;
    assert!(contem(&notas, "Querido diário"), "aberta: a nota aparece {notas}");

    // Um nível só: nem dentro de pasta trancada, nem pasta que contenha uma trancada.
    let (st, _) = chamar(&app, "POST", "/api/v1/seguro/pastas", t, Some(json!({ "pasta": "Diário/2026" }))).await;
    assert_eq!(st, StatusCode::CONFLICT);
    // O cadeado não deixa renomear a própria pasta.
    let (st, _) = chamar(&app, "PATCH", "/api/v1/pastas", t, Some(json!({ "tipo": "nota", "caminho_atual": "Diário", "novo_caminho": "Outro" }))).await;
    assert_eq!(st, StatusCode::CONFLICT);

    // Tranca de verdade.
    let (st, e) = chamar(&app, "POST", "/api/v1/seguro/trancar", t, Some(json!({}))).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(e["pastas"][0]["aberta"], false);

    // Nada do conteúdo trancado aparece, em lugar nenhum.
    let notas = todas_notas(&app, t).await;
    assert!(!contem(&notas, "Querido diário") && contem(&notas, "Nota pública"), "{notas}");
    let (_, tarefas) = chamar(&app, "GET", "/api/v1/tarefas", t, None).await;
    assert!(!contem(&tarefas, "advogado-xyz"), "{tarefas}");
    let (_, busca) = chamar(&app, "GET", "/api/v1/busca?q=segredodiarioxyz", t, None).await;
    assert!(!contem(&busca, "Querido") && !contem(&busca, "segredodiario"), "{busca}");
    let (_, busca) = chamar(&app, "GET", "/api/v1/busca?q=textopublicoabc", t, None).await;
    assert!(contem(&busca, "Nota pública"), "controle positivo da busca: {busca}");
    let (st, _) = chamar(&app, "GET", &format!("/api/v1/notas/{id_nota}"), t, None).await;
    assert_eq!(st, StatusCode::NOT_FOUND);
    let (_, metricas) = chamar(&app, "GET", "/api/v1/me/metricas?escopo=pessoal", t, None).await;
    assert_eq!((metricas["notas"].as_i64(), metricas["tarefas"].as_i64()), (Some(2), Some(0)), "só Nota pública e Obra da casa: {metricas}");
    let (_, grafico) = chamar(&app, "GET", "/api/v1/grafico", t, None).await;
    assert!(!contem(&grafico, "Querido diário"), "{grafico}");
    let (_, tags) = chamar(&app, "GET", "/api/v1/tags?espaco=pessoal", t, None).await;
    assert!(!contem(&tags, "diário"), "{tags}");

    // Arquivos: o nome da pasta aparece, o conteúdo não; subpastas de pasta trancada também somem da árvore.
    let (st, raiz) = chamar(&app, "GET", "/api/v1/arquivos?espaco=pessoal", t, None).await;
    assert_eq!(st, StatusCode::OK);
    assert!(contem(&raiz, "Diário"), "o nome da pasta trancada continua visível: {raiz}");
    let (st, e) = chamar(&app, "GET", "/api/v1/arquivos?espaco=pessoal&pasta=Di%C3%A1rio", t, None).await;
    assert_eq!((st, e["error"].as_str()), (StatusCode::LOCKED, Some("FOLDER_LOCKED")), "{e}");
    let (st, _) = chamar(&app, "GET", "/api/v1/arquivos?espaco=pessoal&pasta=Di%C3%A1rio/2026", t, None).await;
    assert_eq!(st, StatusCode::LOCKED);
    let (_, bytes) = chamar_bytes(&app, "GET", "/api/v1/arquivos/conteudo?espaco=pessoal&caminho=Di%C3%A1rio/2026/note-Querido%20di%C3%A1rio.md", t, None).await;
    assert!(!String::from_utf8_lossy(&bytes).contains("segredodiario"), "conteúdo do arquivo vazou");
    let (_, pastas) = chamar(&app, "GET", "/api/v1/pastas?tipo=nota&recursivo=true", t, None).await;
    assert!(contem(&pastas, "\"Diário\"") && !contem(&pastas, "Diário/2026"), "subpasta de pasta trancada aparece: {pastas}");

    // Escrita: criar dentro, mover para dentro ou para fora, criar subpasta, enviar — tudo 423.
    let (st, _) = chamar(&app, "POST", "/api/v1/notas", t, Some(json!({ "titulo": "Intrusa", "pasta": "Diário" }))).await;
    assert_eq!(st, StatusCode::LOCKED);
    let (st, _) = chamar(&app, "POST", "/api/v1/tarefas", t, Some(json!({ "titulo": "Intrusa", "pasta": "Diário/2026" }))).await;
    assert_eq!(st, StatusCode::LOCKED);
    let (st, _) = chamar(&app, "POST", "/api/v1/pastas", t, Some(json!({ "nome": "Nova", "tipo": "nota", "pasta_pai": "Diário" }))).await;
    assert_eq!(st, StatusCode::LOCKED);
    let (st, _) = chamar(&app, "POST", "/api/v1/arquivos/mover", t, Some(json!({ "itens": ["Aberta"], "destino": "Diário" }))).await;
    assert_eq!(st, StatusCode::LOCKED);
    let (st, _) = chamar(&app, "POST", "/api/v1/arquivos/mover", t, Some(json!({ "itens": ["Diário/2026"], "destino": "Aberta" }))).await;
    assert_eq!(st, StatusCode::LOCKED);
    let (st, _) = chamar(&app, "POST", "/api/v1/arquivos/excluir", t, Some(json!({ "itens": ["Diário/2026"] }))).await;
    assert_eq!(st, StatusCode::LOCKED);
    // O conteúdo trancado fica fora da exportação (o pacote sai sem pedir a senha).
    chamar(&app, "POST", "/api/v1/seguro/desbloquear", t, Some(json!({ "senha": "mestra-do-diogo" }))).await;
    let (st, zip) = chamar_bytes(&app, "GET", "/api/v1/me/export", t, None).await;
    assert_eq!(st, StatusCode::OK);
    let texto = String::from_utf8_lossy(&zip);
    assert!(texto.contains("textopublicoabc"), "controle positivo: o pacote guarda o texto das notas abertas");
    assert!(!texto.contains("segredodiarioxyz"), "exportação levou conteúdo trancado");
    chamar(&app, "POST", "/api/v1/seguro/trancar", t, Some(json!({}))).await;

    // Senha errada não abre; certa abre tudo da mestra; renomear/mover de dentro de pasta aberta funciona.
    let (st, e) = chamar(&app, "POST", "/api/v1/seguro/desbloquear", t, Some(json!({ "senha": "errada-errada" }))).await;
    assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY, "{e}");
    let notas = todas_notas(&app, t).await;
    assert!(!contem(&notas, "Querido diário"));
    let (st, e) = chamar(&app, "POST", "/api/v1/seguro/desbloquear", t, Some(json!({ "senha": "mestra-do-diogo" }))).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(e["pastas"][0]["aberta"], true);
    let notas = todas_notas(&app, t).await;
    assert!(contem(&notas, "Querido diário"), "{notas}");
    let (st, _) = chamar(&app, "GET", &format!("/api/v1/notas/{id_nota}"), t, None).await;
    assert_eq!(st, StatusCode::OK);
    let (st, _) = chamar(&app, "GET", "/api/v1/arquivos?espaco=pessoal&pasta=Di%C3%A1rio", t, None).await;
    assert_eq!(st, StatusCode::OK);

    // Prazo: vencido = trancada de novo; acessar com a pasta aberta renova.
    state.db.with(|c| c.execute("UPDATE pasta_aberta SET ate = CAST(strftime('%s','now') AS INTEGER) - 1", [])).await.unwrap();
    let (st, _) = chamar(&app, "GET", &format!("/api/v1/notas/{id_nota}"), t, None).await;
    assert_eq!(st, StatusCode::NOT_FOUND, "vencido: some");
    chamar(&app, "POST", "/api/v1/seguro/desbloquear", t, Some(json!({ "senha": "mestra-do-diogo" }))).await;
    state.db.with(|c| c.execute("UPDATE pasta_aberta SET ate = CAST(strftime('%s','now') AS INTEGER) + 5", [])).await.unwrap();
    let (st, _) = chamar(&app, "GET", "/api/v1/arquivos?espaco=pessoal&pasta=Di%C3%A1rio", t, None).await;
    assert_eq!(st, StatusCode::OK);
    let ate: i64 = state.db.with_read(|c| c.query_row("SELECT ate - CAST(strftime('%s','now') AS INTEGER) FROM pasta_aberta", [], |r| r.get(0))).await.unwrap();
    assert!(ate > 100, "o acesso renovou o prazo (restam {ate}s)");

    // Senha própria: "Casa" com senha só dela; a mestra não a abre e ela não abre as da mestra.
    let (st, e) = chamar(&app, "POST", "/api/v1/seguro/pastas", t, Some(json!({ "pasta": "Casa", "senha": "senha-da-casa-1" }))).await;
    assert_eq!(st, StatusCode::OK, "{e}");
    assert_eq!(e["pastas"].as_array().unwrap().iter().find(|p| p["pasta"] == "Casa").unwrap()["propria"], true);
    chamar(&app, "POST", "/api/v1/seguro/trancar", t, Some(json!({ "pasta": "Casa" }))).await;
    let notas = todas_notas(&app, t).await;
    assert!(!contem(&notas, "Obra da casa") && contem(&notas, "Querido diário"), "fechar a Casa não fecha o Diário (mestra): {notas}");
    let (st, _) = chamar(&app, "POST", "/api/v1/seguro/desbloquear", t, Some(json!({ "senha": "mestra-do-diogo", "pasta": "Casa" }))).await;
    assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY, "a mestra não abre pasta de senha própria");
    let (st, _) = chamar(&app, "POST", "/api/v1/seguro/desbloquear", t, Some(json!({ "senha": "senha-da-casa-1", "pasta": "Casa" }))).await;
    assert_eq!(st, StatusCode::OK);
    let notas = todas_notas(&app, t).await;
    assert!(contem(&notas, "Obra da casa"));

    // Tarefas de pasta trancada: somem; com a opção ligada, aparecem mascaradas.
    chamar(&app, "POST", "/api/v1/seguro/trancar", t, Some(json!({}))).await;
    let (_, tarefas) = chamar(&app, "GET", "/api/v1/tarefas", t, None).await;
    assert!(tarefas["items"].as_array().map_or(true, |a| a.is_empty()), "{tarefas}");
    let (st, _) = chamar(&app, "PATCH", "/api/v1/seguro/config", t, Some(json!({ "mostrar_tarefas": true }))).await;
    assert_eq!(st, StatusCode::OK);
    let (_, tarefas) = chamar(&app, "GET", "/api/v1/tarefas", t, None).await;
    let lista = tarefas["items"].as_array().unwrap();
    assert_eq!(lista.len(), 1, "{tarefas}");
    assert_eq!((lista[0]["titulo"].as_str(), lista[0]["privada"].as_bool()), (Some("Tarefa privada"), Some(true)));
    assert!(!contem(&tarefas, "advogado") && !contem(&tarefas, "Diário"), "a tarefa mascarada vazou título ou pasta: {tarefas}");
    assert_eq!(lista[0]["due_date"], "2026-12-01", "a data continua (é o que a Agenda precisa)");
    let id_tarefa = tarefa["id"].as_str().unwrap();
    let (st, _) = chamar(&app, "GET", &format!("/api/v1/tarefas/{id_tarefa}"), t, None).await;
    assert_eq!(st, StatusCode::NOT_FOUND, "abrir a tarefa mascarada continua exigindo a senha");

    // Tirar o cadeado só com a pasta aberta; filha herda e não se destranca sozinha.
    let (st, _) = chamar(&app, "DELETE", "/api/v1/seguro/pastas", t, Some(json!({ "pasta": "Diário" }))).await;
    assert_eq!(st, StatusCode::LOCKED);
    chamar(&app, "POST", "/api/v1/seguro/desbloquear", t, Some(json!({ "senha": "mestra-do-diogo" }))).await;
    let (st, _) = chamar(&app, "DELETE", "/api/v1/seguro/pastas", t, Some(json!({ "pasta": "Diário/2026" }))).await;
    assert_eq!(st, StatusCode::NOT_FOUND);
    let (st, e) = chamar(&app, "DELETE", "/api/v1/seguro/pastas", t, Some(json!({ "pasta": "Diário" }))).await;
    assert_eq!(st, StatusCode::OK, "{e}");
    assert!(e["pastas"].as_array().unwrap().iter().all(|p| p["pasta"] != "Diário"));
    chamar(&app, "POST", "/api/v1/seguro/trancar", t, Some(json!({}))).await;
    let notas = todas_notas(&app, t).await;
    assert!(contem(&notas, "Querido diário"), "sem cadeado, volta ao normal mesmo com tudo trancado");

    // Redefinir a senha própria com a senha da conta; os textos continuam.
    let (st, _) = chamar(&app, "POST", "/api/v1/seguro/redefinir", t, Some(json!({ "senha_conta": "errada", "nova": "nova-senha-casa", "pasta": "Casa" }))).await;
    assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY);
    let (st, _) = chamar(&app, "POST", "/api/v1/seguro/redefinir", t, Some(json!({ "senha_conta": "senha-da-conta-123", "nova": "nova-senha-casa", "pasta": "Casa" }))).await;
    assert_eq!(st, StatusCode::OK);
    let (st, _) = chamar(&app, "POST", "/api/v1/seguro/desbloquear", t, Some(json!({ "senha": "senha-da-casa-1", "pasta": "Casa" }))).await;
    assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY, "a senha antiga não vale mais");
    let (st, _) = chamar(&app, "POST", "/api/v1/seguro/desbloquear", t, Some(json!({ "senha": "nova-senha-casa", "pasta": "Casa" }))).await;
    assert_eq!(st, StatusCode::OK);
    let notas = todas_notas(&app, t).await;
    assert!(contem(&notas, "Obra da casa"));
}

#[tokio::test]
async fn cadeado_de_uma_pessoa_nao_afeta_a_outra() {
    let Cenario { app, state, token } = cenario().await;
    let outra = session::emitir_access_token("U2", &state.config.session_secret).unwrap();
    chamar(&app, "POST", "/api/v1/pastas", &token, Some(json!({ "nome": "Diário", "tipo": "nota" }))).await;
    chamar(&app, "POST", "/api/v1/pastas", &outra, Some(json!({ "nome": "Diário", "tipo": "nota" }))).await;
    chamar(&app, "POST", "/api/v1/notas", &token, Some(json!({ "titulo": "Do Diogo", "pasta": "Diário" }))).await;
    chamar(&app, "POST", "/api/v1/notas", &outra, Some(json!({ "titulo": "Da Thaty", "pasta": "Diário" }))).await;
    chamar(&app, "POST", "/api/v1/seguro/configurar", &token, Some(json!({ "senha": "mestra-do-diogo" }))).await;
    chamar(&app, "POST", "/api/v1/seguro/pastas", &token, Some(json!({ "pasta": "Diário" }))).await;
    chamar(&app, "POST", "/api/v1/seguro/trancar", &token, Some(json!({}))).await;
    let dele = todas_notas(&app, &token).await;
    let dela = todas_notas(&app, &outra).await;
    assert!(!contem(&dele, "Do Diogo"), "{dele}");
    assert!(contem(&dela, "Da Thaty") && !contem(&dela, "Do Diogo"), "o cadeado dele não tranca a pasta dela: {dela}");
    let (_, status) = chamar(&app, "GET", "/api/v1/seguro/status", &outra, None).await;
    assert_eq!((status["mestra"]["configurada"].as_bool(), status["pastas"].as_array().map(Vec::len)), (Some(false), Some(0)));
    // Ela não consegue abrir nem a pasta dele.
    let (st, _) = chamar(&app, "POST", "/api/v1/seguro/desbloquear", &outra, Some(json!({ "senha": "mestra-do-diogo", "pasta": "Diário" }))).await;
    assert_eq!(st, StatusCode::NOT_FOUND);
}
