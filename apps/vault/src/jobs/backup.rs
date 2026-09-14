//! Backup automatizado diário (seção 3.5) — cron interno (`tokio::time`,
//! não um container à parte), retenção 7 diários + 4 semanais + 3 mensais,
//! poda automática dos mais antigos.

use crate::state::AppState;
use chrono::{DateTime, Datelike, NaiveDate, Utc};
use std::collections::HashSet;
use std::time::Duration;

pub fn nome_arquivo_backup(quando: DateTime<Utc>) -> String {
    format!("vault-{}.enc", quando.format("%Y-%m-%d"))
}

pub fn iniciar(state: AppState) {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(24 * 60 * 60)).await;
            if let Err(err) = executar(&state).await {
                tracing::error!(error = %err, "backup diário do Cofre falhou");
            }
        }
    });
}

async fn executar(state: &AppState) -> anyhow::Result<()> {
    if !state.db.esta_destrancado() {
        tracing::warn!("Cofre bloqueado — backup diário adiado até o próximo desbloqueio");
        return Ok(());
    }
    let destino = state.config.backups_dir.join(nome_arquivo_backup(Utc::now()));
    state.db.snapshot_para(&destino).await?;
    podar_antigos(&state.config.backups_dir)?;
    Ok(())
}

/// Extrai a data de `vault-YYYY-MM-DD.enc`; ignora qualquer outro nome
/// (ex. `pre-reset-*.enc`, seção 7.3 — esses nunca são podados
/// automaticamente).
fn data_do_nome(nome: &str) -> Option<NaiveDate> {
    let sem_prefixo = nome.strip_prefix("vault-")?;
    let sem_sufixo = sem_prefixo.strip_suffix(".enc")?;
    NaiveDate::parse_from_str(sem_sufixo, "%Y-%m-%d").ok()
}

fn podar_antigos(dir: &std::path::Path) -> anyhow::Result<()> {
    let mut datados: Vec<(NaiveDate, std::path::PathBuf)> = std::fs::read_dir(dir)?
        .flatten()
        .filter_map(|entrada| {
            let nome = entrada.file_name().to_string_lossy().to_string();
            data_do_nome(&nome).map(|data| (data, entrada.path()))
        })
        .collect();
    datados.sort_by(|a, b| b.0.cmp(&a.0)); // mais recente primeiro

    let mut manter: HashSet<std::path::PathBuf> = HashSet::new();
    for (_, caminho) in datados.iter().take(7) {
        manter.insert(caminho.clone());
    }

    let mut semanas_vistas: HashSet<(i32, u32)> = HashSet::new();
    for (data, caminho) in &datados {
        if manter.contains(caminho) {
            continue;
        }
        let semana_iso = data.iso_week();
        let chave = (semana_iso.year(), semana_iso.week());
        if semanas_vistas.len() < 4 && semanas_vistas.insert(chave) {
            manter.insert(caminho.clone());
        }
    }

    let mut meses_vistos: HashSet<(i32, u32)> = HashSet::new();
    for (data, caminho) in &datados {
        if manter.contains(caminho) {
            continue;
        }
        let chave = (data.year(), data.month());
        if meses_vistos.len() < 3 && meses_vistos.insert(chave) {
            manter.insert(caminho.clone());
        }
    }

    for (_, caminho) in &datados {
        if !manter.contains(caminho) {
            if let Err(err) = std::fs::remove_file(caminho) {
                tracing::warn!(error = %err, arquivo = %caminho.display(), "não foi possível podar backup antigo");
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extrai_data_do_nome_padrao() {
        assert_eq!(data_do_nome("vault-2026-09-14.enc"), Some(NaiveDate::from_ymd_opt(2026, 9, 14).unwrap()));
        assert_eq!(data_do_nome("pre-reset-vault-2026-09-14.enc"), None);
        assert_eq!(data_do_nome("qualquer-coisa.txt"), None);
    }
}
