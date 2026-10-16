//! `ecos-app` — hub de sincronização, acesso remoto, agregador do Feed de
//! Equipe e cliente OAuth de calendário (seção 2). A Captura em si nunca
//! passa por aqui em modo local puro (seção 0.1) — isso é papel do cliente
//! Tauri (fora de escopo deste binário).

use ecos_app::config::Config;
use ecos_app::db::{self, IndexDb};
use ecos_app::middleware::{self};
use ecos_app::state::AppState;
use ecos_app::{espacos, jobs, routes};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Log JSON sanitizado + contador de eventos `error` (métrica `ecos_log_erros_total`, base dos alertas).
    {
        use tracing_subscriber::layer::SubscriberExt;
        let subscriber = tracing_subscriber::fmt()
            .event_format(middleware::log_sanitizer::SanitizedJsonFormatter)
            .finish()
            .with(ecos_app::observabilidade::ContadorDeErros);
        tracing::subscriber::set_global_default(subscriber)?;
    }

    let config = Config::from_env()?;
    let db = IndexDb::open(&config.index_db_path)?;

    espacos::migrar_legado(&db, &config.notes_root).await?;
    espacos::migrar_pessoal_por_usuario(&db, &config.notes_root).await?;
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
    jobs::calendario::iniciar(state.clone());
    jobs::push::iniciar(state.clone());
    jobs::mdns::anunciar(&config);

    // Uma porta só em produção (seção 2, modelo Jellyfin/Immich): serve a build estática do client como fallback de
    // qualquer rota que `montar` não reconheceu — `/api/*` e `/health*` sempre respondem antes disso, então isto
    // nunca intercepta a API, só as rotas de navegação do SPA (`index.html` via `not_found_service`). A pilha de
    // camadas (CORS, CSP, limite, gzip, cache de estáticos) vive em `middleware::camadas`.
    if let Some(static_dir) = &config.static_dir {
        tracing::info!(static_dir = %static_dir.display(), "servindo build do client (uma porta só, seção 2)");
    }
    let app = middleware::camadas::completar(routes::montar(state), config.static_dir.as_deref());

    let endereco = SocketAddr::from(([0, 0, 0, 0], config.porta));
    tracing::info!(endereco = %endereco, ambiente = ?config.ambiente, "ecos-app ouvindo");
    let listener = tokio::net::TcpListener::bind(endereco).await?;
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>()).await?;
    Ok(())
}
