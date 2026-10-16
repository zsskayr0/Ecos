//! Métricas Prometheus (`GET /metrics`) e contagem de erros registrados em log.
//!
//! - Requisições por método, rota (o padrão da rota, nunca o caminho com ids) e status, e histograma de latência.
//! - Falhas de login (401 em `/auth/login`).
//! - `ecos_log_erros_total{alvo}`: todo evento `tracing::error!` do processo (falha de escrita de arquivo, de
//!   reindex, de backup de segurança etc.) incrementa o contador do módulo que o emitiu. É a fonte dos alertas em
//!   `docs/observabilidade/alertas-prometheus.yml`.
//!
//! `/metrics` fica desligado (404) a menos que `ECOS_METRICS_TOKEN` esteja definido; com ele, exige
//! `Authorization: Bearer <token>`. Os rótulos não carregam dado pessoal: nem usuário, nem id, nem texto de erro.

use axum::extract::{MatchedPath, Request};
use axum::http::{header, HeaderMap, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use subtle::ConstantTimeEq;
use tracing::{Event, Level, Subscriber};
use tracing_subscriber::layer::{Context, Layer};

const BUCKETS: [f64; 11] = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0];
/// Teto de módulos distintos no contador de erros (o resto vai para "outros"): protege a memória.
const MAX_ALVOS: usize = 100;
const ROTA_LOGIN: &str = "/api/v1/auth/login";

#[derive(Default)]
struct Historico {
    buckets: [u64; BUCKETS.len()],
    soma: f64,
    total: u64,
}

#[derive(Default)]
struct Registro {
    requisicoes: BTreeMap<(String, String, u16), u64>,
    duracao: BTreeMap<String, Historico>,
    login_falhas: u64,
    erros: BTreeMap<String, u64>,
}

fn registro() -> &'static Mutex<Registro> {
    static R: OnceLock<Mutex<Registro>> = OnceLock::new();
    R.get_or_init(|| Mutex::new(Registro::default()))
}

fn metodo_conhecido(m: &str) -> &str {
    match m {
        "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS" => m,
        _ => "OUTRO",
    }
}

pub fn registrar_requisicao(metodo: &str, rota: &str, status: u16, duracao: Duration) {
    let mut r = registro().lock().expect("registro de métricas");
    *r.requisicoes.entry((metodo_conhecido(metodo).to_string(), rota.to_string(), status)).or_insert(0) += 1;
    let h = r.duracao.entry(rota.to_string()).or_default();
    let s = duracao.as_secs_f64();
    for (i, limite) in BUCKETS.iter().enumerate() {
        if s <= *limite {
            h.buckets[i] += 1;
        }
    }
    h.soma += s;
    h.total += 1;
    if rota == ROTA_LOGIN && status == 401 {
        r.login_falhas += 1;
    }
}

pub fn registrar_erro_de_log(alvo: &str) {
    let mut r = registro().lock().expect("registro de métricas");
    let chave = if r.erros.contains_key(alvo) || r.erros.len() < MAX_ALVOS { alvo } else { "outros" };
    *r.erros.entry(chave.to_string()).or_insert(0) += 1;
}

/// Total de erros de log de um módulo (usado nos testes).
pub fn erros_de_log(alvo: &str) -> u64 {
    registro().lock().expect("registro de métricas").erros.get(alvo).copied().unwrap_or(0)
}

fn escapar(v: &str) -> String {
    v.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n")
}

pub fn renderizar() -> String {
    let r = registro().lock().expect("registro de métricas");
    let mut s = String::new();
    s.push_str("# HELP ecos_http_requests_total Requisições HTTP por método, rota e status.\n# TYPE ecos_http_requests_total counter\n");
    for ((m, rota, st), n) in &r.requisicoes {
        let _ = writeln!(s, "ecos_http_requests_total{{metodo=\"{m}\",rota=\"{}\",status=\"{st}\"}} {n}", escapar(rota));
    }
    s.push_str("# HELP ecos_http_request_duration_seconds Latência das requisições por rota.\n# TYPE ecos_http_request_duration_seconds histogram\n");
    for (rota, h) in &r.duracao {
        let rota = escapar(rota);
        for (i, limite) in BUCKETS.iter().enumerate() {
            let _ = writeln!(s, "ecos_http_request_duration_seconds_bucket{{rota=\"{rota}\",le=\"{limite}\"}} {}", h.buckets[i]);
        }
        let _ = writeln!(s, "ecos_http_request_duration_seconds_bucket{{rota=\"{rota}\",le=\"+Inf\"}} {}", h.total);
        let _ = writeln!(s, "ecos_http_request_duration_seconds_sum{{rota=\"{rota}\"}} {}", h.soma);
        let _ = writeln!(s, "ecos_http_request_duration_seconds_count{{rota=\"{rota}\"}} {}", h.total);
    }
    let _ = write!(s, "# HELP ecos_login_falhas_total Tentativas de login recusadas (401).\n# TYPE ecos_login_falhas_total counter\necos_login_falhas_total {}\n", r.login_falhas);
    s.push_str("# HELP ecos_log_erros_total Eventos de log em nível error, por módulo (escrita de arquivo, reindex, backup...).\n# TYPE ecos_log_erros_total counter\n");
    for (alvo, n) in &r.erros {
        let _ = writeln!(s, "ecos_log_erros_total{{alvo=\"{}\"}} {n}", escapar(alvo));
    }
    s
}

/// Middleware de rota (`route_layer`): usa o padrão da rota casada para os rótulos.
pub async fn medir(req: Request, next: Next) -> Response {
    let inicio = Instant::now();
    let metodo = req.method().as_str().to_string();
    let rota = req.extensions().get::<MatchedPath>().map(|m| m.as_str().to_string()).unwrap_or_else(|| "desconhecida".to_string());
    let resposta = next.run(req).await;
    registrar_requisicao(&metodo, &rota, resposta.status().as_u16(), inicio.elapsed());
    resposta
}

/// `GET /metrics`: 404 se `ECOS_METRICS_TOKEN` não estiver definido; senão exige o token em Bearer.
pub async fn exportar(headers: HeaderMap) -> Response {
    let Some(esperado) = std::env::var("ECOS_METRICS_TOKEN").ok().filter(|t| !t.is_empty()) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let recebido = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("Bearer ")).unwrap_or("");
    if !bool::from(recebido.as_bytes().ct_eq(esperado.as_bytes())) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    ([(header::CONTENT_TYPE, "text/plain; version=0.0.4; charset=utf-8")], renderizar()).into_response()
}

/// Camada do `tracing` que conta todo evento em nível `error` por módulo.
pub struct ContadorDeErros;

impl<S: Subscriber> Layer<S> for ContadorDeErros {
    fn on_event(&self, event: &Event<'_>, _ctx: Context<'_, S>) {
        if *event.metadata().level() == Level::ERROR {
            registrar_erro_de_log(event.metadata().target());
        }
    }
}

#[cfg(test)]
mod testes {
    use super::*;
    use crate::{auth::session, config::{Ambiente, Config}, db::IndexDb, middleware::log_sanitizer::SanitizedJsonFormatter, state::AppState};
    use axum::body::{to_bytes, Body};
    use std::sync::Arc;
    use tower::Service;
    use tracing_subscriber::layer::SubscriberExt;

    #[derive(Clone, Default)]
    struct Buffer(Arc<Mutex<Vec<u8>>>);
    impl std::io::Write for Buffer {
        fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(b);
            Ok(b.len())
        }
        fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
    }

    #[test]
    fn erro_forcado_aparece_no_log_estruturado_e_no_contador_que_alimenta_o_alerta() {
        let buf = Buffer::default();
        let b2 = buf.clone();
        let subscriber = tracing_subscriber::fmt().event_format(SanitizedJsonFormatter).with_writer(move || b2.clone()).finish().with(ContadorDeErros);
        let antes = erros_de_log("alvo_forcado_no_teste");
        tracing::subscriber::with_default(subscriber, || {
            tracing::error!(target: "alvo_forcado_no_teste", senha = "nao-deve-vazar", "falha ao gravar arquivo (forçada no teste)");
            tracing::warn!(target: "alvo_forcado_no_teste", "aviso não conta como erro");
        });
        assert_eq!(erros_de_log("alvo_forcado_no_teste"), antes + 1, "só o nível error conta");
        let saida = String::from_utf8(buf.0.lock().unwrap().clone()).unwrap();
        let linha = saida.lines().find(|l| l.contains("falha ao gravar arquivo")).expect("linha do erro no log");
        let json: serde_json::Value = serde_json::from_str(linha).unwrap();
        assert_eq!(json["nivel"], "ERROR");
        assert_eq!(json["alvo"], "alvo_forcado_no_teste");
        assert_eq!(json["senha"], "[REDACTED]");
        assert!(renderizar().contains("ecos_log_erros_total{alvo=\"alvo_forcado_no_teste\"}"));
    }

    #[tokio::test]
    async fn metrics_exige_token_conta_rotas_por_padrao_e_falhas_de_login() {
        let temp = std::env::temp_dir().join(format!("ecos-obs-{}", ecos_core::new_id()));
        std::fs::create_dir_all(&temp).unwrap();
        let segredo = b"segredo-efemero-exclusivo-do-teste-de-observabilidade".to_vec();
        let state = AppState {
            db: IndexDb::open(&temp.join("index.db")).unwrap(),
            config: Arc::new(Config {
                ambiente: Ambiente::Desenvolvimento, porta: 0, notes_root: temp.clone(), index_db_path: temp.join("index.db"),
                vault_enabled: false, vault_internal_url: String::new(), session_secret: segredo.clone(), ranking_interval_secs: 300,
                static_dir: None, cookie_secure: false, google: None,
            }),
            http: reqwest::Client::new(), pareamentos: Arc::new(Mutex::new(Default::default())),
        };
        state.db.with(|c| c.execute("INSERT INTO usuario (id, nome_usuario, senha_hash, recovery_key_hash) VALUES ('U1', 'ana', 'x', 'x')", [])).await.unwrap();
        let app = crate::routes::montar(state.clone());
        let token = session::emitir_access_token("U1", &segredo).unwrap();
        let chamar = |metodo: &'static str, uri: &'static str, auth: Option<String>, corpo: Option<serde_json::Value>| {
            let mut app = app.clone();
            async move {
                let mut p = axum::http::Request::builder().method(metodo).uri(uri);
                if let Some(a) = auth { p = p.header("authorization", a); }
                let body = match corpo { Some(c) => { p = p.header("content-type", "application/json"); Body::from(c.to_string()) } None => Body::empty() };
                let r = app.call(p.body(body).unwrap()).await.unwrap();
                let st = r.status();
                (st, String::from_utf8(to_bytes(r.into_body(), 1 << 20).await.unwrap().to_vec()).unwrap())
            }
        };

        // Sem a variável de ambiente o endpoint nem existe.
        std::env::remove_var("ECOS_METRICS_TOKEN");
        assert_eq!(chamar("GET", "/metrics", None, None).await.0, StatusCode::NOT_FOUND);
        std::env::set_var("ECOS_METRICS_TOKEN", "token-de-teste-das-metricas");
        assert_eq!(chamar("GET", "/metrics", None, None).await.0, StatusCode::UNAUTHORIZED);
        assert_eq!(chamar("GET", "/metrics", Some("Bearer errado".into()), None).await.0, StatusCode::UNAUTHORIZED);

        // Tráfego: uma rota com id (o rótulo é o padrão, não o caminho) e um login recusado.
        let falhas_antes = registro().lock().unwrap().login_falhas;
        assert_eq!(chamar("GET", "/api/v1/notas/ABC123", Some(format!("Bearer {token}")), None).await.0, StatusCode::NOT_FOUND);
        let (st, _) = chamar("POST", "/api/v1/auth/login", None, Some(serde_json::json!({ "usuario": "ana", "senha": "errada-errada-12" }))).await;
        assert_eq!(st, StatusCode::UNAUTHORIZED);

        let (st, corpo) = chamar("GET", "/metrics", Some("Bearer token-de-teste-das-metricas".into()), None).await;
        std::env::remove_var("ECOS_METRICS_TOKEN");
        assert_eq!(st, StatusCode::OK);
        assert!(corpo.contains("ecos_http_requests_total{metodo=\"GET\",rota=\"/api/v1/notas/:id\""), "{corpo}");
        assert!(!corpo.contains("ABC123"), "id não vira rótulo");
        assert!(corpo.contains("ecos_http_request_duration_seconds_bucket{rota=\"/api/v1/auth/login\""));
        assert!(corpo.contains("# TYPE ecos_login_falhas_total counter"));
        assert!(registro().lock().unwrap().login_falhas > falhas_antes);
        let _ = std::fs::remove_dir_all(&temp);
    }
}
