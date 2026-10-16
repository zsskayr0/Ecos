//! Camadas HTTP globais do servidor (segurança, limite, compressão, cache de estáticos), montadas num só lugar
//! para o binário e os testes usarem exatamente a mesma pilha.

use std::path::Path;
use std::time::Duration;

use axum::http::{header, HeaderValue, Request};
use axum::middleware::Next;
use axum::response::Response;
use axum::Router;
use tower_http::compression::predicate::{DefaultPredicate, NotForContentType, Predicate};
use tower_http::compression::CompressionLayer;

use super::rate_limit::RateLimitLayer;
use super::security_headers;

/// Cache dos arquivos do cliente: tudo em `/assets/` tem hash no nome (Vite), logo é imutável; o resto que não
/// é API (index.html, sw.js, favicon, rotas do SPA) deve ser revalidado a cada abertura para pegar versão nova.
async fn cache_estaticos(req: Request<axum::body::Body>, next: Next) -> Response {
    let caminho = req.uri().path().to_string();
    let mut resp = next.run(req).await;
    let ja_definido = resp.headers().contains_key(header::CACHE_CONTROL);
    if ja_definido || caminho.starts_with("/api/") || caminho == "/metrics" || caminho.starts_with("/health") {
        return resp;
    }
    if caminho.starts_with("/assets/") && resp.status().is_success() {
        resp.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=31536000, immutable"));
    } else if !caminho.starts_with("/assets/") {
        // Inclui as rotas do SPA, que o `ServeDir` serve com o index.html (hoje com status 404, comportamento antigo).
        resp.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    }
    resp
}

/// Completa o roteador da API com a pilha global. Com `static_dir`, serve o cliente na mesma porta.
pub fn completar(api: Router, static_dir: Option<&Path>) -> Router {
    let mut app = api
        .layer(security_headers::cors_mesma_origem())
        .layer(security_headers::csp())
        .layer(security_headers::nosniff())
        .layer(security_headers::referrer_policy())
        // limite global, frouxo — defesa em profundidade além dos limites específicos de cada grupo de rota sensível
        // (seção 5.4). Preflights (OPTIONS) não contam.
        .layer(RateLimitLayer::new(300, Duration::from_secs(60)));

    if let Some(dir) = static_dir {
        let servico = tower_http::services::ServeDir::new(dir).not_found_service(tower_http::services::ServeFile::new(dir.join("index.html")));
        app = app.fallback_service(servico);
    }

    // gzip para texto (JS, CSS, JSON, SVG). Brotli ficou de fora: no nível padrão é caro demais para conteúdo
    // dinâmico. Arquivos já compactados (zip, pdf, imagens, vídeo) não são recomprimidos.
    let predicado = DefaultPredicate::new()
        .and(NotForContentType::const_new("application/zip"))
        .and(NotForContentType::const_new("application/pdf"))
        .and(NotForContentType::const_new("application/octet-stream"))
        .and(NotForContentType::const_new("video/"))
        .and(NotForContentType::const_new("audio/"));
    app.layer(CompressionLayer::new().gzip(true).no_br().no_deflate().no_zstd().compress_when(predicado))
        .layer(axum::middleware::from_fn(cache_estaticos))
}
