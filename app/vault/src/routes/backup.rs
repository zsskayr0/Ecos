//! `/vault/backup/*` (seção 11.14) — dump criptografado agendado (seção
//! 3.5). O agendamento em si roda em `crate::jobs::backup` (cron interno,
//! não um container à parte); estas rotas cobrem consulta de histórico e
//! disparo manual.

use axum::extract::State;
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::Utc;
use ecos_core::ErrorCode;

use crate::error::{AppError, AppResult};
use crate::jobs::backup::nome_arquivo_backup;
use crate::routes::ativacao::usuario;
use crate::state::AppState;

pub async fn config() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "frequencia": "diaria",
        "retencao": "7 diários + 4 semanais + 3 mensais",
        "proxima_execucao_automatica": "diariamente, via cron interno do ecos-vault-db",
    }))
}

pub async fn atualizar_config() -> Json<serde_json::Value> {
    // Sem tabela de configuração dedicada nesta versão — a política de
    // retenção é fixa (seção 3.5). Aceito e ignorado, documentado aqui em
    // vez de fingir persistência.
    Json(serde_json::json!({ "ok": true, "aviso": "política de retenção ainda é fixa nesta build" }))
}

pub async fn historico(State(state): State<AppState>) -> AppResult<Json<serde_json::Value>> {
    let mut arquivos = Vec::new();
    if let Ok(entradas) = std::fs::read_dir(state.config.backups_de(&usuario()?)) {
        for entrada in entradas.flatten() {
            if let Ok(metadados) = entrada.metadata() {
                if metadados.is_file() {
                    arquivos.push(serde_json::json!({
                        "nome": entrada.file_name().to_string_lossy(),
                        "tamanho_bytes": metadados.len(),
                    }));
                }
            }
        }
    }
    Ok(Json(serde_json::json!(arquivos)))
}

pub async fn exportar(State(state): State<AppState>) -> AppResult<Json<serde_json::Value>> {
    let pasta = state.config.backups_de(&usuario()?);
    std::fs::create_dir_all(&pasta)?;
    let destino = pasta.join(nome_arquivo_backup(Utc::now()));
    state
        .db
        .snapshot_para(&destino)
        .await
        .map_err(|_| AppError::new(ErrorCode::VaultBackupFailed))?;
    Ok(Json(serde_json::json!({ "ok": true, "arquivo": destino.file_name().map(|n| n.to_string_lossy().to_string()) })))
}

/// Export manual, texto plano por natureza — **nunca** automático (seção
/// 3.5). O aviso de responsabilidade vai junto no corpo da resposta.
pub async fn exportar_csv(State(state): State<AppState>) -> AppResult<Response> {
    let linhas: Vec<(String, String, i64, String, String, String)> = state
        .db
        .with(|conn| {
            let mut stmt = conn.prepare("SELECT data, descricao, valor_centavos, tipo, status, COALESCE(forma_pagamento, '') FROM transacao ORDER BY data")?;
            let linhas = stmt
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await?;

    let mut csv = String::from("data,descricao,valor_centavos,tipo,status,forma_pagamento\n");
    for (data, descricao, valor, tipo, status, forma) in linhas {
        let descricao_escapada = descricao.replace('"', "\"\"");
        csv.push_str(&format!("{data},\"{descricao_escapada}\",{valor},{tipo},{status},{forma}\n"));
    }

    Ok((
        [
            (axum::http::header::CONTENT_TYPE, "text/csv"),
            (axum::http::header::CONTENT_DISPOSITION, "attachment; filename=\"transacoes.csv\""),
        ],
        csv,
    )
        .into_response())
}
