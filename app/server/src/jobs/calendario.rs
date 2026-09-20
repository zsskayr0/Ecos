//! Job de sincronização com o Google Calendar: polling incremental (`syncToken`) a cada
//! `ECOS_CALENDARIO_INTERVAL_SECS` (padrão 300 s). O Google só entrega webhook para HTTPS público; como o Ecos
//! roda em LAN/Tailscale, o polling é o caminho. Falhas transitórias (rede, 429, 5xx) dobram o intervalo, até 16x.

use crate::calendario::google::GoogleErro;
use crate::calendario::sync::{self, SyncErro};
use crate::state::AppState;
use std::time::Duration;

const MAX_EXPOENTE_BACKOFF: u32 = 4;

fn transitorio(e: &SyncErro) -> bool {
    matches!(e, SyncErro::Google(GoogleErro::Rede(_)) | SyncErro::Google(GoogleErro::Http { .. }))
}

pub fn iniciar(state: AppState) {
    let Some(cfg) = state.config.google.clone() else {
        tracing::info!("Google Calendar desligado (sem GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET): job de sincronização não iniciado");
        return;
    };
    tokio::spawn(async move {
        let base = Duration::from_secs(cfg.intervalo_secs);
        let mut expoente: u32 = 0;
        // Deixa o servidor terminar de subir antes do primeiro ciclo.
        tokio::time::sleep(Duration::from_secs(5)).await;
        loop {
            let mut falhou = false;
            match sync::usuarios_para_sincronizar(&state).await {
                Ok(usuarios) => {
                    for usuario in usuarios {
                        if let Err(e) = sync::sincronizar(&state, &usuario).await {
                            falhou |= transitorio(&e);
                        }
                    }
                }
                Err(e) => tracing::error!(error = %e, "não foi possível listar contas do Google para sincronizar"),
            }
            expoente = if falhou { (expoente + 1).min(MAX_EXPOENTE_BACKOFF) } else { 0 };
            tokio::time::sleep(base * 2u32.pow(expoente)).await;
        }
    });
}
