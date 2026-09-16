//! Middleware de segurança aplicado globalmente (seção 5.4) — nunca por
//! endpoint individual.

pub mod auth_guard;
pub mod log_sanitizer;
pub mod rate_limit;
pub mod security_headers;
