//! Materializa ocorrências vencidas de `transacao_recorrente` em
//! `transacao` (`origem='recorrencia_gerada'`), pulando datas em
//! `recorrencia_exclusao` — seção 4.3 do handoff. Usa
//! `ecos_core::recurrence::ocorrencias_vencidas` (mesma lógica testada em
//! `ecos-core`).

use crate::state::AppState;
use chrono::{NaiveDate, Utc};
use std::time::Duration;

const INTERVALO: Duration = Duration::from_secs(15 * 60);

pub fn iniciar(state: AppState) {
    tokio::spawn(async move {
        loop {
            for usuario in state.db.usuarios_destrancados() {
                if let Err(err) = crate::db::USUARIO
                    .scope(usuario.clone(), executar(&state))
                    .await
                {
                    tracing::error!(error = %err, usuario = %usuario, "job de materialização de recorrências falhou");
                }
            }
            tokio::time::sleep(INTERVALO).await;
        }
    });
}

pub(crate) async fn executar(state: &AppState) -> Result<(), crate::db::VaultDbError> {
    let hoje = Utc::now().date_naive();
    let total = state
        .db
        .with(move |c| {
            let tx = c.unchecked_transaction()?;
            let pendentes = crate::routes::fluxo::ocorrencias(
                &tx,
                NaiveDate::from_ymd_opt(1, 1, 1).unwrap(),
                hoje,
            )?;
            for o in &pendentes {
                crate::routes::fluxo::materializar(
                    &tx,
                    &o.recorrencia_id,
                    &o.data,
                    &o.data,
                    false,
                )?;
            }
            tx.commit()?;
            Ok(pendentes.len())
        })
        .await?;
    if total > 0 {
        tracing::info!(geradas = total, "recorrências materializadas");
    }
    Ok(())
}
