//! Explorador de arquivos: pasta única com qualquer arquivo, conteúdo para visualizar e mover arrastando.

mod comum;

use axum::http::StatusCode;
use comum::*;
use serde_json::{json, Value};

fn nomes(lista: &Value, chave: &str) -> Vec<String> {
    lista[chave].as_array().unwrap().iter().map(|i| i["nome"].as_str().unwrap().to_string()).collect()
}

#[tokio::test]
async fn listar_ver_e_mover_arquivos_da_arvore_unica() {
    let e = nova();
    let (_, token) = e.admin("diogo").await;
    let t = Some(token.as_str());

    let (_, nota) = e.chamar("POST", "/api/v1/notas", t, Some(json!({ "titulo": "Plano", "corpo": "x", "pasta": "Trabalho" }))).await;
    let (_, tarefa) = e.chamar("POST", "/api/v1/tarefas", t, Some(json!({ "titulo": "Entregar", "pasta": "Trabalho" }))).await;
    let notas = e.raiz.join("diogo/Trabalho");
    let tarefas = e.raiz.join("diogo/Trabalho");
    std::fs::write(notas.join("contrato.pdf"), b"%PDF-1.4 teste").unwrap();
    std::fs::write(tarefas.join("lista.txt"), "leite\npão\n").unwrap();
    let id_tarefa = tarefa["id"].as_str().unwrap();
    std::fs::create_dir_all(tarefas.join("_anexos").join(id_tarefa)).unwrap();
    std::fs::write(tarefas.join("_anexos").join(id_tarefa).join("foto.png"), b"png").unwrap();

    // Raiz: uma pasta "Trabalho" só, sem as internas.
    let (st, raiz) = e.chamar("GET", "/api/v1/arquivos", t, None).await;
    assert_eq!(st, StatusCode::OK, "{raiz}");
    assert_eq!(nomes(&raiz, "pastas"), ["Trabalho"], "{raiz}");

    let (_, trabalho) = e.chamar("GET", "/api/v1/arquivos?pasta=Trabalho", t, None).await;
    assert_eq!(nomes(&trabalho, "arquivos"), ["contrato.pdf", "lista.txt", "note-Plano.md", "task-Entregar.md"], "{trabalho}");
    assert!(nomes(&trabalho, "pastas").is_empty(), "_anexos não aparece: {trabalho}");
    let item = |nome: &str| trabalho["arquivos"].as_array().unwrap().iter().find(|a| a["nome"] == nome).unwrap().clone();
    assert_eq!((item("note-Plano.md")["tipo"].as_str(), item("note-Plano.md")["id"].as_str()), (Some("nota"), nota["id"].as_str()));
    assert_eq!(item("task-Entregar.md")["tipo"], "tarefa");
    assert_eq!((item("contrato.pdf")["categoria"].as_str(), item("lista.txt")["categoria"].as_str()), (Some("pdf"), Some("texto")));

    // Conteúdo: qualquer arquivo da árvore; nada fora dela nem interno.
    let (st, _) = e.chamar("GET", "/api/v1/arquivos/conteudo?caminho=Trabalho/lista.txt", t, None).await;
    assert_eq!(st, StatusCode::OK);
    for ruim in ["../diogo/Trabalho/note-Plano.md", "Trabalho/_anexos/x", ".ecos-pastas.json"] {
        let (st, _) = e.chamar("GET", &format!("/api/v1/arquivos/conteudo?caminho={ruim}"), t, None).await;
        assert!(st == StatusCode::UNPROCESSABLE_ENTITY || st == StatusCode::NOT_FOUND, "{ruim}: {st}");
    }

    // Mover vários de uma vez: cada arquivo fica na sua árvore física; os anexos da tarefa vão junto.
    let (st, r) = e.chamar("POST", "/api/v1/arquivos/mover", t, Some(json!({ "itens": ["Trabalho/note-Plano.md", "Trabalho/task-Entregar.md", "Trabalho/lista.txt"], "destino": "Arquivo/2026" }))).await;
    assert_eq!(st, StatusCode::OK, "{r}");
    assert_eq!(r["movidos"].as_array().unwrap().len(), 3, "{r}");
    assert!(e.raiz.join("diogo/Arquivo/2026/note-Plano.md").is_file());
    assert!(e.raiz.join("diogo/Arquivo/2026/task-Entregar.md").is_file());
    assert!(e.raiz.join("diogo/Arquivo/2026/_anexos").join(id_tarefa).join("foto.png").is_file());
    let (st, lida) = e.chamar("GET", &format!("/api/v1/tarefas/{id_tarefa}"), t, None).await;
    assert_eq!(st, StatusCode::OK, "{lida}");

    // Pasta: move nas duas árvores; para dentro dela mesma é recusado.
    let (st, _) = e.chamar("POST", "/api/v1/arquivos/mover", t, Some(json!({ "itens": ["Arquivo"], "destino": "Arquivo/2026" }))).await;
    assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY);
    let (st, r) = e.chamar("POST", "/api/v1/arquivos/mover", t, Some(json!({ "itens": ["Arquivo"], "destino": "Trabalho" }))).await;
    assert_eq!(st, StatusCode::OK, "{r}");
    assert!(e.raiz.join("diogo/Trabalho/Arquivo/2026/note-Plano.md").is_file() && e.raiz.join("diogo/Trabalho/Arquivo/2026/task-Entregar.md").is_file());
    let (st, lida) = e.chamar("GET", &format!("/api/v1/notas/{}", nota["id"].as_str().unwrap()), t, None).await;
    assert_eq!(st, StatusCode::OK, "{lida}");

    // Outra pessoa não enxerga nada disso.
    let (_, token_b) = e.pessoa(&token, "bia").await;
    let (_, dela) = e.chamar("GET", "/api/v1/arquivos?pasta=Trabalho", Some(&token_b), None).await;
    assert!(dela["arquivos"].as_array().map_or(true, |a| a.is_empty()), "{dela}");
}

#[tokio::test]
async fn renomear_e_excluir_pelo_explorador_com_restauracao() {
    let e = nova();
    let (_, token) = e.admin("diogo").await;
    let t = Some(token.as_str());

    let (_, nota) = e.chamar("POST", "/api/v1/notas", t, Some(json!({ "titulo": "Plano", "corpo": "x", "pasta": "Trabalho" }))).await;
    let (_, outra) = e.chamar("POST", "/api/v1/notas", t, Some(json!({ "titulo": "Indice", "corpo": "ver [[Plano]]", "pasta": "Trabalho" }))).await;
    let (_, tarefa) = e.chamar("POST", "/api/v1/tarefas", t, Some(json!({ "titulo": "Entregar", "pasta": "Trabalho" }))).await;
    let notas = e.raiz.join("diogo/Trabalho");
    std::fs::write(notas.join("contrato.pdf"), b"%PDF-1.4").unwrap();
    std::fs::write(notas.join("outro.pdf"), b"%PDF-1.4").unwrap();

    // Arquivo comum: só o nome; repetido ou inválido é recusado.
    let (st, r) = e.chamar("POST", "/api/v1/arquivos/renomear", t, Some(json!({ "caminho": "Trabalho/contrato.pdf", "novo_nome": "Contrato 2026.pdf" }))).await;
    assert_eq!(st, StatusCode::OK, "{r}");
    assert_eq!(r["caminho"], "Trabalho/Contrato 2026.pdf");
    assert!(notas.join("Contrato 2026.pdf").is_file() && !notas.join("contrato.pdf").exists());
    let (st, _) = e.chamar("POST", "/api/v1/arquivos/renomear", t, Some(json!({ "caminho": "Trabalho/outro.pdf", "novo_nome": "Contrato 2026.pdf" }))).await;
    assert_eq!(st, StatusCode::CONFLICT);
    for ruim in ["a/b.pdf", ".oculto", "x?.pdf"] {
        let (st, _) = e.chamar("POST", "/api/v1/arquivos/renomear", t, Some(json!({ "caminho": "Trabalho/outro.pdf", "novo_nome": ruim }))).await;
        assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY, "{ruim}");
    }

    // Nota: o nome é o título; arquivo no padrão e o link de outra nota acompanha.
    let (st, r) = e.chamar("POST", "/api/v1/arquivos/renomear", t, Some(json!({ "caminho": "Trabalho/note-Plano.md", "novo_nome": "Plano B" }))).await;
    assert_eq!(st, StatusCode::OK, "{r}");
    assert_eq!(r["caminho"], "Trabalho/note-Plano B.md");
    let (_, lida) = e.chamar("GET", &format!("/api/v1/notas/{}", nota["id"].as_str().unwrap()), t, None).await;
    assert_eq!(lida["titulo"], "Plano B");
    let (_, indice) = e.chamar("GET", &format!("/api/v1/notas/{}", outra["id"].as_str().unwrap()), t, None).await;
    assert!(indice["corpo"].as_str().unwrap().contains("[[Plano B]]"), "{indice}");

    // Pasta: renomeia nas duas árvores.
    let (st, r) = e.chamar("POST", "/api/v1/arquivos/renomear", t, Some(json!({ "caminho": "Trabalho", "novo_nome": "Projetos" }))).await;
    assert_eq!(st, StatusCode::OK, "{r}");
    assert!(e.raiz.join("diogo/Projetos/note-Plano B.md").is_file() && e.raiz.join("diogo/Projetos/task-Entregar.md").is_file());

    // Excluir: tudo vai para a lixeira; nada some de vez.
    let (st, r) = e.chamar("POST", "/api/v1/arquivos/excluir", t, Some(json!({ "itens": ["Projetos/outro.pdf", "Projetos/task-Entregar.md"] }))).await;
    assert_eq!(st, StatusCode::OK, "{r}");
    assert_eq!(r["excluidos"].as_array().unwrap().len(), 2, "{r}");
    let (st, _) = e.chamar("GET", &format!("/api/v1/tarefas/{}", tarefa["id"].as_str().unwrap()), t, None).await;
    assert_eq!(st, StatusCode::NOT_FOUND);
    let (_, lixo) = e.chamar("GET", "/api/v1/lixeira", t, None).await;
    let tipos: Vec<&str> = lixo.as_array().unwrap().iter().map(|i| i["tipo"].as_str().unwrap()).collect();
    assert!(tipos.contains(&"arquivo") && tipos.contains(&"tarefa"), "{lixo}");

    // A pasta inteira (das duas árvores) vai junto e volta igual.
    let (st, r) = e.chamar("POST", "/api/v1/arquivos/excluir", t, Some(json!({ "itens": ["Projetos"] }))).await;
    assert_eq!(st, StatusCode::OK, "{r}");
    assert!(!e.raiz.join("diogo/Projetos").exists());
    let (st, _) = e.chamar("GET", &format!("/api/v1/notas/{}", nota["id"].as_str().unwrap()), t, None).await;
    assert_eq!(st, StatusCode::NOT_FOUND);

    // Outra pessoa não vê nem restaura.
    let (_, token_b) = e.pessoa(&token, "bia").await;
    let (_, lixo_b) = e.chamar("GET", "/api/v1/lixeira", Some(&token_b), None).await;
    assert!(lixo_b.as_array().unwrap().is_empty(), "{lixo_b}");

    let (_, lixo) = e.chamar("GET", "/api/v1/lixeira", t, None).await;
    let pasta = lixo.as_array().unwrap().iter().find(|i| i["tipo"] == "pasta").unwrap().clone();
    assert_eq!(pasta["caminho_original"], "Projetos");
    let rota = format!("/api/v1/lixeira/{}/restaurar", pasta["id"].as_str().unwrap());
    let (st, _) = e.chamar("POST", &rota, Some(&token_b), None).await;
    assert_eq!(st, StatusCode::NOT_FOUND);
    let (st, r) = e.chamar("POST", &rota, t, None).await;
    assert_eq!(st, StatusCode::OK, "{r}");
    assert!(e.raiz.join("diogo/Projetos/Contrato 2026.pdf").is_file());
    let (st, _) = e.chamar("GET", &format!("/api/v1/notas/{}", nota["id"].as_str().unwrap()), t, None).await;
    assert_eq!(st, StatusCode::OK);

    // Restaurar o arquivo solto: volta para a pasta restaurada.
    let arquivo = lixo.as_array().unwrap().iter().find(|i| i["tipo"] == "arquivo").unwrap().clone();
    let (st, r) = e.chamar("POST", &format!("/api/v1/lixeira/{}/restaurar", arquivo["id"].as_str().unwrap()), t, None).await;
    assert_eq!(st, StatusCode::OK, "{r}");
    assert!(e.raiz.join("diogo/Projetos/outro.pdf").is_file());
}

#[tokio::test]
async fn criar_pasta_e_enviar_arquivos_pelo_explorador() {
    let e = nova();
    let (_, token) = e.admin("diogo").await;
    let t = Some(token.as_str());
    e.chamar("POST", "/api/v1/tarefas", t, Some(json!({ "titulo": "Entregar", "pasta": "Trabalho" }))).await;

    // Nova pasta pela rota de pastas: aparece no explorador.
    let (st, r) = e.chamar("POST", "/api/v1/pastas", t, Some(json!({ "nome": "Contratos", "pasta_pai": "Trabalho" }))).await;
    assert_eq!(st, StatusCode::OK, "{r}");
    let (_, trabalho) = e.chamar("GET", "/api/v1/arquivos?pasta=Trabalho", t, None).await;
    assert_eq!(nomes(&trabalho, "pastas"), ["Contratos"], "{trabalho}");

    // Enviar: nome original, repetido ganha (2) (mesmo se o repetido estiver na outra árvore).
    let (st, r) = e.enviar_arquivo("/api/v1/arquivos/enviar?pasta=Trabalho/Contratos", &token, "Aluguel 2026.pdf", b"%PDF-1.4").await;
    assert_eq!(st, StatusCode::OK, "{r}");
    assert_eq!(r["caminho"], "Trabalho/Contratos/Aluguel 2026.pdf");
    let (_, r) = e.enviar_arquivo("/api/v1/arquivos/enviar?pasta=Trabalho/Contratos", &token, "Aluguel 2026.pdf", b"%PDF-1.4 outro").await;
    assert_eq!(r["nome"], "Aluguel 2026 (2).pdf", "{r}");
    std::fs::write(e.raiz.join("diogo/Trabalho/foto.png"), b"png").unwrap();
    let (_, r) = e.enviar_arquivo("/api/v1/arquivos/enviar?pasta=Trabalho", &token, "foto.png", b"png2").await;
    assert_eq!(r["nome"], "foto (2).png", "{r}");
    let (st, conteudo) = e.chamar("GET", "/api/v1/arquivos/conteudo?caminho=Trabalho/Contratos/Aluguel%202026%20(2).pdf", t, None).await;
    assert_eq!(st, StatusCode::OK, "{conteudo}");

    // `.md` enviado vira nota, com o título do `# ` e o nome no padrão; o corpo fica como veio.
    let (_, r) = e.enviar_arquivo("/api/v1/arquivos/enviar?pasta=Trabalho", &token, "ideias.md", "# Ideias\nalgo".as_bytes()).await;
    assert_eq!(r["nome"], "note-Ideias.md", "{r}");
    let (_, trabalho) = e.chamar("GET", "/api/v1/arquivos?pasta=Trabalho", t, None).await;
    let md = trabalho["arquivos"].as_array().unwrap().iter().find(|a| a["nome"] == "note-Ideias.md").unwrap();
    assert_eq!((md["tipo"].as_str(), md["fora_do_padrao"].as_bool()), (Some("nota"), Some(false)), "{trabalho}");
    assert!(std::fs::read_to_string(e.raiz.join("diogo/Trabalho/note-Ideias.md")).unwrap().ends_with("# Ideias\nalgo"));
    // Tarefa vinda de outro lugar: continua tarefa e ganha o prefixo dela.
    let tarefa = "---\nid: 01J00000000000000000000000\ntitulo: Pagar luz\ntipo: tarefa\nstatus: pendente\nespaco: pessoal\ncriado_em: 2026-01-01T00:00:00Z\n---\n";
    let (_, r) = e.enviar_arquivo("/api/v1/arquivos/enviar?pasta=Trabalho", &token, "luz.md", tarefa.as_bytes()).await;
    assert_eq!(r["nome"], "task-Pagar luz.md", "{r}");

    // Pasta interna, caminho fora da raiz e nome oculto são recusados.
    for uri in ["/api/v1/arquivos/enviar?pasta=Trabalho/_anexos", "/api/v1/arquivos/enviar?pasta=../fora"] {
        let (st, _) = e.enviar_arquivo(uri, &token, "x.txt", b"x").await;
        assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY, "{uri}");
    }
    let (st, _) = e.enviar_arquivo("/api/v1/arquivos/enviar?pasta=Trabalho", &token, ".env", b"x").await;
    assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(!e.raiz.join("fora").exists());
}
