//! Ícones personalizados das pastas — imagens que a pessoa sobe em Configurações e escolhe no seletor de ícones
//! (como logos de aplicativos). Ficam em `.ecos/icones/<usuario_id>/<id>.<ext>`, com os nomes num `indice.json`.
//! Mesma regra do avatar: só PNG/JPEG/WebP reconhecidos pelos bytes (SVG fica de fora: carrega script) e só a própria
//! pessoa enxerga os seus. A pasta guarda a referência como `img:<id>`.

use axum::extract::{Multipart, Path, Query, State};
use axum::response::Response;
use axum::{Extension, Json};
use ecos_core::ErrorCode;
use serde::Deserialize;
use std::collections::BTreeMap;
use std::path::PathBuf;

use crate::error::{AppError, AppResult};
use crate::middleware::auth_guard::UsuarioAutenticado;
use crate::routes::avatar::{arquivo_existente_em, gravar_em, ler_campo_arquivo, remover_todos_em, servir_de, validar_imagem, versao_em};
use crate::state::AppState;

const LIMITE_ICONES: usize = 300;
const TAMANHO_MAXIMO_NOME: usize = 40;
const INDICE: &str = "indice.json";
type Indice = BTreeMap<String, String>;

fn raiz(state: &AppState, usuario_id: &str) -> AppResult<PathBuf> {
    if usuario_id.is_empty() || !usuario_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    Ok(state.config.notes_root.join(".ecos").join("icones").join(usuario_id))
}

fn ler_indice(dir: &std::path::Path) -> Indice {
    std::fs::read_to_string(dir.join(INDICE)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn gravar_indice(dir: &std::path::Path, indice: &Indice) -> AppResult<()> {
    let r = std::fs::create_dir_all(dir).and_then(|_| std::fs::write(dir.join(INDICE), serde_json::to_string_pretty(indice).unwrap_or_default()));
    r.map_err(|err| {
        tracing::error!(error = %err, "falha ao guardar índice de ícones");
        AppError::new(ErrorCode::InternalError).with_message("Não foi possível guardar o ícone no servidor. Verifique o espaço disponível e a permissão da pasta.")
    })
}

/// Apaga todos os ícones de uma pessoa (exclusão de conta).
pub(crate) fn remover_todos(state: &AppState, usuario_id: &str) {
    if let Ok(dir) = raiz(state, usuario_id) { let _ = std::fs::remove_dir_all(dir); }
}

pub async fn listar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>) -> AppResult<Json<serde_json::Value>> {
    let dir = raiz(&state, &usuario.0)?;
    let itens: Vec<_> = ler_indice(&dir).into_iter()
        .filter_map(|(id, nome)| versao_em(&dir, &id).map(|v| serde_json::json!({ "id": id, "nome": nome, "versao": v })))
        .collect();
    Ok(Json(serde_json::Value::Array(itens)))
}

#[derive(Debug, Deserialize)]
pub struct ParEnvio { pub nome: Option<String> }

pub async fn enviar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Query(par): Query<ParEnvio>, mut multipart: Multipart) -> AppResult<Json<serde_json::Value>> {
    let dir = raiz(&state, &usuario.0)?;
    let bytes = ler_campo_arquivo(&mut multipart).await?;
    let ext = validar_imagem(&bytes)?;
    let mut indice = ler_indice(&dir);
    if indice.len() >= LIMITE_ICONES {
        return Err(AppError::new(ErrorCode::ValidationError).with_message(format!("Limite de {LIMITE_ICONES} ícones personalizados atingido. Exclua algum antes de enviar outro.")));
    }
    let nome: String = par.nome.unwrap_or_default().trim().chars().filter(|c| !c.is_control()).take(TAMANHO_MAXIMO_NOME).collect();
    let nome = if nome.is_empty() { "Ícone".to_string() } else { nome };
    let id = ulid::Ulid::new().to_string();
    gravar_em(&dir, &id, ext, &bytes)?;
    indice.insert(id.clone(), nome.clone());
    gravar_indice(&dir, &indice)?;
    Ok(Json(serde_json::json!({ "id": id, "nome": nome, "versao": versao_em(&dir, &id) })))
}

pub async fn obter(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(id): Path<String>) -> AppResult<Response> {
    servir_de(&raiz(&state, &usuario.0)?, &id)
}

pub async fn remover(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let dir = raiz(&state, &usuario.0)?;
    if arquivo_existente_em(&dir, &id).is_none() { return Err(AppError::new(ErrorCode::NotFound)); }
    remover_todos_em(&dir, &id);
    let mut indice = ler_indice(&dir);
    indice.remove(&id);
    gravar_indice(&dir, &indice)?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
