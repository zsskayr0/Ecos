//! Proxy reverso pra `ecos-vault-db` (seção 2/11.14) — único ponto de
//! acoplamento entre os dois serviços; `ecos-app` nunca fala SQL com o
//! vault, só HTTP interno, através da rede Docker `internal` (nunca
//! alcançável de fora). `404` (nunca `403`) em qualquer
//! `/vault/*` quando `ECOS_VAULT_ENABLED=false` — não revela nem a
//! existência do recurso (seção 5.3).

use axum::body::Bytes;
use axum::extract::State;
use axum::Extension;
use axum::http::{HeaderMap, Method, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use ecos_core::ErrorCode;

use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

use crate::error::AppError;
use crate::middleware::auth_guard::UsuarioAutenticado;
use crate::state::AppState;

/// Cabeçalhos com que este serviço se identifica ao Cofre. O Cofre tem um arquivo e uma senha por pessoa e
/// só confia no id que vem daqui (nada do que o cliente mandar é repassado: o pedido é montado do zero).
pub const CABECALHO_USUARIO: &str = "x-ecos-usuario";
pub const CABECALHO_DONO_LEGADO: &str = "x-ecos-dono-legado";

/// Espaço do Cofre que o cliente quer usar (`pessoal` ou `equipe:<id>`). Só é lido aqui, nunca repassado.
pub const CABECALHO_ESPACO: &str = "x-ecos-espaco";

/// Quem provou saber a senha do Cofre de uma equipe: `(usuário, dono do cofre)`. O Cofre guarda a chave em
/// memória por dono, então, uma vez aberto por um membro, estaria aberto para todos; este conjunto garante que
/// cada membro digite a senha antes de ver qualquer coisa. Só em memória: reiniciar o `ecos-app` exige de novo.
fn verificados() -> &'static Mutex<HashSet<(String, String)>> {
    static V: OnceLock<Mutex<HashSet<(String, String)>>> = OnceLock::new();
    V.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Dono do Cofre para este pedido: a própria pessoa (`pessoal`/ausente) ou a equipe (`eq_<id>`, exige ser membro).
/// O Cofre trata o dono como um id opaco: cada um tem arquivo, salt e senha próprios.
pub async fn dono_do_cofre(state: &AppState, usuario_id: &str, espaco: Option<&str>) -> Result<String, AppError> {
    match espaco.map(str::trim).filter(|e| !e.is_empty() && *e != "pessoal") {
        None => Ok(usuario_id.to_string()),
        Some(e) => {
            let id = e.strip_prefix("equipe:").filter(|id| !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'));
            let Some(id) = id else { return Err(AppError::new(ErrorCode::ValidationError).with_message("Espaço inválido.")) };
            crate::espacos::exigir_acesso(state, usuario_id, e).await?;
            Ok(format!("eq_{id}"))
        }
    }
}

/// Ativar, apagar ou zerar o Cofre de uma equipe é coisa de dono/admin da equipe; usar é de qualquer membro.
async fn pode_administrar(state: &AppState, usuario_id: &str, dono: &str) -> bool {
    let (uid, eid) = (usuario_id.to_string(), dono.trim_start_matches("eq_").to_string());
    state
        .db
        .with(move |conn| conn.query_row("SELECT EXISTS(SELECT 1 FROM membro_equipe WHERE equipe_id = ?1 AND usuario_id = ?2 AND cargo IN ('dono','admin'))", [&eid, &uid], |r| r.get::<_, bool>(0)))
        .await
        .unwrap_or(false)
}

/// O primeiro usuário cadastrado é o dono do cofre único das versões anteriores.
async fn e_primeiro_usuario(state: &AppState, usuario_id: &str) -> bool {
    let uid = usuario_id.to_string();
    state
        .db
        .with(move |conn| conn.query_row("SELECT id = ?1 FROM usuario ORDER BY criado_em, id LIMIT 1", [&uid], |r| r.get::<_, bool>(0)))
        .await
        .unwrap_or(false)
}

/// Pedido ao Cofre em nome de `usuario_id` (`caminho` já sem `/api/v1`, ex.: `/vault/transacoes`).
pub async fn requisicao_interna(state: &AppState, metodo: reqwest::Method, caminho: &str, usuario_id: &str) -> reqwest::RequestBuilder {
    let mut pedido = state
        .http
        .request(metodo, format!("{}{}", state.config.vault_internal_url, caminho))
        .header(CABECALHO_USUARIO, usuario_id);
    if e_primeiro_usuario(state, usuario_id).await {
        pedido = pedido.header(CABECALHO_DONO_LEGADO, "1");
    }
    pedido
}

pub async fn encaminhar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, method: Method, uri: Uri, headers: HeaderMap, body: Bytes) -> Response {
    if !state.config.vault_enabled {
        return AppError::new(ErrorCode::VaultDisabled).into_response();
    }

    // `ecos-vault-db` serve suas rotas em `/vault/*` na raiz (é um serviço
    // interno, sem o prefixo `/api/v1` do `ecos-app` público) — remove o
    // prefixo antes de repassar.
    let caminho_completo = uri.path_and_query().map(|pq| pq.as_str()).unwrap_or("/");
    let caminho = caminho_completo.strip_prefix("/api/v1").unwrap_or(caminho_completo);
    let espaco = headers.get(CABECALHO_ESPACO).and_then(|v| v.to_str().ok());
    let dono = match dono_do_cofre(&state, &usuario.0, espaco).await {
        Ok(d) => d,
        Err(e) => return e.into_response(),
    };
    let de_equipe = dono.starts_with("eq_");
    let rota = caminho.split('?').next().unwrap_or(caminho);
    if de_equipe {
        let administrativa = ["/vault/ativar", "/vault/reset", "/vault/excluir", "/vault/backup/exportar"].iter().any(|p| rota.starts_with(p));
        if administrativa && !pode_administrar(&state, &usuario.0, &dono).await {
            return AppError::new(ErrorCode::Forbidden).with_message("Só o dono ou um administrador da equipe pode fazer isso no Cofre da equipe.").into_response();
        }
        let livre = ["/vault/desbloquear", "/vault/ativar", "/vault/config", "/vault/bloquear"].contains(&rota);
        let chave = (usuario.0.clone(), dono.clone());
        if !livre && !verificados().lock().expect("mutex").contains(&chave) {
            return AppError::new(ErrorCode::VaultLocked).into_response();
        }
    }
    let mut requisicao = requisicao_interna(&state, method.clone(), caminho, &dono).await;
    if let Some(content_type) = headers.get(axum::http::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()) {
        requisicao = requisicao.header("content-type", content_type);
    }
    requisicao = requisicao.body(body.to_vec());

    match requisicao.send().await {
        Ok(resposta) => {
            let status = StatusCode::from_u16(resposta.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
            let content_type = resposta
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("application/json")
                .to_string();
            let mut corpo = resposta.bytes().await.unwrap_or_default().to_vec();
            if de_equipe {
                let chave = (usuario.0.clone(), dono.clone());
                let sucesso = status.is_success();
                match (method.as_str(), rota) {
                    ("POST", "/vault/desbloquear") | ("POST", "/vault/ativar") if sucesso => { verificados().lock().expect("mutex").insert(chave); }
                    ("POST", "/vault/bloquear") => verificados().lock().expect("mutex").retain(|(_, d)| d != &dono),
                    ("POST", "/vault/excluir") | ("POST", "/vault/reset") if sucesso => verificados().lock().expect("mutex").retain(|(_, d)| d != &dono),
                    ("GET", "/vault/config") => {
                        if let Ok(mut json) = serde_json::from_slice::<serde_json::Value>(&corpo) {
                            let aberto = json["destrancado"].as_bool().unwrap_or(false);
                            if !aberto {
                                verificados().lock().expect("mutex").retain(|(_, d)| d != &dono); // o Cofre trancou: todos digitam de novo
                            } else if !verificados().lock().expect("mutex").contains(&chave) {
                                // Aberto por outro membro: este ainda não provou a senha, então não vê nada.
                                json["destrancado"] = serde_json::Value::Bool(false);
                                json["saldos_por_conta"] = serde_json::json!([]);
                                corpo = serde_json::to_vec(&json).unwrap_or(corpo);
                            }
                        }
                    }
                    _ => {}
                }
            }
            (status, [(axum::http::header::CONTENT_TYPE, content_type), (axum::http::header::CACHE_CONTROL, "no-store, private".to_string())], corpo).into_response()
        }
        Err(err) => {
            tracing::error!(error = %err, "falha ao repassar requisição pro ecos-vault-db");
            AppError::new(ErrorCode::InternalError).with_message("Cofre indisponível no momento.").into_response()
        }
    }
}

#[cfg(test)]
mod testes {
    use crate::{auth::session, config::{Ambiente, Config}, db::IndexDb, state::AppState};
    use axum::{body::{to_bytes, Body}, http::{HeaderMap, Request, StatusCode}, routing::any, Json, Router};
    use ecos_core::new_id;
    use std::sync::{Arc, Mutex};
    use tower::Service;

    // Cofre de mentira: devolve os cabeçalhos internos que recebeu.
    async fn eco(headers: HeaderMap) -> Json<serde_json::Value> {
        let v = |k: &str| headers.get(k).and_then(|v| v.to_str().ok()).map(str::to_string);
        Json(serde_json::json!({ "usuario": v("x-ecos-usuario"), "legado": v("x-ecos-dono-legado"), "cookie": v("cookie"), "authorization": v("authorization") }))
    }

    #[tokio::test]
    async fn o_proxy_identifica_a_pessoa_ao_cofre_e_nao_repassa_o_que_o_cliente_mandar() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, Router::new().fallback(any(eco))).await.unwrap() });

        let temp = std::env::temp_dir().join(format!("ecos-proxy-{}", new_id()));
        std::fs::create_dir_all(&temp).unwrap();
        let segredo = b"segredo-efemero-exclusivo-do-teste-do-proxy".to_vec();
        let state = AppState {
            db: IndexDb::open(&temp.join("index.db")).unwrap(),
            config: Arc::new(Config {
                ambiente: Ambiente::Desenvolvimento, porta: 0, notes_root: temp.clone(), index_db_path: temp.join("index.db"),
                vault_enabled: true, vault_internal_url: url, session_secret: segredo.clone(), ranking_interval_secs: 300,
                static_dir: None, cookie_secure: false, google: None,
            }),
            http: reqwest::Client::new(), pareamentos: Arc::new(Mutex::new(Default::default())),
        };
        state.db.with(|c| {
            c.execute("INSERT INTO usuario (id, nome_usuario, senha_hash, recovery_key_hash, criado_em) VALUES ('U1', 'diogo', 'x', 'x', '2026-01-01'), ('U2', 'thaty', 'x', 'x', '2026-02-01')", [])?;
            Ok(())
        }).await.unwrap();
        let app = crate::routes::montar(state);

        let pedir = |uid: &str| {
            let token = session::emitir_access_token(uid, &segredo).unwrap();
            let mut app = app.clone();
            async move {
                let req = Request::get("/api/v1/vault/contas")
                    .header("authorization", format!("Bearer {token}"))
                    .header("x-ecos-usuario", "U1")        // tentativa de se passar por outra pessoa
                    .header("x-ecos-dono-legado", "1")     // e de reivindicar o cofre antigo
                    .body(Body::empty()).unwrap();
                let r = app.call(req).await.unwrap();
                assert_eq!(r.status(), StatusCode::OK);
                serde_json::from_slice::<serde_json::Value>(&to_bytes(r.into_body(), 65536).await.unwrap()).unwrap()
            }
        };
        let diogo = pedir("U1").await;
        assert_eq!((diogo["usuario"].as_str(), diogo["legado"].as_str()), (Some("U1"), Some("1")), "o primeiro usuário é o dono do cofre antigo");
        let thaty = pedir("U2").await;
        assert_eq!((thaty["usuario"].as_str(), thaty["legado"].as_str()), (Some("U2"), None), "a identidade vem da sessão, não do cabeçalho do cliente; sem reivindicar o legado");
        assert!(thaty["authorization"].is_null() && thaty["cookie"].is_null(), "credenciais da sessão não vazam para o Cofre");
        let _ = std::fs::remove_dir_all(&temp);
    }

    #[tokio::test]
    async fn o_cofre_da_equipe_exige_ser_membro_cargo_para_administrar_e_senha_de_cada_membro() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, Router::new().fallback(any(eco))).await.unwrap() });
        let temp = std::env::temp_dir().join(format!("ecos-proxy-eq-{}", new_id()));
        std::fs::create_dir_all(&temp).unwrap();
        let segredo = b"segredo-efemero-exclusivo-do-teste-do-proxy-equipe".to_vec();
        let state = AppState {
            db: IndexDb::open(&temp.join("index.db")).unwrap(),
            config: Arc::new(Config {
                ambiente: Ambiente::Desenvolvimento, porta: 0, notes_root: temp.clone(), index_db_path: temp.join("index.db"),
                vault_enabled: true, vault_internal_url: url, session_secret: segredo.clone(), ranking_interval_secs: 300,
                static_dir: None, cookie_secure: false, google: None,
            }),
            http: reqwest::Client::new(), pareamentos: Arc::new(Mutex::new(Default::default())),
        };
        state.db.with(|c| {
            c.execute("INSERT INTO usuario (id, nome_usuario, senha_hash, recovery_key_hash, criado_em) VALUES ('U1','diogo','x','x','2026-01-01'),('U2','thaty','x','x','2026-02-01'),('U3','fora','x','x','2026-03-01')", [])?;
            c.execute("INSERT INTO equipe (id, nome) VALUES ('EQ1','Casa')", [])?;
            c.execute("INSERT INTO membro_equipe (equipe_id, usuario_id, cargo) VALUES ('EQ1','U1','dono'),('EQ1','U2','membro')", [])?;
            Ok(())
        }).await.unwrap();
        let app = crate::routes::montar(state);
        let chamar = |uid: &str, metodo: &str, caminho: &str| {
            let token = session::emitir_access_token(uid, &segredo).unwrap();
            let mut app = app.clone();
            let req = Request::builder().method(metodo).uri(format!("/api/v1{caminho}"))
                .header("authorization", format!("Bearer {token}")).header("x-ecos-espaco", "equipe:EQ1").body(Body::empty()).unwrap();
            async move {
                let r = app.call(req).await.unwrap();
                let st = r.status();
                (st, serde_json::from_slice::<serde_json::Value>(&to_bytes(r.into_body(), 65536).await.unwrap()).unwrap_or_default())
            }
        };
        assert_eq!(chamar("U3", "GET", "/vault/contas").await.0, StatusCode::FORBIDDEN, "quem não é da equipe não alcança o cofre dela");
        assert_eq!(chamar("U2", "POST", "/vault/ativar").await.0, StatusCode::FORBIDDEN, "membro comum não ativa o cofre da equipe");
        assert_eq!(chamar("U1", "POST", "/vault/ativar").await.0, StatusCode::OK, "o dono ativa");
        assert_eq!(chamar("U2", "GET", "/vault/contas").await.0, StatusCode::UNAUTHORIZED, "membro que não digitou a senha vê o cofre trancado");
        assert_eq!(chamar("U2", "POST", "/vault/desbloquear").await.0, StatusCode::OK);
        let (st, corpo) = chamar("U2", "GET", "/vault/contas").await;
        assert_eq!(st, StatusCode::OK);
        assert_eq!((corpo["usuario"].as_str(), corpo["legado"].is_null()), (Some("eq_EQ1"), true), "o cofre da equipe é o dono `eq_<id>`, sem reivindicar o cofre legado");
        assert_eq!(chamar("U1", "GET", "/vault/contas").await.1["usuario"].as_str(), Some("eq_EQ1"));
        // Trancar vale para a equipe toda.
        assert_eq!(chamar("U1", "POST", "/vault/bloquear").await.0, StatusCode::OK);
        assert_eq!(chamar("U2", "GET", "/vault/contas").await.0, StatusCode::UNAUTHORIZED);
        let _ = std::fs::remove_dir_all(&temp);
    }
}
