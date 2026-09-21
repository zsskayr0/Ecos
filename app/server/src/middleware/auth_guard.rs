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
use rusqlite::OptionalExtension;
use crate::error::AppError;
use crate::state::AppState;

/// Identidade do usuário autenticado — extraível em qualquer handler
/// protegido via `Extension<UsuarioAutenticado>`.
#[derive(Debug, Clone)]
pub struct UsuarioAutenticado(pub String);

/// Cookie primeiro (navegador, mesma origem — inclui o build servido pelo
/// próprio `ecos-app`); `Authorization: Bearer` como alternativa pro
/// cliente Tauri, cuja origem (`tauri://localhost` / `http://tauri.localhost`)
/// nunca é a mesma do servidor — um cookie `SameSite=Strict` (seção 5.1)
/// nunca acompanha essa requisição cross-origin, CORS não muda isso (CORS
/// só decide se o navegador *permite ler a resposta*, não se ele *envia*
/// um cookie Strict num pedido de outra origem). Sem essa alternativa o
/// app nativo nunca ficaria logado, só o navegador.
fn extrair_token(req: &Request<Body>) -> Option<String> {
    if let Some(auth) = req.headers().get(axum::http::header::AUTHORIZATION) {
        if let Ok(valor) = auth.to_str() {
            if let Some(token) = valor.strip_prefix("Bearer ") {
                return Some(token.to_string());
            }
        }
    }
    CookieJar::from_headers(req.headers())
        .get(session::NOME_COOKIE_SESSAO)
        .map(|c| c.value().to_string())
}

pub async fn exigir_sessao(
    State(state): State<AppState>,
    mut req: Request<Body>,
    next: Next,
) -> Result<Response, AppError> {
    let token = extrair_token(&req).ok_or(AppError::new(ErrorCode::Unauthorized))?;

    let claims = session::validar_access_token(&token, &state.config.session_secret)
        .ok_or(AppError::new(ErrorCode::Unauthorized))?;

    // O access token é stateless (15 min): sem isto, uma conta excluída continuaria entrando até ele expirar.
    let sub = claims.sub.clone();
    let linha: Option<bool> = state.db.with(move |conn| conn.query_row("SELECT deve_trocar_senha != 0 FROM usuario WHERE id = ?1", [&sub], |r| r.get(0)).optional()).await.unwrap_or(None);
    let Some(deve_trocar_senha) = linha else {
        return Err(AppError::new(ErrorCode::Unauthorized));
    };
    // Conta com senha temporária: nada funciona até a troca (nem ler dados, nem chamar o Cofre); o app precisa só do perfil
    // (para saber que tem de trocar) e da própria troca.
    if deve_trocar_senha {
        // O guard roda dentro do roteador aninhado em `/api/v1`, que tira o prefixo do caminho: aceita com e sem.
        let caminho = req.uri().path();
        let caminho = caminho.strip_prefix("/api/v1").unwrap_or(caminho);
        let liberado = matches!((req.method(), caminho), (&axum::http::Method::GET, "/me") | (&axum::http::Method::POST, "/me/senha"));
        if !liberado {
            return Err(AppError::new(ErrorCode::PasswordChangeRequired));
        }
    }

    req.extensions_mut().insert(UsuarioAutenticado(claims.sub));
    Ok(next.run(req).await)
}
