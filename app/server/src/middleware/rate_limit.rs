//! Rate limit por IP, janela deslizante (seção 5.4: "defesa em profundidade
//! — um limite mais frouxo por IP se aplica à API inteira, não só às rotas
//! de auth"). Implementado como `tower::Layer` próprio (sem dependência
//! externa) pra não acoplar o tipo de estado do middleware ao `AppState`
//! do router.

use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{Request, StatusCode};
use axum::response::{IntoResponse, Response};
use ecos_core::{ErrorCode, ErrorInfo};
use std::collections::{HashMap, VecDeque};
use std::future::Future;
use std::net::{IpAddr, SocketAddr};
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};
use std::time::{Duration, Instant};
use tower::{Layer, Service};

#[derive(Clone)]
struct Limiter {
    janelas: Arc<Mutex<HashMap<IpAddr, VecDeque<Instant>>>>,
    max_por_janela: usize,
    janela: Duration,
}

impl Limiter {
    /// `Ok(())` libera a requisição; `Err(segundos)` bloqueia e diz quanto
    /// falta até a janela mais antiga expirar — o cliente usa isso pra
    /// mostrar uma contagem regressiva real (seção UX: "como na tela de
    /// bloqueio de um celular") em vez de só "tente de novo mais tarde".
    fn permitir(&self, ip: IpAddr) -> Result<(), u64> {
        let mut mapa = self.janelas.lock().expect("mutex do rate limiter nunca deve ser envenenado");
        let agora = Instant::now();
        let fila = mapa.entry(ip).or_default();
        while let Some(&frente) = fila.front() {
            if agora.duration_since(frente) > self.janela {
                fila.pop_front();
            } else {
                break;
            }
        }
        if fila.len() >= self.max_por_janela {
            let frente = *fila.front().expect("len >= max_por_janela > 0 implica fila não vazia");
            let restante = self.janela.saturating_sub(agora.duration_since(frente));
            Err(restante.as_secs() + 1)
        } else {
            fila.push_back(agora);
            Ok(())
        }
    }
}

#[derive(Clone)]
pub struct RateLimitLayer {
    limiter: Limiter,
}

impl RateLimitLayer {
    /// `max_por_janela` requisições por IP a cada `janela` de tempo.
    pub fn new(max_por_janela: usize, janela: Duration) -> Self {
        Self {
            limiter: Limiter {
                janelas: Arc::new(Mutex::new(HashMap::new())),
                max_por_janela,
                janela,
            },
        }
    }
}

impl<S> Layer<S> for RateLimitLayer {
    type Service = RateLimitService<S>;

    fn layer(&self, inner: S) -> Self::Service {
        RateLimitService {
            inner,
            limiter: self.limiter.clone(),
        }
    }
}

#[derive(Clone)]
pub struct RateLimitService<S> {
    inner: S,
    limiter: Limiter,
}

impl<S> Service<Request<Body>> for RateLimitService<S>
where
    S: Service<Request<Body>, Response = Response> + Clone + Send + 'static,
    S::Future: Send + 'static,
    S::Error: Send + 'static,
{
    type Response = Response;
    type Error = S::Error;
    type Future = Pin<Box<dyn Future<Output = Result<Response, S::Error>> + Send>>;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(cx)
    }

    fn call(&mut self, req: Request<Body>) -> Self::Future {
        let ip = req.extensions().get::<ConnectInfo<SocketAddr>>().map(|ci| ci.0.ip());
        let limiter = self.limiter.clone();
        let mut inner = self.inner.clone();

        Box::pin(async move {
            if let Some(ip) = ip {
                if let Err(retry_after_secs) = limiter.permitir(ip) {
                    let info: ErrorInfo = ErrorCode::RateLimited.into();
                    // `retry_after_segundos` além do contrato padrão
                    // `{error, message}` (seção 7) — só usado aqui, pro
                    // cliente montar uma contagem regressiva real em vez
                    // de um texto genérico "tente mais tarde".
                    let corpo = serde_json::json!({
                        "error": info.error,
                        "message": info.message,
                        "retry_after_segundos": retry_after_secs,
                    });
                    let mut resp = (StatusCode::TOO_MANY_REQUESTS, axum::Json(corpo)).into_response();
                    if let Ok(valor) = axum::http::HeaderValue::from_str(&retry_after_secs.to_string()) {
                        resp.headers_mut().insert(axum::http::header::RETRY_AFTER, valor);
                    }
                    return Ok(resp);
                }
            }
            inner.call(req).await
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bloqueia_apos_o_limite_e_libera_apos_a_janela() {
        let limiter = Limiter {
            janelas: Arc::new(Mutex::new(HashMap::new())),
            max_por_janela: 2,
            janela: Duration::from_millis(50),
        };
        let ip: IpAddr = "127.0.0.1".parse().unwrap();
        assert!(limiter.permitir(ip).is_ok());
        assert!(limiter.permitir(ip).is_ok());
        assert!(limiter.permitir(ip).is_err());
        std::thread::sleep(Duration::from_millis(60));
        assert!(limiter.permitir(ip).is_ok());
    }
}
