//! Wikilinks entre notas e tarefas: quatro sentidos, prefixos, colisão, espaços e endpoints de lote/sugestão.

mod comum;

use axum::http::StatusCode;
use comum::*;
use serde_json::{json, Value};

async fn criar(e: &Instancia, rota: &str, token: &str, corpo: Value) -> String {
    let (st, r) = e.chamar("POST", rota, Some(token), Some(corpo)).await;
    assert_eq!(st, StatusCode::OK, "{rota}: {r}");
    r["id"].as_str().unwrap().to_string()
}

async fn links(e: &Instancia, rota: &str, token: &str) -> (Vec<String>, Vec<String>) {
    let (st, r) = e.chamar("GET", rota, Some(token), None).await;
    assert_eq!(st, StatusCode::OK, "{r}");
    let f = |k: &str| r[k].as_array().unwrap().iter().map(|x| format!("{}:{}", x["tipo"].as_str().unwrap(), x["id"].as_str().unwrap())).collect::<Vec<_>>();
    (f("entrada"), f("saida"))
}

async fn resolver(e: &Instancia, token: &str, corpo: Value) -> Value {
    let (st, r) = e.chamar("POST", "/api/v1/links/resolver", Some(token), Some(corpo)).await;
    assert_eq!(st, StatusCode::OK, "{r}");
    r["resolvidos"].clone()
}

#[tokio::test]
async fn quatro_sentidos_e_prefixos() {
    let e = nova();
    let (_, a) = e.admin("ana").await;
    let n1 = criar(&e, "/api/v1/notas", &a, json!({ "titulo": "Nota Um" })).await;
    let t1 = criar(&e, "/api/v1/tarefas", &a, json!({ "titulo": "Tarefa Um" })).await;
    let n2 = criar(&e, "/api/v1/notas", &a, json!({ "titulo": "Nota Dois", "corpo": "[[Nota Um]] [[Tarefa Um]]" })).await;
    let t2 = criar(&e, "/api/v1/tarefas", &a, json!({ "titulo": "Tarefa Dois", "corpo": "[[nota:Nota Um|apelido]] e [[TAREFA:Tarefa Um]] e [[Tarefa Dois]]" })).await;

    let (ent, sai) = links(&e, &format!("/api/v1/notas/{n2}/links"), &a).await;
    assert!(ent.is_empty());
    assert_eq!(sai, vec![format!("nota:{n1}"), format!("tarefa:{t1}")]);
    let (ent, sai) = links(&e, &format!("/api/v1/tarefas/{t2}/links"), &a).await;
    assert!(ent.is_empty());
    assert_eq!(sai, vec![format!("nota:{n1}"), format!("tarefa:{t1}")], "autolink ignorado");
    let (ent, _) = links(&e, &format!("/api/v1/notas/{n1}/links"), &a).await;
    assert_eq!(ent.len(), 2);
    assert!(ent.contains(&format!("nota:{n2}")) && ent.contains(&format!("tarefa:{t2}")));
    let (ent, _) = links(&e, &format!("/api/v1/tarefas/{t1}/links"), &a).await;
    assert_eq!(ent.len(), 2);

    // Grafo: arestas com tarefas.
    let (_, g) = e.chamar("GET", "/api/v1/grafico", Some(&a), None).await;
    let tem = |o: &str, d: &str| g["arestas"].as_array().unwrap().iter().any(|x| x["origem"] == o && x["destino"] == d && x["tipo"] == "wikilink");
    assert!(tem(&n2, &t1) && tem(&t2, &n1) && tem(&t2, &t1) && tem(&n2, &n1));

    // Renomear o alvo: o link fica sem resolver (não aponta para o item errado).
    let (st, _) = e.chamar("PATCH", &format!("/api/v1/tarefas/{t1}"), Some(&a), Some(json!({ "titulo": "Outro nome" }))).await;
    assert_eq!(st, StatusCode::OK);
    let (_, sai) = links(&e, &format!("/api/v1/notas/{n2}/links"), &a).await;
    assert_eq!(sai, vec![format!("nota:{n1}")]);
}

#[tokio::test]
async fn colisao_prefere_nota_e_empate_pega_o_mais_recente() {
    let e = nova();
    let (_, a) = e.admin("ana").await;
    let t = criar(&e, "/api/v1/tarefas", &a, json!({ "titulo": "Plano" })).await;
    let n_velha = criar(&e, "/api/v1/notas", &a, json!({ "titulo": "plano" })).await;
    std::thread::sleep(std::time::Duration::from_millis(30));
    let n_nova = criar(&e, "/api/v1/notas", &a, json!({ "titulo": " PLANO " })).await;
    let r = resolver(&e, &a, json!({ "titulos": ["Plano", "tarefa:Plano", "nota:plano", "Nada", "nota:"] })).await;
    assert_eq!(r["Plano"]["id"], n_nova);
    assert_eq!(r["Plano"]["tipo"], "nota");
    assert_eq!(r["tarefa:Plano"]["id"], t);
    assert_eq!(r["nota:plano"]["id"], n_nova);
    assert!(r["Nada"].is_null() && r["nota:"].is_null());
    let _ = n_velha;
}

#[tokio::test]
async fn nunca_cruza_espaco_nem_vaza_titulo() {
    let e = nova();
    let (_, a) = e.admin("ana").await;
    let (id_b, b) = e.pessoa(&a, "bia").await;
    let _ = id_b;
    let secreta_b = criar(&e, "/api/v1/notas", &b, json!({ "titulo": "Segredo de Bia" })).await;
    let tarefa_b = criar(&e, "/api/v1/tarefas", &b, json!({ "titulo": "Tarefa secreta de Bia" })).await;
    let nota_a = criar(&e, "/api/v1/notas", &a, json!({ "titulo": "Da Ana", "corpo": "[[Segredo de Bia]] [[Tarefa secreta de Bia]]" })).await;

    // Índice: nada de A aponta para B.
    let (_, sai) = links(&e, &format!("/api/v1/notas/{nota_a}/links"), &a).await;
    assert!(sai.is_empty(), "{sai:?}");
    let (ent, _) = links(&e, &format!("/api/v1/notas/{secreta_b}/links"), &b).await;
    assert!(ent.is_empty());
    // Itens alheios: 404 em /links, null no resolver, ausente nas sugestões.
    assert_eq!(e.chamar("GET", &format!("/api/v1/notas/{secreta_b}/links"), Some(&a), None).await.0, StatusCode::NOT_FOUND);
    assert_eq!(e.chamar("GET", &format!("/api/v1/tarefas/{tarefa_b}/links"), Some(&a), None).await.0, StatusCode::NOT_FOUND);
    let r = resolver(&e, &a, json!({ "titulos": ["Segredo de Bia"] })).await;
    assert!(r["Segredo de Bia"].is_null());
    let (st, _) = e.chamar("POST", "/api/v1/links/resolver", Some(&a), Some(json!({ "titulos": ["x"], "origem": { "tipo": "nota", "id": secreta_b } }))).await;
    assert_eq!(st, StatusCode::NOT_FOUND, "origem invisível");
    let (_, s) = e.chamar("GET", "/api/v1/links/sugestoes?q=segredo", Some(&a), None).await;
    assert!(s.as_array().unwrap().is_empty(), "{s}");
    let (_, s) = e.chamar("GET", "/api/v1/links/sugestoes", Some(&a), None).await;
    assert_eq!(s.as_array().unwrap().len(), 1);

    // Equipe: Ana e Bia na mesma equipe; link de dentro da equipe só resolve para itens da equipe.
    let eq = criar(&e, "/api/v1/equipes", &a, json!({ "nome": "Casa" })).await;
    let convite = e.chamar("POST", &format!("/api/v1/equipes/{eq}/convites"), Some(&a), None).await.1;
    let codigo = convite["codigo"].as_str().unwrap().to_string();
    assert_eq!(e.chamar("POST", &format!("/api/v1/convites/{codigo}/aceitar"), Some(&b), None).await.0, StatusCode::OK);
    let espaco = format!("equipe:{eq}");
    let alvo_eq = criar(&e, "/api/v1/notas", &a, json!({ "titulo": "Alvo", "espaco": espaco })).await;
    let _alvo_pessoal_a = criar(&e, "/api/v1/notas", &a, json!({ "titulo": "Alvo", "corpo": "" })).await;
    let origem_eq = criar(&e, "/api/v1/tarefas", &b, json!({ "titulo": "Da equipe", "corpo": "[[Alvo]] [[Segredo de Bia]]", "espaco": espaco })).await;
    let (_, sai) = links(&e, &format!("/api/v1/tarefas/{origem_eq}/links"), &b).await;
    assert_eq!(sai, vec![format!("nota:{alvo_eq}")], "só o item do mesmo espaço");
    // Com origem na equipe o resolvedor fica na equipe; sem origem a pessoal vence.
    let r = resolver(&e, &a, json!({ "titulos": ["Alvo"], "origem": { "tipo": "tarefa", "id": origem_eq } })).await;
    assert_eq!(r["Alvo"]["id"], alvo_eq);
    let r = resolver(&e, &a, json!({ "titulos": ["Alvo"] })).await;
    assert_ne!(r["Alvo"]["id"], alvo_eq);
}

#[tokio::test]
async fn sugestoes_e_limites_e_autenticacao() {
    let e = nova();
    let (_, a) = e.admin("ana").await;
    let (_, b) = (0, a.clone());
    let sub = criar(&e, "/api/v1/notas", &b, json!({ "titulo": "Casa de praia" })).await;
    std::thread::sleep(std::time::Duration::from_millis(30));
    let pre = criar(&e, "/api/v1/tarefas", &b, json!({ "titulo": "Praia: comprar protetor" })).await;
    let (_, s) = e.chamar("GET", "/api/v1/links/sugestoes?q=PRAIA", Some(&a), None).await;
    let ids: Vec<&str> = s.as_array().unwrap().iter().map(|x| x["id"].as_str().unwrap()).collect();
    assert_eq!(ids, vec![pre.as_str(), sub.as_str()], "prefixo antes de substring");
    assert_eq!(s[0]["tipo"], "tarefa");
    let (_, s) = e.chamar("GET", &format!("/api/v1/links/sugestoes?q=praia&excluir_id={pre}&limite=1"), Some(&a), None).await;
    assert_eq!(s.as_array().unwrap().len(), 1);
    assert_eq!(s[0]["id"], sub);
    let (_, s) = e.chamar("GET", "/api/v1/links/sugestoes?limite=999", Some(&a), None).await;
    assert!(s.as_array().unwrap().len() <= 50);

    let muitos: Vec<String> = (0..201).map(|i| format!("t{i}")).collect();
    let (st, _) = e.chamar("POST", "/api/v1/links/resolver", Some(&a), Some(json!({ "titulos": muitos }))).await;
    assert!(st.is_client_error());
    let ok: Vec<String> = (0..200).map(|i| format!("t{i}")).collect();
    assert_eq!(e.chamar("POST", "/api/v1/links/resolver", Some(&a), Some(json!({ "titulos": ok }))).await.0, StatusCode::OK);

    for (m, u) in [("POST", "/api/v1/links/resolver"), ("GET", "/api/v1/links/sugestoes"), ("GET", "/api/v1/tarefas/x/links"), ("GET", "/api/v1/notas/x/links")] {
        assert_eq!(e.chamar(m, u, None, if m == "POST" { Some(json!({ "titulos": [] })) } else { None }).await.0, StatusCode::UNAUTHORIZED, "{u}");
    }
}

#[tokio::test]
async fn atalho_do_digest_nao_esconde_mudanca_no_corpo_de_tarefa() {
    let e = nova();
    let (_, a) = e.admin("ana").await;
    let n = criar(&e, "/api/v1/notas", &a, json!({ "titulo": "Alvo" })).await;
    let t = criar(&e, "/api/v1/tarefas", &a, json!({ "titulo": "Origem" })).await;
    let (_, sai) = links(&e, &format!("/api/v1/tarefas/{t}/links"), &a).await;
    assert!(sai.is_empty());
    // Edita o .md por fora (sem rota) e reindexa: o corpo da tarefa entra no resumo.
    let dir = e.raiz.join("ana/Tarefas");
    let arq = std::fs::read_dir(&dir).unwrap().flatten().map(|x| x.path()).find(|p| p.extension().map(|x| x == "md").unwrap_or(false)).unwrap();
    let c = std::fs::read_to_string(&arq).unwrap();
    std::fs::write(&arq, format!("{c}\nveja [[Alvo]]\n")).unwrap();
    ecos_app::db::reindex::reindexar_tudo(&e.state.db, &e.state.config.notes_root).await.unwrap();
    let (_, sai) = links(&e, &format!("/api/v1/tarefas/{t}/links"), &a).await;
    assert_eq!(sai, vec![format!("nota:{n}")]);
}
