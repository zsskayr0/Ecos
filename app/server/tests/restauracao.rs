//! Exportar e restaurar: round-trip, validação prévia, conflitos sem sobrescrita e backup de segurança.

mod comum;

use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use comum::*;
use serde_json::{json, Value};
use tower::Service;

async fn exportar(e: &Instancia, token: &str) -> Vec<u8> {
    let r = e.app.clone().call(Request::get("/api/v1/me/export").header("authorization", format!("Bearer {token}")).body(Body::empty()).unwrap()).await.unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    to_bytes(r.into_body(), 64 * 1024 * 1024).await.unwrap().to_vec()
}

async fn enviar_pacote(e: &Instancia, token: &str, zip: Vec<u8>) -> (StatusCode, Value) {
    let mut corpo = b"--limite\r\nContent-Disposition: form-data; name=\"arquivo\"; filename=\"pacote.zip\"\r\nContent-Type: application/zip\r\n\r\n".to_vec();
    corpo.extend_from_slice(&zip);
    corpo.extend_from_slice(b"\r\n--limite--\r\n");
    let r = e.app.clone().call(
        Request::post("/api/v1/me/restauracao/validar")
            .header("authorization", format!("Bearer {token}"))
            .header("content-type", "multipart/form-data; boundary=limite")
            .body(Body::from(corpo)).unwrap(),
    ).await.unwrap();
    let status = r.status();
    let bytes = to_bytes(r.into_body(), 4 * 1024 * 1024).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

fn arquivos_com(raiz: &std::path::Path, sufixo: &str) -> usize {
    walkdir::WalkDir::new(raiz).into_iter().filter_map(Result::ok).filter(|f| f.file_type().is_file() && f.file_name().to_string_lossy().ends_with(sufixo)).count()
}

#[tokio::test]
async fn round_trip_restaura_o_que_sumiu_preserva_o_que_mudou_e_gera_backup() {
    let e = nova();
    let (_, token) = e.admin("ana").await;
    let (_, n1) = e.chamar("POST", "/api/v1/notas", Some(&token), Some(json!({ "titulo": "Ideias", "corpo": "primeira versao" }))).await;
    let (_, n2) = e.chamar("POST", "/api/v1/notas", Some(&token), Some(json!({ "titulo": "Diario", "corpo": "dia 1" }))).await;
    let (_, t1) = e.chamar("POST", "/api/v1/tarefas", Some(&token), Some(json!({ "titulo": "Pagar conta", "due_date": "2026-10-20" }))).await;
    e.chamar("PATCH", "/api/v1/me/preferencias/calendario", Some(&token), Some(json!({ "pais": "Portugal", "fuso": "Europe/Lisbon", "inicio": "07:30", "deadlines": false }))).await;
    e.chamar("POST", "/api/v1/rotina/blocos", Some(&token), Some(json!({ "tipo": "sono", "hora_inicio": "23:00", "hora_fim": "06:00", "dias_semana": "diario", "classificacao": "indisponivel" }))).await;
    let (id_n1, id_n2, id_t1) = (n1["id"].as_str().unwrap().to_string(), n2["id"].as_str().unwrap().to_string(), t1["id"].as_str().unwrap().to_string());

    let zip = exportar(&e, &token).await;

    // Estado "depois do desastre": uma nota foi editada, a outra e a tarefa foram apagadas de vez (arquivos removidos).
    let (st, _) = e.chamar("PATCH", &format!("/api/v1/notas/{id_n1}"), Some(&token), Some(json!({ "corpo": "versao nova, editada depois" }))).await;
    assert_eq!(st, StatusCode::OK);
    for rel in e.state.db.with(|c| {
        let mut s = c.prepare("SELECT caminho_arquivo FROM nota WHERE titulo = 'Diario' UNION SELECT caminho_arquivo FROM tarefa")?;
        let v = s.query_map([], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
        Ok(v)
    }).await.unwrap() {
        std::fs::remove_file(e.raiz.join(rel)).unwrap();
    }
    ecos_app::db::reindex::reindexar_tudo(&e.state.db, &e.raiz).await.unwrap();
    assert_eq!(e.chamar("GET", &format!("/api/v1/notas/{id_n2}"), Some(&token), None).await.0, StatusCode::NOT_FOUND);
    e.chamar("PATCH", "/api/v1/me/preferencias/calendario", Some(&token), Some(json!({ "pais": "Brasil", "fuso": "America/Sao_Paulo", "inicio": "06:00", "deadlines": true }))).await;

    // Validação prévia: não grava nada.
    let (st, rel) = enviar_pacote(&e, &token, zip.clone()).await;
    assert_eq!(st, StatusCode::OK, "{rel}");
    assert_eq!(rel["novos"], 2, "{rel}");
    assert_eq!(rel["conflitos_total"], 1, "a nota editada difere do pacote");
    assert_eq!(rel["conflitos"][0]["copiavel"], false, "mesmo identificador: a versão atual não é sobreposta nem duplicada");
    assert_eq!(rel["tem_configuracoes"], true);
    assert_eq!(e.chamar("GET", &format!("/api/v1/notas/{id_n2}"), Some(&token), None).await.0, StatusCode::NOT_FOUND, "validar não restaura");
    let token_pacote = rel["token"].as_str().unwrap().to_string();

    // Sem a frase, nada acontece.
    let (st, _) = e.chamar("POST", &format!("/api/v1/me/restauracao/{token_pacote}/aplicar"), Some(&token), Some(json!({ "confirm": "sim" }))).await;
    assert_ne!(st, StatusCode::OK);
    assert_eq!(e.chamar("GET", &format!("/api/v1/notas/{id_n2}"), Some(&token), None).await.0, StatusCode::NOT_FOUND);

    let (st, res) = e.chamar("POST", &format!("/api/v1/me/restauracao/{token_pacote}/aplicar"), Some(&token), Some(json!({ "confirm": "RESTAURAR", "restaurar_configuracoes": true }))).await;
    assert_eq!(st, StatusCode::OK, "{res}");
    assert_eq!(res["restaurados"], 2);
    assert_eq!(res["conflitos_ignorados"], 1);
    assert_eq!(res["configuracoes_aplicadas"], 2);

    // Voltaram a nota e a tarefa; a nota editada continua com a versão nova; configurações do pacote aplicadas.
    let (st, volta) = e.chamar("GET", &format!("/api/v1/notas/{id_n2}"), Some(&token), None).await;
    assert_eq!((st, volta["corpo"].as_str().unwrap().trim()), (StatusCode::OK, "dia 1"));
    assert_eq!(e.chamar("GET", &format!("/api/v1/tarefas/{id_t1}"), Some(&token), None).await.0, StatusCode::OK);
    let (_, editada) = e.chamar("GET", &format!("/api/v1/notas/{id_n1}"), Some(&token), None).await;
    assert!(editada["corpo"].as_str().unwrap().contains("versao nova"), "nada foi sobrescrito");
    let (_, prefs) = e.chamar("GET", "/api/v1/me/preferencias/calendario", Some(&token), None).await;
    assert_eq!((prefs["pais"].as_str(), prefs["fuso"].as_str()), (Some("Portugal"), Some("Europe/Lisbon")));

    // Backup de segurança gerado antes de gravar, fora das árvores de notas.
    let backups = e.raiz.join(".ecos/backups/restauracao");
    assert_eq!(arquivos_com(&backups, ".zip"), 1);
    assert_eq!(res["backup"].as_str().unwrap().starts_with("pre-restauracao-"), true);
    // O pacote enviado foi descartado; reaplicar o mesmo token falha.
    let (st, _) = e.chamar("POST", &format!("/api/v1/me/restauracao/{token_pacote}/aplicar"), Some(&token), Some(json!({ "confirm": "RESTAURAR" }))).await;
    assert_eq!(st, StatusCode::NOT_FOUND);
    assert_eq!(arquivos_com(&e.raiz.join(".ecos/tmp/restauracao"), ".zip"), 0);
}

#[tokio::test]
async fn pacote_invalido_ou_adulterado_e_recusado_e_cancelar_descarta() {
    let e = nova();
    let (_, token) = e.admin("ana").await;
    e.chamar("POST", "/api/v1/notas", Some(&token), Some(json!({ "titulo": "Minha nota", "corpo": "x" }))).await;
    let zip = exportar(&e, &token).await;

    // Lixo e zip adulterado (um byte do conteúdo muda: o CRC não confere).
    let (st, _) = enviar_pacote(&e, &token, b"isto nao e um zip, mas tem mais de vinte e dois bytes".to_vec()).await;
    assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY);
    let mut adulterado = zip.clone();
    let pos = adulterado.windows(13).position(|w| w == b"titulo: Minha").unwrap();
    adulterado[pos + 8] = b'X';
    let (st, corpo) = enviar_pacote(&e, &token, adulterado).await;
    assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY, "{corpo}");
    assert!(corpo["message"].as_str().unwrap().contains("CRC"), "{corpo}");
    assert_eq!(arquivos_com(&e.raiz.join(".ecos/tmp/restauracao"), ".zip"), 0, "pacote recusado não fica no servidor");

    // Cancelar descarta o pacote válido enviado.
    let (st, rel) = enviar_pacote(&e, &token, zip).await;
    assert_eq!(st, StatusCode::OK, "{rel}");
    assert_eq!(arquivos_com(&e.raiz.join(".ecos/tmp/restauracao"), ".zip"), 1);
    let (st, _) = e.chamar("DELETE", &format!("/api/v1/me/restauracao/{}", rel["token"].as_str().unwrap()), Some(&token), None).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(arquivos_com(&e.raiz.join(".ecos/tmp/restauracao"), ".zip"), 0);
}

#[tokio::test]
async fn pacote_de_outra_pessoa_nao_e_aplicavel_e_exige_sessao() {
    let e = nova();
    let (_, admin) = e.admin("ana").await;
    let (_, bia) = e.pessoa(&admin, "bia").await;
    e.chamar("POST", "/api/v1/notas", Some(&admin), Some(json!({ "titulo": "Da Ana", "corpo": "x" }))).await;
    let zip = exportar(&e, &admin).await;
    let (_, rel) = enviar_pacote(&e, &admin, zip).await;
    let token = rel["token"].as_str().unwrap();

    // A Bia não consegue aplicar nem cancelar o pacote da Ana.
    let (st, _) = e.chamar("POST", &format!("/api/v1/me/restauracao/{token}/aplicar"), Some(&bia), Some(json!({ "confirm": "RESTAURAR" }))).await;
    assert_eq!(st, StatusCode::NOT_FOUND);
    e.chamar("DELETE", &format!("/api/v1/me/restauracao/{token}"), Some(&bia), None).await;
    assert_eq!(arquivos_com(&e.raiz.join(".ecos/tmp/restauracao"), ".zip"), 1, "o pacote da Ana segue lá");
    // Sem sessão: 401.
    let (st, _) = e.chamar("DELETE", &format!("/api/v1/me/restauracao/{token}"), None, None).await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn conflito_de_nome_vira_copia_quando_pedido_e_nunca_sobrescreve() {
    let e = nova();
    let (_, token) = e.admin("ana").await;
    let (_, t) = e.chamar("POST", "/api/v1/notas", Some(&token), Some(json!({ "titulo": "Receita", "corpo": "original" }))).await;
    let id = t["id"].as_str().unwrap().to_string();
    let zip = exportar(&e, &token).await;
    // Apaga a nota e cria outra, de outro id, que ocupa o mesmo nome de arquivo.
    let caminho: String = e.state.db.with(move |c| c.query_row("SELECT caminho_arquivo FROM nota WHERE id = ?1", [&id], |r| r.get(0))).await.unwrap();
    std::fs::remove_file(e.raiz.join(&caminho)).unwrap();
    ecos_app::db::reindex::reindexar_tudo(&e.state.db, &e.raiz).await.unwrap();
    let (_, outra) = e.chamar("POST", "/api/v1/notas", Some(&token), Some(json!({ "titulo": "Receita", "corpo": "outra nota, mesmo nome" }))).await;
    assert!(e.raiz.join(&caminho).is_file(), "a nova ocupa o nome antigo");

    let (_, rel) = enviar_pacote(&e, &token, zip).await;
    assert_eq!(rel["conflitos"][0]["copiavel"], true);
    let (st, res) = e.chamar("POST", &format!("/api/v1/me/restauracao/{}/aplicar", rel["token"].as_str().unwrap()), Some(&token), Some(json!({ "confirm": "RESTAURAR", "conflitos": "copiar" }))).await;
    assert_eq!(st, StatusCode::OK, "{res}");
    assert_eq!(res["copias"], 1);
    assert!(std::fs::read_to_string(e.raiz.join(&caminho)).unwrap().contains("outra nota, mesmo nome"), "o arquivo existente não foi tocado");
    let (_, lista) = e.chamar("GET", "/api/v1/notas", Some(&token), None).await;
    assert_eq!(ids(&lista).len(), 2, "a nota original voltou como cópia, sem apagar a outra");
    let _ = outra;
}
