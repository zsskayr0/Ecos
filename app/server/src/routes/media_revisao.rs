//! Revisão da biblioteca de mídia: acha as mídias órfãs (nenhum Markdown as referencia) e as duplicadas
//! (conteúdo idêntico). Só descarta órfãs, e para a lixeira de mídia (recuperável); nada é apagado de vez.

use axum::extract::{Query, State};
use axum::{Extension, Json};
use ecos_core::{new_id, ErrorCode};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

use super::media::{marcador_lixeira, nome_legivel, raiz_lixeira, EspacoQuery};
use crate::error::{AppError, AppResult};
use crate::middleware::auth_guard::UsuarioAutenticado;
use crate::state::AppState;

#[derive(Serialize, Clone)]
pub struct ItemRevisao {
    pub caminho: String,
    pub nome: String,
    pub espaco: String,
    pub tamanho_bytes: u64,
    pub referenciada: bool,
}

#[derive(Serialize, Default)]
pub struct Revisao {
    /// Sem nenhum Markdown que as use (inclui cópias órfãs de arquivos duplicados).
    pub orfas: Vec<ItemRevisao>,
    /// Grupos de arquivos com conteúdo idêntico (2 ou mais), referenciados ou não.
    pub duplicadas: Vec<Vec<ItemRevisao>>,
    pub bytes_orfas: u64,
}

pub async fn revisar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Query(q): Query<EspacoQuery>) -> AppResult<Json<Revisao>> {
    let permitidos = crate::espacos::chaves_acessiveis(&state, &usuario.0).await?;
    let filtro = q.espaco;
    let notes_root = state.config.notes_root.clone();
    let r = tokio::task::spawn_blocking(move || montar(&notes_root, &permitidos, filtro.as_deref()))
        .await
        .map_err(|_| AppError::new(ErrorCode::InternalError))?;
    Ok(Json(r))
}

fn montar(notes_root: &std::path::Path, permitidos: &[String], filtro: Option<&str>) -> Revisao {
    let usadas = crate::espacos::todas_midias_referenciadas(notes_root);
    let mut todas: Vec<(ItemRevisao, std::path::PathBuf)> = Vec::new();
    for (espaco, dir) in crate::espacos::listar(notes_root) {
        if !permitidos.contains(&espaco) {
            continue;
        }
        if filtro.is_some_and(|f| f != crate::espacos::logica(&espaco)) {
            continue;
        }
        let raiz = dir.join(crate::espacos::MIDIA_DIR);
        if !raiz.exists() {
            continue;
        }
        for e in walkdir::WalkDir::new(&raiz).into_iter().filter_map(Result::ok).filter(|e| e.file_type().is_file()) {
            let Ok(rel) = e.path().strip_prefix(&raiz) else { continue };
            let rel = rel.to_string_lossy().replace('\\', "/");
            let item = ItemRevisao {
                caminho: format!("{}{}", crate::espacos::PREFIXO_MIDIA, rel),
                nome: nome_legivel(&e.file_name().to_string_lossy()),
                espaco: crate::espacos::logica(&espaco).to_string(),
                tamanho_bytes: e.metadata().map(|m| m.len()).unwrap_or(0),
                referenciada: usadas.contains(&rel),
            };
            todas.push((item, e.into_path()));
        }
    }
    // Duplicadas: mesmo tamanho primeiro (barato), depois o hash do conteúdo.
    let mut por_tamanho: BTreeMap<u64, Vec<usize>> = BTreeMap::new();
    for (i, (it, _)) in todas.iter().enumerate() {
        por_tamanho.entry(it.tamanho_bytes).or_default().push(i);
    }
    let mut r = Revisao::default();
    for (_, idxs) in por_tamanho.into_iter().filter(|(_, v)| v.len() > 1) {
        let mut por_hash: BTreeMap<Vec<u8>, Vec<usize>> = BTreeMap::new();
        for i in idxs {
            if let Ok(bytes) = std::fs::read(&todas[i].1) {
                por_hash.entry(Sha256::digest(&bytes).to_vec()).or_default().push(i);
            }
        }
        for g in por_hash.into_values().filter(|v| v.len() > 1) {
            r.duplicadas.push(g.into_iter().map(|i| todas[i].0.clone()).collect());
        }
    }
    for (it, _) in &todas {
        if !it.referenciada {
            r.bytes_orfas += it.tamanho_bytes;
            r.orfas.push(it.clone());
        }
    }
    r.orfas.sort_by(|a, b| b.tamanho_bytes.cmp(&a.tamanho_bytes));
    r.duplicadas.sort_by(|a, b| b[0].tamanho_bytes.cmp(&a[0].tamanho_bytes));
    r
}

#[derive(Deserialize)]
pub struct Descarte {
    pub caminhos: Vec<String>,
}

#[derive(Serialize)]
pub struct ResultadoDescarte {
    pub descartados: Vec<String>,
    pub ignorados: Vec<String>,
}

/// Move para a lixeira de mídia as órfãs pedidas. Confere de novo, no servidor, que nenhum Markdown as usa.
pub async fn descartar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Json(corpo): Json<Descarte>) -> AppResult<Json<ResultadoDescarte>> {
    let permitidos = crate::espacos::chaves_acessiveis(&state, &usuario.0).await?;
    let notes_root = state.config.notes_root.clone();
    let usadas = crate::espacos::todas_midias_referenciadas(&notes_root);
    let mut r = ResultadoDescarte { descartados: vec![], ignorados: vec![] };
    for caminho in corpo.caminhos {
        let rel = caminho.trim_start_matches('/').to_string();
        let sem_prefixo = rel.strip_prefix(crate::espacos::PREFIXO_MIDIA).unwrap_or(&rel).to_string();
        if usadas.contains(&sem_prefixo) {
            r.ignorados.push(caminho);
            continue;
        }
        let Some((espaco, arquivo)) = crate::espacos::achar_midia(&notes_root, &rel, &permitidos) else {
            r.ignorados.push(caminho);
            continue;
        };
        let id = new_id();
        let destino = raiz_lixeira(&state).join(&id).join(&rel);
        let ok = destino.parent().is_some_and(|p| std::fs::create_dir_all(p).is_ok())
            && std::fs::write(marcador_lixeira(&state, &id), &espaco).is_ok()
            && std::fs::rename(&arquivo, &destino).is_ok();
        if ok { r.descartados.push(caminho); } else { r.ignorados.push(caminho); }
    }
    Ok(Json(r))
}
