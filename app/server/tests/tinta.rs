//! Modo de escrita: a tinta da Nota em `_anexos/<id>/tinta.json` + `tinta.svg`, pela API real.

mod comum;

use axum::http::StatusCode;
use comum::*;
use serde_json::{json, Value};

fn traco(id: &str, y: f64) -> Value {
    json!({
        "id": id, "ferramenta": "caneta", "cor": "auto", "espessura": 2.5,
        "pontos": [{ "x": 10.0, "y": y, "pressao": 0.5 }, { "x": 30.0, "y": y + 4.0, "pressao": 0.7 }],
        "d": format!("M10 {y} L30 {} Z", y + 4.0),
        "criado_em": "2026-11-06T12:00:00Z"
    })
}

async fn criar_nota(e: &Instancia, token: &str) -> String {
    let (st, criada) = e.chamar("POST", "/api/v1/notas", Some(token), Some(json!({ "titulo": "Com tinta", "corpo": "linha 1\n\nlinha 2" }))).await;
    assert_eq!(st, StatusCode::OK, "{criada}");
    criada["id"].as_str().unwrap().to_string()
}

fn dir_anexos(e: &Instancia, id: &str) -> std::path::PathBuf {
    walkdir_md(&e.raiz, id).parent().unwrap().join("_anexos").join(id)
}

/// Acha o `.md` da Nota pelo id no front-matter (o nome do arquivo vem do título).
fn walkdir_md(raiz: &std::path::Path, id: &str) -> std::path::PathBuf {
    let mut pilha = vec![raiz.to_path_buf()];
    while let Some(d) = pilha.pop() {
        for ent in std::fs::read_dir(&d).unwrap().flatten() {
            let p = ent.path();
            if p.is_dir() {
                if p.file_name().is_some_and(|n| n != "_anexos" && n != ".ecos") {
                    pilha.push(p);
                }
            } else if p.extension().is_some_and(|x| x == "md") && std::fs::read_to_string(&p).unwrap_or_default().contains(&format!("id: {id}")) {
                return p;
            }
        }
    }
    panic!("nota {id} não encontrada");
}

#[tokio::test]
async fn tinta_salva_recarrega_conflita_e_some_quando_vazia() {
    let e = nova();
    let (_, token) = e.admin("diogo").await;
    let id = criar_nota(&e, &token).await;
    let rota = format!("/api/v1/notas/{id}/tinta");

    let (st, vazia) = e.chamar("GET", &rota, Some(&token), None).await;
    assert_eq!(st, StatusCode::OK, "{vazia}");
    assert_eq!((vazia["revisao"].as_u64(), vazia["largura_coluna"].is_null(), vazia["tracos"].as_array().map(|a| a.len())), (Some(0), true, Some(0)));
    let md_antes = std::fs::read_to_string(walkdir_md(&e.raiz, &id)).unwrap();

    let (st, r) = e.chamar("PUT", &rota, Some(&token), Some(json!({ "revisao_base": 0, "largura_coluna": 760, "tracos": [traco("a", 20.0), traco("b", 60.0)] }))).await;
    assert_eq!((st, r["revisao"].as_u64()), (StatusCode::OK, Some(1)), "{r}");
    let dir = dir_anexos(&e, &id);
    assert!(dir.join("tinta.json").is_file() && dir.join("tinta.svg").is_file());
    let svg = std::fs::read_to_string(dir.join("tinta.svg")).unwrap();
    assert!(svg.contains("M10 20 L30 24 Z") && svg.contains("viewBox=\"0 0 760 "), "{svg}");
    assert_eq!(std::fs::read_to_string(walkdir_md(&e.raiz, &id)).unwrap(), md_antes, "o .md não é tocado pela tinta");

    let (_, lida) = e.chamar("GET", &rota, Some(&token), None).await;
    assert_eq!((lida["revisao"].as_u64(), lida["largura_coluna"].as_u64()), (Some(1), Some(760)));
    assert_eq!(lida["tracos"].as_array().unwrap().len(), 2);
    assert_eq!(lida["tracos"][0]["pontos"][1]["pressao"].as_f64(), Some(0.7));

    // Outra aba com a revisão velha: 409, nada gravado.
    let (st, r) = e.chamar("PUT", &rota, Some(&token), Some(json!({ "revisao_base": 0, "largura_coluna": 760, "tracos": [traco("z", 5.0)] }))).await;
    assert_eq!(st, StatusCode::CONFLICT, "{r}");
    let (_, lida) = e.chamar("GET", &rota, Some(&token), None).await;
    assert_eq!(lida["tracos"].as_array().unwrap().len(), 2);

    // Largura gravada na 1ª conversão é mantida; lápide some do GET e do SVG.
    let mut apagado = traco("a", 20.0);
    apagado["apagado_em"] = json!(chrono::Utc::now().to_rfc3339());
    let (st, r) = e.chamar("PUT", &rota, Some(&token), Some(json!({ "revisao_base": 1, "largura_coluna": 900, "tracos": [apagado, traco("b", 60.0)] }))).await;
    assert_eq!((st, r["revisao"].as_u64(), r["largura_coluna"].as_u64()), (StatusCode::OK, Some(2), Some(760)), "{r}");
    let (_, lida) = e.chamar("GET", &rota, Some(&token), None).await;
    assert_eq!(ids(&json!({ "items": lida["tracos"] })).len(), 1);
    assert!(!std::fs::read_to_string(dir.join("tinta.svg")).unwrap().contains("M10 20 "));

    // Sem traço ativo: apaga os dois arquivos, a Nota volta a "não convertida".
    let (st, r) = e.chamar("PUT", &rota, Some(&token), Some(json!({ "revisao_base": 2, "largura_coluna": 760, "tracos": [] }))).await;
    assert_eq!((st, r["revisao"].as_u64()), (StatusCode::OK, Some(0)), "{r}");
    assert!(!dir.join("tinta.json").exists() && !dir.join("tinta.svg").exists());
    let (_, lida) = e.chamar("GET", &rota, Some(&token), None).await;
    assert!(lida["largura_coluna"].is_null());
}

#[tokio::test]
async fn tinta_recusa_payload_invalido_e_svg_malicioso() {
    let e = nova();
    let (_, token) = e.admin("diogo").await;
    let id = criar_nota(&e, &token).await;
    let rota = format!("/api/v1/notas/{id}/tinta");

    let mut script = traco("a", 10.0);
    script["d"] = json!("M0 0\"/><script>alert(1)</script><path d=\"");
    let mut cor = traco("a", 10.0);
    cor["cor"] = json!("red\" onload=\"x");
    let mut ferramenta = traco("a", 10.0);
    ferramenta["ferramenta"] = json!("laser");
    for (nome, tracos) in [("d", json!([script])), ("cor", json!([cor])), ("id repetido", json!([traco("a", 1.0), traco("a", 2.0)]))] {
        let (st, r) = e.chamar("PUT", &rota, Some(&token), Some(json!({ "revisao_base": 0, "largura_coluna": 760, "tracos": tracos }))).await;
        assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY, "{nome}: {r}");
    }
    let (st, _) = e.chamar("PUT", &rota, Some(&token), Some(json!({ "revisao_base": 0, "largura_coluna": 760, "tracos": [ferramenta] }))).await;
    assert!(st.is_client_error(), "ferramenta desconhecida: {st}");
    assert!(!e.raiz.join("diogo/Notas/_anexos").join(&id).exists(), "nada foi gravado");
}

#[tokio::test]
async fn tinta_sobrevive_a_reindex_do_zero_mover_de_pasta_e_lixeira() {
    let e = nova();
    let (_, token) = e.admin("diogo").await;
    let id = criar_nota(&e, &token).await;
    let rota = format!("/api/v1/notas/{id}/tinta");
    let (st, _) = e.chamar("PUT", &rota, Some(&token), Some(json!({ "revisao_base": 0, "largura_coluna": 760, "tracos": [traco("a", 20.0)] }))).await;
    assert_eq!(st, StatusCode::OK);

    // O índice não guarda tinta: esvaziar a tabela e reindexar do zero mantém tudo.
    e.state.db.with(|c| c.execute("DELETE FROM nota", []).map(|_| ())).await.unwrap();
    ecos_app::db::reindex::reindexar_tudo(&e.state.db, &e.state.config.notes_root).await.unwrap();
    let (st, lida) = e.chamar("GET", &rota, Some(&token), None).await;
    assert_eq!((st, lida["tracos"].as_array().map(|a| a.len())), (StatusCode::OK, Some(1)), "{lida}");

    // Mover de pasta leva `_anexos/<id>` junto.
    let (st, r) = e.chamar("PATCH", &format!("/api/v1/notas/{id}"), Some(&token), Some(json!({ "pasta": "Projetos" }))).await;
    assert_eq!(st, StatusCode::OK, "{r}");
    assert!(walkdir_md(&e.raiz, &id).parent().unwrap().ends_with("Projetos"));
    assert!(dir_anexos(&e, &id).join("tinta.json").is_file(), "a tinta foi junto para a nova pasta");
    let (_, lida) = e.chamar("GET", &rota, Some(&token), None).await;
    assert_eq!(lida["tracos"].as_array().unwrap().len(), 1);

    // Lixeira e restauração.
    let (st, _) = e.chamar("DELETE", &format!("/api/v1/notas/{id}"), Some(&token), None).await;
    assert_eq!(st, StatusCode::OK);
    let (_, lixeira) = e.chamar("GET", "/api/v1/lixeira", Some(&token), None).await;
    let item = lixeira.as_array().or_else(|| lixeira["items"].as_array()).and_then(|l| l.iter().find(|i| i["tipo"] == "nota")).cloned().unwrap_or_else(|| panic!("{lixeira}"));
    let (st, r) = e.chamar("POST", &format!("/api/v1/lixeira/{}/restaurar", item["id"].as_str().unwrap()), Some(&token), None).await;
    assert_eq!(st, StatusCode::OK, "{r}");
    let (st, lida) = e.chamar("GET", &rota, Some(&token), None).await;
    assert_eq!((st, lida["tracos"].as_array().map(|a| a.len())), (StatusCode::OK, Some(1)), "{lida}");
}

#[tokio::test]
async fn tinta_de_outra_pessoa_e_404() {
    let e = nova();
    let (_, admin) = e.admin("diogo").await;
    let (_, outra) = e.pessoa(&admin, "bruna").await;
    let id = criar_nota(&e, &admin).await;
    let rota = format!("/api/v1/notas/{id}/tinta");
    let (st, _) = e.chamar("GET", &rota, Some(&outra), None).await;
    assert_eq!(st, StatusCode::NOT_FOUND);
    let (st, _) = e.chamar("PUT", &rota, Some(&outra), Some(json!({ "revisao_base": 0, "largura_coluna": 760, "tracos": [traco("a", 1.0)] }))).await;
    assert_eq!(st, StatusCode::NOT_FOUND);
}
