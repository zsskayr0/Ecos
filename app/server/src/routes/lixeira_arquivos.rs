//! Lixeira do explorador: arquivos que não são nota/tarefa (PDF, imagem, txt...) e pastas inteiras. Nota e tarefa
//! soltas vão para a lixeira de documentos (`lixeira.rs`), que já sabe restaurá-las com os anexos.
//!
//! Cada item fica em `.ecos/lixeira/arquivos/<ulid>/`: `registro.json` e as partes `0`, `1`... Uma pasta lógica
//! pode existir nas duas árvores físicas, por isso guarda uma parte por árvore e volta para os mesmos lugares.

use std::path::{Path, PathBuf};

use ecos_core::{new_id, ErrorCode};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::routes::anexos_comuns::mime_por_extensao;
use crate::routes::media::ItemLixeira;
use crate::state::AppState;

pub const PREFIXO_ID: &str = "arquivo-";

#[derive(Serialize, Deserialize)]
struct Registro {
    nome: String,
    /// Chave física do espaço (`pessoal:<id>` ou `equipe:<id>`), para filtrar quem enxerga o item.
    espaco: String,
    /// Caminho lógico de onde saiu, para mostrar na lixeira.
    caminho: String,
    pasta: bool,
    /// Caminhos de origem relativos à raiz das notas, na ordem das partes guardadas.
    partes: Vec<String>,
    tamanho_bytes: u64,
    excluido_em: String,
}

fn raiz(state: &AppState) -> PathBuf {
    state.config.notes_root.join(".ecos/lixeira/arquivos")
}

fn tamanho(p: &Path) -> u64 {
    if p.is_file() {
        return p.metadata().map(|m| m.len()).unwrap_or(0);
    }
    walkdir::WalkDir::new(p).into_iter().filter_map(Result::ok).filter(|e| e.file_type().is_file()).filter_map(|e| e.metadata().ok()).map(|m| m.len()).sum()
}

/// Move `origens` (arquivo ou a mesma pasta em cada árvore) para a lixeira. Se uma parte falhar, as já movidas voltam.
pub fn mover(state: &AppState, espaco_fisico: &str, caminho_logico: &str, origens: &[PathBuf]) -> AppResult<()> {
    let notes_root = &state.config.notes_root;
    let id = new_id();
    let dir = raiz(state).join(&id);
    std::fs::create_dir_all(&dir)?;
    let registro = Registro {
        nome: caminho_logico.rsplit('/').next().unwrap_or(caminho_logico).to_string(),
        espaco: espaco_fisico.to_string(),
        caminho: caminho_logico.to_string(),
        pasta: origens.iter().any(|o| o.is_dir()),
        partes: origens.iter().map(|o| crate::db::reindex_incremental::relativo(notes_root, o)).collect(),
        tamanho_bytes: origens.iter().map(|o| tamanho(o)).sum(),
        excluido_em: chrono::Utc::now().to_rfc3339(),
    };
    std::fs::write(dir.join("registro.json"), serde_json::to_vec(&registro).map_err(|_| AppError::new(ErrorCode::InternalError))?)?;
    for (i, origem) in origens.iter().enumerate() {
        if let Err(e) = std::fs::rename(origem, dir.join(i.to_string())) {
            for (j, ja) in origens.iter().enumerate().take(i) {
                let _ = std::fs::rename(dir.join(j.to_string()), ja);
            }
            let _ = std::fs::remove_dir_all(&dir);
            return Err(e.into());
        }
    }
    Ok(())
}

fn ler(dir: &Path) -> Option<Registro> {
    serde_json::from_slice(&std::fs::read(dir.join("registro.json")).ok()?).ok()
}

pub fn listar(state: &AppState, permitidos: &[String]) -> AppResult<Vec<ItemLixeira>> {
    let raiz = raiz(state);
    let Ok(entradas) = std::fs::read_dir(&raiz) else { return Ok(Vec::new()) };
    let mut itens = Vec::new();
    for entrada in entradas.flatten() {
        let id = entrada.file_name().to_string_lossy().to_string();
        if ulid::Ulid::from_string(&id).is_err() {
            continue;
        }
        let Some(r) = ler(&entrada.path()) else { continue };
        if !permitidos.contains(&r.espaco) {
            continue;
        }
        let mime = if r.pasta { "inode/directory".to_string() } else { mime_por_extensao(&r.nome).to_string() };
        itens.push(ItemLixeira {
            tipo: if r.pasta { "pasta".into() } else { "arquivo".into() },
            id: format!("{PREFIXO_ID}{id}"),
            nome: r.nome,
            caminho_original: r.caminho,
            tamanho_bytes: r.tamanho_bytes,
            mime,
            excluido_em: r.excluido_em,
        });
    }
    Ok(itens)
}

pub async fn restaurar(state: &AppState, id: &str, permitidos: &[String]) -> AppResult<()> {
    let id = id.strip_prefix(PREFIXO_ID).filter(|i| ulid::Ulid::from_string(i).is_ok()).ok_or(AppError::new(ErrorCode::NotFound))?;
    let dir = raiz(state).join(id);
    let r = ler(&dir).ok_or(AppError::new(ErrorCode::NotFound))?;
    if !permitidos.contains(&r.espaco) {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    let notes_root = &state.config.notes_root;
    let mut destinos = Vec::new();
    for parte in &r.partes {
        if !crate::espacos::caminho_relativo_seguro(parte) || crate::espacos::espaco_do_caminho(notes_root, parte).as_deref() != Some(r.espaco.as_str()) {
            return Err(AppError::new(ErrorCode::Forbidden));
        }
        let destino = notes_root.join(parte);
        if destino.exists() {
            return Err(AppError::new(ErrorCode::Conflict).with_message(format!("Já existe \"{}\" no lugar original. Renomeie ou mova o que está lá antes de restaurar.", r.nome)));
        }
        destinos.push(destino);
    }
    for (i, destino) in destinos.iter().enumerate() {
        if let Some(pai) = destino.parent() {
            std::fs::create_dir_all(pai)?;
        }
        std::fs::rename(dir.join(i.to_string()), destino)?;
    }
    std::fs::remove_dir_all(&dir)?;
    crate::db::reindex::reindexar_tudo(&state.db, notes_root).await?;
    Ok(())
}
