//! Cor e foto da equipe (persistidas no servidor) e identidade dos membros.

use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use serde_json::{json, Value};
use tower::Service;

use crate::auth::session;
use crate::auth::testes::{chamar, novo_estado, SEGREDO};
use crate::state::AppState;

const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0];

/// Equipe `EQ` com dono `d`, admin `a` e membro `m`; `f` não participa.
async fn estado_com_equipe() -> (AppState, String, String, String) {
    let state = novo_estado();
    state.db.with(|c| {
        c.execute("INSERT INTO usuario (id, nome_usuario, nome, senha_hash, recovery_key_hash) VALUES ('d', 'dono', 'Dona Maria', 'h', 'r'), ('a', 'admin', NULL, 'h', 'r'), ('m', 'membro', '  ', 'h', 'r'), ('f', 'fora', 'Fora', 'h', 'r')", [])?;
        c.execute("INSERT INTO equipe (id, nome) VALUES ('EQ', 'Time')", [])?;
        c.execute("INSERT INTO membro_equipe (equipe_id, usuario_id, cargo) VALUES ('EQ', 'd', 'dono'), ('EQ', 'a', 'admin'), ('EQ', 'm', 'membro')", [])?;
        Ok(())
    }).await.unwrap();
    let t = |u: &str| session::emitir_access_token(u, SEGREDO).unwrap();
    (state, t("d"), t("a"), t("m"))
}

async fn enviar_foto(state: &AppState, metodo: &str, rota: &str, token: &str, conteudo: &[u8]) -> StatusCode {
    let mut corpo = b"--x\r\nContent-Disposition: form-data; name=\"arquivo\"; filename=\"f.png\"\r\nContent-Type: image/png\r\n\r\n".to_vec();
    corpo.extend_from_slice(conteudo);
    corpo.extend_from_slice(b"\r\n--x--\r\n");
    let req = Request::builder().method(metodo).uri(rota).header("authorization", format!("Bearer {token}")).header("content-type", "multipart/form-data; boundary=x").body(Body::from(corpo)).unwrap();
    crate::routes::montar(state.clone()).call(req).await.unwrap().status()
}

async fn baixar(state: &AppState, rota: &str, token: &str) -> (StatusCode, Vec<u8>) {
    let req = Request::builder().method("GET").uri(rota).header("authorization", format!("Bearer {token}")).body(Body::empty()).unwrap();
    let r = crate::routes::montar(state.clone()).call(req).await.unwrap();
    let st = r.status();
    (st, to_bytes(r.into_body(), 4 * 1024 * 1024).await.unwrap().to_vec())
}

fn pasta_fotos(state: &AppState) -> std::path::PathBuf { crate::routes::avatar::raiz_equipes(state) }

#[tokio::test]
async fn cor_da_equipe_persiste_valida_e_tem_derivada_para_as_existentes() {
    let (state, dono, admin, membro) = estado_com_equipe().await;
    let (_, lista) = chamar(&state, "GET", "/api/v1/equipes", Some(&dono), Value::Null).await;
    let cor = lista[0]["cor"].as_str().unwrap();
    assert!(cor.starts_with('#') && cor.len() == 7, "equipe sem escolha recebe uma cor derivada do id: {cor}");

    let (st, _) = chamar(&state, "PATCH", "/api/v1/equipes/EQ", Some(&admin), json!({ "cor": "#ff8800" })).await;
    assert_eq!(st, StatusCode::OK);
    let (_, obtida) = chamar(&state, "GET", "/api/v1/equipes/EQ", Some(&membro), Value::Null).await;
    assert_eq!(obtida["cor"], "#FF8800", "outros membros veem a cor escolhida");
    assert_eq!(obtida["nome"], "Time", "mexer só na cor preserva o nome");
    let (_, lista) = chamar(&state, "GET", "/api/v1/equipes", Some(&membro), Value::Null).await;
    assert_eq!(lista[0]["cor"], "#FF8800");

    for ruim in ["vermelho", "#fff", "rgb(0,0,0)", "#GG0000", "url(x)"] {
        let (st, _) = chamar(&state, "PATCH", "/api/v1/equipes/EQ", Some(&dono), json!({ "cor": ruim })).await;
        assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY, "{ruim}");
    }
    let (st, _) = chamar(&state, "PATCH", "/api/v1/equipes/EQ", Some(&membro), json!({ "cor": "#112233" })).await;
    assert_eq!(st, StatusCode::FORBIDDEN, "membro comum não muda a cor");
    let (st, nova) = chamar(&state, "POST", "/api/v1/equipes", Some(&dono), json!({ "nome": "Nova", "cor": "#22c55e" })).await;
    assert_eq!(st, StatusCode::OK);
    let (_, nova_obtida) = chamar(&state, "GET", &format!("/api/v1/equipes/{}", nova["id"].as_str().unwrap()), Some(&dono), Value::Null).await;
    assert_eq!(nova_obtida["cor"], "#22C55E");
}

#[tokio::test]
async fn foto_da_equipe_so_dono_e_admin_trocam_e_so_membros_veem() {
    let (state, dono, admin, membro) = estado_com_equipe().await;
    let fora = session::emitir_access_token("f", SEGREDO).unwrap();
    let rota = "/api/v1/equipes/EQ/avatar";

    assert_eq!(baixar(&state, rota, &dono).await.0, StatusCode::NOT_FOUND, "sem foto ainda");
    assert_eq!(enviar_foto(&state, "PUT", rota, &membro, PNG).await, StatusCode::FORBIDDEN);
    assert_eq!(enviar_foto(&state, "PUT", rota, &fora, PNG).await, StatusCode::NOT_FOUND, "quem não é da equipe não sabe que ela existe");
    assert_eq!(enviar_foto(&state, "PUT", rota, &admin, PNG).await, StatusCode::OK);

    let (st, bytes) = baixar(&state, rota, &membro).await;
    assert_eq!((st, bytes.as_slice()), (StatusCode::OK, PNG));
    assert_eq!(baixar(&state, rota, &fora).await.0, StatusCode::NOT_FOUND);
    let (_, obtida) = chamar(&state, "GET", "/api/v1/equipes/EQ", Some(&membro), Value::Null).await;
    assert!(obtida["avatar_atualizado_em"].is_number(), "o perfil traz a versão da imagem para invalidar cache");
    let (_, lista) = chamar(&state, "GET", "/api/v1/equipes", Some(&membro), Value::Null).await;
    assert!(lista[0]["avatar_atualizado_em"].is_number(), "a listagem também");

    let (st, _) = chamar(&state, "DELETE", rota, Some(&membro), Value::Null).await;
    assert_eq!(st, StatusCode::FORBIDDEN);
    let (st, _) = chamar(&state, "DELETE", rota, Some(&dono), Value::Null).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(baixar(&state, rota, &dono).await.0, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn foto_da_equipe_recusa_svg_disfarcado_tamanho_excessivo_e_some_com_a_equipe() {
    let (state, dono, ..) = estado_com_equipe().await;
    let rota = "/api/v1/equipes/EQ/avatar";
    let svg = b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>";
    assert_eq!(enviar_foto(&state, "PUT", rota, &dono, svg).await, StatusCode::UNPROCESSABLE_ENTITY, "SVG nunca");
    assert_eq!(enviar_foto(&state, "PUT", rota, &dono, b"GIF89a....").await, StatusCode::UNPROCESSABLE_ENTITY);
    let mut grande = PNG.to_vec();
    grande.extend(std::iter::repeat(0u8).take(2 * 1024 * 1024));
    assert_eq!(enviar_foto(&state, "PUT", rota, &dono, &grande).await, StatusCode::UNPROCESSABLE_ENTITY, "acima de 2 MB");
    assert!(crate::routes::avatar::arquivo_existente_em(&pasta_fotos(&state), "EQ").is_none());

    assert_eq!(enviar_foto(&state, "PUT", rota, &dono, PNG).await, StatusCode::OK);
    assert!(crate::routes::avatar::arquivo_existente_em(&pasta_fotos(&state), "EQ").is_some());
    let (st, _) = chamar(&state, "DELETE", "/api/v1/equipes/EQ", Some(&dono), json!({ "confirm": "EXCLUIR EQUIPE" })).await;
    assert_eq!(st, StatusCode::OK);
    assert!(crate::routes::avatar::arquivo_existente_em(&pasta_fotos(&state), "EQ").is_none(), "excluir a equipe elimina a foto");
}
