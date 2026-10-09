//! Instância de teste: o roteador real (`routes::montar`) sobre um índice SQLite e uma pasta de notas temporários.
//! Tudo passa pela API como um cliente faria — cadastro, login, token —, sem inserir linhas direto no banco.

#![allow(dead_code)]

use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use axum::Router;
use ecos_app::config::{Ambiente, Config};
use ecos_app::db::IndexDb;
use ecos_app::state::AppState;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tower::Service;

pub const SENHA_ADMIN: &str = "Correto-Cavalo-Grampo-41";
pub const SENHA_NOVA: &str = "Outra-Frase-Longa-Segura-77";

pub struct Instancia {
    pub app: Router,
    pub state: AppState,
    pub raiz: PathBuf,
    pub segredo: Vec<u8>,
}

impl Drop for Instancia {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.raiz);
    }
}

pub fn nova() -> Instancia {
    let raiz = std::env::temp_dir().join(format!("ecos-it-{}", ecos_core::new_id()));
    std::fs::create_dir_all(&raiz).unwrap();
    let segredo = format!("segredo-de-teste-{}", ecos_core::new_id()).into_bytes();
    let state = AppState {
        db: IndexDb::open(&raiz.join("index.db")).unwrap(),
        config: Arc::new(Config {
            ambiente: Ambiente::Desenvolvimento,
            porta: 0,
            notes_root: raiz.clone(),
            index_db_path: raiz.join("index.db"),
            vault_enabled: false,
            vault_internal_url: String::new(),
            session_secret: segredo.clone(),
            ranking_interval_secs: 300,
            static_dir: None,
            cookie_secure: false,
            google: None,
        }),
        http: reqwest::Client::new(),
        pareamentos: Arc::new(Mutex::new(Default::default())),
    };
    let app = ecos_app::routes::montar(state.clone());
    Instancia { app, state, raiz, segredo }
}

impl Instancia {
    /// Uma chamada à API. `token` vai como `Authorization: Bearer`; devolve status e corpo JSON (`Null` se vazio).
    pub async fn chamar(&self, metodo: &str, uri: &str, token: Option<&str>, corpo: Option<Value>) -> (StatusCode, Value) {
        // Com o IP de origem presente, os limites de tentativas (login etc.) valem como em produção.
        let origem: std::net::SocketAddr = "127.0.0.1:50000".parse().unwrap();
        let mut pedido = Request::builder().method(metodo).uri(uri).extension(axum::extract::ConnectInfo(origem));
        if let Some(t) = token {
            pedido = pedido.header("authorization", format!("Bearer {t}"));
        }
        let corpo = match corpo {
            Some(c) => {
                pedido = pedido.header("content-type", "application/json");
                Body::from(c.to_string())
            }
            None => Body::empty(),
        };
        let resposta = self.app.clone().call(pedido.body(corpo).unwrap()).await.unwrap();
        let status = resposta.status();
        let bytes = to_bytes(resposta.into_body(), 4 * 1024 * 1024).await.unwrap();
        (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
    }

    pub async fn registrar(&self, usuario: &str, senha: &str) -> (StatusCode, Value) {
        self.chamar("POST", "/api/v1/auth/registrar", None, Some(json!({
            "nome_usuario": usuario, "senha": senha, "nome": "Pessoa de Teste",
            "declara_idade_minima": true, "aceita_termos": true,
        }))).await
    }

    pub async fn login(&self, usuario: &str, senha: &str) -> (StatusCode, Value) {
        self.chamar("POST", "/api/v1/auth/login", None, Some(json!({ "usuario": usuario, "senha": senha }))).await
    }

    /// Cadastro do primeiro usuário (admin) + login. Devolve `(id, token)`.
    pub async fn admin(&self, usuario: &str) -> (String, String) {
        let (st, corpo) = self.registrar(usuario, SENHA_ADMIN).await;
        assert_eq!(st, StatusCode::OK, "{corpo}");
        let (st, sessao) = self.login(usuario, SENHA_ADMIN).await;
        assert_eq!(st, StatusCode::OK, "{sessao}");
        (sessao["usuario_id"].as_str().unwrap().into(), sessao["access_token"].as_str().unwrap().into())
    }

    /// Como a administração faz de verdade: cria a conta (senha temporária), a pessoa entra, troca a senha e entra de novo.
    /// Devolve `(id, token)`.
    pub async fn pessoa(&self, token_admin: &str, usuario: &str) -> (String, String) {
        let (st, criada) = self.chamar("POST", "/api/v1/admin/usuarios", Some(token_admin), Some(json!({ "nome_usuario": usuario }))).await;
        assert_eq!(st, StatusCode::OK, "{criada}");
        let temporaria = criada["senha_temporaria"].as_str().unwrap().to_string();
        let (st, sessao) = self.login(usuario, &temporaria).await;
        assert_eq!(st, StatusCode::OK, "{sessao}");
        let provisorio = sessao["access_token"].as_str().unwrap();
        let (st, troca) = self.chamar("POST", "/api/v1/me/senha", Some(provisorio), Some(json!({ "senha_atual": temporaria, "nova_senha": SENHA_NOVA }))).await;
        assert_eq!(st, StatusCode::OK, "{troca}");
        let (st, sessao) = self.login(usuario, SENHA_NOVA).await;
        assert_eq!(st, StatusCode::OK, "{sessao}");
        (criada["id"].as_str().unwrap().into(), sessao["access_token"].as_str().unwrap().into())
    }
}

pub fn ids(lista: &Value) -> Vec<String> {
    let itens = lista.get("items").unwrap_or(lista);
    let mut v: Vec<String> = itens.as_array().unwrap().iter().map(|i| i["id"].as_str().unwrap().to_string()).collect();
    v.sort();
    v
}
