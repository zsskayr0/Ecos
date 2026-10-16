//! Importador de Markdown/ZIP: prévia sem gravar, aplicação, idempotência e busca refletindo os itens.

mod comum;

use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use comum::*;
use serde_json::{json, Value};
use tower::Service;

fn zip(itens: &[(&str, &[u8])]) -> Vec<u8> {
    // O escritor do Ecos gera "stored", que o importador também lê.
    let mut z = ecos_app::zip::ZipWriter::new(Vec::new());
    for (n, d) in itens {
        z.adicionar_bytes(n, d).unwrap();
    }
    z.finalizar().unwrap()
}

async fn enviar(e: &Instancia, token: &str, nome: &str, dados: Vec<u8>) -> (StatusCode, Value) {
    let mut corpo = format!("--limite\r\nContent-Disposition: form-data; name=\"arquivo\"; filename=\"{nome}\"\r\nContent-Type: application/octet-stream\r\n\r\n").into_bytes();
    corpo.extend_from_slice(&dados);
    corpo.extend_from_slice(b"\r\n--limite--\r\n");
    let r = e.app.clone().call(
        Request::post("/api/v1/me/importacao/validar")
            .header("authorization", format!("Bearer {token}"))
            .header("content-type", "multipart/form-data; boundary=limite")
            .body(Body::from(corpo)).unwrap(),
    ).await.unwrap();
    let st = r.status();
    let b = to_bytes(r.into_body(), 4 * 1024 * 1024).await.unwrap();
    (st, serde_json::from_slice(&b).unwrap_or(Value::Null))
}

async fn contar_notas(e: &Instancia, token: &str) -> usize {
    // A listagem é por pasta: raiz + "Projetos".
    let mut total = 0;
    for uri in ["/api/v1/notas", "/api/v1/notas?pasta=Projetos"] {
        let (_, v) = e.chamar("GET", uri, Some(token), None).await;
        total += v["items"].as_array().map(|a| a.len()).unwrap_or(0);
    }
    total
}

#[tokio::test]
async fn previa_nao_grava_aplicar_importa_e_repetir_nao_duplica() {
    let e = nova();
    let (_, token) = e.admin("ana").await;
    let pacote = zip(&[
        ("Vault/Projetos/Plano.md", "# Plano zebrafish\ncorpo".as_bytes()),
        ("Vault/Solta.md", b"nota solta"),
        ("Vault/anexo.png", &[1, 2, 3]),
    ]);
    let antes = contar_notas(&e, &token).await;

    let (st, rel) = enviar(&e, &token, "vault.zip", pacote.clone()).await;
    assert_eq!(st, StatusCode::OK, "{rel}");
    assert_eq!(rel["novas"], 2);
    assert_eq!(rel["ignorados_total"], 1);
    assert_eq!(contar_notas(&e, &token).await, antes, "validar não grava");
    let tk = rel["token"].as_str().unwrap().to_string();

    let (st, _) = e.chamar("POST", &format!("/api/v1/me/importacao/{tk}/aplicar"), Some(&token), Some(json!({ "confirm": "sim" }))).await;
    assert_ne!(st, StatusCode::OK);
    assert_eq!(contar_notas(&e, &token).await, antes);

    let (st, res) = e.chamar("POST", &format!("/api/v1/me/importacao/{tk}/aplicar"), Some(&token), Some(json!({ "confirm": "IMPORTAR" }))).await;
    assert_eq!(st, StatusCode::OK, "{res}");
    assert_eq!(res["importadas"], 2);
    assert_eq!(contar_notas(&e, &token).await, antes + 2);
    let (_, busca) = e.chamar("GET", "/api/v1/busca?q=zebrafish", Some(&token), None).await;
    assert!(busca.to_string().contains("Plano zebrafish"), "busca reflete a importação: {busca}");

    // Segunda vez: tudo já importado, nada novo.
    let (st, rel2) = enviar(&e, &token, "vault.zip", pacote).await;
    assert_eq!(st, StatusCode::OK, "{rel2}");
    assert_eq!(rel2["novas"], 0);
    assert_eq!(rel2["ja_importadas"], 2);
    assert_eq!(contar_notas(&e, &token).await, antes + 2);

    // Lixo é recusado e nada fica.
    let (st, _) = enviar(&e, &token, "x.zip", b"PK\x03\x04 lixo lixo lixo lixo lixo".to_vec()).await;
    assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY);
}
