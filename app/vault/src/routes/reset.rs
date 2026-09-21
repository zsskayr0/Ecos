//! `POST /vault/reset` (seção 11.14/7.3) — zona de perigo. Exige
//! `{confirm:"APAGAR TUDO"}` (mesmo padrão validado no Nexus,
//! [[ecos-vault-nexus-reuse-policy]]) e tira um backup antes de aplicar
//! (seção 3.4: "backup do vault é sempre tirado antes de aplicar uma
//! migração/reset no Cofre — rollback de dado financeiro nunca depende só
//! de migração reversa").

use axum::extract::State;
use axum::Json;
use chrono::Utc;
use ecos_core::ErrorCode;
use serde::Deserialize;

use crate::db::meta::VaultMeta;
use crate::error::{AppError, AppResult};
use crate::jobs::backup::nome_arquivo_backup;
use crate::routes::ativacao::usuario;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct ConfirmarPayload {
    pub confirm: String,
}

pub async fn reset(State(state): State<AppState>, Json(payload): Json<ConfirmarPayload>) -> AppResult<Json<serde_json::Value>> {
    if payload.confirm != "APAGAR TUDO" {
        return Err(AppError::new(ErrorCode::ConfirmationPhraseRequired));
    }

    let pasta = state.config.backups_de(&usuario()?);
    std::fs::create_dir_all(&pasta)?;
    let backup_antes = pasta.join(format!("pre-reset-{}", nome_arquivo_backup(Utc::now())));
    state
        .db
        .snapshot_para(&backup_antes)
        .await
        .map_err(|_| AppError::new(ErrorCode::VaultBackupFailed).with_message("Reset abortado: não foi possível tirar o backup de segurança antes de apagar."))?;

    state
        .db
        .with(|conn| {
            let tx = conn.unchecked_transaction()?;
            for tabela in ["anexo", "transacao", "recorrencia_exclusao", "transacao_recorrente", "pendencia_avulsa", "beneficiario", "conta", "categoria"] {
                tx.execute(&format!("DELETE FROM {tabela}"), [])?;
            }
            tx.commit()
        })
        .await?;

    Ok(Json(serde_json::json!({ "ok": true, "backup_de_seguranca": backup_antes.file_name().map(|n| n.to_string_lossy().to_string()) })))
}

/// `POST /vault/excluir` — usado na exclusão da conta: apaga o Cofre **desta pessoa** por inteiro (banco, salt e
/// backups; sem cópia "pre-reset"). Sem Cofre ativado não há o que apagar; com Cofre trancado, recusa (423): a pessoa
/// precisa desbloquear para provar que pode. Nunca toca no Cofre de outra pessoa.
pub async fn excluir_cofre(State(state): State<AppState>, Json(payload): Json<ConfirmarPayload>) -> AppResult<Json<serde_json::Value>> {
    if payload.confirm != "APAGAR TUDO" {
        return Err(AppError::new(ErrorCode::ConfirmationPhraseRequired));
    }
    let uid = usuario()?;
    if VaultMeta::carregar(&state.config.meta_de(&uid))?.is_none() {
        return Ok(Json(serde_json::json!({ "ok": true, "existia": false })));
    }
    if !state.db.esta_destrancado() {
        return Err(AppError::new(ErrorCode::VaultLocked));
    }
    state.db.trancar();
    for pasta in [state.config.dir_do_usuario(&uid), state.config.backups_de(&uid)] {
        if pasta.exists() {
            std::fs::remove_dir_all(&pasta)?;
        }
    }
    tracing::info!(usuario = %uid, "cofre excluído junto com a conta");
    Ok(Json(serde_json::json!({ "ok": true, "existia": true })))
}
