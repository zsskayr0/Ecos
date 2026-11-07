//! Árvore única (ADR árvore única): `Notas/X` e `Tarefas/X` são a mesma pasta para a API — listar mostra as duas
//! contagens, renomear leva as duas árvores e excluir não apaga itens do outro tipo sem confirmação.

mod comum;

use axum::http::StatusCode;
use comum::*;
use serde_json::{json, Value};

fn pasta<'a>(lista: &'a Value, caminho: &str) -> &'a Value {
    lista["subpastas"].as_array().unwrap().iter().find(|p| p["caminho"] == caminho).unwrap_or_else(|| panic!("sem {caminho}: {lista}"))
}

#[tokio::test]
async fn nota_e_tarefa_dividem_a_mesma_pasta() {
    let e = nova();
    let (_, token) = e.admin("diogo").await;
    let t = Some(token.as_str());

    let (st, nota) = e.chamar("POST", "/api/v1/notas", t, Some(json!({ "titulo": "Plano", "corpo": "x", "pasta": "Trabalho" }))).await;
    assert_eq!(st, StatusCode::OK, "{nota}");
    let (st, tarefa) = e.chamar("POST", "/api/v1/tarefas", t, Some(json!({ "titulo": "Entregar", "pasta": "Trabalho" }))).await;
    assert_eq!(st, StatusCode::OK, "{tarefa}");
    // Só pasta de notas: aparece também na tela de tarefas, com zero tarefas.
    let (st, _) = e.chamar("POST", "/api/v1/pastas", t, Some(json!({ "tipo": "nota", "nome": "Ideias" }))).await;
    assert_eq!(st, StatusCode::OK);

    // Todo arquivo gravado pelo Ecos sai com `tipo`.
    let md = std::fs::read_to_string(e.raiz.join("diogo/Trabalho/note-Plano.md")).unwrap();
    assert!(md.contains("\ntipo: nota\n"), "{md}");
    let md = std::fs::read_to_string(e.raiz.join("diogo/Trabalho/task-Entregar.md")).unwrap();
    assert!(md.contains("\ntipo: tarefa\n"), "{md}");

    for tipo in ["nota", "tarefa"] {
        let (st, lista) = e.chamar("GET", &format!("/api/v1/pastas?tipo={tipo}"), t, None).await;
        assert_eq!(st, StatusCode::OK, "{lista}");
        let p = pasta(&lista, "Trabalho");
        assert_eq!((p["contagem_notas"].as_i64(), p["contagem_tarefas"].as_i64(), p["contagem_itens"].as_i64()), (Some(1), Some(1), Some(1)), "{lista}");
        assert_eq!(pasta(&lista, "Ideias")["contagem_tarefas"], 0);
    }
    let (_, todos) = e.chamar("GET", "/api/v1/pastas?tipo=todos&pasta_pai=Trabalho", t, None).await;
    let mut tipos: Vec<&str> = todos["itens"].as_array().unwrap().iter().map(|i| i["tipo"].as_str().unwrap()).collect();
    tipos.sort();
    assert_eq!(tipos, ["nota", "tarefa"], "{todos}");

    // Renomear pela tela de notas leva a pasta de tarefas junto, e o item continua acessível.
    let (st, r) = e.chamar("PATCH", "/api/v1/pastas", t, Some(json!({ "tipo": "nota", "caminho_atual": "Trabalho", "novo_caminho": "Projetos" }))).await;
    assert_eq!(st, StatusCode::OK, "{r}");
    assert!(e.raiz.join("diogo/Projetos/note-Plano.md").is_file() && e.raiz.join("diogo/Projetos/task-Entregar.md").is_file());
    let (st, lida) = e.chamar("GET", &format!("/api/v1/tarefas/{}", tarefa["id"].as_str().unwrap()), t, None).await;
    assert_eq!(st, StatusCode::OK, "{lida}");

    // Excluir pela tela de notas não leva a tarefa sem confirmação.
    let (st, r) = e.chamar("DELETE", "/api/v1/pastas", t, Some(json!({ "tipo": "nota", "caminho": "Projetos" }))).await;
    assert_eq!(st, StatusCode::CONFLICT, "{r}");
    assert!(e.raiz.join("diogo/Projetos/task-Entregar.md").is_file());
    let (st, r) = e.chamar("DELETE", "/api/v1/pastas", t, Some(json!({ "tipo": "nota", "caminho": "Projetos", "todos_os_tipos": true }))).await;
    assert_eq!(st, StatusCode::OK, "{r}");
    assert!(!e.raiz.join("diogo/Projetos").exists() && !e.raiz.join("diogo/Projetos").exists());
    // Pasta sem itens do outro tipo sai sem pedir nada.
    let (st, r) = e.chamar("DELETE", "/api/v1/pastas", t, Some(json!({ "tipo": "tarefa", "caminho": "Ideias" }))).await;
    assert_eq!(st, StatusCode::OK, "{r}");
}
