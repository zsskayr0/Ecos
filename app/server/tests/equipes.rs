//! Equipes: criação, convite, papéis, o que um membro vê e o que só o dono pode.

mod comum;

use axum::http::StatusCode;
use comum::*;
use serde_json::json;

#[tokio::test]
async fn convite_leva_a_pessoa_para_a_equipe_e_ela_passa_a_ver_o_que_e_da_equipe() {
    let e = nova();
    let (_, dono) = e.admin("diogo").await;
    let (_, thaty) = e.pessoa(&dono, "thaty").await;
    let (_, visita) = e.pessoa(&dono, "visita").await;

    let (st, equipe) = e.chamar("POST", "/api/v1/equipes", Some(&dono), Some(json!({ "nome": "Casa" }))).await;
    assert_eq!(st, StatusCode::OK, "{equipe}");
    let eq = equipe["id"].as_str().unwrap().to_string();

    let (_, nota) = e.chamar("POST", "/api/v1/notas", Some(&dono), Some(json!({ "titulo": "Lista da casa", "espaco": format!("equipe:{eq}") }))).await;
    let nota_id = nota["id"].as_str().unwrap().to_string();
    assert!(e.raiz.join("Casa/Notas").is_dir(), "a equipe tem a própria pasta");

    // Antes do convite, ninguém de fora enxerga a equipe nem o que há nela.
    assert_eq!(e.chamar("GET", &format!("/api/v1/equipes/{eq}"), Some(&thaty), None).await.0, StatusCode::NOT_FOUND);
    assert_eq!(e.chamar("GET", &format!("/api/v1/notas/{nota_id}"), Some(&thaty), None).await.0, StatusCode::NOT_FOUND);
    let (_, minhas) = e.chamar("GET", "/api/v1/equipes", Some(&thaty), None).await;
    assert!(ids(&minhas).is_empty());

    let (st, convite) = e.chamar("POST", &format!("/api/v1/equipes/{eq}/convites"), Some(&dono), None).await;
    assert_eq!(st, StatusCode::OK, "{convite}");
    let codigo = convite["codigo"].as_str().unwrap().to_string();

    let (st, corpo) = e.chamar("POST", &format!("/api/v1/convites/{codigo}/aceitar"), Some(&thaty), None).await;
    assert_eq!(st, StatusCode::OK, "{corpo}");
    let (st, _) = e.chamar("POST", &format!("/api/v1/convites/{codigo}/aceitar"), Some(&visita), None).await;
    assert_eq!(st, StatusCode::CONFLICT, "convite é de uso único");
    let (st, _) = e.chamar("POST", "/api/v1/convites/CODIGO-INVENTADO/aceitar", Some(&visita), None).await;
    assert_eq!(st, StatusCode::NOT_FOUND);

    // Agora a Thaty é membro: vê a equipe e a nota; a visita continua de fora.
    assert_eq!(e.chamar("GET", &format!("/api/v1/notas/{nota_id}"), Some(&thaty), None).await.0, StatusCode::OK);
    let (_, lista) = e.chamar("GET", "/api/v1/notas", Some(&thaty), None).await;
    assert_eq!(ids(&lista), vec![nota_id.clone()]);
    assert_eq!(e.chamar("GET", &format!("/api/v1/notas/{nota_id}"), Some(&visita), None).await.0, StatusCode::NOT_FOUND);
    let (st, _) = e.chamar("POST", "/api/v1/notas", Some(&visita), Some(json!({ "titulo": "intrusa", "espaco": format!("equipe:{eq}") }))).await;
    assert_eq!(st, StatusCode::FORBIDDEN, "criar dentro de equipe alheia");

    let (st, membros) = e.chamar("GET", &format!("/api/v1/equipes/{eq}/membros"), Some(&thaty), None).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(membros.as_array().or(membros["items"].as_array()).map(|m| m.len()), Some(2), "{membros}");
    assert_eq!(e.chamar("GET", &format!("/api/v1/equipes/{eq}/membros"), Some(&visita), None).await.0, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn membro_comum_nao_convida_nao_muda_cargo_nem_exclui_a_equipe() {
    let e = nova();
    let (_, dono) = e.admin("diogo").await;
    let (id_thaty, thaty) = e.pessoa(&dono, "thaty").await;
    let (_, equipe) = e.chamar("POST", "/api/v1/equipes", Some(&dono), Some(json!({ "nome": "Casa" }))).await;
    let eq = equipe["id"].as_str().unwrap().to_string();
    let (_, convite) = e.chamar("POST", &format!("/api/v1/equipes/{eq}/convites"), Some(&dono), None).await;
    e.chamar("POST", &format!("/api/v1/convites/{}/aceitar", convite["codigo"].as_str().unwrap()), Some(&thaty), None).await;

    assert_eq!(e.chamar("POST", &format!("/api/v1/equipes/{eq}/convites"), Some(&thaty), None).await.0, StatusCode::FORBIDDEN, "membro comum não convida");
    let (st, _) = e.chamar("PATCH", &format!("/api/v1/equipes/{eq}/membros/{id_thaty}"), Some(&thaty), Some(json!({ "cargo": "dono" }))).await;
    assert_eq!(st, StatusCode::FORBIDDEN, "ninguém se promove a dono");
    let (st, _) = e.chamar("PATCH", &format!("/api/v1/equipes/{eq}"), Some(&thaty), Some(json!({ "nome": "Minha" }))).await;
    assert_eq!(st, StatusCode::FORBIDDEN, "membro comum não renomeia");
    let (st, _) = e.chamar("DELETE", &format!("/api/v1/equipes/{eq}"), Some(&thaty), Some(json!({ "confirm": "EXCLUIR EQUIPE" }))).await;
    assert_eq!(st, StatusCode::FORBIDDEN, "só o dono exclui");
    assert_eq!(e.chamar("GET", &format!("/api/v1/equipes/{eq}"), Some(&dono), None).await.0, StatusCode::OK, "a equipe segue de pé");
}

#[tokio::test]
async fn excluir_equipe_exige_a_frase_e_leva_o_acesso_junto() {
    let e = nova();
    let (_, dono) = e.admin("diogo").await;
    let (_, equipe) = e.chamar("POST", "/api/v1/equipes", Some(&dono), Some(json!({ "nome": "Casa" }))).await;
    let eq = equipe["id"].as_str().unwrap().to_string();

    let (st, _) = e.chamar("DELETE", &format!("/api/v1/equipes/{eq}"), Some(&dono), Some(json!({ "confirm": "sim" }))).await;
    assert_ne!(st, StatusCode::OK, "sem a frase de confirmação nada é apagado");
    assert_eq!(e.chamar("GET", &format!("/api/v1/equipes/{eq}"), Some(&dono), None).await.0, StatusCode::OK);

    let (st, corpo) = e.chamar("DELETE", &format!("/api/v1/equipes/{eq}"), Some(&dono), Some(json!({ "confirm": "EXCLUIR EQUIPE" }))).await;
    assert_eq!(st, StatusCode::OK, "{corpo}");
    assert_eq!(e.chamar("GET", &format!("/api/v1/equipes/{eq}"), Some(&dono), None).await.0, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn membro_sai_e_perde_o_acesso_mas_dono_com_gente_na_equipe_nao_sai() {
    let e = nova();
    let (_, dono) = e.admin("diogo").await;
    let (_, thaty) = e.pessoa(&dono, "thaty").await;
    let (_, equipe) = e.chamar("POST", "/api/v1/equipes", Some(&dono), Some(json!({ "nome": "Casa" }))).await;
    let eq = equipe["id"].as_str().unwrap().to_string();
    let (_, nota) = e.chamar("POST", "/api/v1/notas", Some(&dono), Some(json!({ "titulo": "Da casa", "espaco": format!("equipe:{eq}") }))).await;
    let nota_id = nota["id"].as_str().unwrap().to_string();
    let (_, convite) = e.chamar("POST", &format!("/api/v1/equipes/{eq}/convites"), Some(&dono), None).await;
    e.chamar("POST", &format!("/api/v1/convites/{}/aceitar", convite["codigo"].as_str().unwrap()), Some(&thaty), None).await;

    assert_eq!(e.chamar("POST", &format!("/api/v1/equipes/{eq}/sair"), Some(&dono), None).await.0, StatusCode::CONFLICT, "o dono precisa transferir antes de sair");
    assert_eq!(e.chamar("POST", &format!("/api/v1/equipes/{eq}/sair"), Some(&thaty), None).await.0, StatusCode::OK);
    assert_eq!(e.chamar("GET", &format!("/api/v1/notas/{nota_id}"), Some(&thaty), None).await.0, StatusCode::NOT_FOUND, "quem saiu deixa de ver a equipe");
}

#[tokio::test]
async fn administracao_coloca_uma_conta_na_equipe_sem_convite() {
    let e = nova();
    let (_, admin) = e.admin("diogo").await;
    let (id_thaty, thaty) = e.pessoa(&admin, "thaty").await;
    let (_, equipe) = e.chamar("POST", "/api/v1/equipes", Some(&admin), Some(json!({ "nome": "Casa" }))).await;
    let eq = equipe["id"].as_str().unwrap().to_string();

    let (st, _) = e.chamar("POST", &format!("/api/v1/admin/equipes/{eq}/membros"), Some(&thaty), Some(json!({ "usuario_id": id_thaty }))).await;
    assert!(matches!(st, StatusCode::FORBIDDEN | StatusCode::NOT_FOUND), "só quem administra a instância ({st})");
    assert_eq!(e.chamar("GET", &format!("/api/v1/equipes/{eq}"), Some(&thaty), None).await.0, StatusCode::NOT_FOUND, "nada mudou");
    let (st, corpo) = e.chamar("POST", &format!("/api/v1/admin/equipes/{eq}/membros"), Some(&admin), Some(json!({ "usuario_id": id_thaty }))).await;
    assert_eq!(st, StatusCode::OK, "{corpo}");
    assert_eq!(e.chamar("GET", &format!("/api/v1/equipes/{eq}"), Some(&thaty), None).await.0, StatusCode::OK);
}
