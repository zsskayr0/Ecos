//! Proxy reverso pra `ecos-vault-db` (seção 2/11.14) — único ponto de
//! acoplamento entre os dois serviços; `ecos-app` nunca fala SQL com o
//! vault, só HTTP interno, através da rede Docker `internal` (nunca
//! alcançável de fora). `404` (nunca `403`) em qualquer
//! `/vault/*` quando `ECOS_VAULT_ENABLED=false` — não revela nem a
//! existência do recurso (seção 5.3).

use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, Method, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use ecos_core::ErrorCode;

use crate::error::AppError;
use crate::state::AppState;

pub async fn encaminhar(State(state): State<AppState>, method: Method, uri: Uri, headers: HeaderMap, body: Bytes) -> Response {
    if !state.config.vault_enabled {
        return AppError::new(ErrorCode::VaultDisabled).into_response();
    }

    // `ecos-vault-db` serve suas rotas em `/vault/*` na raiz (é um serviço
    // interno, sem o prefixo `/api/v1` do `ecos-app` público) — remove o
    // prefixo antes de repassar.
    let caminho_completo = uri.path_and_query().map(|pq| pq.as_str()).unwrap_or("/");
    let caminho = caminho_completo.strip_prefix("/api/v1").unwrap_or(caminho_completo);
    let alvo = format!("{}{}", state.config.vault_internal_url, caminho);

    let mut requisicao = state.http.request(method, alvo);
    if let Some(content_type) = headers.get(axum::http::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()) {
        requisicao = requisicao.header("content-type", content_type);
    }
    requisicao = requisicao.body(body.to_vec());

    match requisicao.send().await {
        Ok(resposta) => {
            let status = StatusCode::from_u16(resposta.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
            let content_type = resposta
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("application/json")
                .to_string();
            let corpo = resposta.bytes().await.unwrap_or_default();
            (status, [(axum::http::header::CONTENT_TYPE, content_type)], corpo.to_vec()).into_response()
        }
        Err(err) => {
            tracing::error!(error = %err, "falha ao repassar requisição pro ecos-vault-db");
            AppError::new(ErrorCode::InternalError).with_message("Cofre indisponível no momento.").into_response()
        }
    }
}
