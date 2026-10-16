//! Regressão: listagem de notas, cards de nota do Feed e métricas do perfil não dependem mais de juntar por
//! `nota_fts.id` (varredura quadrática), mas devolvem exatamente o mesmo conteúdo.

mod comum;

use comum::*;
use serde_json::json;

#[tokio::test]
async fn notas_feed_e_metricas_devolvem_titulo_corpo_tags_e_contagens() {
    let e = nova();
    let (_, token) = e.admin("diogo").await;
    let corpos = ["um dois três", "quatro cinco", "seis"];
    for (i, c) in corpos.iter().enumerate() {
        let (st, r) = e.chamar("POST", "/api/v1/notas", Some(&token), Some(json!({ "titulo": format!("Nota {i}"), "corpo": c, "tags": ["alfa"] }))).await;
        assert!(st.is_success(), "{r}");
    }
    ecos_app::jobs::ranking::executar_ciclo(&e.state).await.unwrap();

    let (_, lista) = e.chamar("GET", "/api/v1/notas?limit=2", Some(&token), None).await;
    let itens = lista["items"].as_array().unwrap();
    assert_eq!(itens.len(), 2);
    assert!(lista["next_cursor"].is_string());
    for n in itens {
        let titulo = n["titulo"].as_str().unwrap();
        let i: usize = titulo.trim_start_matches("Nota ").parse().unwrap();
        assert!(n["corpo"].as_str().unwrap().contains(corpos[i]), "corpo da {titulo}: {n}");
        assert_eq!(n["tags"], json!(["alfa"]));
        assert_eq!(n["criado_por_nome"], "diogo");
    }
    let (_, pagina2) = e.chamar("GET", &format!("/api/v1/notas?limit=2&cursor={}", lista["next_cursor"].as_str().unwrap()), Some(&token), None).await;
    assert_eq!(pagina2["items"].as_array().unwrap().len(), 1);
    assert!(pagina2["items"][0]["corpo"].as_str().unwrap().contains(corpos[pagina2["items"][0]["titulo"].as_str().unwrap().trim_start_matches("Nota ").parse::<usize>().unwrap()]));

    let (_, feed) = e.chamar("GET", "/api/v1/feed?limit=40", Some(&token), None).await;
    let cards = feed["items"].as_array().unwrap();
    let notas: Vec<_> = cards.iter().filter(|c| c["tipo"] == "nota").collect();
    assert_eq!(notas.len(), 3, "{feed}");
    for c in notas {
        let i: usize = c["titulo"].as_str().unwrap().trim_start_matches("Nota ").parse().unwrap();
        assert!(c["corpo"].as_str().unwrap().contains(corpos[i]));
        assert!(c["preview"].as_str().unwrap().contains(corpos[i]));
        assert_eq!(c["tags"], json!(["alfa"]));
        assert_eq!(c["criado_por_nome"], "diogo");
    }

    let (st, m) = e.chamar("GET", "/api/v1/me/metricas?escopo=pessoal", Some(&token), None).await;
    assert!(st.is_success(), "{m}");
    assert_eq!(m["notas"], 3);
    // títulos "Nota i" (2 palavras cada = 6) + corpos (3 + 2 + 1 = 6 palavras)
    assert_eq!(m["palavras"], 12, "{m}");
}
