//! Política de exclusão da equipe: só sem conteúdo ativo, nunca em silêncio, e só o dono.

use axum::http::StatusCode;
use serde_json::{json, Value};

use crate::auth::session;
use crate::auth::testes::{chamar, novo_estado, SEGREDO};

fn token(u: &str) -> String { session::emitir_access_token(u, SEGREDO).unwrap() }
const FRASE: &str = "EXCLUIR EQUIPE";

#[tokio::test]
async fn equipe_com_conteudo_nao_e_excluida_e_vazia_e() {
    let state = novo_estado();
    state.db.with(|c| {
        for u in ["d", "a", "f"] {
            c.execute("INSERT INTO usuario (id, nome_usuario, senha_hash, recovery_key_hash) VALUES (?1, ?1, 'h', 'r')", [u])?;
        }
        c.execute("INSERT INTO equipe (id, nome) VALUES ('EQ', 'Time')", [])?;
        c.execute("INSERT INTO membro_equipe (equipe_id, usuario_id, cargo) VALUES ('EQ', 'd', 'dono'), ('EQ', 'a', 'admin')", [])?;
        Ok(())
    }).await.unwrap();
    let (d, a, f) = (token("d"), token("a"), token("f"));

    let (st, nota) = chamar(&state, "POST", "/api/v1/notas", Some(&d), json!({ "titulo": "Da equipe", "espaco": "equipe:EQ" })).await;
    assert_eq!(st, StatusCode::OK, "{nota}");
    let (st, tarefa) = chamar(&state, "POST", "/api/v1/tarefas", Some(&a), json!({ "titulo": "Fazer", "espaco": "equipe:EQ" })).await;
    assert_eq!(st, StatusCode::OK, "{tarefa}");
    let (nota_id, tarefa_id) = (nota["id"].as_str().unwrap().to_string(), tarefa["id"].as_str().unwrap().to_string());

    // Quem não é dono não exclui; de fora nem sabe que existe.
    let (st, _) = chamar(&state, "DELETE", "/api/v1/equipes/EQ", Some(&a), json!({ "confirm": FRASE })).await;
    assert_eq!(st, StatusCode::FORBIDDEN);
    let (st, _) = chamar(&state, "DELETE", "/api/v1/equipes/EQ", Some(&f), json!({ "confirm": FRASE })).await;
    assert_eq!(st, StatusCode::NOT_FOUND);

    // Dono, com a frase, mas a equipe tem conteúdo: recusado, com a contagem, e nada é apagado.
    let (st, corpo) = chamar(&state, "DELETE", "/api/v1/equipes/EQ", Some(&d), json!({ "confirm": FRASE })).await;
    assert_eq!(st, StatusCode::CONFLICT, "{corpo}");
    let mensagem = corpo["message"].as_str().unwrap_or_default();
    assert!(mensagem.contains("1 nota") && mensagem.contains("1 tarefa"), "{mensagem}");
    assert_eq!(chamar(&state, "GET", &format!("/api/v1/notas/{nota_id}"), Some(&d), Value::Null).await.0, StatusCode::OK);
    assert_eq!(chamar(&state, "GET", "/api/v1/equipes/EQ", Some(&d), Value::Null).await.0, StatusCode::OK);

    // Esvaziada pelo próprio dono, a exclusão passa e leva membros e convites junto.
    assert_eq!(chamar(&state, "DELETE", &format!("/api/v1/notas/{nota_id}"), Some(&d), Value::Null).await.0, StatusCode::OK);
    let (st, corpo) = chamar(&state, "DELETE", "/api/v1/equipes/EQ", Some(&d), json!({ "confirm": FRASE })).await;
    assert_eq!(st, StatusCode::CONFLICT, "ainda há uma tarefa: {corpo}");
    assert_eq!(chamar(&state, "DELETE", &format!("/api/v1/tarefas/{tarefa_id}"), Some(&a), Value::Null).await.0, StatusCode::OK);
    let (st, corpo) = chamar(&state, "DELETE", "/api/v1/equipes/EQ", Some(&d), json!({ "confirm": FRASE })).await;
    assert_eq!(st, StatusCode::OK, "{corpo}");
    assert_eq!(chamar(&state, "GET", "/api/v1/equipes/EQ", Some(&d), Value::Null).await.0, StatusCode::NOT_FOUND);
    let membros: i64 = state.db.with(|c| c.query_row("SELECT COUNT(*) FROM membro_equipe WHERE equipe_id = 'EQ'", [], |r| r.get(0))).await.unwrap();
    assert_eq!(membros, 0);
}
