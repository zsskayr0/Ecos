//! `ecos-app` — hub de sincronização, acesso remoto, agregador do Feed de
//! Equipe e cliente OAuth de calendário (seção 2). A Captura em si nunca
//! passa por aqui em modo local puro (seção 0.1) — isso é papel do cliente
//! Tauri (fora de escopo deste binário).

mod auth;
mod config;
mod db;
mod error;
mod jobs;
mod middleware;
mod routes;
mod state;

use config::Config;
use db::IndexDb;
use middleware::{rate_limit::RateLimitLayer, security_headers};
use state::AppState;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .event_format(middleware::log_sanitizer::SanitizedJsonFormatter)
        .init();

    let config = Config::from_env()?;
    let db = IndexDb::open(&config.index_db_path)?;

    tracing::info!(notes_root = %config.notes_root.display(), "reindexando na inicialização");
    let resultado = db::reindex::reindexar_tudo(&db, &config.notes_root).await?;
    tracing::info!(
        notas = resultado.notas,
        tarefas = resultado.tarefas,
        erros = resultado.erros.len(),
        "reindex inicial concluído"
    );

    let state = AppState {
        db,
        config: Arc::new(config.clone()),
        http: reqwest::Client::builder().timeout(Duration::from_secs(10)).build()?,
        pareamentos: Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
    };

    jobs::ranking::iniciar(state.clone());
    jobs::watch::iniciar(state.clone());
    jobs::mdns::anunciar(&config);

    let app = routes::montar(state)
        .layer(security_headers::cors_mesma_origem())
        .layer(security_headers::csp())
        .layer(security_headers::nosniff())
        .layer(security_headers::referrer_policy())
        // limite global, frouxo — defesa em profundidade além dos limites
        // específicos de cada grupo de rota sensível (seção 5.4).
        .layer(RateLimitLayer::new(300, Duration::from_secs(60)));

    let endereco = SocketAddr::from(([0, 0, 0, 0], config.porta));
    tracing::info!(endereco = %endereco, ambiente = ?config.ambiente, "ecos-app ouvindo");
    let listener = tokio::net::TcpListener::bind(endereco).await?;
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>()).await?;
    Ok(())
}
