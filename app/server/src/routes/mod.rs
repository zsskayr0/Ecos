//! Montagem do roteador (seção 11) — base `/api/v1`, exceto `/health`. Toda
//! rota exige cookie de sessão válido (seção 11.1), exceto `/health` e
//! `/auth/*`.

pub mod busca;
pub mod calendario;
pub mod captura;
pub mod equipes;
pub mod feed;
pub mod health;
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
use axum::Router;
use std::time::Duration;

/// Rotas sensíveis (login, recuperação) levam um limite mais rígido que o
/// global (seção 5.4).
fn rotas_auth_sensiveis() -> Router<AppState> {
    Router::new()
        .route("/auth/login", post(crate::auth::login))
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
        .route("/me", get(crate::auth::perfil).patch(crate::auth::atualizar_perfil).delete(crate::auth::excluir_conta))
        .route("/me/export", get(crate::auth::exportar))
        .route("/captura", post(captura::capturar))
        .route("/captura/campos-compativeis", get(captura::campos_compativeis))
        .route("/notas", get(notas::listar).post(notas::criar))
        .route("/notas/:id", get(notas::obter).patch(notas::atualizar).delete(notas::excluir))
        .route("/notas/:id/links", get(notas::links))
        .route("/notas/:id/pagina", get(notas::obter_pagina).patch(notas::atualizar_pagina))
        .route("/pastas", get(pastas::listar).post(pastas::criar).patch(pastas::renomear).delete(pastas::excluir))
        .route("/documentos/:hash", get(pastas::documento))
        .route("/tarefas", get(tarefas::listar).post(tarefas::criar))
        .route("/tarefas/:id", get(tarefas::obter).patch(tarefas::atualizar).delete(tarefas::excluir))
        .route("/tarefas/:id/status", patch(tarefas::atualizar_status))
        .route("/tarefas/:id/anexos", post(tarefas::enviar_anexo))
        .route("/tarefas/:id/anexos/:nome_arquivo", get(tarefas::obter_anexo))
        .route("/agenda/capacidade", get(tarefas::capacidade))
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
        .merge(rotas_protegidas(state.clone()));

    Router::new()
        .route("/health", get(health::liveness))
        .route("/health/ready", get(health::readiness))
        .nest("/api/v1", v1)
        .with_state(state)
}
