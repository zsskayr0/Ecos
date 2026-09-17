//! Cabeçalhos de segurança HTTP globais (seção 5.4) — aplicados a toda
//! resposta via middleware Axum, desde o primeiro commit do servidor, não
//! algo "a adicionar depois".

use axum::http::{HeaderName, HeaderValue, Method};
use tower_http::cors::{AllowOrigin, CorsLayer};
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

/// `ecos-app` serve API e front do mesmo domínio quando acessado via
/// navegador (seção 2.1) — nesse caso nem precisa de `allow_origin`, o
/// navegador já aplica same-origin sozinho. Mas o cliente Tauri (seção
/// 10, endereço do servidor configurável nas Configurações — user
/// feedback: "quero poder usar o app") roda no WebView da própria origem
/// do app (`tauri://localhost` no desktop, `http://tauri.localhost` no
/// Android), nunca a mesma origem do servidor que ele acessa. Listar
/// essas origens explicitamente não é "abrir CORS pra terceiro" (regra da
/// seção 5.4) — são só as origens do próprio app, nunca um wildcard, e
/// `allow_credentials` é obrigatório pro cookie de sessão (seção 5.1)
/// sobreviver à requisição cross-origin.
pub fn cors_mesma_origem() -> CorsLayer {
    let origens_tauri = ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"]
        .map(|o| o.parse::<HeaderValue>().expect("origem Tauri estática e válida"));

    CorsLayer::new()
        .allow_origin(AllowOrigin::list(origens_tauri))
        .allow_credentials(true)
        .allow_methods([Method::GET, Method::POST, Method::PATCH, Method::PUT, Method::DELETE])
        .allow_headers([axum::http::header::CONTENT_TYPE, axum::http::header::AUTHORIZATION])
}
