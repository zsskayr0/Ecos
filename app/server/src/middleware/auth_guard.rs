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

/// Sessão (`sessao.id`) que emitiu o token da requisição; `None` para tokens sem `sid`.
#[derive(Debug, Clone)]
pub struct SessaoAtual(pub Option<String>);

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

/// Rotas de leitura de arquivo que `<img>`/`<a>` abrem direto, sem como mandar `Authorization`.
fn rota_de_midia(metodo: &axum::http::Method, caminho: &str) -> bool {
    if metodo != axum::http::Method::GET { return false; }
    let caminho = caminho.strip_prefix("/api/v1").unwrap_or(caminho);
    if caminho.starts_with("/media/arquivo/") || caminho == "/arquivos/conteudo" { return true; }
    let partes: Vec<&str> = caminho.trim_start_matches('/').split('/').collect();
    partes.len() == 4 && matches!(partes[0], "notas" | "tarefas") && partes[2] == "anexos"
}

/// `?mt=<token>` só vale nas rotas de leitura de arquivo (`rota_de_midia`); em qualquer outra, é ignorado.
fn token_de_midia(req: &Request<Body>, segredo: &[u8]) -> Option<session::Claims> {
    if !rota_de_midia(req.method(), req.uri().path()) { return None; }
    let token = req.uri().query()?.split('&').find_map(|par| par.strip_prefix("mt="))?;
    session::validar_token_midia(token, segredo)
}

pub async fn exigir_sessao(
    State(state): State<AppState>,
    mut req: Request<Body>,
    next: Next,
) -> Result<Response, AppError> {
    let claims = extrair_token(&req)
        .and_then(|token| session::validar_access_token(&token, &state.config.session_secret))
        .or_else(|| token_de_midia(&req, &state.config.session_secret))
        .ok_or(AppError::new(ErrorCode::Unauthorized))?;

    // O access token é stateless (15 min): sem isto, uma conta excluída continuaria entrando até ele expirar.
    let sub = claims.sub.clone();
    // Distinguir "usuário não existe" (sessão realmente inválida, 401) de uma falha
    // transitória do banco (lock/timeout do SQLite): um soluço de banco não pode
    // deslogar quem tem um token válido — isso derrubava a sessão sem motivo real.
    let linha: Option<bool> = match state
        .db
        .with_read(move |conn| conn.query_row("SELECT deve_trocar_senha != 0 FROM usuario WHERE id = ?1", [&sub], |r| r.get(0)).optional())
        .await
    {
        Ok(linha) => linha,
        Err(_) => return Err(AppError::new(ErrorCode::InternalError)),
    };
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

    // Token amarrado a uma sessão: sessão revogada (troca de senha, logout) ou expirada não autentica mais.
    if let Some(sid) = claims.sid.clone() {
        let ativa: Result<Option<bool>, _> = state
            .db
            .with_read(move |conn| conn.query_row("SELECT revogado_em IS NULL FROM sessao WHERE id = ?1", [&sid], |r| r.get(0)).optional())
            .await;
        match ativa {
            Ok(Some(true)) => {}
            Ok(_) => return Err(AppError::new(ErrorCode::Unauthorized)),
            Err(_) => return Err(AppError::new(ErrorCode::InternalError)),
        }
    }

    req.extensions_mut().insert(SessaoAtual(claims.sid));
    req.extensions_mut().insert(UsuarioAutenticado(claims.sub));
    Ok(next.run(req).await)
}
