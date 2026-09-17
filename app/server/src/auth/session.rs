//! Sessão de login: cookie `HttpOnly, Secure, SameSite=Strict` com um JWT
//! curto (access token) + um cookie de refresh separado, opaco, guardado
//! hasheado na tabela `sessao` (seção 5.1).

use axum_extra::extract::cookie::{Cookie, SameSite};
use chrono::{Duration as ChronoDuration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const NOME_COOKIE_SESSAO: &str = "ecos_sessao";
pub const NOME_COOKIE_REFRESH: &str = "ecos_refresh";

const DURACAO_ACCESS_TOKEN_MIN: i64 = 15;
pub const DURACAO_REFRESH_DIAS: i64 = 30;

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    /// `usuario_id`.
    pub sub: String,
    pub exp: usize,
}

/// Emite um access token JWT (HS256) curto, assinado com o segredo de
/// sessão da instância (seção 5.4 — nunca ausente em produção).
pub fn emitir_access_token(usuario_id: &str, segredo: &[u8]) -> anyhow::Result<String> {
    let exp = (Utc::now() + ChronoDuration::minutes(DURACAO_ACCESS_TOKEN_MIN)).timestamp() as usize;
    let claims = Claims {
        sub: usuario_id.to_string(),
        exp,
    };
    Ok(encode(&Header::default(), &claims, &EncodingKey::from_secret(segredo))?)
}

pub fn validar_access_token(token: &str, segredo: &[u8]) -> Option<Claims> {
    decode::<Claims>(token, &DecodingKey::from_secret(segredo), &Validation::default())
        .ok()
        .map(|dado| dado.claims)
}

/// Gera um refresh token opaco novo — o valor em si vai só no cookie do
/// navegador; o que persiste no banco é `hash_refresh_token(valor)`.
pub fn gerar_refresh_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, bytes)
}

pub fn hash_refresh_token(valor: &str) -> String {
    let digest = Sha256::digest(valor.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// `secure`: `false` por padrão (self-host na LAN via `http://`, ver
/// `Config::cookie_secure`) — um cookie `Secure` em `http://` puro é
/// descartado pelo navegador sem aviso, não é "mais seguro nesse caso",
/// só quebra o login silenciosamente.
pub fn cookie_sessao(valor: String, secure: bool) -> Cookie<'static> {
    Cookie::build((NOME_COOKIE_SESSAO, valor))
        .http_only(true)
        .secure(secure)
        .same_site(SameSite::Strict)
        .path("/")
        .max_age(time::Duration::minutes(DURACAO_ACCESS_TOKEN_MIN))
        .build()
}

pub fn cookie_refresh(valor: String, secure: bool) -> Cookie<'static> {
    Cookie::build((NOME_COOKIE_REFRESH, valor))
        .http_only(true)
        .secure(secure)
        .same_site(SameSite::Strict)
        .path("/api/v1/auth")
        .max_age(time::Duration::days(DURACAO_REFRESH_DIAS))
        .build()
}

/// Cookies "removidos" (idade zero) usados em `/auth/logout` — `secure`
/// só afeta o atributo do cabeçalho; um cookie de idade zero é removido
/// pelo navegador de qualquer forma.
pub fn cookie_sessao_expirado(secure: bool) -> Cookie<'static> {
    let mut c = cookie_sessao(String::new(), secure);
    c.set_max_age(time::Duration::seconds(0));
    c
}

pub fn cookie_refresh_expirado(secure: bool) -> Cookie<'static> {
    let mut c = cookie_refresh(String::new(), secure);
    c.set_max_age(time::Duration::seconds(0));
    c
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn access_token_roundtrip() {
        let segredo = b"segredo-de-teste-32-bytes-aaaaaa";
        let token = emitir_access_token("usr_1", segredo).unwrap();
        let claims = validar_access_token(&token, segredo).unwrap();
        assert_eq!(claims.sub, "usr_1");
    }

    #[test]
    fn access_token_rejeita_segredo_errado() {
        let token = emitir_access_token("usr_1", b"segredo-a-xxxxxxxxxxxxxxxxxxxxxx").unwrap();
        assert!(validar_access_token(&token, b"segredo-b-yyyyyyyyyyyyyyyyyyyyyy").is_none());
    }

    #[test]
    fn refresh_token_hash_e_deterministico_e_nao_reversivel_a_olho() {
        let valor = gerar_refresh_token();
        let h1 = hash_refresh_token(&valor);
        let h2 = hash_refresh_token(&valor);
        assert_eq!(h1, h2);
        assert_ne!(h1, valor);
    }
}
