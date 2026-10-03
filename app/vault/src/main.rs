//! `ecos-vault-db` — Cofre financeiro (seção 1.3-A, 5.3, 11.14). Bind só em
//! rede interna Docker, nunca porta publicada (seção 2). Se o arquivo de
//! ativação (`.meta.json`) já existir no boot, o Cofre segue **bloqueado**
//! até `POST /vault/desbloquear` — nenhuma chave fica em memória sem antes
//! passar pela senha do usuário (seção 5.3).

mod arquivo;
mod busca;
mod config;
mod crypto;
mod db;
mod error;
mod jobs;
mod ocr;
mod pagination;
mod routes;
mod state;

use config::Config;
use db::VaultDb;
use state::AppState;
use std::net::SocketAddr;
use std::sync::Arc;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().json().init();

    if !routes::ativacao::CIFRADO {
        tracing::warn!("build SEM SQLCipher: o arquivo do Cofre não é criptografado em disco. Não use com dados reais.");
    }

    let config = Config::from_env()?;
    let state = AppState {
        db: VaultDb::trancado(),
        config: Arc::new(config.clone()),
    };

    jobs::backup::iniciar(state.clone());
    jobs::recorrencia::iniciar(state.clone());

    let app = routes::montar(state);

    // Bind explícito em `0.0.0.0` dentro do container é seguro aqui porque
    // a rede Docker `internal` (seção 2.1) não tem rota pra fora — o
    // isolamento é feito na topologia, não no bind.
    let endereco = SocketAddr::from(([0, 0, 0, 0], config.porta));
    tracing::info!(endereco = %endereco, "ecos-vault-db ouvindo (rede interna)");
    let listener = tokio::net::TcpListener::bind(endereco).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
