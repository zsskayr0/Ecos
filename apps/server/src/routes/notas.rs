//! Notas (seção 11.4) — Captura local-first: o arquivo `.md` é a fonte de
//! verdade (seção 1.1), o índice (`nota`) é só cache de leitura. Toda
//! escrita aqui grava o arquivo primeiro e depois reindexa, nunca o
//! contrário.

use axum::extract::{Path, Query, State};
use axum::Json;
use chrono::Utc;
use ecos_core::types::{Espaco, NotaFrontMatter, NotaModo};
use ecos_core::{frontmatter, naming, new_id, ErrorCode};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::db::reindex::reindexar_tudo;
use crate::error::{AppError, AppResult, CampoInvalido};
use crate::routes::pagination::{codificar, decodificar, limite_efetivo, Pagina};
use crate::state::AppState;

fn notas_dir(state: &AppState) -> PathBuf {
    state.config.notes_root.join("Notas")
}

fn absoluto(state: &AppState, caminho_relativo: &str) -> PathBuf {
    state.config.notes_root.join(caminho_relativo)
}

#[derive(Debug, Serialize)]
pub struct NotaResumo {
    pub id: String,
    pub titulo: String,
    pub modo: String,
    pub pasta: Option<String>,
    pub espaco: String,
    pub criado_em: String,
    pub atualizado_em: String,
    pub ultima_revisao_em: Option<String>,
    pub tags: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct ListarQuery {
    pub pasta: Option<String>,
    pub espaco: Option<String>,
    pub tag: Option<String>,
    pub cursor: Option<String>,
    pub limit: Option<i64>,
}

pub async fn listar(State(state): State<AppState>, Query(q): Query<ListarQuery>) -> AppResult<Json<Pagina<NotaResumo>>> {
    let limite = limite_efetivo(q.limit);
    let cursor = q.cursor.as_deref().and_then(decodificar);

    let linhas: Vec<(String, String, String, Option<String>, String, String, String, Option<String>)> = state
        .db
        .with(move |conn| {
            let mut sql = String::from(
                "SELECT n.id, n.titulo, n.modo, n.pasta_id, n.espaco, n.criado_em, n.atualizado_em, n.ultima_revisao_em \
                 FROM nota n",
            );
            let mut condicoes: Vec<String> = Vec::new();
            let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

            if let Some(tag) = &q.tag {
                sql.push_str(" JOIN nota_tag nt ON nt.nota_id = n.id");
                condicoes.push("nt.tag = ?".into());
                params.push(Box::new(tag.clone()));
            }
            if let Some(pasta) = &q.pasta {
                condicoes.push("n.pasta_id = ?".into());
                params.push(Box::new(pasta.clone()));
            } else {
                condicoes.push("n.pasta_id IS NULL".into());
            }
            if let Some(espaco) = &q.espaco {
                condicoes.push("n.espaco = ?".into());
                params.push(Box::new(espaco.clone()));
            }
            if let Some(c) = &cursor {
                condicoes.push("(n.atualizado_em, n.id) < (?, ?)".into());
                params.push(Box::new(c.valor_ordenacao.clone()));
                params.push(Box::new(c.id.clone()));
            }
            if !condicoes.is_empty() {
                sql.push_str(" WHERE ");
                sql.push_str(&condicoes.join(" AND "));
            }
            sql.push_str(" ORDER BY n.atualizado_em DESC, n.id DESC LIMIT ?");
            params.push(Box::new(limite + 1));

            let mut stmt = conn.prepare(&sql)?;
            let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
            let linhas = stmt
                .query_map(param_refs.as_slice(), |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                        r.get(6)?,
                        r.get(7)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await?;

    let tem_mais = linhas.len() as i64 > limite;
    let visiveis = if tem_mais { &linhas[..limite as usize] } else { &linhas[..] };

    let mut items = Vec::with_capacity(visiveis.len());
    for (id, titulo, modo, pasta, espaco, criado_em, atualizado_em, ultima_revisao_em) in visiveis {
        let tags = tags_da_nota(&state, id).await?;
        items.push(NotaResumo {
            id: id.clone(),
            titulo: titulo.clone(),
            modo: modo.clone(),
            pasta: pasta.clone(),
            espaco: espaco.clone(),
            criado_em: criado_em.clone(),
            atualizado_em: atualizado_em.clone(),
            ultima_revisao_em: ultima_revisao_em.clone(),
            tags,
        });
    }

    let next_cursor = if tem_mais {
        visiveis.last().map(|(id, _, _, _, _, _, atualizado_em, _)| codificar(atualizado_em, id))
    } else {
        None
    };

    Ok(Json(Pagina { items, next_cursor }))
}

async fn tags_da_nota(state: &AppState, nota_id: &str) -> AppResult<Vec<String>> {
    let nota_id = nota_id.to_string();
    let tags = state
        .db
        .with(move |conn| {
            let mut stmt = conn.prepare("SELECT tag FROM nota_tag WHERE nota_id = ?1 ORDER BY tag")?;
            let tags = stmt.query_map([&nota_id], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
            Ok(tags)
        })
        .await?;
    Ok(tags)
}

#[derive(Debug, Deserialize)]
pub struct CriarNotaPayload {
    pub titulo: String,
    #[serde(default)]
    pub corpo: Option<String>,
    /// Caminho relativo sob `Notas/`, `None`/vazio = raiz.
    #[serde(default)]
    pub pasta: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub espaco: Option<String>,
    #[serde(default)]
    pub modo: Option<NotaModo>,
}

pub async fn criar(State(state): State<AppState>, Json(payload): Json<CriarNotaPayload>) -> AppResult<Json<serde_json::Value>> {
    if payload.titulo.trim().is_empty() {
        return Err(AppError::validation(vec![CampoInvalido {
            campo: "titulo".into(),
            motivo: "não pode ser vazio".into(),
        }]));
    }
    let espaco: Espaco = payload
        .espaco
        .as_deref()
        .unwrap_or("pessoal")
        .parse()
        .map_err(|motivo: String| AppError::validation(vec![CampoInvalido { campo: "espaco".into(), motivo }]))?;

    let pasta_relativa = payload.pasta.as_deref().filter(|p| !p.is_empty());
    let dir = match pasta_relativa {
        Some(p) => notas_dir(&state).join(p),
        None => notas_dir(&state),
    };
    std::fs::create_dir_all(&dir)?;

    let nome_arquivo = naming::sanitizar_nome_arquivo(&payload.titulo);
    let caminho_absoluto = naming::caminho_sem_colisao(&dir, &nome_arquivo, "md");

    let agora = Utc::now();
    let front_matter = NotaFrontMatter {
        id: new_id(),
        titulo: payload.titulo.clone(),
        modo: payload.modo.unwrap_or_default(),
        criado_em: agora,
        atualizado_em: agora,
        tags: payload.tags,
        pasta_id: pasta_relativa.map(str::to_string),
        espaco,
        tarefa_vinculada_id: None,
        ultima_revisao_em: None,
    };
    let corpo = payload.corpo.unwrap_or_default();
    let conteudo = frontmatter::serialize(&front_matter, &corpo)?;
    std::fs::write(&caminho_absoluto, conteudo)?;

    // Reindex completo — simples e correto pra escala pessoal (seção 1.1: é
    // cache reconstruível, refazer inteiro é barato).
    reindexar_tudo(&state.db, &state.config.notes_root).await?;

    Ok(Json(serde_json::json!({
        "id": front_matter.id,
        "titulo": front_matter.titulo,
        "modo": front_matter.modo,
        "espaco": front_matter.espaco.to_string(),
        "pasta": pasta_relativa,
        "criado_em": front_matter.criado_em,
        "atualizado_em": front_matter.atualizado_em,
    })))
}

async fn caminho_por_id(state: &AppState, id: &str) -> AppResult<String> {
    let id_owned = id.to_string();
    let caminho: Option<String> = state
        .db
        .with(move |conn| conn.query_row("SELECT caminho_arquivo FROM nota WHERE id = ?1", [&id_owned], |r| r.get(0)).optional())
        .await?;
    caminho.ok_or(AppError::new(ErrorCode::NotFound))
}

pub async fn obter(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let caminho_relativo = caminho_por_id(&state, &id).await?;
    let bruto = std::fs::read_to_string(absoluto(&state, &caminho_relativo))?;
    let doc = frontmatter::parse::<NotaFrontMatter>(&bruto)?;
    Ok(Json(serde_json::json!({
        "id": doc.front_matter.id,
        "titulo": doc.front_matter.titulo,
        "modo": doc.front_matter.modo,
        "tags": doc.front_matter.tags,
        "espaco": doc.front_matter.espaco.to_string(),
        "criado_em": doc.front_matter.criado_em,
        "atualizado_em": doc.front_matter.atualizado_em,
        "ultima_revisao_em": doc.front_matter.ultima_revisao_em,
        "caminho_arquivo": caminho_relativo,
        "corpo": doc.body,
    })))
}

#[derive(Debug, Deserialize)]
pub struct AtualizarNotaPayload {
    #[serde(default)]
    pub titulo: Option<String>,
    #[serde(default)]
    pub pasta: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub corpo: Option<String>,
    /// Marca "revisado" manual (alimenta o critério Esquecimento, seção 4.1).
    #[serde(default)]
    pub marcar_revisado: bool,
}

pub async fn atualizar(State(state): State<AppState>, Path(id): Path<String>, Json(payload): Json<AtualizarNotaPayload>) -> AppResult<Json<serde_json::Value>> {
    let caminho_relativo_atual = caminho_por_id(&state, &id).await?;
    let caminho_absoluto_atual = absoluto(&state, &caminho_relativo_atual);
    let bruto = std::fs::read_to_string(&caminho_absoluto_atual)?;
    let doc = frontmatter::parse::<NotaFrontMatter>(&bruto)?;
    let mut fm = doc.front_matter;
    let mut corpo = doc.body;

    if let Some(titulo) = &payload.titulo {
        fm.titulo = titulo.clone();
    }
    if let Some(tags) = payload.tags {
        fm.tags = tags;
    }
    if let Some(novo_corpo) = payload.corpo {
        corpo = novo_corpo;
    }
    fm.atualizado_em = Utc::now();
    if payload.marcar_revisado {
        fm.ultima_revisao_em = Some(fm.atualizado_em);
    }

    // `pasta` ausente = não mexe; `pasta: ""` explícito = mover pra raiz;
    // `pasta: "X"` = mover pra `Notas/X`.
    let dir_destino = match payload.pasta.as_deref() {
        Some(p) if !p.is_empty() => notas_dir(&state).join(p),
        Some(_) => notas_dir(&state),
        None => caminho_absoluto_atual
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| notas_dir(&state)),
    };
    std::fs::create_dir_all(&dir_destino)?;

    if let Some(p) = payload.pasta.as_deref() {
        fm.pasta_id = if p.is_empty() { None } else { Some(p.to_string()) };
    }

    let nome_arquivo = naming::sanitizar_nome_arquivo(&fm.titulo);
    let caminho_absoluto_destino = if dir_destino.join(format!("{nome_arquivo}.md")) == caminho_absoluto_atual {
        caminho_absoluto_atual.clone()
    } else {
        naming::caminho_sem_colisao(&dir_destino, &nome_arquivo, "md")
    };

    let conteudo = frontmatter::serialize(&fm, &corpo)?;

    if caminho_absoluto_destino == caminho_absoluto_atual {
        std::fs::write(&caminho_absoluto_atual, conteudo)?;
    } else {
        std::fs::write(&caminho_absoluto_destino, conteudo)?;
        std::fs::remove_file(&caminho_absoluto_atual)?;
    }

    reindexar_tudo(&state.db, &state.config.notes_root).await?;

    Ok(Json(serde_json::json!({ "id": fm.id, "titulo": fm.titulo, "atualizado_em": fm.atualizado_em })))
}

/// `{escopo: "apenas_eu"|"todos"}` no corpo (seção 11.4) — não muda o efeito
/// local, já que só existe uma cópia física do arquivo por instância; a
/// distinção importa pro sync entre dispositivos de Equipe (seção 6), fora
/// de escopo do reindex síncrono, por isso não é lida aqui.
pub async fn excluir(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let caminho_relativo = caminho_por_id(&state, &id).await?;
    std::fs::remove_file(absoluto(&state, &caminho_relativo))?;
    reindexar_tudo(&state.db, &state.config.notes_root).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn links(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let id_entrada = id.clone();
    let id_saida = id.clone();
    let entrada: Vec<(String, String)> = state
        .db
        .with(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT n.id, n.titulo FROM links_nota l JOIN nota n ON n.id = l.nota_id_origem WHERE l.nota_id_destino = ?1",
            )?;
            let linhas = stmt.query_map([&id_entrada], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await?;
    let saida: Vec<(String, String)> = state
        .db
        .with(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT n.id, n.titulo FROM links_nota l JOIN nota n ON n.id = l.nota_id_destino WHERE l.nota_id_origem = ?1",
            )?;
            let linhas = stmt.query_map([&id_saida], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await?;

    Ok(Json(serde_json::json!({
        "entrada": entrada.into_iter().map(|(id, titulo)| serde_json::json!({"id": id, "titulo": titulo})).collect::<Vec<_>>(),
        "saida": saida.into_iter().map(|(id, titulo)| serde_json::json!({"id": id, "titulo": titulo})).collect::<Vec<_>>(),
    })))
}

fn anexos_dir(state: &AppState, nota_id: &str, caminho_relativo: &str) -> PathBuf {
    let pai = absoluto(state, caminho_relativo)
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| notas_dir(state));
    pai.join("_anexos").join(nota_id)
}

/// `pagina.json` de uma Nota em Modo Página (seção 1.3-B).
pub async fn obter_pagina(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let caminho_relativo = caminho_por_id(&state, &id).await?;
    let caminho_json = anexos_dir(&state, &id, &caminho_relativo).join("pagina.json");
    if !caminho_json.exists() {
        return Ok(Json(serde_json::json!({ "caixas_texto": [], "tracos": [] })));
    }
    let bruto = std::fs::read_to_string(caminho_json)?;
    let valor: serde_json::Value = serde_json::from_str(&bruto).map_err(|_| {
        AppError::validation(vec![CampoInvalido {
            campo: "pagina.json".into(),
            motivo: "arquivo corrompido".into(),
        }])
    })?;
    Ok(Json(valor))
}

/// Grava o canvas (seção 1.3-B). A regeneração fiel de `pagina.svg` exige um
/// renderizador de canvas — isso é o editor do cliente Tauri (fora de
/// escopo deste binário, seção 10.1); o servidor só persiste o dado vivo.
pub async fn atualizar_pagina(State(state): State<AppState>, Path(id): Path<String>, Json(payload): Json<serde_json::Value>) -> AppResult<Json<serde_json::Value>> {
    let caminho_relativo = caminho_por_id(&state, &id).await?;
    let dir = anexos_dir(&state, &id, &caminho_relativo);
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join("pagina.json"), serde_json::to_string_pretty(&payload).unwrap_or_default())?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
