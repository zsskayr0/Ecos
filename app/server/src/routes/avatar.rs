//! Foto de perfil — arquivo em `.ecos/avatares/<usuario_id>.<ext>` (sem
//! migração: o próprio arquivo é a fonte da verdade). Só PNG/JPEG/WebP,
//! reconhecidos pelos bytes iniciais e nunca pelo nome enviado (SVG fica de
//! fora de propósito: carrega script). `GET /usuarios/:id/avatar` só serve a
//! foto de quem divide uma Equipe com quem pede; qualquer outro caso é `404`,
//! sem revelar se a pessoa existe.

use axum::extract::{Multipart, Path, State};
use axum::http::{header, HeaderValue};
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use ecos_core::ErrorCode;
use std::path::PathBuf;

use crate::error::{AppError, AppResult, CampoInvalido};
use crate::middleware::auth_guard::UsuarioAutenticado;
use crate::state::AppState;

pub const TAMANHO_MAXIMO_AVATAR_BYTES: usize = 2 * 1024 * 1024;
/// Reserva para cabeçalhos e separadores do multipart, além da imagem.
pub const TAMANHO_MAXIMO_MULTIPART_AVATAR_BYTES: usize = TAMANHO_MAXIMO_AVATAR_BYTES + 64 * 1024;
const EXTENSOES: [&str; 3] = ["png", "jpg", "webp"];

fn raiz(state: &AppState) -> PathBuf { state.config.notes_root.join(".ecos").join("avatares") }

fn id_seguro(id: &str) -> bool { !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') }

/// `(extensão, mime)` pelos bytes iniciais do arquivo.
fn tipo_da_imagem(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) { return Some(("png", "image/png")); }
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) { return Some(("jpg", "image/jpeg")); }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" { return Some(("webp", "image/webp")); }
    None
}

fn mime_da_extensao(ext: &str) -> &'static str {
    match ext { "png" => "image/png", "jpg" => "image/jpeg", _ => "image/webp" }
}

pub(crate) fn arquivo_existente(state: &AppState, usuario_id: &str) -> Option<(PathBuf, &'static str)> {
    if !id_seguro(usuario_id) { return None; }
    EXTENSOES.iter().map(|ext| (raiz(state).join(format!("{usuario_id}.{ext}")), *ext)).find(|(p, _)| p.is_file())
}

pub(crate) fn remover_todos(state: &AppState, usuario_id: &str) {
    for ext in EXTENSOES { let _ = std::fs::remove_file(raiz(state).join(format!("{usuario_id}.{ext}"))); }
}

/// Carimbo de versão (epoch, segundos) pra o cliente invalidar o cache; `None` sem foto.
pub fn versao(state: &AppState, usuario_id: &str) -> Option<u64> {
    let (caminho, _) = arquivo_existente(state, usuario_id)?;
    std::fs::metadata(caminho).ok()?.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_secs())
}

fn resposta_imagem(bytes: Vec<u8>, mime: &'static str) -> Response {
    let mut r = bytes.into_response();
    let h = r.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_static(mime));
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("private, no-cache"));
    h.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    r
}

fn servir(state: &AppState, usuario_id: &str) -> AppResult<Response> {
    let (caminho, ext) = arquivo_existente(state, usuario_id).ok_or_else(|| AppError::new(ErrorCode::NotFound))?;
    let bytes = std::fs::read(caminho).map_err(|_| AppError::new(ErrorCode::NotFound))?;
    Ok(resposta_imagem(bytes, mime_da_extensao(ext)))
}

pub async fn obter_meu(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>) -> AppResult<Response> {
    servir(&state, &usuario.0)
}

pub async fn enviar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, mut multipart: Multipart) -> AppResult<Json<serde_json::Value>> {
    let invalido = |msg: &str| AppError::new(ErrorCode::ValidationError).with_message(msg.to_string());
    let campo = multipart.next_field().await.map_err(|_| invalido("O envio da imagem está incompleto ou inválido. Escolha a imagem novamente."))?
        .ok_or_else(|| invalido("Nenhuma imagem foi enviada. Escolha uma foto."))?;
    if campo.name() != Some("arquivo") { return Err(invalido("O envio não contém uma imagem válida. Escolha a foto novamente.")); }
    let bytes = campo.bytes().await.map_err(|_| invalido("O envio foi interrompido ou excedeu o limite. Use uma imagem de até 2 MB."))?;
    if bytes.is_empty() { return Err(invalido("A imagem está vazia. Escolha outra foto.")); }
    if bytes.len() > TAMANHO_MAXIMO_AVATAR_BYTES {
        return Err(AppError::validation(vec![CampoInvalido { campo: "arquivo".into(), motivo: "maior que 2 MB".into() }]));
    }
    let (ext, _) = tipo_da_imagem(&bytes).ok_or_else(|| invalido("Formato não suportado. Use uma imagem PNG, JPEG ou WebP."))?;
    if !id_seguro(&usuario.0) { return Err(AppError::new(ErrorCode::NotFound)); }
    let dir = raiz(&state);
    remover_todos(&state, &usuario.0);
    std::fs::create_dir_all(&dir).and_then(|_| std::fs::write(dir.join(format!("{}.{ext}", usuario.0)), &bytes)).map_err(|err| {
        tracing::error!(error = %err, "falha ao guardar foto de perfil");
        AppError::new(ErrorCode::InternalError).with_message("Não foi possível guardar a foto no servidor. Verifique o espaço disponível e a permissão da pasta.")
    })?;
    Ok(Json(serde_json::json!({ "ok": true, "avatar_atualizado_em": versao(&state, &usuario.0) })))
}

pub async fn remover(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>) -> AppResult<Json<serde_json::Value>> {
    remover_todos(&state, &usuario.0);
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Foto de outra pessoa: só de quem divide uma Equipe com quem pede.
pub async fn obter_de_usuario(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(alvo): Path<String>) -> AppResult<Response> {
    if alvo != usuario.0 {
        let (eu, alvo_sql) = (usuario.0.clone(), alvo.clone());
        let divide: bool = state.db.with(move |conn| {
            conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM membro_equipe a JOIN membro_equipe b ON a.equipe_id = b.equipe_id WHERE a.usuario_id = ?1 AND b.usuario_id = ?2)",
                rusqlite::params![eu, alvo_sql],
                |r| r.get(0),
            )
        }).await?;
        if !divide { return Err(AppError::new(ErrorCode::NotFound)); }
    }
    servir(&state, &alvo)
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn reconhece_so_formatos_de_imagem_seguros_pelos_bytes() {
        assert_eq!(tipo_da_imagem(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0]), Some(("png", "image/png")));
        assert_eq!(tipo_da_imagem(&[0xFF, 0xD8, 0xFF, 0xE0]), Some(("jpg", "image/jpeg")));
        assert_eq!(tipo_da_imagem(b"RIFF\x00\x00\x00\x00WEBPVP8 "), Some(("webp", "image/webp")));
        assert_eq!(tipo_da_imagem(b"<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>"), None);
        assert_eq!(tipo_da_imagem(b"GIF89a"), None);
        assert_eq!(tipo_da_imagem(&[]), None);
    }

    #[test]
    fn id_com_travessia_de_caminho_e_recusado() {
        assert!(id_seguro("01HZX9ABCDEF"));
        assert!(!id_seguro("../segredo"));
        assert!(!id_seguro("a/b"));
        assert!(!id_seguro(""));
    }
}
