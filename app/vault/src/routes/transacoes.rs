//! `/vault/transacoes` (seção 11.14) — fonte da verdade do extrato,
//! dashboards e Feed (via proxy do `ecos-app`, seção 4.3).

use axum::extract::{Multipart, Path, Query, State};
use axum::Json;
use chrono::NaiveDate;
use ecos_core::{new_id, ErrorCode};
use rusqlite::OptionalExtension;
use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

const FORMAS_PAGAMENTO: &[&str] = &["pix", "pix_automatico", "ted", "cartao", "dinheiro", "boleto", "outro"];

#[derive(Debug, Deserialize)]
pub struct ListarQuery {
    pub conta_id: Option<String>,
    pub categoria_id: Option<String>,
    pub tipo: Option<String>,
    pub forma_pagamento: Option<String>,
    pub sem_categoria: Option<bool>,
    pub sem_pagamento: Option<bool>,
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
        "conciliada": r.get::<_, bool>(18)?,
        "data_ocorrencia": r.get::<_, Option<String>>(19)?,
        // Quantos comprovantes e quantas notas fiscais o lançamento tem (a lista mostra um ícone para cada).
        "anexos": r.get::<_, i64>(20)?,
        "notas_fiscais": r.get::<_, i64>(21)?,
    }))
}

const COLUNAS: &str = "id, tipo, valor_centavos, moeda, data, descricao, categoria_id, conta_id, beneficiario_id, \
     forma_pagamento, status, observacoes, origem, transacao_recorrente_id, espaco, criado_por, criado_em, atualizado_em, conciliada, data_ocorrencia, \
     (SELECT COUNT(*) FROM anexo WHERE anexo.transacao_id = transacao.id AND anexo.tipo = 'comprovante'), \
     (SELECT COUNT(*) FROM anexo WHERE anexo.transacao_id = transacao.id AND anexo.tipo = 'nota_fiscal')";

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
            if let Some(v) = &q.tipo { condicoes.push("tipo = ?".into()); params.push(Box::new(v.clone())); }
            if let Some(v) = &q.forma_pagamento { condicoes.push("forma_pagamento = ?".into()); params.push(Box::new(v.clone())); }
            if q.sem_categoria == Some(true) { condicoes.push("categoria_id IS NULL".into()); }
            if q.sem_pagamento == Some(true) { condicoes.push("forma_pagamento IS NULL".into()); }
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

/// INSERT da transação, compartilhado entre o lançamento manual e a confirmação de um comprovante.
pub(crate) fn inserir_transacao(
    conn: &rusqlite::Connection,
    id: &str,
    payload: &TransacaoPayload,
    autor: &str,
    origem: &str,
    ocr_texto: Option<&str>,
    ocr_confianca: Option<f64>,
) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT INTO transacao (id, tipo, valor_centavos, moeda, data, descricao, categoria_id, conta_id,          beneficiario_id, forma_pagamento, status, observacoes, origem, ocr_texto_bruto, ocr_confianca, espaco, criado_por)          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
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
            origem,
            ocr_texto,
            ocr_confianca,
            payload.espaco,
            autor,
        ],
    )
}

pub(crate) fn validar(payload: &TransacaoPayload) -> AppResult<()> {
    validar_transacao(payload)
}

pub(crate) async fn validar_referencias(state: &AppState, payload: &TransacaoPayload) -> AppResult<()> {
    checar_referencias(state, &payload.categoria_id, &payload.conta_id).await
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
    // A autoria vem do pedido autenticado, nunca do corpo: não dá para lançar em nome de outra pessoa.
    let autor = crate::db::autor_atual().unwrap_or_default();
    state
        .db
        .with({
            let id = id.clone();
            move |conn| inserir_transacao(conn, &id, &payload, &autor, "manual", None, None)
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

/// Upload de imagem → OCR → rascunho não salvo (seção 11.14). Mantida por compatibilidade; o fluxo novo é
/// `POST /vault/comprovantes` (que guarda o arquivo cifrado até a confirmação).
pub async fn captura_foto(mut multipart: Multipart) -> AppResult<Json<serde_json::Value>> {
    crate::arquivo::ler_multipart(&mut multipart, "foto").await?;
    Ok(Json(serde_json::json!({
        "rascunho": { "descricao": null, "valor_centavos": null, "data": null, "ocr_texto_bruto": "", "ocr_confianca": 0.0 },
        "aviso": "OCR (Tesseract/leptess) ainda não implementado nesta build — revise manualmente."
    })))
}

/// Tipos de anexo: o comprovante de pagamento e a nota fiscal da compra. Os dois seguem o mesmo caminho.
pub(crate) const TIPOS_ANEXO: [&str; 2] = ["comprovante", "nota_fiscal"];

pub(crate) fn validar_tipo_anexo(tipo: Option<&str>) -> AppResult<&'static str> {
    match tipo {
        None => Ok("comprovante"),
        Some(t) => TIPOS_ANEXO.iter().find(|x| **x == t).copied().ok_or_else(|| AppError::new(ErrorCode::ValidationError).with_message("tipo de anexo deve ser 'comprovante' ou 'nota_fiscal'")),
    }
}

#[derive(Debug, Deserialize)]
pub struct TipoQuery {
    pub tipo: Option<String>,
}

pub async fn listar_anexos(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let linhas: Vec<serde_json::Value> = state
        .db
        .with(move |conn| {
            let mut stmt = conn.prepare("SELECT id, nome_arquivo, mime_type, tamanho_bytes, checksum_sha256, criado_em, tipo FROM anexo WHERE transacao_id = ?1 ORDER BY criado_em, id")?;
            let linhas = stmt
                .query_map([&id], |r| {
                    Ok(serde_json::json!({
                        "id": r.get::<_, String>(0)?, "nome_arquivo": r.get::<_, String>(1)?, "mime_type": r.get::<_, String>(2)?,
                        "tamanho_bytes": r.get::<_, i64>(3)?, "checksum_sha256": r.get::<_, String>(4)?, "criado_em": r.get::<_, String>(5)?,
                        "tipo": r.get::<_, String>(6)?,
                    }))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await?;
    Ok(Json(serde_json::json!(linhas)))
}

pub async fn upload_anexo(State(state): State<AppState>, Path(id): Path<String>, Query(tq): Query<TipoQuery>, mut multipart: Multipart) -> AppResult<Json<serde_json::Value>> {
    let tipo_anexo = validar_tipo_anexo(tq.tipo.as_deref())?;
    let existe: Option<i64> = state.db.with({
        let id = id.clone();
        move |conn| conn.query_row("SELECT 1 FROM transacao WHERE id = ?1", [&id], |r| r.get(0)).optional()
    }).await?;
    if existe.is_none() {
        return Err(AppError::new(ErrorCode::NotFound));
    }

    let arquivo = crate::arquivo::ler_multipart(&mut multipart, "arquivo").await?;
    let anexo_id = new_id();
    let tamanho = arquivo.bytes.len() as i64;
    let resposta_nome = arquivo.nome.clone();
    let para_ler = arquivo.bytes.clone();
    let mime = arquivo.tipo.mime;
    // Mesmo arquivo na mesma transação: devolve o que já existe (reenvio por rede ruim não duplica).
    // Em outra transação: grava e avisa onde já estava.
    let (mantido, duplicado_em) = state
        .db
        .with({
            let (id, anexo_id) = (id.clone(), anexo_id.clone());
            move |conn| {
                let tx = conn.unchecked_transaction()?;
                let aqui: Option<String> = tx.query_row("SELECT id FROM anexo WHERE transacao_id = ?1 AND checksum_sha256 = ?2", rusqlite::params![id, arquivo.checksum], |r| r.get(0)).optional()?;
                if let Some(existente) = aqui {
                    return Ok((existente, None));
                }
                let outra: Option<String> = tx.query_row("SELECT transacao_id FROM anexo WHERE checksum_sha256 = ?1 AND transacao_id <> ?2 LIMIT 1", rusqlite::params![arquivo.checksum, id], |r| r.get(0)).optional()?;
                tx.execute(
                    "INSERT INTO anexo (id, transacao_id, nome_arquivo, mime_type, tamanho_bytes, checksum_sha256, conteudo, tipo) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    rusqlite::params![anexo_id, id, arquivo.nome, arquivo.tipo.mime, tamanho, arquivo.checksum, arquivo.bytes, tipo_anexo],
                )?;
                tx.commit()?;
                Ok((anexo_id, outra))
            }
        })
        .await?;
    if mantido == anexo_id {
        super::comprovantes::ler_anexo_em_segundo_plano(state, mantido.clone(), para_ler, mime.to_string());
    }
    Ok(Json(serde_json::json!({ "id": mantido, "nome_arquivo": resposta_nome, "tamanho_bytes": tamanho, "duplicado_em": duplicado_em })))
}

#[derive(Debug, Deserialize)]
pub struct ReclassificarPayload {
    pub tipo: String,
}

/// Troca um anexo de comprovante para nota fiscal (ou ao contrário), sem reenviar o arquivo.
pub async fn reclassificar_anexo(State(state): State<AppState>, Path(id): Path<String>, Json(payload): Json<ReclassificarPayload>) -> AppResult<Json<serde_json::Value>> {
    let tipo = validar_tipo_anexo(Some(&payload.tipo))?;
    let afetadas = state.db.with(move |conn| conn.execute("UPDATE anexo SET tipo = ?1 WHERE id = ?2", rusqlite::params![tipo, id])).await?;
    if afetadas == 0 {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn excluir_anexo(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let afetadas = state.db.with(move |conn| conn.execute("DELETE FROM anexo WHERE id = ?1", [&id])).await?;
    if afetadas == 0 {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}
