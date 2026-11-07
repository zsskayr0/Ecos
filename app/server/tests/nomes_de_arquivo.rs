//! Padrão de nome `note-<Título>.md` / `task-<Título>.md`: criação já sai no padrão, arquivos antigos aparecem como
//! problema, corrigir renomeia com `aliases` sem mudar o tipo nem quebrar os links, e editar um item antigo já o
//! renomeia sozinho.

mod comum;

use axum::http::StatusCode;
use comum::*;
use serde_json::json;

#[tokio::test]
async fn criar_no_padrao_listar_e_corrigir_os_antigos() {
    let e = nova();
    let (_, token) = e.admin("diogo").await;
    let t = Some(token.as_str());

    let (st, nova_nota) = e.chamar("POST", "/api/v1/notas", t, Some(json!({ "titulo": "Diário", "corpo": "ver [[Plano antigo]]" }))).await;
    assert_eq!(st, StatusCode::OK, "{nova_nota}");
    let md = std::fs::read_to_string(e.raiz.join("diogo/note-Diário.md")).unwrap();
    assert!(md.contains("aliases:\n- Diário"), "{md}");

    // Arquivos antigos, fora do padrão — um deles com propriedade desconhecida que não pode sumir.
    let notas = e.raiz.join("diogo");
    std::fs::write(notas.join("Plano antigo.md"), "---\nid: N9\ntitulo: Plano antigo\nespaco: pessoal\ncriado_em: 2026-01-01T00:00:00Z\natualizado_em: 2026-01-01T00:00:00Z\ncssclasses: [larga]\n---\ncorpo\n").unwrap();
    std::fs::create_dir_all(e.raiz.join("diogo")).unwrap();
    std::fs::write(e.raiz.join("diogo/note-Lavar.md"), "---\nid: T9\ntitulo: Lavar\nstatus: pendente\nespaco: pessoal\ncriado_em: 2026-01-01T00:00:00Z\n---\n").unwrap();
    ecos_app::db::reindex::reindexar_tudo(&e.state.db, &e.state.config.notes_root).await.unwrap();

    let (st, lista) = e.chamar("GET", "/api/v1/arquivos/problemas", t, None).await;
    assert_eq!(st, StatusCode::OK, "{lista}");
    let itens = lista["itens"].as_array().unwrap();
    assert_eq!(itens.len(), 2, "{lista}");
    let lavar = itens.iter().find(|i| i["id"] == "T9").unwrap();
    assert_eq!((lavar["problema"].as_str(), lavar["nome_sugerido"].as_str()), (Some("prefixo_de_outro_tipo"), Some("task-Lavar.md")));

    // Na pasta, o item antigo vem marcado.
    let (_, raiz) = e.chamar("GET", "/api/v1/pastas?tipo=nota", t, None).await;
    let antigo = raiz["itens"].as_array().unwrap().iter().find(|i| i["id"] == "N9").unwrap();
    assert_eq!(antigo["fora_do_padrao"], true, "{raiz}");

    // Sem itens nem `todos`, nada acontece.
    let (st, _) = e.chamar("POST", "/api/v1/arquivos/problemas/corrigir", t, Some(json!({}))).await;
    assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY);

    let (st, r) = e.chamar("POST", "/api/v1/arquivos/problemas/corrigir", t, Some(json!({ "todos": true }))).await;
    assert_eq!(st, StatusCode::OK, "{r}");
    assert_eq!(r["corrigidos"].as_array().unwrap().len(), 2, "{r}");

    let corrigido = std::fs::read_to_string(notas.join("note-Plano antigo.md")).unwrap();
    assert!(corrigido.contains("cssclasses") && corrigido.contains("- Plano antigo") && corrigido.ends_with("---\ncorpo\n"), "{corrigido}");
    assert!(!notas.join("Plano antigo.md").exists());
    assert!(e.raiz.join("diogo/task-Lavar.md").is_file());

    // O tipo não mudou e o link continua resolvendo.
    let (st, tarefa) = e.chamar("GET", "/api/v1/tarefas/T9", t, None).await;
    assert_eq!(st, StatusCode::OK, "{tarefa}");
    let (_, lista) = e.chamar("GET", "/api/v1/arquivos/problemas", t, None).await;
    assert!(lista["itens"].as_array().unwrap().is_empty(), "{lista}");

    // Mudar o título renomeia no padrão e atualiza o alias.
    let id = nova_nota["id"].as_str().unwrap();
    let (st, _) = e.chamar("PATCH", &format!("/api/v1/notas/{id}"), t, Some(json!({ "titulo": "Diário 2026" }))).await;
    assert_eq!(st, StatusCode::OK);
    let md = std::fs::read_to_string(notas.join("note-Diário 2026.md")).unwrap();
    assert!(md.contains("- Diário 2026") && !md.contains("- Diário\n"), "{md}");

    // Editar um arquivo antigo, mesmo sem mudar o título, já o leva para o padrão.
    std::fs::write(notas.join("Velho.md"), "---\nid: N8\ntitulo: Velho\nespaco: pessoal\ncriado_em: 2026-01-01T00:00:00Z\natualizado_em: 2026-01-01T00:00:00Z\n---\nx\n").unwrap();
    ecos_app::db::reindex::reindexar_tudo(&e.state.db, &e.state.config.notes_root).await.unwrap();
    let (st, r) = e.chamar("PATCH", "/api/v1/notas/N8", t, Some(json!({ "corpo": "y" }))).await;
    assert_eq!(st, StatusCode::OK, "{r}");
    assert!(notas.join("note-Velho.md").is_file() && !notas.join("Velho.md").exists());
}
