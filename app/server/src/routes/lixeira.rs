//! Notas e Tarefas recuperáveis; não inclui o Cofre.
use std::path::{Component, Path, PathBuf};
use ecos_core::{new_id, ErrorCode};
use serde::{Deserialize, Serialize};
use crate::{error::{AppError, AppResult}, state::AppState};
#[derive(Serialize, Deserialize)]
pub struct Registro { pub item: super::media::ItemLixeira, pub anexos: Option<String> }
fn root(s: &AppState) -> PathBuf { s.config.notes_root.join(".ecos/lixeira/documentos") }
fn seguro(s: &AppState, rel: &str, tipo: &str) -> AppResult<PathBuf> {
    let arvore = match tipo { "nota" => "Notas", "tarefa" => "Tarefas", _ => return Err(AppError::new(ErrorCode::Forbidden)) };
    let p = Path::new(rel);
    if p.components().any(|c| !matches!(c, Component::Normal(_))) { return Err(AppError::new(ErrorCode::Forbidden)); }
    let mut partes = p.components().map(|c| c.as_os_str().to_string_lossy().to_string());
    let primeiro = partes.next().unwrap_or_default();
    // Registros antigos (layout sem espaço) apontam para `Notas/...`: voltam para o Pessoal.
    let p = if primeiro == arvore {
        Path::new(crate::espacos::PESSOAL_DIR).join(p)
    } else {
        let e_espaco = crate::espacos::listar(&s.config.notes_root).iter().any(|(_, d)| d.file_name().is_some_and(|n| n.to_string_lossy() == primeiro));
        if !e_espaco || partes.next().as_deref() != Some(arvore) { return Err(AppError::new(ErrorCode::Forbidden)); }
        p.to_path_buf()
    };
    let p = p.as_path();
    Ok(s.config.notes_root.join(p))
}
fn validar(s: &AppState, path: &Path) -> AppResult<()> {
    if !std::fs::canonicalize(path)?.starts_with(std::fs::canonicalize(&s.config.notes_root)?) { return Err(AppError::new(ErrorCode::Forbidden)); }
    Ok(())
}
pub fn mover(s: &AppState, rel: &str, tipo: &str, titulo: &str, anexos: &Path) -> AppResult<()> {
    let origem = seguro(s, rel, tipo)?;
    validar(s, &origem)?;
    let anexos = if anexos.is_dir() { validar(s, anexos)?; Some(anexos.strip_prefix(&s.config.notes_root).map_err(|_| AppError::new(ErrorCode::Forbidden))?.to_string_lossy().replace('\\', "/")) } else { None };
    let registro = Registro { item: super::media::ItemLixeira { id: format!("documento-{}", new_id()), nome: titulo.into(), tipo: tipo.into(), caminho_original: rel.into(), tamanho_bytes: origem.metadata()?.len(), mime: "text/markdown".into(), excluido_em: chrono::Utc::now().to_rfc3339() }, anexos };
    let dir = root(s).join(&registro.item.id);
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join("registro.json"), serde_json::to_vec(&registro).map_err(|_| AppError::new(ErrorCode::InternalError))?)?;
    if let Some(ref rel) = registro.anexos { std::fs::rename(seguro(s, rel, tipo)?, dir.join("anexos"))?; }
    if let Err(e) = std::fs::rename(&origem, dir.join("conteudo.md")) {
        if let Some(ref rel) = registro.anexos { let _ = std::fs::rename(dir.join("anexos"), seguro(s, rel, tipo)?); }
        return Err(e.into());
    }
    Ok(())
}
pub fn listar(s: &AppState) -> AppResult<Vec<super::media::ItemLixeira>> {
    if !root(s).exists() { return Ok(Vec::new()); }
    let mut itens = Vec::new();
    for entry in std::fs::read_dir(root(s))? {
        let dir = entry?.path();
        if !dir.join("conteudo.md").is_file() { continue; }
        let r: Registro = serde_json::from_slice(&std::fs::read(dir.join("registro.json"))?).map_err(|_| AppError::new(ErrorCode::InternalError))?;
        itens.push(r.item);
    }
    Ok(itens)
}
pub async fn restaurar(s: &AppState, id: &str) -> AppResult<()> {
    if id.strip_prefix("documento-").and_then(|id| ulid::Ulid::from_string(id).ok()).is_none() { return Err(AppError::new(ErrorCode::NotFound)); }
    let dir = root(s).join(id);
    if !dir.join("conteudo.md").is_file() { return Err(AppError::new(ErrorCode::NotFound)); }
    validar(s, &dir)?;
    let r: Registro = serde_json::from_slice(&std::fs::read(dir.join("registro.json"))?).map_err(|_| AppError::new(ErrorCode::InternalError))?;
    let destino = seguro(s, &r.item.caminho_original, &r.item.tipo)?;
    let anexos = r.anexos.as_deref().map(|rel| seguro(s, rel, &r.item.tipo)).transpose()?;
    if destino.exists() || anexos.as_ref().is_some_and(|p| p.exists()) { return Err(AppError::new(ErrorCode::Conflict).with_message("Já existe um item no caminho original. Resolva o conflito antes de restaurar.")); }
    for p in std::iter::once(&destino).chain(anexos.iter()) { std::fs::create_dir_all(p.parent().unwrap())?; validar(s, p.parent().unwrap())?; }
    if let Some(ref p) = anexos { std::fs::rename(dir.join("anexos"), p)?; }
    if let Err(e) = std::fs::rename(dir.join("conteudo.md"), destino) {
        if let Some(ref p) = anexos { let _ = std::fs::rename(p, dir.join("anexos")); }
        return Err(e.into());
    }
    crate::db::reindex::reindexar_tudo(&s.db, &s.config.notes_root).await?;
    Ok(())
}
