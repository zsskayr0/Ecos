//! "Auth por cookie de sessão em toda rota, exceto `/health` e `/auth/*`"
//! (seção 11.1). Valida o JWT do cookie `ecos_sessao` e injeta o
//! `usuario_id` autenticado nas extensions da request pro handler ler.

use axum::body::Body;
use axum::extract::State;
use axum::http::Request;
use axum::middleware::Next;
use axum::response::Response;
use axum_extra::extract::cookie::CookieJar;
use ecos_core::ErrorCode;

use crate::auth::session;
use crate::error::AppError;
use crate::state::AppState;

/// Identidade do usuário autenticado — extraível em qualquer handler
/// protegido via `Extension<UsuarioAutenticado>`.
#[derive(Debug, Clone)]
pub struct UsuarioAutenticado(pub String);

pub async fn exigir_sessao(
    State(state): State<AppState>,
    mut req: Request<Body>,
    next: Next,
) -> Result<Response, AppError> {
    let jar = CookieJar::from_headers(req.headers());
    let token = jar
        .get(session::NOME_COOKIE_SESSAO)
        .map(|c| c.value().to_string())
        .ok_or(AppError::new(ErrorCode::Unauthorized))?;

    let claims = session::validar_access_token(&token, &state.config.session_secret)
        .ok_or(AppError::new(ErrorCode::Unauthorized))?;

    req.extensions_mut().insert(UsuarioAutenticado(claims.sub));
    Ok(next.run(req).await)
}
