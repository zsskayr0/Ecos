//! Ativação/desbloqueio do Cofre (seção 5.3, 12) — não estão listados
//! literalmente na tabela da seção 11.14 (que assume o Vault já
//! desbloqueado), mas são o mecanismo que o README de ativação (seção 12)
//! descreve: "no primeiro acesso, você vai definir uma senha exclusiva do
//! Cofre" e "biometria obrigatória... renovado a cada abertura". Aqui,
//! senha é o fator real; a biometria de dispositivo (WebAuthn) fica como
//! gate adicional no cliente, `TODO` (ver plano de execução).

use axum::extract::State;
use axum::Json;
use ecos_core::ErrorCode;
use serde::Deserialize;

use crate::crypto;
use crate::db::meta::VaultMeta;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct SenhaPayload {
    pub senha: String,
}

fn validar_senha(senha: &str) -> AppResult<()> {
    if senha.len() < 8 {
        return Err(AppError::new(ErrorCode::ValidationError).with_message("A senha do Cofre deve ter ao menos 8 caracteres."));
    }
    Ok(())
}

/// Primeiro acesso — define a senha do Cofre, deriva a chave (Argon2id),
/// cria o arquivo e aplica as migrations. Falha se já existir uma
/// ativação anterior nesta instância.
pub async fn ativar(State(state): State<AppState>, Json(payload): Json<SenhaPayload>) -> AppResult<Json<serde_json::Value>> {
    validar_senha(&payload.senha)?;
    if VaultMeta::carregar(&state.config.meta_path)?.is_some() {
        return Err(AppError::new(ErrorCode::Conflict).with_message("O Cofre desta instância já foi ativado."));
    }

    let salt = crypto::gerar_salt();
    let chave = crypto::derivar_chave(&payload.senha, &salt);
    state.db.destrancar(&state.config.db_path, &crypto::para_hex(&chave))?;

    let meta = VaultMeta { salt_hex: crypto::para_hex(&salt) };
    meta.salvar(&state.config.meta_path)?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Reabertura do módulo — mesma senha, mesma chave derivada; nunca fica
/// "destravado" indefinidamente entre chamadas (o processo só mantém a
/// conexão aberta enquanto o serviço roda; reiniciar o container exige
/// desbloquear de novo).
pub async fn desbloquear(State(state): State<AppState>, Json(payload): Json<SenhaPayload>) -> AppResult<Json<serde_json::Value>> {
    let meta = VaultMeta::carregar(&state.config.meta_path)?.ok_or(AppError::new(ErrorCode::NotFound).with_message("Cofre ainda não foi ativado nesta instância."))?;
    let salt = crypto::de_hex(&meta.salt_hex).ok_or(AppError::new(ErrorCode::InternalError))?;
    let chave = crypto::derivar_chave(&payload.senha, &salt);

    state
        .db
        .destrancar(&state.config.db_path, &crypto::para_hex(&chave))
        .map_err(|_| AppError::new(ErrorCode::InvalidCredentials).with_message("Senha do Cofre incorreta."))?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn bloquear(State(state): State<AppState>) -> AppResult<Json<serde_json::Value>> {
    state.db.trancar();
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// `GET /vault/config` (seção 11.14) — `cofre_ativado` + saldo consolidado
/// por Conta (só quando destrancado; bloqueado, devolve só o status).
pub async fn config(State(state): State<AppState>) -> AppResult<Json<serde_json::Value>> {
    let ativado = VaultMeta::carregar(&state.config.meta_path)?.is_some();
    let destrancado = state.db.esta_destrancado();

    if !destrancado {
        return Ok(Json(serde_json::json!({ "cofre_ativado": ativado, "destrancado": false, "saldos_por_conta": [] })));
    }

    let saldos: Vec<serde_json::Value> = state
        .db
        .with(|conn| {
            let mut stmt = conn.prepare(
                "SELECT c.id, c.nome, COALESCE(SUM(CASE WHEN t.tipo = 'entrada' THEN t.valor_centavos ELSE -t.valor_centavos END), 0) \
                 FROM conta c LEFT JOIN transacao t ON t.conta_id = c.id AND t.status = 'efetivada' \
                 GROUP BY c.id, c.nome",
            )?;
            let linhas = stmt
                .query_map([], |r| Ok(serde_json::json!({ "conta_id": r.get::<_, String>(0)?, "nome": r.get::<_, String>(1)?, "saldo_centavos": r.get::<_, i64>(2)? })))?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await?;

    Ok(Json(serde_json::json!({ "cofre_ativado": ativado, "destrancado": true, "saldos_por_conta": saldos })))
}
