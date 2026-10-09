//! Catálogo universal de tags: criada numa nota aparece nas tarefas (e vice-versa), renomear/mesclar/remover
//! reescrevem os `.md` de todos os itens, e espaços/pessoas não se misturam.

use crate::{auth::session, config::{Ambiente, Config}, db::IndexDb, state::AppState};
use axum::{body::{to_bytes, Body}, http::{Request, StatusCode}, Router};
use ecos_core::new_id;
use std::sync::{Arc, Mutex};
use tower::Service;

async fn chamar(app: &Router, metodo: &str, uri: &str, token: &str, corpo: Option<serde_json::Value>) -> (StatusCode, serde_json::Value) {
    let mut pedido = Request::builder().method(metodo).uri(uri).header("authorization", format!("Bearer {token}"));
    let corpo = match corpo {
        Some(c) => { pedido = pedido.header("content-type", "application/json"); Body::from(c.to_string()) }
        None => Body::empty(),
    };
    let resposta = app.clone().call(pedido.body(corpo).unwrap()).await.unwrap();
    let status = resposta.status();
    let bytes = to_bytes(resposta.into_body(), 1024 * 1024).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null))
}

fn nomes(catalogo: &serde_json::Value) -> Vec<String> {
    let mut v: Vec<String> = catalogo.as_array().unwrap().iter().map(|t| t["tag"].as_str().unwrap().to_string()).collect();
    v.sort();
    v
}

fn busca<'a>(catalogo: &'a serde_json::Value, tag: &str) -> &'a serde_json::Value {
    catalogo.as_array().unwrap().iter().find(|t| t["tag"] == tag).unwrap_or_else(|| panic!("tag {tag} ausente em {catalogo}"))
}

fn ler_todos(raiz: &std::path::Path) -> String {
    fn andar(dir: &std::path::Path, saida: &mut String) {
        for e in std::fs::read_dir(dir).into_iter().flatten().flatten() {
            let p = e.path();
            if p.is_dir() { andar(&p, saida) } else if p.extension().is_some_and(|x| x == "md") { saida.push_str(&std::fs::read_to_string(&p).unwrap()); }
        }
    }
    let mut s = String::new();
    andar(raiz, &mut s);
    s
}

#[tokio::test]
async fn catalogo_unico_renomear_mesclar_remover() {
    let temp = std::env::temp_dir().join(format!("ecos-tags-{}", new_id()));
    std::fs::create_dir_all(&temp).unwrap();
    let segredo = b"segredo-efemero-exclusivo-do-teste-de-tags".to_vec();
    let state = AppState {
        db: IndexDb::open(&temp.join("index.db")).unwrap(),
        config: Arc::new(Config {
            ambiente: Ambiente::Desenvolvimento, porta: 0, notes_root: temp.clone(), index_db_path: temp.join("index.db"),
            vault_enabled: false, vault_internal_url: String::new(), session_secret: segredo.clone(), ranking_interval_secs: 300,
            static_dir: None, cookie_secure: false, google: None,
        }),
        http: reqwest::Client::new(), pareamentos: Arc::new(Mutex::new(Default::default())),
    };
    state.db.with(|c| {
        c.execute("INSERT INTO usuario (id, nome_usuario, senha_hash, recovery_key_hash) VALUES ('U1', 'diogo', 'x', 'x'), ('U2', 'thaty', 'x', 'x'), ('U3', 'visita', 'x', 'x')", [])?;
        c.execute("INSERT INTO equipe (id, nome) VALUES ('EQ', 'Casa')", [])?;
        c.execute("INSERT INTO membro_equipe (equipe_id, usuario_id, cargo) VALUES ('EQ', 'U1', 'dono'), ('EQ', 'U2', 'membro')", [])?;
        Ok(())
    }).await.unwrap();
    let app = crate::routes::montar(state.clone());
    let diogo = session::emitir_access_token("U1", &segredo).unwrap();
    let thaty = session::emitir_access_token("U2", &segredo).unwrap();
    let visita = session::emitir_access_token("U3", &segredo).unwrap();

    // Entrada nova é normalizada (caixa, '#', espaços, duplicatas).
    let (st, nota) = chamar(&app, "POST", "/api/v1/notas", &diogo, Some(serde_json::json!({ "titulo": "N1", "tags": ["#Casa", "casa", "Obra Nova"] }))).await;
    assert_eq!(st, StatusCode::OK, "{nota}");
    let (_, tarefa) = chamar(&app, "POST", "/api/v1/tarefas", &diogo, Some(serde_json::json!({ "titulo": "T1", "tags": ["CASA", "reforma"] }))).await;
    chamar(&app, "POST", "/api/v1/tarefas", &diogo, Some(serde_json::json!({ "titulo": "T2", "tags": ["obra-nova"] }))).await;
    chamar(&app, "POST", "/api/v1/notas", &diogo, Some(serde_json::json!({ "titulo": "Eq", "espaco": "equipe:EQ", "tags": ["casa"] }))).await;
    let (id_nota, id_tarefa) = (nota["id"].as_str().unwrap(), tarefa["id"].as_str().unwrap());

    // Uma tag criada na nota aparece para tarefas e vice-versa: um catálogo só, com contagem por tipo.
    let (_, cat) = chamar(&app, "GET", "/api/v1/tags?espaco=pessoal", &diogo, None).await;
    assert_eq!(nomes(&cat), vec!["casa", "obra-nova", "reforma"], "{cat}");
    let casa = busca(&cat, "casa");
    assert_eq!((casa["notas"].as_i64(), casa["tarefas"].as_i64()), (Some(1), Some(1)), "{casa}");
    let (_, cat_total) = chamar(&app, "GET", "/api/v1/tags", &diogo, None).await;
    let casa = busca(&cat_total, "casa");
    assert_eq!(casa["total"], 3, "pessoal + equipe");
    assert_eq!(casa["espacos"].as_array().unwrap().len(), 2);

    // Permissões: a Thaty não vê as tags pessoais do Diogo; a visita não vê nada.
    let (_, cat) = chamar(&app, "GET", "/api/v1/tags", &thaty, None).await;
    assert_eq!(nomes(&cat), vec!["casa"], "só a da equipe");
    let (_, cat) = chamar(&app, "GET", "/api/v1/tags", &visita, None).await;
    assert!(cat.as_array().unwrap().is_empty());
    let (st, _) = chamar(&app, "PATCH", "/api/v1/tags", &visita, Some(serde_json::json!({ "espaco": "equipe:EQ", "de": "casa", "para": "lar" }))).await;
    assert_eq!(st, StatusCode::FORBIDDEN);
    let (st, _) = chamar(&app, "PATCH", "/api/v1/tags", &thaty, Some(serde_json::json!({ "espaco": "pessoal", "de": "casa", "para": "lar" }))).await;
    assert_eq!(st, StatusCode::OK, "pessoal da Thaty: nada a mudar, e nada do Diogo é tocado");
    let (_, cat) = chamar(&app, "GET", "/api/v1/tags?espaco=pessoal", &diogo, None).await;
    assert!(nomes(&cat).contains(&"casa".to_string()));

    // Filtros usam o nome canônico, qualquer grafia.
    let (_, lista) = chamar(&app, "GET", "/api/v1/tarefas?tag=%23CASA", &diogo, None).await;
    assert_eq!(lista["items"].as_array().unwrap().len(), 1, "{lista}");

    // Renomear no espaço pessoal atualiza notas e tarefas; a equipe não é tocada.
    let (st, r) = chamar(&app, "PATCH", "/api/v1/tags", &diogo, Some(serde_json::json!({ "espaco": "pessoal", "de": "Casa", "para": "Lar" }))).await;
    assert_eq!(st, StatusCode::OK, "{r}");
    assert_eq!((r["afetados"]["notas"].as_u64(), r["afetados"]["tarefas"].as_u64()), (Some(1), Some(1)));
    let (_, n) = chamar(&app, "GET", &format!("/api/v1/notas/{id_nota}"), &diogo, None).await;
    assert_eq!(n["tags"], serde_json::json!(["lar", "obra-nova"]));
    let (_, cat) = chamar(&app, "GET", "/api/v1/tags", &diogo, None).await;
    assert_eq!(busca(&cat, "lar")["total"], 2);
    assert_eq!(busca(&cat, "casa")["total"], 1, "a da equipe continua casa");

    // Mesclar: obra-nova + reforma -> reforma; item que tinha as duas fica com uma só.
    let (st, r) = chamar(&app, "POST", "/api/v1/tags/mesclar", &diogo, Some(serde_json::json!({ "espaco": "pessoal", "origens": ["obra-nova", "reforma"], "destino": "reforma" }))).await;
    assert_eq!(st, StatusCode::OK, "{r}");
    let (_, cat) = chamar(&app, "GET", "/api/v1/tags?espaco=pessoal", &diogo, None).await;
    assert_eq!(nomes(&cat), vec!["lar", "reforma"], "{cat}");
    let reforma = busca(&cat, "reforma");
    assert_eq!((reforma["notas"].as_i64(), reforma["tarefas"].as_i64()), (Some(1), Some(2)));

    // Remover tira só a tag; os itens continuam.
    let (st, r) = chamar(&app, "DELETE", "/api/v1/tags?espaco=pessoal&tag=lar", &diogo, None).await;
    assert_eq!(st, StatusCode::OK, "{r}");
    let (_, t) = chamar(&app, "GET", &format!("/api/v1/tarefas/{id_tarefa}"), &diogo, None).await;
    assert_eq!(t["tags"], serde_json::json!(["reforma"]));
    let (st, _) = chamar(&app, "GET", &format!("/api/v1/notas/{id_nota}"), &diogo, None).await;
    assert_eq!(st, StatusCode::OK);
    assert!(!ler_todos(&temp.join("diogo")).contains("lar"), "arquivos reescritos");

    // Nome inválido é recusado.
    let (st, _) = chamar(&app, "PATCH", "/api/v1/tags", &diogo, Some(serde_json::json!({ "espaco": "pessoal", "de": "reforma", "para": "  # " }))).await;
    assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY);

    // Hashtag antiga no arquivo não é reescrita por um reindex nem por editar o item.
    let (_, n) = chamar(&app, "GET", &format!("/api/v1/notas/{id_nota}"), &diogo, None).await;
    let caminho = temp.join(n["caminho_arquivo"].as_str().unwrap());
    let antes = std::fs::read_to_string(&caminho).unwrap();
    let texto = antes.replacen("- reforma", "- Reforma Antiga", 1);
    let texto = if texto == antes { antes.replacen("tags: []", "tags:\n- Reforma Antiga", 1) } else { texto };
    assert_ne!(texto, antes, "{antes}");
    std::fs::write(&caminho, &texto).unwrap();
    crate::db::reindex::reindexar_tudo(&state.db, &temp).await.unwrap();
    assert_eq!(std::fs::read_to_string(&caminho).unwrap(), texto, "reindex não mexe no arquivo");
    let (_, cat) = chamar(&app, "GET", "/api/v1/tags?espaco=pessoal", &diogo, None).await;
    assert!(nomes(&cat).contains(&"reforma-antiga".to_string()), "{cat}");
    chamar(&app, "PATCH", &format!("/api/v1/notas/{id_nota}"), &diogo, Some(serde_json::json!({ "tags": ["reforma antiga", "nova"] }))).await;
    let (_, n) = chamar(&app, "GET", &format!("/api/v1/notas/{id_nota}"), &diogo, None).await;
    assert_eq!(n["tags"], serde_json::json!(["Reforma Antiga", "nova"]), "grafia antiga preservada na edição");

    let _ = std::fs::remove_dir_all(&temp);
}
