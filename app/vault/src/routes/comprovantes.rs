//! Comprovantes do Cofre. Um comprovante nasce como **rascunho** (arquivo guardado cifrado, ainda sem
//! transação) e só vira anexo quando o usuário confirma os dados: transação e anexo são criados juntos,
//! numa única transação de banco. Os metadados de organização (data, categoria, pagador/recebedor, conta)
//! moram na transação; o anexo herda tudo pelo vínculo — não há segunda cópia para ficar desatualizada.

use axum::extract::{Multipart, Path, Query, State};
use axum::http::{header, HeaderValue};
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::NaiveDate;
use ecos_core::{new_id, ErrorCode};
use rusqlite::OptionalExtension;
use serde::Deserialize;

use super::transacoes::{inserir_transacao, obter, validar, validar_referencias, TransacaoPayload};
use crate::arquivo;
use crate::db::{usuario_atual, USUARIO};
use crate::ocr;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// Resposta com o arquivo em si. Nunca é interpretado como página: tipo fixo vindo da detecção por conteúdo,
/// `nosniff` e uma política que desliga script e embeds mesmo se o navegador abrir o arquivo direto.
fn resposta_binaria(mime: &str, nome: &str, bytes: Vec<u8>) -> Response {
    let ascii: String = nome.chars().map(|c| if c.is_ascii_graphic() && c != '"' && c != '\\' || c == ' ' { c } else { '_' }).collect();
    let mut r = bytes.into_response();
    let h = r.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_str(mime).unwrap_or(HeaderValue::from_static("application/octet-stream")));
    h.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    h.insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static("default-src 'none'; sandbox"));
    if let Ok(v) = HeaderValue::from_str(&format!("inline; filename=\"{ascii}\"")) {
        h.insert(header::CONTENT_DISPOSITION, v);
    }
    r
}

/// Expressão SQL do status de leitura: uma leitura que passou de 2 minutos sem terminar é dada como falha
/// (o Cofre foi trancado no meio, o processo reiniciou…) e pode ser reprocessada.
const STATUS_EFETIVO: &str = "CASE WHEN ocr_status = 'processando' AND COALESCE(ocr_iniciado_em, criado_em) < datetime('now', '-2 minutes') THEN 'falhou' ELSE ocr_status END";

/// Lê o rascunho em segundo plano (miniatura, texto, sugestão); quem enviou o arquivo não espera por isso.
fn ler_rascunho_em_segundo_plano(state: AppState, id: String, bytes: Vec<u8>, mime: String) {
    let Some(usuario) = usuario_atual() else { return };
    tokio::spawn(async move {
        let p = ocr::processar(bytes, mime).await;
        let status = p.leitura.status();
        let (texto, sugestao, confianca) = match &p.leitura {
            ocr::Leitura::Texto(t) => {
                let s = ocr::parser::analisar(t);
                let c = f64::from(s.confianca.geral);
                (Some(t.clone()), serde_json::to_string(&s).ok(), Some(c))
            }
            _ => (None, None, None),
        };
        let miniatura = p.miniatura;
        let r = USUARIO
            .scope(usuario, async {
                state
                    .db
                    .with(move |conn| {
                        conn.execute(
                            "UPDATE comprovante_rascunho SET miniatura = ?1, ocr_texto = ?2, ocr_confianca = ?3, sugestao_json = ?4, ocr_status = ?5 WHERE id = ?6",
                            rusqlite::params![miniatura, texto, confianca, sugestao, status, id],
                        )
                    })
                    .await
            })
            .await;
        if let Err(e) = r {
            tracing::warn!(error = %e, "não foi possível gravar a leitura do comprovante (Cofre trancado?)");
        }
    });
}

/// Mesma leitura para um anexo enviado direto a uma transação: só guarda miniatura e texto (para a busca).
pub(crate) fn ler_anexo_em_segundo_plano(state: AppState, id: String, bytes: Vec<u8>, mime: String) {
    let Some(usuario) = usuario_atual() else { return };
    tokio::spawn(async move {
        let p = ocr::processar(bytes, mime).await;
        let texto = match p.leitura {
            ocr::Leitura::Texto(t) => Some(t),
            _ => None,
        };
        let miniatura = p.miniatura;
        let r = USUARIO
            .scope(usuario, async { state.db.with(move |conn| conn.execute("UPDATE anexo SET miniatura = ?1, ocr_texto = ?2 WHERE id = ?3", rusqlite::params![miniatura, texto, id])).await })
            .await;
        if let Err(e) = r {
            tracing::warn!(error = %e, "não foi possível gravar a leitura do anexo (Cofre trancado?)");
        }
    });
}

/// Recebe o arquivo, guarda como rascunho e começa a leitura em segundo plano. O mesmo arquivo enviado de novo
/// devolve o rascunho que já está lá, para que um reenvio por rede ruim não duplique.
pub async fn receber(State(state): State<AppState>, mut multipart: Multipart) -> AppResult<Json<serde_json::Value>> {
    let arq = arquivo::ler_multipart(&mut multipart, "arquivo").await?;
    let autor = crate::db::autor_atual().unwrap_or_default();
    let (nome, mime, tamanho) = (arq.nome.clone(), arq.tipo.mime, arq.bytes.len() as i64);
    let para_ler = arq.bytes.clone();
    let novo_id = new_id();
    let (id, reaproveitado, ja_anexado_em, ocr_status) = state
        .db
        .with({
            let novo_id = novo_id.clone();
            move |conn| {
                let tx = conn.unchecked_transaction()?;
                let anexado: Option<String> = tx.query_row("SELECT transacao_id FROM anexo WHERE checksum_sha256 = ?1 LIMIT 1", [&arq.checksum], |r| r.get(0)).optional()?;
                let existente: Option<(String, String)> = tx
                    .query_row(&format!("SELECT id, {STATUS_EFETIVO} FROM comprovante_rascunho WHERE checksum_sha256 = ?1"), [&arq.checksum], |r| Ok((r.get(0)?, r.get(1)?)))
                    .optional()?;
                if let Some((id, status)) = existente {
                    return Ok((id, true, anexado, status));
                }
                tx.execute(
                    "INSERT INTO comprovante_rascunho (id, nome_arquivo, mime_type, tamanho_bytes, checksum_sha256, conteudo, criado_por, ocr_iniciado_em) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'))",
                    rusqlite::params![novo_id, arq.nome, arq.tipo.mime, tamanho, arq.checksum, arq.bytes, autor],
                )?;
                tx.commit()?;
                Ok((novo_id, false, anexado, "processando".to_string()))
            }
        })
        .await?;
    if !reaproveitado {
        ler_rascunho_em_segundo_plano(state, id.clone(), para_ler, mime.to_string());
    }
    Ok(Json(serde_json::json!({
        "id": id, "nome_arquivo": nome, "mime_type": mime, "tamanho_bytes": tamanho,
        "reaproveitado": reaproveitado, "ja_anexado_em": ja_anexado_em, "ocr_status": ocr_status,
    })))
}

/// Rascunho com a sugestão da leitura (sem o arquivo). A tela consulta isto até o status sair de `processando`.
pub async fn obter_rascunho(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let linha: Option<serde_json::Value> = state
        .db
        .with(move |conn| {
            conn.query_row(
                &format!("SELECT id, nome_arquivo, mime_type, tamanho_bytes, criado_em, {STATUS_EFETIVO}, sugestao_json, ocr_confianca, miniatura IS NOT NULL FROM comprovante_rascunho WHERE id = ?1"),
                [&id],
                |r| {
                    let sugestao: Option<String> = r.get(6)?;
                    Ok(serde_json::json!({
                        "id": r.get::<_, String>(0)?, "nome_arquivo": r.get::<_, String>(1)?, "mime_type": r.get::<_, String>(2)?,
                        "tamanho_bytes": r.get::<_, i64>(3)?, "criado_em": r.get::<_, String>(4)?, "ocr_status": r.get::<_, String>(5)?,
                        "sugestao": sugestao.and_then(|j| serde_json::from_str::<serde_json::Value>(&j).ok()),
                        "ocr_confianca": r.get::<_, Option<f64>>(7)?, "tem_miniatura": r.get::<_, bool>(8)?,
                    }))
                },
            )
            .optional()
        })
        .await?;
    Ok(Json(linha.ok_or(AppError::new(ErrorCode::NotFound))?))
}

/// Tenta a leitura de novo (ela falhou, o programa de OCR foi instalado depois, o Cofre estava trancado).
pub async fn reprocessar(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let linha: Option<(String, Vec<u8>, String)> = state
        .db
        .with({
            let id = id.clone();
            move |conn| {
                let r = conn
                    .query_row(&format!("SELECT {STATUS_EFETIVO}, conteudo, mime_type FROM comprovante_rascunho WHERE id = ?1"), [&id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Vec<u8>>(1)?, r.get::<_, String>(2)?)))
                    .optional()?;
                if let Some((status, _, _)) = &r {
                    if status != "processando" {
                        conn.execute("UPDATE comprovante_rascunho SET ocr_status = 'processando', ocr_iniciado_em = datetime('now') WHERE id = ?1", [&id])?;
                    }
                }
                Ok(r)
            }
        })
        .await?;
    let (status, bytes, mime) = linha.ok_or(AppError::new(ErrorCode::NotFound))?;
    if status != "processando" {
        ler_rascunho_em_segundo_plano(state, id, bytes, mime);
    }
    Ok(Json(serde_json::json!({ "ocr_status": "processando" })))
}

pub async fn listar_rascunhos(State(state): State<AppState>) -> AppResult<Json<serde_json::Value>> {
    let itens: Vec<serde_json::Value> = state
        .db
        .with(|conn| {
            let mut stmt = conn.prepare(&format!("SELECT id, nome_arquivo, mime_type, tamanho_bytes, criado_em, {STATUS_EFETIVO}, miniatura IS NOT NULL FROM comprovante_rascunho ORDER BY criado_em DESC, id DESC"))?;
            let linhas = stmt
                .query_map([], |r| {
                    Ok(serde_json::json!({
                        "id": r.get::<_, String>(0)?, "nome_arquivo": r.get::<_, String>(1)?, "mime_type": r.get::<_, String>(2)?,
                        "tamanho_bytes": r.get::<_, i64>(3)?, "criado_em": r.get::<_, String>(4)?,
                        "ocr_status": r.get::<_, String>(5)?, "tem_miniatura": r.get::<_, bool>(6)?,
                    }))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await?;
    Ok(Json(serde_json::json!({ "items": itens })))
}

pub async fn conteudo_rascunho(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Response> {
    let linha: Option<(String, String, Vec<u8>)> = state
        .db
        .with(move |conn| conn.query_row("SELECT mime_type, nome_arquivo, conteudo FROM comprovante_rascunho WHERE id = ?1", [&id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).optional())
        .await?;
    let (mime, nome, bytes) = linha.ok_or(AppError::new(ErrorCode::NotFound))?;
    Ok(resposta_binaria(&mime, &nome, bytes))
}

pub async fn conteudo_anexo(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Response> {
    let linha: Option<(String, String, Vec<u8>)> = state
        .db
        .with(move |conn| conn.query_row("SELECT mime_type, nome_arquivo, conteudo FROM anexo WHERE id = ?1", [&id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).optional())
        .await?;
    let (mime, nome, bytes) = linha.ok_or(AppError::new(ErrorCode::NotFound))?;
    Ok(resposta_binaria(&mime, &nome, bytes))
}

async fn miniatura_de(state: &AppState, tabela: &'static str, id: String) -> AppResult<Response> {
    let bytes: Option<Option<Vec<u8>>> = state.db.with(move |conn| conn.query_row(&format!("SELECT miniatura FROM {tabela} WHERE id = ?1"), [&id], |r| r.get(0)).optional()).await?;
    match bytes.flatten() {
        Some(b) => Ok(resposta_binaria("image/jpeg", "miniatura.jpg", b)),
        None => Err(AppError::new(ErrorCode::NotFound)),
    }
}

pub async fn miniatura_anexo(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Response> {
    miniatura_de(&state, "anexo", id).await
}

pub async fn miniatura_rascunho(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Response> {
    miniatura_de(&state, "comprovante_rascunho", id).await
}

pub async fn descartar(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let afetadas = state.db.with(move |conn| conn.execute("DELETE FROM comprovante_rascunho WHERE id = ?1", [&id])).await?;
    if afetadas == 0 {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Confirma o rascunho com os dados revisados: cria a transação (origem `captura_camera`) e move o arquivo
/// para `anexo`, tudo ou nada. Se algo falhar, o rascunho continua intacto para nova tentativa.
pub async fn confirmar(State(state): State<AppState>, Path(id): Path<String>, Json(mut payload): Json<TransacaoPayload>) -> AppResult<Json<serde_json::Value>> {
    if let Some(titulo) = payload.titulo.take() {
        if payload.descricao.trim().is_empty() {
            payload.descricao = titulo;
        }
    }
    validar(&payload)?;
    validar_referencias(&state, &payload).await?;

    let transacao_id = new_id();
    let anexo_id = new_id();
    let autor = crate::db::autor_atual().unwrap_or_default();
    let encontrado = state
        .db
        .with({
            let (transacao_id, anexo_id) = (transacao_id.clone(), anexo_id.clone());
            move |conn| {
                let tx = conn.unchecked_transaction()?;
                let linha = tx
                    .query_row(
                        "SELECT nome_arquivo, mime_type, tamanho_bytes, checksum_sha256, conteudo, ocr_texto, ocr_confianca, miniatura FROM comprovante_rascunho WHERE id = ?1",
                        [&id],
                        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?, r.get::<_, String>(3)?, r.get::<_, Vec<u8>>(4)?, r.get::<_, Option<String>>(5)?, r.get::<_, Option<f64>>(6)?, r.get::<_, Option<Vec<u8>>>(7)?)),
                    )
                    .optional()?;
                let Some((nome, mime, tamanho, checksum, conteudo, ocr, confianca, miniatura)) = linha else { return Ok(false) };
                inserir_transacao(&tx, &transacao_id, &payload, &autor, "captura_camera", ocr.as_deref(), confianca)?;
                tx.execute(
                    "INSERT INTO anexo (id, transacao_id, nome_arquivo, mime_type, tamanho_bytes, checksum_sha256, conteudo, miniatura, ocr_texto) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    rusqlite::params![anexo_id, transacao_id, nome, mime, tamanho, checksum, conteudo, miniatura, ocr],
                )?;
                tx.execute("DELETE FROM comprovante_rascunho WHERE id = ?1", [&id])?;
                tx.commit()?;
                Ok(true)
            }
        })
        .await?;
    if !encontrado {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    obter(State(state), Path(transacao_id)).await
}

#[derive(Debug, Deserialize)]
pub struct ListarQuery {
    pub data_de: Option<NaiveDate>,
    pub data_ate: Option<NaiveDate>,
    pub categoria_id: Option<String>,
    pub beneficiario_id: Option<String>,
    pub conta_id: Option<String>,
    pub q: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// Todos os comprovantes já arquivados, com os dados da transação a que pertencem, mais recentes primeiro.
pub async fn listar(State(state): State<AppState>, Query(q): Query<ListarQuery>) -> AppResult<Json<serde_json::Value>> {
    let limite = q.limit.unwrap_or(50).clamp(1, 200);
    let deslocamento = q.offset.unwrap_or(0).max(0);
    let itens = state
        .db
        .with(move |conn| {
            let mut onde = vec!["1=1".to_string()];
            let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
            let mut filtro = |condicao: &str, valor: Box<dyn rusqlite::ToSql>| {
                params.push(valor);
                onde.push(condicao.replace('?', &format!("?{}", params.len())));
            };
            if let Some(d) = q.data_de { filtro("t.data >= ?", Box::new(d.to_string())); }
            if let Some(d) = q.data_ate { filtro("t.data <= ?", Box::new(d.to_string())); }
            if let Some(v) = q.categoria_id { filtro("t.categoria_id = ?", Box::new(v)); }
            if let Some(v) = q.beneficiario_id { filtro("t.beneficiario_id = ?", Box::new(v)); }
            if let Some(v) = q.conta_id { filtro("t.conta_id = ?", Box::new(v)); }
            if let Some(texto) = q.q.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
                let padrao = format!("%{}%", texto.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"));
                filtro("(t.descricao LIKE ? ESCAPE '\\' OR a.nome_arquivo LIKE ? ESCAPE '\\' OR a.ocr_texto LIKE ? ESCAPE '\\')", Box::new(padrao.clone()));
            }
            params.push(Box::new(limite));
            params.push(Box::new(deslocamento));
            let sql = format!(
                "SELECT a.id, a.nome_arquivo, a.mime_type, a.tamanho_bytes, a.criado_em, \
                        t.id, t.data, t.descricao, t.tipo, t.valor_centavos, t.categoria_id, t.beneficiario_id, t.conta_id \
                 FROM anexo a JOIN transacao t ON t.id = a.transacao_id \
                 WHERE {} ORDER BY t.data DESC, a.criado_em DESC, a.id DESC LIMIT ?{} OFFSET ?{}",
                onde.join(" AND "),
                params.len() - 1,
                params.len()
            );
            let mut stmt = conn.prepare(&sql)?;
            let linhas = stmt
                .query_map(rusqlite::params_from_iter(params.iter().map(|p| p.as_ref())), |r| {
                    Ok(serde_json::json!({
                        "id": r.get::<_, String>(0)?, "nome_arquivo": r.get::<_, String>(1)?, "mime_type": r.get::<_, String>(2)?,
                        "tamanho_bytes": r.get::<_, i64>(3)?, "criado_em": r.get::<_, String>(4)?,
                        "transacao": {
                            "id": r.get::<_, String>(5)?, "data": r.get::<_, String>(6)?, "descricao": r.get::<_, String>(7)?,
                            "tipo": r.get::<_, String>(8)?, "valor_centavos": r.get::<_, i64>(9)?,
                            "categoria_id": r.get::<_, Option<String>>(10)?, "beneficiario_id": r.get::<_, Option<String>>(11)?, "conta_id": r.get::<_, Option<String>>(12)?,
                        },
                    }))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await?;
    Ok(Json(serde_json::json!({ "items": itens })))
}

#[cfg(test)]
mod testes {
    use crate::{config::Config, db::VaultDb, routes, state::AppState};
    use axum::{body::{to_bytes, Body}, http::{Request, StatusCode}, response::Response, Router};
    use ecos_core::new_id;
    use serde_json::{json, Value};
    use std::sync::Arc;
    use tower::Service;

    fn app_e_estado() -> (Router, AppState, std::path::PathBuf) {
        let raiz = std::env::temp_dir().join(format!("ecos-comprov-{}", new_id()));
        let config = Arc::new(Config { porta: 0, db_path: raiz.join("vault/ecos-vault.db"), meta_path: raiz.join("vault/ecos-vault.meta.json"), backups_dir: raiz.join("backups") });
        std::fs::create_dir_all(raiz.join("vault")).unwrap();
        std::fs::create_dir_all(raiz.join("backups")).unwrap();
        let estado = AppState { db: VaultDb::trancado(), config };
        (routes::montar(estado.clone()), estado, raiz)
    }

    fn app() -> (Router, std::path::PathBuf) {
        let (r, _, raiz) = app_e_estado();
        (r, raiz)
    }

    /// PNG pequeno e liso: decodifica, gera miniatura e não tem texto nenhum.
    fn png_liso() -> Vec<u8> {
        let img = image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(400, 300, image::Rgb([240, 240, 240])));
        let mut s = std::io::Cursor::new(Vec::new());
        img.write_to(&mut s, image::ImageFormat::Png).unwrap();
        s.into_inner()
    }

    /// Espera a leitura em segundo plano terminar (ou estourar 15 s).
    async fn esperar_leitura(app: &Router, u: &str, id: &str) -> Value {
        for _ in 0..150 {
            let (_, r) = chamar(app, u, "GET", &format!("/vault/comprovantes/rascunhos/{id}"), None).await;
            if r["ocr_status"] != "processando" { return r; }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
        panic!("a leitura não terminou");
    }

    async fn bruto(app: &Router, usuario: &str, metodo: &str, uri: &str, tipo: Option<&str>, corpo: Vec<u8>) -> Response {
        let mut p = Request::builder().method(metodo).uri(uri).header("x-ecos-usuario", usuario);
        if let Some(t) = tipo { p = p.header("content-type", t); }
        app.clone().call(p.body(Body::from(corpo)).unwrap()).await.unwrap()
    }

    async fn json_de(r: Response) -> (StatusCode, Value) {
        let s = r.status();
        let b = to_bytes(r.into_body(), 32 << 20).await.unwrap();
        (s, serde_json::from_slice(&b).unwrap_or(Value::Null))
    }

    async fn chamar(app: &Router, u: &str, m: &str, uri: &str, corpo: Option<Value>) -> (StatusCode, Value) {
        let c = corpo.map(|c| c.to_string().into_bytes()).unwrap_or_default();
        json_de(bruto(app, u, m, uri, Some("application/json"), c).await).await
    }

    fn multipart(campo: &str, nome: &str, declarado: &str, dados: &[u8]) -> (String, Vec<u8>) {
        let limite = "----ecos-teste";
        let mut c = format!("--{limite}\r\nContent-Disposition: form-data; name=\"{campo}\"; filename=\"{nome}\"\r\nContent-Type: {declarado}\r\n\r\n").into_bytes();
        c.extend_from_slice(dados);
        c.extend_from_slice(format!("\r\n--{limite}--\r\n").as_bytes());
        (format!("multipart/form-data; boundary={limite}"), c)
    }

    async fn enviar(app: &Router, u: &str, uri: &str, campo: &str, nome: &str, declarado: &str, dados: &[u8]) -> (StatusCode, Value) {
        let (tipo, corpo) = multipart(campo, nome, declarado, dados);
        json_de(bruto(app, u, "POST", uri, Some(&tipo), corpo).await).await
    }

    fn pdf(tamanho: usize, marca: u8) -> Vec<u8> {
        let mut v = b"%PDF-1.7\n".to_vec();
        v.resize(tamanho, marca);
        v
    }

    fn lancamento(descricao: &str) -> Value {
        json!({ "tipo": "saida", "valor_centavos": 12990, "data": "2026-09-30", "descricao": descricao })
    }

    async fn ativar(app: &Router, u: &str) {
        let (s, _) = chamar(app, u, "POST", "/vault/ativar", Some(json!({ "senha": "senha-financeiro-123" }))).await;
        assert_eq!(s, StatusCode::OK);
    }

    #[tokio::test]
    async fn rascunho_vira_transacao_com_anexo_de_forma_atomica_e_o_arquivo_volta_intacto() {
        let (app, raiz) = app();
        ativar(&app, "ana").await;
        // 5 MB: acima do limite padrão de 2 MB do axum, que antes derrubava fotos de celular.
        let original = pdf(5 * 1024 * 1024, 7);
        let (s, r) = enviar(&app, "ana", "/vault/comprovantes", "arquivo", "pix.pdf", "application/pdf", &original).await;
        assert_eq!(s, StatusCode::OK, "{r}");
        let rid = r["id"].as_str().unwrap().to_string();
        assert_eq!(chamar(&app, "ana", "GET", "/vault/comprovantes/rascunhos", None).await.1["items"].as_array().unwrap().len(), 1);
        assert_eq!(chamar(&app, "ana", "GET", "/vault/comprovantes", None).await.1["items"].as_array().unwrap().len(), 0, "rascunho não é comprovante arquivado");

        let (s, t) = chamar(&app, "ana", "POST", &format!("/vault/comprovantes/rascunhos/{rid}/confirmar"), Some(lancamento("Mercado"))).await;
        assert_eq!(s, StatusCode::OK, "{t}");
        assert_eq!(t["origem"], "captura_camera");
        assert_eq!(chamar(&app, "ana", "GET", "/vault/comprovantes/rascunhos", None).await.1["items"].as_array().unwrap().len(), 0);

        let (_, lista) = chamar(&app, "ana", "GET", "/vault/comprovantes", None).await;
        let item = &lista["items"][0];
        assert_eq!(item["transacao"]["id"], t["id"]);
        assert_eq!(item["transacao"]["descricao"], "Mercado");
        assert_eq!(item["mime_type"], "application/pdf");

        let r = bruto(&app, "ana", "GET", &format!("/vault/anexos/{}/conteudo", item["id"].as_str().unwrap()), None, vec![]).await;
        assert_eq!(r.headers()["x-content-type-options"], "nosniff");
        assert_eq!(r.headers()["content-type"], "application/pdf");
        assert!(r.headers()["content-security-policy"].to_str().unwrap().contains("sandbox"));
        assert_eq!(to_bytes(r.into_body(), 32 << 20).await.unwrap().to_vec(), original);

        // Confirmar de novo (rascunho já consumido) não cria nada.
        let (s, _) = chamar(&app, "ana", "POST", &format!("/vault/comprovantes/rascunhos/{rid}/confirmar"), Some(lancamento("Mercado"))).await;
        assert_eq!(s, StatusCode::NOT_FOUND);
        assert_eq!(chamar(&app, "ana", "GET", "/vault/transacoes", None).await.1["items"].as_array().unwrap().len(), 1);
        drop(app);
        let _ = std::fs::remove_dir_all(raiz);
    }

    #[tokio::test]
    async fn confirmacao_invalida_nao_consome_o_rascunho() {
        let (app, raiz) = app();
        ativar(&app, "ana").await;
        let (_, r) = enviar(&app, "ana", "/vault/comprovantes", "arquivo", "a.pdf", "application/pdf", &pdf(2000, 1)).await;
        let rid = r["id"].as_str().unwrap();
        let ruim = json!({ "tipo": "saida", "valor_centavos": 0, "data": "2026-09-30", "descricao": "x" });
        assert_ne!(chamar(&app, "ana", "POST", &format!("/vault/comprovantes/rascunhos/{rid}/confirmar"), Some(ruim)).await.0, StatusCode::OK);
        assert_eq!(chamar(&app, "ana", "GET", "/vault/comprovantes/rascunhos", None).await.1["items"].as_array().unwrap().len(), 1);
        assert_eq!(chamar(&app, "ana", "DELETE", &format!("/vault/comprovantes/rascunhos/{rid}"), None).await.0, StatusCode::OK);
        assert_eq!(chamar(&app, "ana", "GET", "/vault/comprovantes/rascunhos", None).await.1["items"].as_array().unwrap().len(), 0);
        drop(app);
        let _ = std::fs::remove_dir_all(raiz);
    }

    #[tokio::test]
    async fn so_aceita_tipos_conhecidos_pelo_conteudo_e_respeita_o_limite() {
        let (app, raiz) = app();
        ativar(&app, "ana").await;
        // Mentir no Content-Type e na extensão não adianta.
        for (nome, dados) in [("a.png", &b"<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>"[..]), ("b.jpg", &b"<html><script>1</script></html>"[..]), ("c.pdf", &b"MZ\x90\0exe"[..])] {
            let (s, _) = enviar(&app, "ana", "/vault/comprovantes", "arquivo", nome, "image/png", dados).await;
            assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{nome}");
        }
        assert_eq!(enviar(&app, "ana", "/vault/comprovantes", "arquivo", "vazio.pdf", "application/pdf", b"").await.0, StatusCode::UNPROCESSABLE_ENTITY);
        let (s, r) = enviar(&app, "ana", "/vault/comprovantes", "arquivo", "grande.pdf", "application/pdf", &pdf(8 * 1024 * 1024 + 1, 1)).await;
        assert!(s == StatusCode::PAYLOAD_TOO_LARGE || s == StatusCode::UNPROCESSABLE_ENTITY, "{s} {r}");
        assert_eq!(chamar(&app, "ana", "GET", "/vault/comprovantes/rascunhos", None).await.1["items"].as_array().unwrap().len(), 0);
        drop(app);
        let _ = std::fs::remove_dir_all(raiz);
    }

    #[tokio::test]
    async fn arquivo_repetido_e_reconhecido() {
        let (app, raiz) = app();
        ativar(&app, "ana").await;
        let (_, t1) = chamar(&app, "ana", "POST", "/vault/transacoes", Some(lancamento("Luz"))).await;
        let (_, t2) = chamar(&app, "ana", "POST", "/vault/transacoes", Some(lancamento("Luz de novo"))).await;
        let arquivo = pdf(3000, 9);
        let u1 = format!("/vault/transacoes/{}/anexos", t1["id"].as_str().unwrap());
        let u2 = format!("/vault/transacoes/{}/anexos", t2["id"].as_str().unwrap());
        let (_, a) = enviar(&app, "ana", &u1, "arquivo", "luz.pdf", "application/pdf", &arquivo).await;
        let (_, a2) = enviar(&app, "ana", &u1, "arquivo", "luz.pdf", "application/pdf", &arquivo).await;
        assert_eq!(a["id"], a2["id"], "reenvio na mesma transação não duplica");
        let (_, b) = enviar(&app, "ana", &u2, "arquivo", "luz.pdf", "application/pdf", &arquivo).await;
        assert_ne!(b["id"], a["id"]);
        assert_eq!(b["duplicado_em"], t1["id"]);
        // Compartilhar o mesmo comprovante de novo avisa que ele já está arquivado.
        let (_, r) = enviar(&app, "ana", "/vault/comprovantes", "arquivo", "luz.pdf", "application/pdf", &arquivo).await;
        assert_eq!(r["ja_anexado_em"], t1["id"]);
        let (_, r2) = enviar(&app, "ana", "/vault/comprovantes", "arquivo", "luz.pdf", "application/pdf", &arquivo).await;
        assert_eq!(r2["id"], r["id"]);
        assert_eq!(r2["reaproveitado"], true);
        drop(app);
        let _ = std::fs::remove_dir_all(raiz);
    }

    #[tokio::test]
    async fn filtros_da_lista_e_isolamento_entre_usuarios_e_cofre_trancado() {
        let (app, raiz) = app();
        ativar(&app, "ana").await;
        ativar(&app, "bia").await;
        let (_, t1) = chamar(&app, "ana", "POST", "/vault/transacoes", Some(json!({ "tipo": "saida", "valor_centavos": 100, "data": "2026-01-10", "descricao": "Aluguel_100%" }))).await;
        let (_, t2) = chamar(&app, "ana", "POST", "/vault/transacoes", Some(lancamento("Mercado"))).await;
        enviar(&app, "ana", &format!("/vault/transacoes/{}/anexos", t1["id"].as_str().unwrap()), "arquivo", "jan.pdf", "application/pdf", &pdf(500, 1)).await;
        enviar(&app, "ana", &format!("/vault/transacoes/{}/anexos", t2["id"].as_str().unwrap()), "arquivo", "set.pdf", "application/pdf", &pdf(500, 2)).await;
        let n = |v: Value| v["items"].as_array().unwrap().len();
        assert_eq!(n(chamar(&app, "ana", "GET", "/vault/comprovantes", None).await.1), 2);
        assert_eq!(n(chamar(&app, "ana", "GET", "/vault/comprovantes?data_de=2026-09-01&data_ate=2026-09-30", None).await.1), 1);
        assert_eq!(n(chamar(&app, "ana", "GET", "/vault/comprovantes?q=Aluguel", None).await.1), 1);
        assert_eq!(n(chamar(&app, "ana", "GET", "/vault/comprovantes?q=%25100", None).await.1), 0, "% é texto, não curinga");
        assert_eq!(n(chamar(&app, "ana", "GET", "/vault/comprovantes?q=set.pdf", None).await.1), 1);
        assert_eq!(n(chamar(&app, "bia", "GET", "/vault/comprovantes", None).await.1), 0);
        let (_, r) = enviar(&app, "ana", "/vault/comprovantes", "arquivo", "x.pdf", "application/pdf", &pdf(500, 3)).await;
        let rid = r["id"].as_str().unwrap();
        assert_eq!(bruto(&app, "bia", "GET", &format!("/vault/comprovantes/rascunhos/{rid}/conteudo"), None, vec![]).await.status(), StatusCode::NOT_FOUND);
        chamar(&app, "ana", "POST", "/vault/bloquear", None).await;
        assert_eq!(chamar(&app, "ana", "GET", "/vault/comprovantes", None).await.0, StatusCode::UNAUTHORIZED);
        assert_eq!(enviar(&app, "ana", "/vault/comprovantes", "arquivo", "y.pdf", "application/pdf", &pdf(500, 4)).await.0, StatusCode::UNAUTHORIZED);
        drop(app);
        let _ = std::fs::remove_dir_all(raiz);
    }

    #[tokio::test]
    async fn lancamentos_informam_quantos_anexos_tem_na_lista_e_no_detalhe() {
        let (app, raiz) = app();
        ativar(&app, "ana").await;
        let (_, com) = chamar(&app, "ana", "POST", "/vault/transacoes", Some(lancamento("Com comprovantes"))).await;
        let (_, sem) = chamar(&app, "ana", "POST", "/vault/transacoes", Some(lancamento("Sem comprovante"))).await;
        let uri = format!("/vault/transacoes/{}/anexos", com["id"].as_str().unwrap());
        enviar(&app, "ana", &uri, "arquivo", "a.pdf", "application/pdf", &pdf(500, 1)).await;
        enviar(&app, "ana", &uri, "arquivo", "b.pdf", "application/pdf", &pdf(500, 2)).await;
        let (_, lista) = chamar(&app, "ana", "GET", "/vault/transacoes", None).await;
        let contagem = |nome: &str| lista["items"].as_array().unwrap().iter().find(|t| t["descricao"] == nome).unwrap()["anexos"].clone();
        assert_eq!(contagem("Com comprovantes"), 2);
        assert_eq!(contagem("Sem comprovante"), 0);
        let (_, detalhe) = chamar(&app, "ana", "GET", &format!("/vault/transacoes/{}", sem["id"].as_str().unwrap()), None).await;
        assert_eq!(detalhe["anexos"], 0);
        // Apagar um anexo baixa a contagem.
        let (_, anexos) = chamar(&app, "ana", "GET", &uri, None).await;
        chamar(&app, "ana", "DELETE", &format!("/vault/anexos/{}", anexos[0]["id"].as_str().unwrap()), None).await;
        let (_, de_novo) = chamar(&app, "ana", "GET", &format!("/vault/transacoes/{}", com["id"].as_str().unwrap()), None).await;
        assert_eq!(de_novo["anexos"], 1);
        drop(app);
        let _ = std::fs::remove_dir_all(raiz);
    }

    #[tokio::test]
    async fn leitura_em_segundo_plano_gera_miniatura_e_ela_acompanha_o_anexo_na_confirmacao() {
        let (app, raiz) = app();
        ativar(&app, "ana").await;
        let (s, r) = enviar(&app, "ana", "/vault/comprovantes", "arquivo", "foto.png", "image/png", &png_liso()).await;
        assert_eq!(s, StatusCode::OK, "{r}");
        assert_eq!(r["ocr_status"], "processando");
        let rid = r["id"].as_str().unwrap().to_string();
        let pronto = esperar_leitura(&app, "ana", &rid).await;
        // Sem Tesseract (dev) vira `indisponivel`; com ele, uma imagem lisa vira `sem_texto`. Nunca `falhou`.
        assert!(["indisponivel", "sem_texto"].contains(&pronto["ocr_status"].as_str().unwrap()), "{pronto}");
        assert_eq!(pronto["tem_miniatura"], true);
        let mini = bruto(&app, "ana", "GET", &format!("/vault/comprovantes/rascunhos/{rid}/miniatura"), None, vec![]).await;
        assert_eq!(mini.headers()["content-type"], "image/jpeg");
        assert!(to_bytes(mini.into_body(), 1 << 20).await.unwrap().starts_with(&[0xFF, 0xD8, 0xFF]));

        let (s, t) = chamar(&app, "ana", "POST", &format!("/vault/comprovantes/rascunhos/{rid}/confirmar"), Some(lancamento("Foto"))).await;
        assert_eq!(s, StatusCode::OK, "{t}");
        let (_, lista) = chamar(&app, "ana", "GET", "/vault/comprovantes", None).await;
        let aid = lista["items"][0]["id"].as_str().unwrap().to_string();
        assert_eq!(bruto(&app, "ana", "GET", &format!("/vault/anexos/{aid}/miniatura"), None, vec![]).await.status(), StatusCode::OK);
        drop(app);
        let _ = std::fs::remove_dir_all(raiz);
    }

    #[tokio::test]
    async fn pdf_e_heic_nao_tem_miniatura_e_a_leitura_nao_trava_o_fluxo() {
        let (app, raiz) = app();
        ativar(&app, "ana").await;
        let (_, r) = enviar(&app, "ana", "/vault/comprovantes", "arquivo", "x.pdf", "application/pdf", &pdf(800, 5)).await;
        let rid = r["id"].as_str().unwrap().to_string();
        let pronto = esperar_leitura(&app, "ana", &rid).await;
        assert_eq!(pronto["tem_miniatura"], false);
        assert_ne!(pronto["ocr_status"], "processando");
        assert_eq!(bruto(&app, "ana", "GET", &format!("/vault/comprovantes/rascunhos/{rid}/miniatura"), None, vec![]).await.status(), StatusCode::NOT_FOUND);
        // Mesmo sem leitura, dá para revisar e confirmar manualmente.
        assert_eq!(chamar(&app, "ana", "POST", &format!("/vault/comprovantes/rascunhos/{rid}/confirmar"), Some(lancamento("Manual"))).await.0, StatusCode::OK);
        drop(app);
        let _ = std::fs::remove_dir_all(raiz);
    }

    #[tokio::test]
    async fn leitura_travada_vira_falhou_e_pode_ser_reprocessada_e_o_texto_lido_entra_na_busca() {
        use crate::db::USUARIO;
        let (app, estado, raiz) = app_e_estado();
        ativar(&app, "ana").await;
        let (_, r) = enviar(&app, "ana", "/vault/comprovantes", "arquivo", "foto.png", "image/png", &png_liso()).await;
        let rid = r["id"].as_str().unwrap().to_string();
        esperar_leitura(&app, "ana", &rid).await;

        // Simula uma leitura que ficou presa há 5 minutos (Cofre trancado no meio, processo reiniciado).
        let id = rid.clone();
        USUARIO.scope("ana".into(), estado.db.with(move |c| c.execute("UPDATE comprovante_rascunho SET ocr_status='processando', ocr_iniciado_em=datetime('now','-5 minutes') WHERE id=?1", [&id]))).await.unwrap();
        assert_eq!(chamar(&app, "ana", "GET", &format!("/vault/comprovantes/rascunhos/{rid}"), None).await.1["ocr_status"], "falhou");
        let (s, _) = chamar(&app, "ana", "POST", &format!("/vault/comprovantes/rascunhos/{rid}/reprocessar"), None).await;
        assert_eq!(s, StatusCode::OK);
        assert_ne!(esperar_leitura(&app, "ana", &rid).await["ocr_status"], "falhou");
        assert_eq!(chamar(&app, "ana", "POST", "/vault/comprovantes/rascunhos/inexistente/reprocessar", None).await.0, StatusCode::NOT_FOUND);

        // Texto lido de um anexo é encontrado pela busca, mesmo que a descrição e o nome do arquivo não tenham a palavra.
        let (_, t) = chamar(&app, "ana", "POST", "/vault/transacoes", Some(lancamento("Despesa qualquer"))).await;
        let (_, a) = enviar(&app, "ana", &format!("/vault/transacoes/{}/anexos", t["id"].as_str().unwrap()), "arquivo", "scan001.png", "image/png", &png_liso()).await;
        let aid = a["id"].as_str().unwrap().to_string();
        tokio::time::sleep(std::time::Duration::from_millis(600)).await; // deixa a leitura em segundo plano terminar antes de gravar o texto
        USUARIO.scope("ana".into(), estado.db.with(move |c| c.execute("UPDATE anexo SET ocr_texto='Pix para Padaria Pao Quente' WHERE id=?1", [&aid]))).await.unwrap();
        let n = |v: Value| v["items"].as_array().unwrap().len();
        assert_eq!(n(chamar(&app, "ana", "GET", "/vault/comprovantes?q=Padaria", None).await.1), 1);
        assert_eq!(n(chamar(&app, "ana", "GET", "/vault/comprovantes?q=Farmacia", None).await.1), 0);
        drop(app);
        let _ = std::fs::remove_dir_all(raiz);
    }
}
