//! Cabeçalhos de segurança HTTP globais (seção 5.4) — aplicados a toda
//! resposta via middleware Axum, desde o primeiro commit do servidor, não
//! algo "a adicionar depois".

use axum::http::{HeaderName, HeaderValue};
use tower_http::cors::CorsLayer;
use tower_http::set_header::SetResponseHeaderLayer;

fn header_layer(nome: &'static str, valor: &'static str) -> SetResponseHeaderLayer<HeaderValue> {
    SetResponseHeaderLayer::overriding(HeaderName::from_static(nome), HeaderValue::from_static(valor))
}

pub fn csp() -> SetResponseHeaderLayer<HeaderValue> {
    header_layer(
        "content-security-policy",
        "default-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
    )
}

pub fn nosniff() -> SetResponseHeaderLayer<HeaderValue> {
    header_layer("x-content-type-options", "nosniff")
}

pub fn referrer_policy() -> SetResponseHeaderLayer<HeaderValue> {
    header_layer("referrer-policy", "no-referrer")
}

/// `ecos-app` serve API e front do mesmo domínio (seção 2.1) — sem
/// wildcard, sem motivo pra abrir CORS pra terceiro (seção 5.4). Sem
/// `allow_origin` configurado, o navegador aplica same-origin por padrão.
pub fn cors_mesma_origem() -> CorsLayer {
    CorsLayer::new()
}
