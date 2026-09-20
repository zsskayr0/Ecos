//! Montagem do roteador (seção 11) — base `/api/v1`, exceto `/health`. Toda
//! rota exige cookie de sessão válido (seção 11.1), exceto `/health` e
//! `/auth/*`.

pub mod anexos_comuns;
pub mod avatar;
pub mod busca;
pub mod calendario;
pub mod captura;
pub mod equipes;
pub mod feed;
pub mod health;
pub mod media;
pub mod lixeira;
pub mod notas;
pub mod notificacoes;
pub mod pagination;
pub mod pastas;
pub mod rotina;
pub mod sync;
pub mod tarefas;
pub mod vault_proxy;

use crate::middleware::auth_guard::exigir_sessao;
use crate::middleware::rate_limit::RateLimitLayer;
use crate::state::AppState;
use axum::middleware::from_fn_with_state;
use axum::routing::{delete, get, patch, post};
use axum::{extract::DefaultBodyLimit, Router};
use std::time::Duration;

/// Rotas sensíveis (login, recuperação) levam um limite mais rígido que o
/// global (seção 5.4).
fn rotas_auth_sensiveis() -> Router<AppState> {
    Router::new()
        .route("/auth/login", post(crate::auth::login))
        .route("/auth/refresh", post(crate::auth::refresh))
        .route("/auth/recuperar-senha", post(crate::auth::recuperar_senha))
        .layer(RateLimitLayer::new(10, Duration::from_secs(60)))
}

/// `/sync/dispositivos/parear/confirmar` (código de 6 dígitos) merece o
/// mesmo tipo de limite rígido — força-bruta viável sem ele (seção 5.4).
fn rotas_pareamento_sensiveis() -> Router<AppState> {
    Router::new()
        .route("/sync/dispositivos/parear/confirmar", post(sync::confirmar_pareamento))
        .layer(RateLimitLayer::new(10, Duration::from_secs(60)))
}

fn rotas_protegidas(state: AppState) -> Router<AppState> {
    Router::new()
        .route("/me", get(crate::auth::perfil).patch(crate::auth::atualizar_perfil).delete(crate::conta::excluir_conta))
        .route("/me/export", get(crate::conta::exportar))
        .route("/me/avatar", get(avatar::obter_meu).put(avatar::enviar).delete(avatar::remover).layer(DefaultBodyLimit::max(avatar::TAMANHO_MAXIMO_MULTIPART_AVATAR_BYTES)))
        .route("/usuarios/:id/avatar", get(avatar::obter_de_usuario))
        .route("/captura", post(captura::capturar))
        .route("/captura/campos-compativeis", get(captura::campos_compativeis))
        .route("/notas", get(notas::listar).post(notas::criar))
        .route("/notas/importar", post(notas::importar))
        .route("/notas/:id", get(notas::obter).patch(notas::atualizar).delete(notas::excluir))
        .route("/notas/:id/links", get(notas::links))
        .route("/notas/:id/pagina", get(notas::obter_pagina).patch(notas::atualizar_pagina))
        .route("/notas/:id/anexos", post(notas::enviar_anexo).layer(DefaultBodyLimit::max(anexos_comuns::TAMANHO_MAXIMO_MULTIPART_BYTES)))
        .route("/notas/:id/anexos/:nome_arquivo", get(notas::obter_anexo))
        // Axum limita multipart a 2 MB por padrão. A biblioteca aceita até
        // 120 MB (validado no handler), então a camada precisa comportar a
        // requisição completa antes de ela chegar ao `Multipart`.
        .route("/media", get(media::listar).post(media::enviar).layer(DefaultBodyLimit::max(anexos_comuns::TAMANHO_MAXIMO_MULTIPART_BYTES)))
        .route("/media/arquivo/*caminho", get(media::obter_arquivo).delete(media::excluir))
        .route("/lixeira", get(media::listar_lixeira))
        .route("/lixeira/:id/restaurar", post(media::restaurar))
        .route("/pastas", get(pastas::listar).post(pastas::criar).patch(pastas::renomear).delete(pastas::excluir))
        .route("/documentos/:hash", get(pastas::documento))
        .route("/tarefas", get(tarefas::listar).post(tarefas::criar))
        .route("/tarefas/:id", get(tarefas::obter).patch(tarefas::atualizar).delete(tarefas::excluir))
        .route("/tarefas/:id/status", patch(tarefas::atualizar_status))
        .route("/tarefas/:id/time-entries", get(tarefas::listar_time_entries).post(tarefas::criar_time_entry))
        .route("/tarefas/:id/time-entries/:entrada", patch(tarefas::atualizar_time_entry).delete(tarefas::excluir_time_entry))
        .route("/tarefas/:id/anexos", post(tarefas::enviar_anexo).layer(DefaultBodyLimit::max(anexos_comuns::TAMANHO_MAXIMO_MULTIPART_BYTES)))
        .route("/tarefas/:id/anexos/:nome_arquivo", get(tarefas::obter_anexo))
        .route("/agenda/capacidade", get(tarefas::capacidade))
        .route("/agenda/blocos", get(tarefas::listar_blocos))
        .route("/feed", get(feed::obter))
        .route("/busca", get(busca::buscar))
        .route("/rotina/blocos", get(rotina::listar).post(rotina::criar))
        .route("/rotina/blocos/:id", patch(rotina::atualizar).delete(rotina::excluir))
        .route("/equipes", get(equipes::listar_minhas).post(equipes::criar))
        .route("/equipes/:id", get(equipes::obter).patch(equipes::atualizar).delete(equipes::excluir))
        .route("/equipes/:id/membros", get(equipes::listar_membros))
        .route("/equipes/:id/membros/:usuario_id", patch(equipes::trocar_cargo).delete(equipes::remover_membro))
        .route("/equipes/:id/convites", post(equipes::criar_convite))
        .route("/convites/:codigo/aceitar", post(equipes::aceitar_convite))
        .route("/notificacoes", get(notificacoes::listar))
        .route("/notificacoes/:id/lida", patch(notificacoes::marcar_lida))
        .route("/notificacoes/marcar-todas-lidas", post(notificacoes::marcar_todas_lidas))
        .route("/sync/status", get(sync::status))
        .route("/sync/dispositivos", get(sync::listar_dispositivos))
        .route("/sync/dispositivos/parear", post(sync::parear))
        .merge(rotas_pareamento_sensiveis())
        .route("/sync/dispositivos/:id", patch(sync::atualizar_dispositivo).delete(sync::excluir_dispositivo))
        .route("/sync/config", patch(sync::atualizar_config))
        .route("/equipes/:id/sair", post(equipes::sair))
        .route("/sync/dispositivos/:id/push", patch(sync::atualizar_push))
        .route("/calendario/config", get(calendario::config))
        .route("/calendario/conectar/:provider", get(calendario::conectar))
        .route("/calendario/callback/:provider", get(calendario::callback))
        .route("/calendario/:provider", delete(calendario::desconectar))
        .route("/vault/*resto", axum::routing::any(vault_proxy::encaminhar))
        .route_layer(from_fn_with_state(state, exigir_sessao))
}

pub fn montar(state: AppState) -> Router {
    let v1 = Router::new()
        .route("/auth/status", get(crate::auth::status))
        .route("/auth/registrar", post(crate::auth::registrar))
        .route("/auth/logout", post(crate::auth::logout))
        .merge(rotas_auth_sensiveis())
        .merge(rotas_protegidas(state.clone()))
        .fallback(|| async {
            (axum::http::StatusCode::NOT_FOUND, axum::Json(serde_json::json!({
                "error": "NOT_FOUND",
                "message": "Esta operação não está disponível no servidor Ecos. Atualize o servidor e tente novamente."
            })))
        });

    Router::new()
        .route("/health", get(health::liveness))
        .route("/health/ready", get(health::readiness))
        .nest("/api/v1", v1)
        .with_state(state)
}
