//! Gráfico de conexões: o que cada pessoa enxerga (nós e arestas) segue a mesma visibilidade das listagens.

mod comum;

use axum::http::StatusCode;
use comum::*;
use serde_json::{json, Value};
use std::collections::HashSet;

fn nos(g: &Value) -> HashSet<String> {
    g["nos"].as_array().unwrap().iter().map(|n| n["id"].as_str().unwrap().to_string()).collect()
}

fn tem_aresta(g: &Value, origem: &str, destino: &str, tipo: &str) -> bool {
    g["arestas"].as_array().unwrap().iter().any(|a| a["origem"] == origem && a["destino"] == destino && a["tipo"] == tipo)
}

async fn criar(e: &Instancia, rota: &str, token: &str, corpo: Value) -> String {
    let (st, r) = e.chamar("POST", rota, Some(token), Some(corpo)).await;
    assert_eq!(st, StatusCode::OK, "{rota}: {r}");
    r["id"].as_str().unwrap().to_string()
}

async fn equipe(e: &Instancia, dono: &str, nome: &str) -> String {
    criar(e, "/api/v1/equipes", dono, json!({ "nome": nome })).await
}

#[tokio::test]
async fn sem_token_e_401() {
    let e = nova();
    assert_eq!(e.chamar("GET", "/api/v1/grafico", None, None).await.0, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn quem_nao_tem_conteudo_recebe_grafo_vazio() {
    let e = nova();
    let (_, admin) = e.admin("diogo").await;
    let (st, g) = e.chamar("GET", "/api/v1/grafico", Some(&admin), None).await;
    assert_eq!(st, StatusCode::OK, "{g}");
    assert!(g["nos"].as_array().unwrap().is_empty());
    assert!(g["arestas"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn grafico_so_mostra_nos_e_arestas_que_a_pessoa_enxerga() {
    let e = nova();
    let (_, a) = e.admin("diogo").await;
    let (_, b) = e.pessoa(&a, "thaty").await;
    // Equipe do A (B não participa) e equipe do B (A não participa).
    let eq_a = equipe(&e, &a, "Casa A").await;
    let eq_b = equipe(&e, &b, "Casa B").await;

    // A: nota pessoal que aponta para a nota secreta de B, tarefa, evento ligado às duas, tags.
    let nota_b_pessoal = criar(&e, "/api/v1/notas", &b, json!({ "titulo": "Segredo de B", "tags": ["segredoB"] })).await;
    let nota_a = criar(&e, "/api/v1/notas", &a, json!({ "titulo": "Nota de A", "corpo": "veja [[Segredo de B]]", "tags": ["comum", "soA"] })).await;
    let nota_a2 = criar(&e, "/api/v1/notas", &a, json!({ "titulo": "Outra de A", "corpo": "volta para [[Nota de A]]" })).await;
    let tarefa_a = criar(&e, "/api/v1/tarefas", &a, json!({ "titulo": "Tarefa de A", "tags": ["comum"] })).await;
    let evento_a = criar(&e, "/api/v1/eventos", &a, json!({ "titulo": "Evento de A", "inicio": "2030-01-01T10:00:00Z", "fim": "2030-01-01T11:00:00Z" })).await;
    let (st, r) = e.chamar("PUT", &format!("/api/v1/eventos/{evento_a}/vinculos"), Some(&a), Some(json!({ "notas": [nota_a], "tarefas": [tarefa_a] }))).await;
    assert_eq!(st, StatusCode::OK, "{r}");

    // B: pessoal, na equipe de B e um evento com vínculos — nada disso pode aparecer para A.
    let tarefa_b = criar(&e, "/api/v1/tarefas", &b, json!({ "titulo": "Tarefa de B", "tags": ["segredoB"] })).await;
    let evento_b = criar(&e, "/api/v1/eventos", &b, json!({ "titulo": "Evento de B", "inicio": "2030-01-02T10:00:00Z", "fim": "2030-01-02T11:00:00Z" })).await;
    let (st, r) = e.chamar("PUT", &format!("/api/v1/eventos/{evento_b}/vinculos"), Some(&b), Some(json!({ "notas": [nota_b_pessoal], "tarefas": [tarefa_b] }))).await;
    assert_eq!(st, StatusCode::OK, "{r}");
    let nota_eq_b = criar(&e, "/api/v1/notas", &b, json!({ "titulo": "Da equipe B", "espaco": format!("equipe:{eq_b}"), "tags": ["soEquipeB"] })).await;
    let nota_eq_a = criar(&e, "/api/v1/notas", &a, json!({ "titulo": "Da equipe A", "espaco": format!("equipe:{eq_a}"), "tags": ["soEquipeA"] })).await;

    // O wikilink de A para a nota de B tem de existir no índice (senão o teste não prova nada) ou, se o
    // resolvedor já o recusa, não ter nenhuma linha apontando para a nota de B.
    let alvo = nota_b_pessoal.clone();
    let origem = nota_a.clone();
    let linhas: i64 = e
        .state
        .db
        .with(move |c| Ok(c.query_row("SELECT COUNT(*) FROM links_nota WHERE nota_id_origem = ?1 AND nota_id_destino = ?2", [&origem, &alvo], |r| r.get(0))?))
        .await
        .unwrap();
    eprintln!("wikilink A->B presente no índice: {}", linhas > 0);

    let (st, ga) = e.chamar("GET", "/api/v1/grafico", Some(&a), None).await;
    assert_eq!(st, StatusCode::OK, "{ga}");
    let vistos = nos(&ga);
    for esperado in [&nota_a, &nota_a2, &tarefa_a, &evento_a, &nota_eq_a] {
        assert!(vistos.contains(esperado), "A deveria ver {esperado}");
    }
    for proibido in [&nota_b_pessoal, &tarefa_b, &evento_b, &nota_eq_b] {
        assert!(!vistos.contains(proibido), "A não pode ver {proibido}");
    }
    // Nenhuma aresta aponta para fora do conjunto de nós devolvido.
    for ar in ga["arestas"].as_array().unwrap() {
        assert!(vistos.contains(ar["origem"].as_str().unwrap()) && vistos.contains(ar["destino"].as_str().unwrap()), "aresta solta: {ar}");
    }
    assert!(!tem_aresta(&ga, &nota_a, &nota_b_pessoal, "wikilink"), "wikilink para nota invisível não pode aparecer");
    assert!(tem_aresta(&ga, &nota_a2, &nota_a, "wikilink"), "wikilink entre notas visíveis aparece");
    assert!(tem_aresta(&ga, &evento_a, &nota_a, "evento_nota"));
    assert!(tem_aresta(&ga, &evento_a, &tarefa_a, "evento_tarefa"));
    assert!(tem_aresta(&ga, &nota_a, "tag:comum", "tag"));
    assert!(tem_aresta(&ga, &tarefa_a, "tag:comum", "tag"));
    // Tags só nascem de itens visíveis.
    for t in ["tag:comum", "tag:soa", "tag:soequipea"] {
        assert!(vistos.contains(t), "falta {t}: {vistos:?}");
    }
    for t in ["tag:segredob", "tag:soequipeb"] {
        assert!(!vistos.contains(t), "tag de item invisível vazou: {t}");
    }
    assert!(!ga.to_string().contains("Segredo de B") && !ga.to_string().contains("Da equipe B"));

    // Simetria: B também não vê nada de A.
    let (_, gb) = e.chamar("GET", "/api/v1/grafico", Some(&b), None).await;
    let vb = nos(&gb);
    for proibido in [&nota_a, &nota_a2, &tarefa_a, &evento_a, &nota_eq_a, &"tag:comum".to_string(), &"tag:soa".to_string()] {
        assert!(!vb.contains(proibido), "B não pode ver {proibido}");
    }
    assert!(vb.contains(&nota_b_pessoal) && vb.contains(&nota_eq_b));
    assert!(tem_aresta(&gb, &evento_b, &nota_b_pessoal, "evento_nota"));
    assert!(tem_aresta(&gb, &evento_b, &tarefa_b, "evento_tarefa"));
}

#[tokio::test]
async fn membro_passa_a_ver_a_equipe_no_grafico_e_perde_ao_sair() {
    let e = nova();
    let (_, dono) = e.admin("diogo").await;
    let (_, thaty) = e.pessoa(&dono, "thaty").await;
    let eq = equipe(&e, &dono, "Casa").await;
    let nota = criar(&e, "/api/v1/notas", &dono, json!({ "titulo": "Da casa", "espaco": format!("equipe:{eq}"), "tags": ["casa"] })).await;
    let (_, g) = e.chamar("GET", "/api/v1/grafico", Some(&thaty), None).await;
    assert!(nos(&g).is_empty());
    let (_, c) = e.chamar("POST", &format!("/api/v1/equipes/{eq}/convites"), Some(&dono), None).await;
    e.chamar("POST", &format!("/api/v1/convites/{}/aceitar", c["codigo"].as_str().unwrap()), Some(&thaty), None).await;
    let (_, g) = e.chamar("GET", "/api/v1/grafico", Some(&thaty), None).await;
    assert!(nos(&g).contains(&nota) && nos(&g).contains("tag:casa"));
    e.chamar("POST", &format!("/api/v1/equipes/{eq}/sair"), Some(&thaty), None).await;
    let (_, g) = e.chamar("GET", "/api/v1/grafico", Some(&thaty), None).await;
    assert!(nos(&g).is_empty(), "quem saiu não vê mais nada da equipe");
}

#[tokio::test]
async fn wikilink_para_nota_criada_depois_nao_quebra_o_indice() {
    let e = nova();
    let (_, a) = e.admin("diogo").await;
    let origem = criar(&e, "/api/v1/notas", &a, json!({ "titulo": "Aaa", "corpo": "vai para [[Zzz]]" })).await;
    // Zzz nasce depois de Aaa; antes da correção o reindex falhava (FK) e toda criação seguinte dava 500.
    let destino = criar(&e, "/api/v1/notas", &a, json!({ "titulo": "Zzz", "corpo": "volta para [[Aaa]]" })).await;
    let (_, g) = e.chamar("GET", "/api/v1/grafico", Some(&a), None).await;
    assert!(tem_aresta(&g, &origem, &destino, "wikilink") && tem_aresta(&g, &destino, &origem, "wikilink"));
}

#[tokio::test]
async fn parametros_de_escala_reduzem_sem_furar_a_visibilidade() {
    let e = nova();
    let (_, a) = e.admin("diogo").await;
    let (_, b) = e.pessoa(&a, "thaty").await;
    let eq = equipe(&e, &a, "Casa").await;
    for i in 0..3 {
        criar(&e, "/api/v1/notas", &a, json!({ "titulo": format!("N{i}") })).await;
    }
    let nota_eq = criar(&e, "/api/v1/notas", &a, json!({ "titulo": "Da equipe", "espaco": format!("equipe:{eq}") })).await;
    let t_aberta = criar(&e, "/api/v1/tarefas", &a, json!({ "titulo": "Aberta" })).await;
    let t_feita = criar(&e, "/api/v1/tarefas", &a, json!({ "titulo": "Feita" })).await;
    let (st, r) = e.chamar("PATCH", &format!("/api/v1/tarefas/{t_feita}/status"), Some(&a), Some(json!({ "status": "concluida" }))).await;
    assert_eq!(st, StatusCode::OK, "{r}");
    criar(&e, "/api/v1/notas", &b, json!({ "titulo": "De B" })).await;

    let (_, g) = e.chamar("GET", "/api/v1/grafico", Some(&a), None).await;
    assert_eq!(g["nos"].as_array().unwrap().len(), 6, "contrato padrão: tudo o que A vê");
    assert_eq!(g["truncado"], false);

    let (_, g) = e.chamar("GET", "/api/v1/grafico?incluir_concluidas=false", Some(&a), None).await;
    assert!(nos(&g).contains(&t_aberta) && !nos(&g).contains(&t_feita));

    let (_, g) = e.chamar("GET", &format!("/api/v1/grafico?espaco=equipe:{eq}"), Some(&a), None).await;
    assert_eq!(nos(&g), HashSet::from([nota_eq.clone()]));

    let (_, g) = e.chamar("GET", "/api/v1/grafico?limite=2", Some(&a), None).await;
    assert_eq!(g["nos"].as_array().unwrap().len(), 2);
    assert_eq!(g["truncado"], true);

    // Pedir o espaço de outra pessoa não revela nada.
    let (_, g) = e.chamar("GET", &format!("/api/v1/grafico?espaco=equipe:{eq}"), Some(&b), None).await;
    assert!(g["nos"].as_array().unwrap().is_empty());
}
