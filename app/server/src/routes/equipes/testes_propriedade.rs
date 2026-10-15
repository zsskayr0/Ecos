//! Propriedade e convites: a equipe nunca fica sem dono, admin não tem poder sobre dono e convites vencidos,
//! revogados ou já usados são recusados, inclusive com pedidos simultâneos. Vários usuários, roteador real.

use axum::http::StatusCode;
use serde_json::{json, Value};

use crate::auth::session;
use crate::auth::testes::{chamar, novo_estado, SEGREDO};
use crate::state::AppState;

fn token(u: &str) -> String { session::emitir_access_token(u, SEGREDO).unwrap() }

/// `EQ`: dono `d`, admin `a`, membros `m` e `n`; `x` e `y` ficam de fora.
async fn cenario() -> AppState {
    let state = novo_estado();
    state.db.with(|c| {
        for u in ["d", "a", "m", "n", "x", "y"] {
            c.execute("INSERT INTO usuario (id, nome_usuario, senha_hash, recovery_key_hash) VALUES (?1, ?1, 'h', 'r')", [u])?;
        }
        c.execute("INSERT INTO equipe (id, nome) VALUES ('EQ', 'Time')", [])?;
        c.execute("INSERT INTO membro_equipe (equipe_id, usuario_id, cargo) VALUES ('EQ', 'd', 'dono'), ('EQ', 'a', 'admin'), ('EQ', 'm', 'membro'), ('EQ', 'n', 'membro')", [])?;
        Ok(())
    }).await.unwrap();
    state
}

async fn cargo(state: &AppState, usuario: &str) -> Option<String> {
    let u = usuario.to_string();
    state.db.with(move |c| c.query_row("SELECT cargo FROM membro_equipe WHERE equipe_id = 'EQ' AND usuario_id = ?1", [&u], |r| r.get(0)).map(Some).or_else(|e| match e { rusqlite::Error::QueryReturnedNoRows => Ok(None), e => Err(e) })).await.unwrap()
}

async fn donos(state: &AppState) -> i64 {
    state.db.with(|c| c.query_row("SELECT COUNT(*) FROM membro_equipe WHERE equipe_id = 'EQ' AND cargo = 'dono'", [], |r| r.get(0))).await.unwrap()
}

#[tokio::test]
async fn admin_nao_promove_a_dono_nem_mexe_em_dono() {
    let state = cenario().await;
    let a = token("a");
    let (st, _) = chamar(&state, "PATCH", "/api/v1/equipes/EQ/membros/m", Some(&a), json!({ "cargo": "dono" })).await;
    assert_eq!(st, StatusCode::FORBIDDEN, "admin não cria dono");
    let (st, _) = chamar(&state, "PATCH", "/api/v1/equipes/EQ/membros/d", Some(&a), json!({ "cargo": "membro" })).await;
    assert_eq!(st, StatusCode::FORBIDDEN, "admin não rebaixa dono");
    let (st, _) = chamar(&state, "DELETE", "/api/v1/equipes/EQ/membros/d", Some(&a), Value::Null).await;
    assert_eq!(st, StatusCode::FORBIDDEN, "admin não remove dono");
    let (st, _) = chamar(&state, "POST", "/api/v1/equipes/EQ/transferir", Some(&a), json!({ "usuario_id": "m" })).await;
    assert_eq!(st, StatusCode::FORBIDDEN, "admin não transfere a propriedade");
    assert_eq!((cargo(&state, "d").await.as_deref(), cargo(&state, "m").await.as_deref()), (Some("dono"), Some("membro")));
}

#[tokio::test]
async fn equipe_nunca_fica_sem_dono() {
    let state = cenario().await;
    let d = token("d");
    // O único dono não se rebaixa, não se remove e não sai.
    let (st, _) = chamar(&state, "PATCH", "/api/v1/equipes/EQ/membros/d", Some(&d), json!({ "cargo": "admin" })).await;
    assert_eq!(st, StatusCode::CONFLICT);
    let (st, _) = chamar(&state, "DELETE", "/api/v1/equipes/EQ/membros/d", Some(&d), Value::Null).await;
    assert_eq!(st, StatusCode::CONFLICT, "autoexclusão do último dono");
    let (st, _) = chamar(&state, "POST", "/api/v1/equipes/EQ/sair", Some(&d), Value::Null).await;
    assert_eq!(st, StatusCode::CONFLICT);
    assert_eq!(donos(&state).await, 1);

    // Com um segundo dono (promoção feita pelo dono), o primeiro pode sair — e o último que sobra, não.
    let (st, _) = chamar(&state, "PATCH", "/api/v1/equipes/EQ/membros/a", Some(&d), json!({ "cargo": "dono" })).await;
    assert_eq!(st, StatusCode::OK);
    let (st, _) = chamar(&state, "POST", "/api/v1/equipes/EQ/sair", Some(&d), Value::Null).await;
    assert_eq!(st, StatusCode::OK);
    let (st, _) = chamar(&state, "POST", "/api/v1/equipes/EQ/sair", Some(&token("a")), Value::Null).await;
    assert_eq!(st, StatusCode::CONFLICT, "quem restou como dono não sai");
    assert_eq!(donos(&state).await, 1);
}

#[tokio::test]
async fn transferencia_explicita_troca_dono_e_vira_admin_numa_operacao() {
    let state = cenario().await;
    let d = token("d");
    let (st, _) = chamar(&state, "POST", "/api/v1/equipes/EQ/transferir", Some(&d), json!({ "usuario_id": "x" })).await;
    assert_eq!(st, StatusCode::NOT_FOUND, "só para quem está na equipe");
    let (st, _) = chamar(&state, "POST", "/api/v1/equipes/EQ/transferir", Some(&d), json!({ "usuario_id": "d" })).await;
    assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY, "não transfere para si mesmo");
    let (st, _) = chamar(&state, "POST", "/api/v1/equipes/EQ/transferir", Some(&token("m")), json!({ "usuario_id": "n" })).await;
    assert_eq!(st, StatusCode::FORBIDDEN);

    let (st, _) = chamar(&state, "POST", "/api/v1/equipes/EQ/transferir", Some(&d), json!({ "usuario_id": "m" })).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!((cargo(&state, "m").await.as_deref(), cargo(&state, "d").await.as_deref()), (Some("dono"), Some("admin")));
    assert_eq!(donos(&state).await, 1);
    // O antigo dono agora é admin: perde o poder sobre o novo dono.
    let (st, _) = chamar(&state, "PATCH", "/api/v1/equipes/EQ/membros/m", Some(&d), json!({ "cargo": "membro" })).await;
    assert_eq!(st, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn pedidos_simultaneos_preservam_ao_menos_um_dono() {
    let state = cenario().await;
    state.db.with(|c| c.execute("UPDATE membro_equipe SET cargo = 'dono' WHERE equipe_id = 'EQ' AND usuario_id = 'a'", [])).await.unwrap();
    let (d, a) = (token("d"), token("a"));
    // Cada dono tenta rebaixar o outro ao mesmo tempo.
    let (r1, r2) = tokio::join!(
        chamar(&state, "PATCH", "/api/v1/equipes/EQ/membros/a", Some(&d), json!({ "cargo": "membro" })),
        chamar(&state, "PATCH", "/api/v1/equipes/EQ/membros/d", Some(&a), json!({ "cargo": "membro" })),
    );
    assert_eq!(donos(&state).await, 1, "{:?} / {:?}", r1.0, r2.0);
    assert!([r1.0, r2.0].contains(&StatusCode::OK));
}

#[tokio::test]
async fn convite_expirado_revogado_ou_usado_e_recusado() {
    let state = cenario().await;
    let d = token("d");
    let (st, convite) = chamar(&state, "POST", "/api/v1/equipes/EQ/convites", Some(&token("m")), Value::Null).await;
    assert_eq!(st, StatusCode::FORBIDDEN, "membro comum não convida");
    let _ = convite;

    // Válido: entra como membro e o código não vale uma segunda vez.
    let (_, c1) = chamar(&state, "POST", "/api/v1/equipes/EQ/convites", Some(&d), Value::Null).await;
    let cod1 = c1["codigo"].as_str().unwrap().to_string();
    let (st, _) = chamar(&state, "POST", &format!("/api/v1/convites/{cod1}/aceitar"), Some(&token("x")), Value::Null).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(cargo(&state, "x").await.as_deref(), Some("membro"));
    let (st, _) = chamar(&state, "POST", &format!("/api/v1/convites/{cod1}/aceitar"), Some(&token("y")), Value::Null).await;
    assert_eq!(st, StatusCode::CONFLICT, "tentativa repetida com outro usuário");
    assert_eq!(cargo(&state, "y").await, None);

    // Vencido (a data passou).
    let (_, c2) = chamar(&state, "POST", "/api/v1/equipes/EQ/convites", Some(&d), Value::Null).await;
    let cod2 = c2["codigo"].as_str().unwrap().to_string();
    let c2id = c2["id"].as_str().unwrap().to_string();
    state.db.with(move |c| c.execute("UPDATE convite_equipe SET expira_em = '2020-01-01T00:00:00+00:00' WHERE id = ?1", [&c2id])).await.unwrap();
    let (st, _) = chamar(&state, "POST", &format!("/api/v1/convites/{cod2}/aceitar"), Some(&token("y")), Value::Null).await;
    assert_eq!(st, StatusCode::CONFLICT);
    assert_eq!(cargo(&state, "y").await, None);

    // Revogado.
    let (_, c3) = chamar(&state, "POST", "/api/v1/equipes/EQ/convites", Some(&d), Value::Null).await;
    let (cod3, c3id) = (c3["codigo"].as_str().unwrap().to_string(), c3["id"].as_str().unwrap().to_string());
    let (st, lista) = chamar(&state, "GET", "/api/v1/equipes/EQ/convites", Some(&d), Value::Null).await;
    assert_eq!(st, StatusCode::OK);
    assert!(lista.as_array().unwrap().iter().any(|c| c["id"] == c3id.as_str()), "o convite pendente aparece na lista");
    let (st, _) = chamar(&state, "DELETE", &format!("/api/v1/equipes/EQ/convites/{c3id}"), Some(&token("m")), Value::Null).await;
    assert_eq!(st, StatusCode::FORBIDDEN);
    let (st, _) = chamar(&state, "DELETE", &format!("/api/v1/equipes/EQ/convites/{c3id}"), Some(&token("a")), Value::Null).await;
    assert_eq!(st, StatusCode::OK);
    let (st, _) = chamar(&state, "POST", &format!("/api/v1/convites/{cod3}/aceitar"), Some(&token("y")), Value::Null).await;
    assert_eq!(st, StatusCode::CONFLICT);
    assert_eq!(cargo(&state, "y").await, None);
    let (_, lista) = chamar(&state, "GET", "/api/v1/equipes/EQ/convites", Some(&d), Value::Null).await;
    assert!(!lista.as_array().unwrap().iter().any(|c| c["id"] == c3id.as_str()));
}

#[tokio::test]
async fn dois_aceites_simultaneos_do_mesmo_codigo_deixam_entrar_so_um() {
    let state = cenario().await;
    let (_, c) = chamar(&state, "POST", "/api/v1/equipes/EQ/convites", Some(&token("d")), Value::Null).await;
    let rota = format!("/api/v1/convites/{}/aceitar", c["codigo"].as_str().unwrap());
    let (tx, ty) = (token("x"), token("y"));
    let (r1, r2) = tokio::join!(
        chamar(&state, "POST", &rota, Some(&tx), Value::Null),
        chamar(&state, "POST", &rota, Some(&ty), Value::Null),
    );
    let ok = [r1.0, r2.0].iter().filter(|s| **s == StatusCode::OK).count();
    assert_eq!(ok, 1, "{:?} {:?}", r1.0, r2.0);
    let entraram = [cargo(&state, "x").await, cargo(&state, "y").await].iter().filter(|c| c.is_some()).count();
    assert_eq!(entraram, 1);
}

#[tokio::test]
async fn quem_ja_e_da_equipe_nao_gasta_o_convite() {
    let state = cenario().await;
    let (_, c) = chamar(&state, "POST", "/api/v1/equipes/EQ/convites", Some(&token("d")), Value::Null).await;
    let rota = format!("/api/v1/convites/{}/aceitar", c["codigo"].as_str().unwrap());
    let (st, corpo) = chamar(&state, "POST", &rota, Some(&token("m")), Value::Null).await;
    assert_eq!((st, &corpo["ja_membro"]), (StatusCode::OK, &json!(true)));
    assert_eq!(cargo(&state, "m").await.as_deref(), Some("membro"), "o cargo não muda");
    let (st, _) = chamar(&state, "POST", &rota, Some(&token("x")), Value::Null).await;
    assert_eq!(st, StatusCode::OK, "o convite continuava disponível");
}
