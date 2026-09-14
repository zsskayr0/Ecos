//! `/vault/transacoes` (seção 11.14) — fonte da verdade do extrato,
//! dashboards e Feed (via proxy do `ecos-app`, seção 4.3).

use axum::extract::{Multipart, Path, Query, State};
use axum::Json;
use chrono::NaiveDate;
use ecos_core::types::ANEXO_TAMANHO_MAXIMO_BYTES;
use ecos_core::{new_id, ErrorCode};
use rusqlite::OptionalExtension;
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult};
use crate::state::AppState;

const FORMAS_PAGAMENTO: &[&str] = &["pix", "pix_automatico", "ted", "cartao", "dinheiro", "boleto", "outro"];

#[derive(Debug, Deserialize)]
pub struct ListarQuery {
    pub conta_id: Option<String>,
    pub categoria_id: Option<String>,
    pub status: Option<String>,
    pub data_de: Option<NaiveDate>,
    pub data_ate: Option<NaiveDate>,
    pub cursor: Option<String>,
    pub limit: Option<i64>,
}

fn linha_para_json(r: &rusqlite::Row) -> rusqlite::Result<serde_json::Value> {
    Ok(serde_json::json!({
        "id": r.get::<_, String>(0)?,
        "tipo": r.get::<_, String>(1)?,
        "valor_centavos": r.get::<_, i64>(2)?,
        "moeda": r.get::<_, String>(3)?,
        "data": r.get::<_, String>(4)?,
        "descricao": r.get::<_, String>(5)?,
        "categoria_id": r.get::<_, Option<String>>(6)?,
        "conta_id": r.get::<_, Option<String>>(7)?,
        "beneficiario_id": r.get::<_, Option<String>>(8)?,
        "forma_pagamento": r.get::<_, Option<String>>(9)?,
        "status": r.get::<_, String>(10)?,
        "observacoes": r.get::<_, Option<String>>(11)?,
        "origem": r.get::<_, String>(12)?,
        "transacao_recorrente_id": r.get::<_, Option<String>>(13)?,
        "espaco": r.get::<_, String>(14)?,
        "criado_por": r.get::<_, String>(15)?,
        "criado_em": r.get::<_, String>(16)?,
        "atualizado_em": r.get::<_, String>(17)?,
    }))
}

const COLUNAS: &str = "id, tipo, valor_centavos, moeda, data, descricao, categoria_id, conta_id, beneficiario_id, \
     forma_pagamento, status, observacoes, origem, transacao_recorrente_id, espaco, criado_por, criado_em, atualizado_em";

pub async fn listar(State(state): State<AppState>, Query(q): Query<ListarQuery>) -> AppResult<Json<serde_json::Value>> {
    let limite = q.limit.unwrap_or(30).clamp(1, 200);
    let cursor = q.cursor.as_deref().and_then(crate::pagination::decodificar);

    let linhas: Vec<serde_json::Value> = state
        .db
        .with(move |conn| {
            let mut sql = format!("SELECT {COLUNAS} FROM transacao");
            let mut condicoes = Vec::new();
            let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

            if let Some(v) = &q.conta_id {
                condicoes.push("conta_id = ?".to_string());
                params.push(Box::new(v.clone()));
            }
            if let Some(v) = &q.categoria_id {
                condicoes.push("categoria_id = ?".to_string());
                params.push(Box::new(v.clone()));
            }
            if let Some(v) = &q.status {
                condicoes.push("status = ?".to_string());
                params.push(Box::new(v.clone()));
            }
            if let Some(v) = q.data_de {
                condicoes.push("data >= ?".to_string());
                params.push(Box::new(v.to_string()));
            }
            if let Some(v) = q.data_ate {
                condicoes.push("data <= ?".to_string());
                params.push(Box::new(v.to_string()));
            }
            if let Some(c) = &cursor {
                condicoes.push("(criado_em, id) < (?, ?)".to_string());
                params.push(Box::new(c.valor_ordenacao.clone()));
                params.push(Box::new(c.id.clone()));
            }
            if !condicoes.is_empty() {
                sql.push_str(" WHERE ");
                sql.push_str(&condicoes.join(" AND "));
            }
            sql.push_str(" ORDER BY criado_em DESC, id DESC LIMIT ?");
            params.push(Box::new(limite + 1));

            let mut stmt = conn.prepare(&sql)?;
            let refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
            let linhas = stmt.query_map(refs.as_slice(), linha_para_json)?.collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await?;

    let tem_mais = linhas.len() as i64 > limite;
    let items: Vec<serde_json::Value> = if tem_mais { linhas[..limite as usize].to_vec() } else { linhas };
    let next_cursor = if tem_mais {
        items.last().and_then(|v| Some(crate::pagination::codificar(v["criado_em"].as_str()?, v["id"].as_str()?)))
    } else {
        None
    };

    Ok(Json(serde_json::json!({ "items": items, "next_cursor": next_cursor })))
}

#[derive(Debug, Deserialize)]
pub struct TransacaoPayload {
    pub tipo: String,
    pub valor_centavos: i64,
    #[serde(default = "moeda_padrao")]
    pub moeda: String,
    pub data: NaiveDate,
    pub descricao: String,
    #[serde(default)]
    pub categoria_id: Option<String>,
    #[serde(default)]
    pub conta_id: Option<String>,
    #[serde(default)]
    pub beneficiario_id: Option<String>,
    #[serde(default)]
    pub forma_pagamento: Option<String>,
    #[serde(default = "status_padrao")]
    pub status: String,
    #[serde(default)]
    pub observacoes: Option<String>,
    #[serde(default = "espaco_padrao")]
    pub espaco: String,
    #[serde(default = "criado_por_padrao")]
    pub criado_por: String,
    #[serde(default)]
    pub titulo: Option<String>, // aceito quando vem via Captura universal (seção 11.3) — vira `descricao`
}

fn moeda_padrao() -> String {
    "BRL".to_string()
}
fn status_padrao() -> String {
    "efetivada".to_string()
}
fn espaco_padrao() -> String {
    "pessoal".to_string()
}
fn criado_por_padrao() -> String {
    "usuario_local".to_string()
}

fn validar_transacao(payload: &TransacaoPayload) -> AppResult<()> {
    if !["entrada", "saida"].contains(&payload.tipo.as_str()) {
        return Err(AppError::new(ErrorCode::ValidationError).with_message("tipo deve ser 'entrada' ou 'saida'"));
    }
    if payload.valor_centavos <= 0 {
        return Err(AppError::new(ErrorCode::TransactionInvalidAmount));
    }
    if let Some(fp) = &payload.forma_pagamento {
        if !FORMAS_PAGAMENTO.contains(&fp.as_str()) {
            return Err(AppError::new(ErrorCode::PaymentMethodInvalid));
        }
    }
    if !["efetivada", "pendente"].contains(&payload.status.as_str()) {
        return Err(AppError::new(ErrorCode::ValidationError).with_message("status deve ser 'efetivada' ou 'pendente'"));
    }
    Ok(())
}

async fn checar_referencias(state: &AppState, categoria_id: &Option<String>, conta_id: &Option<String>) -> AppResult<()> {
    if let Some(id) = categoria_id {
        let id = id.clone();
        let existe: Option<i64> = state.db.with(move |conn| conn.query_row("SELECT 1 FROM categoria WHERE id = ?1", [&id], |r| r.get(0)).optional()).await?;
        if existe.is_none() {
            return Err(AppError::new(ErrorCode::CategoryNotFound));
        }
    }
    if let Some(id) = conta_id {
        let id = id.clone();
        let existe: Option<i64> = state.db.with(move |conn| conn.query_row("SELECT 1 FROM conta WHERE id = ?1", [&id], |r| r.get(0)).optional()).await?;
        if existe.is_none() {
            return Err(AppError::new(ErrorCode::AccountNotFound));
        }
    }
    Ok(())
}

pub async fn criar(State(state): State<AppState>, Json(mut payload): Json<TransacaoPayload>) -> AppResult<Json<serde_json::Value>> {
    if let Some(titulo) = payload.titulo.take() {
        if payload.descricao.trim().is_empty() {
            payload.descricao = titulo;
        }
    }
    validar_transacao(&payload)?;
    checar_referencias(&state, &payload.categoria_id, &payload.conta_id).await?;

    let id = new_id();
    state
        .db
        .with({
            let id = id.clone();
            move |conn| {
                conn.execute(
                    "INSERT INTO transacao (id, tipo, valor_centavos, moeda, data, descricao, categoria_id, conta_id, \
                     beneficiario_id, forma_pagamento, status, observacoes, origem, espaco, criado_por) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'manual', ?13, ?14)",
                    rusqlite::params![
                        id,
                        payload.tipo,
                        payload.valor_centavos,
                        payload.moeda,
                        payload.data.to_string(),
                        payload.descricao,
                        payload.categoria_id,
                        payload.conta_id,
                        payload.beneficiario_id,
                        payload.forma_pagamento,
                        payload.status,
                        payload.observacoes,
                        payload.espaco,
                        payload.criado_por,
                    ],
                )
            }
        })
        .await?;

    obter(State(state), Path(id)).await
}

pub async fn obter(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let linha: Option<serde_json::Value> = state
        .db
        .with(move |conn| conn.query_row(&format!("SELECT {COLUNAS} FROM transacao WHERE id = ?1"), [&id], linha_para_json).optional())
        .await?;
    linha.map(Json).ok_or(AppError::new(ErrorCode::NotFound))
}

pub async fn atualizar(State(state): State<AppState>, Path(id): Path<String>, Json(payload): Json<TransacaoPayload>) -> AppResult<Json<serde_json::Value>> {
    validar_transacao(&payload)?;
    checar_referencias(&state, &payload.categoria_id, &payload.conta_id).await?;

    let afetadas = state
        .db
        .with({
            let id = id.clone();
            move |conn| {
                conn.execute(
                    "UPDATE transacao SET tipo=?1, valor_centavos=?2, moeda=?3, data=?4, descricao=?5, categoria_id=?6, \
                     conta_id=?7, beneficiario_id=?8, forma_pagamento=?9, status=?10, observacoes=?11, atualizado_em=datetime('now') \
                     WHERE id=?12",
                    rusqlite::params![
                        payload.tipo,
                        payload.valor_centavos,
                        payload.moeda,
                        payload.data.to_string(),
                        payload.descricao,
                        payload.categoria_id,
                        payload.conta_id,
                        payload.beneficiario_id,
                        payload.forma_pagamento,
                        payload.status,
                        payload.observacoes,
                        id,
                    ],
                )
            }
        })
        .await?;
    if afetadas == 0 {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    obter(State(state), Path(id)).await
}

pub async fn excluir(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let afetadas = state.db.with(move |conn| conn.execute("DELETE FROM transacao WHERE id = ?1", [&id])).await?;
    if afetadas == 0 {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Debug, Deserialize)]
pub struct StatusPayload {
    pub status: String,
}

pub async fn atualizar_status(State(state): State<AppState>, Path(id): Path<String>, Json(payload): Json<StatusPayload>) -> AppResult<Json<serde_json::Value>> {
    if !["efetivada", "pendente"].contains(&payload.status.as_str()) {
        return Err(AppError::new(ErrorCode::ValidationError).with_message("status deve ser 'efetivada' ou 'pendente'"));
    }
    let afetadas = state
        .db
        .with(move |conn| conn.execute("UPDATE transacao SET status = ?1, atualizado_em = datetime('now') WHERE id = ?2", rusqlite::params![payload.status, id]))
        .await?;
    if afetadas == 0 {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Debug, Deserialize)]
pub struct ExcluirLotePayload {
    pub ids: Vec<String>,
}

pub async fn excluir_em_lote(State(state): State<AppState>, Json(payload): Json<ExcluirLotePayload>) -> AppResult<Json<serde_json::Value>> {
    let afetadas: usize = state
        .db
        .with(move |conn| {
            let tx = conn.unchecked_transaction()?;
            let mut total = 0usize;
            for id in &payload.ids {
                total += tx.execute("DELETE FROM transacao WHERE id = ?1", [id])?;
            }
            tx.commit()?;
            Ok(total)
        })
        .await?;
    Ok(Json(serde_json::json!({ "excluidas": afetadas })))
}

/// Upload de imagem → OCR → rascunho não salvo (seção 11.14). O motor real
/// (`leptess`/Tesseract, seção 4.5) fica `TODO` — devolve um rascunho vazio
/// pra revisão manual, contrato idêntico ao que o front espera.
pub async fn captura_foto(mut multipart: Multipart) -> AppResult<Json<serde_json::Value>> {
    let mut recebeu_arquivo = false;
    while let Some(campo) = multipart.next_field().await.map_err(|_| AppError::new(ErrorCode::ValidationError))? {
        if campo.name() == Some("foto") {
            let bytes = campo.bytes().await.map_err(|_| AppError::new(ErrorCode::ValidationError))?;
            if bytes.len() as i64 > ANEXO_TAMANHO_MAXIMO_BYTES {
                return Err(AppError::new(ErrorCode::AttachmentTooLarge));
            }
            recebeu_arquivo = true;
        }
    }
    if !recebeu_arquivo {
        return Err(AppError::new(ErrorCode::ValidationError).with_message("campo 'foto' ausente no multipart"));
    }
    Ok(Json(serde_json::json!({
        "rascunho": { "descricao": null, "valor_centavos": null, "data": null, "ocr_texto_bruto": "", "ocr_confianca": 0.0 },
        "aviso": "OCR (Tesseract/leptess) ainda não implementado nesta build — revise manualmente."
    })))
}

pub async fn listar_anexos(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let linhas: Vec<serde_json::Value> = state
        .db
        .with(move |conn| {
            let mut stmt = conn.prepare("SELECT id, nome_arquivo, mime_type, tamanho_bytes, checksum_sha256, criado_em FROM anexo WHERE transacao_id = ?1")?;
            let linhas = stmt
                .query_map([&id], |r| {
                    Ok(serde_json::json!({
                        "id": r.get::<_, String>(0)?, "nome_arquivo": r.get::<_, String>(1)?, "mime_type": r.get::<_, String>(2)?,
                        "tamanho_bytes": r.get::<_, i64>(3)?, "checksum_sha256": r.get::<_, String>(4)?, "criado_em": r.get::<_, String>(5)?,
                    }))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await?;
    Ok(Json(serde_json::json!(linhas)))
}

pub async fn upload_anexo(State(state): State<AppState>, Path(id): Path<String>, mut multipart: Multipart) -> AppResult<Json<serde_json::Value>> {
    let existe: Option<i64> = state.db.with({
        let id = id.clone();
        move |conn| conn.query_row("SELECT 1 FROM transacao WHERE id = ?1", [&id], |r| r.get(0)).optional()
    }).await?;
    if existe.is_none() {
        return Err(AppError::new(ErrorCode::NotFound));
    }

    while let Some(campo) = multipart.next_field().await.map_err(|_| AppError::new(ErrorCode::ValidationError))? {
        if campo.name() != Some("arquivo") {
            continue;
        }
        let nome_arquivo = campo.file_name().unwrap_or("comprovante").to_string();
        let mime_type = campo.content_type().unwrap_or("application/octet-stream").to_string();
        let bytes = campo.bytes().await.map_err(|_| AppError::new(ErrorCode::ValidationError))?;
        if bytes.len() as i64 > ANEXO_TAMANHO_MAXIMO_BYTES {
            return Err(AppError::new(ErrorCode::AttachmentTooLarge));
        }
        let checksum = Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect::<String>();
        let anexo_id = new_id();
        let tamanho = bytes.len() as i64;
        let conteudo = bytes.to_vec();
        state
            .db
            .with({
                let id = id.clone();
                let anexo_id = anexo_id.clone();
                let nome_arquivo = nome_arquivo.clone();
                move |conn| {
                    conn.execute(
                        "INSERT INTO anexo (id, transacao_id, nome_arquivo, mime_type, tamanho_bytes, checksum_sha256, conteudo) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                        rusqlite::params![anexo_id, id, nome_arquivo, mime_type, tamanho, checksum, conteudo],
                    )
                }
            })
            .await?;
        return Ok(Json(serde_json::json!({ "id": anexo_id, "nome_arquivo": nome_arquivo, "tamanho_bytes": tamanho })));
    }
    Err(AppError::new(ErrorCode::ValidationError).with_message("campo 'arquivo' ausente no multipart"))
}

pub async fn excluir_anexo(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let afetadas = state.db.with(move |conn| conn.execute("DELETE FROM anexo WHERE id = ?1", [&id])).await?;
    if afetadas == 0 {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}
