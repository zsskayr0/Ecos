//! Notas (seção 11.4) — Captura local-first: o arquivo `.md` é a fonte de
//! verdade (seção 1.1), o índice (`nota`) é só cache de leitura. Toda
//! escrita aqui grava o arquivo primeiro e depois reindexa, nunca o
//! contrário.

use axum::extract::{Multipart, Path, Query, State};
use axum::{Extension, Json};
use chrono::Utc;
use ecos_core::types::{Espaco, NotaFrontMatter, NotaModo};
use ecos_core::{frontmatter, naming, new_id, ErrorCode};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

use crate::db::reindex::reindexar_tudo;
use crate::error::{AppError, AppResult, CampoInvalido};
use crate::middleware::auth_guard::UsuarioAutenticado;
use crate::routes::anexos_comuns::mime_por_extensao;
use crate::routes::pagination::{codificar, decodificar, limite_efetivo, Pagina};
use crate::state::AppState;

fn notas_dir(state: &AppState) -> PathBuf {
    // Só fallback: a raiz real de cada árvore depende do espaço (`espacos::raiz`).
    state.config.notes_root.join(crate::espacos::PESSOAL_DIR).join("Notas")
}

fn absoluto(state: &AppState, caminho_relativo: &str) -> PathBuf {
    state.config.notes_root.join(caminho_relativo)
}

#[derive(Debug, Serialize)]
pub struct NotaResumo {
    pub id: String,
    pub corpo: String,
    pub titulo: String,
    pub modo: String,
    pub pasta: Option<String>,
    pub espaco: String,
    pub criado_em: String,
    pub atualizado_em: String,
    pub ultima_revisao_em: Option<String>,
    pub tags: Vec<String>,
    #[serde(default)]
    pub criado_por: Option<String>,
    #[serde(default)]
    pub criado_por_nome: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ListarQuery {
    pub pasta: Option<String>,
    pub espaco: Option<String>,
    pub tag: Option<String>,
    pub cursor: Option<String>,
    pub limit: Option<i64>,
}

pub async fn listar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Query(q): Query<ListarQuery>) -> AppResult<Json<Pagina<NotaResumo>>> {
    let visivel = crate::espacos::visivel_sql("n", &usuario.0);
    let limite = limite_efetivo(q.limit);
    let cursor = q.cursor.as_deref().and_then(decodificar);

    #[allow(clippy::type_complexity)]
    let linhas: Vec<(String, String, String, Option<String>, String, String, String, Option<String>, Option<String>, Option<String>, String)> = state
        .db
        .with(move |conn| {
            let mut sql = String::from(
                "SELECT n.id, n.titulo, n.modo, n.pasta_id, n.espaco, n.criado_em, n.atualizado_em, n.ultima_revisao_em, \
                 n.criado_por, u.nome_usuario, COALESCE(nf.corpo, '') \
                 FROM nota n LEFT JOIN usuario u ON u.id = n.criado_por LEFT JOIN nota_fts nf ON nf.id = n.id",
            );
            let mut condicoes: Vec<String> = vec![visivel.clone()];
            let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

            if let Some(tag) = &q.tag {
                sql.push_str(" JOIN nota_tag nt ON nt.nota_id = n.id");
                condicoes.push("nt.tag = ?".into());
                params.push(Box::new(ecos_core::tags::canonica(tag).unwrap_or_else(|| tag.clone())));
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
                        r.get(8)?,
                        r.get(9)?,
                        r.get(10)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await?;

    let tem_mais = linhas.len() as i64 > limite;
    let visiveis = if tem_mais { &linhas[..limite as usize] } else { &linhas[..] };

    // Uma única consulta para as tags evita N+1 queries (e N aquisições do
    // mutex SQLite) ao abrir uma pasta com muitas notas.
    let ids: Vec<String> = visiveis.iter().map(|(id, ..)| id.clone()).collect();
    let tags_por_nota: HashMap<String, Vec<String>> = if ids.is_empty() {
        HashMap::new()
    } else {
        state
            .db
            .with(move |conn| {
                let marcadores = std::iter::repeat("?").take(ids.len()).collect::<Vec<_>>().join(", ");
                let sql = format!("SELECT nota_id, tag FROM nota_tag WHERE nota_id IN ({marcadores}) ORDER BY tag");
                let mut stmt = conn.prepare(&sql)?;
                let mut mapa: HashMap<String, Vec<String>> = HashMap::new();
                let linhas = stmt.query_map(rusqlite::params_from_iter(ids.iter()), |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
                for linha in linhas {
                    let (nota_id, tag) = linha?;
                    mapa.entry(nota_id).or_default().push(tag);
                }
                Ok(mapa)
            })
            .await?
    };

    let mut items = Vec::with_capacity(visiveis.len());
    for (id, titulo, modo, pasta, espaco, criado_em, atualizado_em, ultima_revisao_em, criado_por, criado_por_nome, corpo) in visiveis {
        let tags = tags_por_nota.get(id).cloned().unwrap_or_default();
        items.push(NotaResumo {
            id: id.clone(),
            corpo: corpo.clone(),
            titulo: titulo.clone(),
            modo: modo.clone(),
            pasta: pasta.clone(),
            espaco: espaco.clone(),
            criado_em: criado_em.clone(),
            atualizado_em: atualizado_em.clone(),
            ultima_revisao_em: ultima_revisao_em.clone(),
            tags,
            criado_por: criado_por.clone(),
            criado_por_nome: criado_por_nome.clone(),
        });
    }

    let next_cursor = if tem_mais {
        visiveis.last().map(|(id, _, _, _, _, _, atualizado_em, ..)| codificar(atualizado_em, id))
    } else {
        None
    };

    Ok(Json(Pagina { items, next_cursor }))
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

pub async fn criar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Json(payload): Json<CriarNotaPayload>) -> AppResult<Json<serde_json::Value>> {
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
    crate::espacos::validar_pasta(pasta_relativa)?;
    crate::espacos::exigir_acesso(&state, &usuario.0, &espaco.to_string()).await?;
    let raiz = crate::espacos::raiz(&state, &crate::espacos::fisica(&espaco.to_string(), &usuario.0), "Notas").await?;
    let dir = match pasta_relativa {
        Some(p) => raiz.join(p),
        None => raiz,
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
        tags: ecos_core::tags::normalizar_lista(&payload.tags),
        pasta_id: pasta_relativa.map(str::to_string),
        espaco,
        tarefa_vinculada_id: None,
        ultima_revisao_em: None,
        criado_por: Some(usuario.0.clone()),
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

#[derive(Debug, Deserialize)]
pub struct ImportarNotaPayload {
    /// Nome do arquivo `.md` (com ou sem extensão) — vira o título se o texto não tiver `# Título`.
    pub nome: String,
    pub conteudo: String,
    #[serde(default)]
    pub pasta: Option<String>,
    #[serde(default)]
    pub espaco: Option<String>,
}

/// Importa um `.md` de fora (arrastado para a aba Notas): mesma "adoção" do arquivo solto na pasta —
/// completa o front-matter que faltar e nunca mexe no corpo.
pub async fn importar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Json(payload): Json<ImportarNotaPayload>) -> AppResult<Json<serde_json::Value>> {
    let pasta_relativa = payload.pasta.as_deref().filter(|p| !p.is_empty());
    crate::espacos::validar_pasta(pasta_relativa)?;
    let nome = payload.nome.trim().trim_end_matches(".md").trim_end_matches(".MD");
    if nome.is_empty() {
        return Err(AppError::validation(vec![CampoInvalido { campo: "nome".into(), motivo: "não pode ser vazio".into() }]));
    }
    let agora = Utc::now();
    let conteudo = ecos_core::adotar::adotar(&payload.conteudo, nome, agora, agora)
        .map_err(|e| AppError::validation(vec![CampoInvalido { campo: "conteudo".into(), motivo: e.to_string() }]))?
        .unwrap_or(payload.conteudo);
    let doc = frontmatter::parse::<NotaFrontMatter>(&conteudo)?;

    let espaco = payload.espaco.as_deref().unwrap_or("pessoal");
    espaco.parse::<ecos_core::types::Espaco>().map_err(|motivo| AppError::validation(vec![CampoInvalido { campo: "espaco".into(), motivo }]))?;
    crate::espacos::exigir_acesso(&state, &usuario.0, espaco).await?;
    let raiz = crate::espacos::raiz(&state, &crate::espacos::fisica(espaco, &usuario.0), "Notas").await?;
    let dir = match pasta_relativa {
        Some(p) => raiz.join(p),
        None => raiz,
    };
    std::fs::create_dir_all(&dir)?;
    let mut doc = doc;
    doc.front_matter.espaco = espaco.parse().unwrap_or(doc.front_matter.espaco);
    doc.front_matter.criado_por = Some(usuario.0.clone());
    let conteudo = frontmatter::serialize(&doc.front_matter, &doc.body)?;
    let caminho_absoluto = naming::caminho_sem_colisao(&dir, &naming::sanitizar_nome_arquivo(nome), "md");
    std::fs::write(&caminho_absoluto, conteudo)?;
    reindexar_tudo(&state.db, &state.config.notes_root).await?;

    Ok(Json(serde_json::json!({
        "id": doc.front_matter.id,
        "titulo": doc.front_matter.titulo,
        "pasta": pasta_relativa,
    })))
}

async fn caminho_por_id(state: &AppState, usuario_id: &str, id: &str) -> AppResult<String> {
    let id_owned = id.to_string();
    let visivel = crate::espacos::visivel_sql("", usuario_id);
    let caminho: Option<String> = state
        .db
        .with(move |conn| conn.query_row(&format!("SELECT caminho_arquivo FROM nota WHERE id = ?1 AND {visivel}"), [&id_owned], |r| r.get(0)).optional())
        .await?;
    caminho.ok_or(AppError::new(ErrorCode::NotFound))
}

pub async fn obter(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let caminho_relativo = caminho_por_id(&state, &usuario.0, &id).await?;
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
    pub espaco: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub corpo: Option<String>,
    /// Marca "revisado" manual (alimenta o critério Esquecimento, seção 4.1).
    #[serde(default)]
    pub marcar_revisado: bool,
}

pub async fn atualizar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(id): Path<String>, Json(payload): Json<AtualizarNotaPayload>) -> AppResult<Json<serde_json::Value>> {
    let caminho_relativo_atual = caminho_por_id(&state, &usuario.0, &id).await?;
    crate::espacos::validar_pasta(payload.pasta.as_deref())?;
    let caminho_absoluto_atual = absoluto(&state, &caminho_relativo_atual);
    let bruto = std::fs::read_to_string(&caminho_absoluto_atual)?;
    let doc = frontmatter::parse::<NotaFrontMatter>(&bruto)?;
    let mut fm = doc.front_matter;
    let mut corpo = doc.body;

    if let Some(titulo) = &payload.titulo {
        fm.titulo = titulo.clone();
    }
    let espaco_antes = fm.espaco.to_string();
    if let Some(espaco) = payload.espaco {
        fm.espaco = espaco.parse().map_err(|motivo: String| AppError::validation(vec![CampoInvalido { campo: "espaco".into(), motivo }]))?;
    }
    if let Some(tags) = payload.tags {
        fm.tags = ecos_core::tags::atualizar_preservando(&fm.tags, &tags);
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
    if fm.espaco.to_string() != espaco_antes {
        crate::espacos::exigir_acesso(&state, &usuario.0, &fm.espaco.to_string()).await?;
    }
    let raiz_destino = crate::espacos::raiz(&state, &crate::espacos::fisica(&fm.espaco.to_string(), &usuario.0), "Notas").await?;
    let dir_destino = match payload.pasta.as_deref() {
        Some(p) if !p.is_empty() => raiz_destino.join(p),
        Some(_) => raiz_destino.clone(),
        None if fm.espaco.to_string() != espaco_antes => raiz_destino.clone(),
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
        // A biblioteca de mídia é por espaço: o que o corpo referencia vai junto para o novo espaço.
        if fm.espaco.to_string() != espaco_antes {
            if let Err(err) = crate::espacos::levar_midia(&state.config.notes_root, &corpo, &crate::espacos::fisica(&espaco_antes, &usuario.0), &crate::espacos::fisica(&fm.espaco.to_string(), &usuario.0)) {
                tracing::warn!(error = %err, "não foi possível levar a mídia para o novo espaço");
            }
        }
    }

    reindexar_tudo(&state.db, &state.config.notes_root).await?;

    Ok(Json(serde_json::json!({ "id": fm.id, "titulo": fm.titulo, "atualizado_em": fm.atualizado_em })))
}

/// `{escopo: "apenas_eu"|"todos"}` no corpo (seção 11.4) — não muda o efeito
/// local, já que só existe uma cópia física do arquivo por instância; a
/// distinção importa pro sync entre dispositivos de Equipe (seção 6), fora
/// de escopo do reindex síncrono, por isso não é lida aqui.
pub async fn excluir(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let caminho_relativo = caminho_por_id(&state, &usuario.0, &id).await?;
    let bruto = std::fs::read_to_string(absoluto(&state, &caminho_relativo))?;
    let doc = frontmatter::parse::<NotaFrontMatter>(&bruto)?;
    crate::routes::lixeira::mover(&state, &caminho_relativo, "nota", &doc.front_matter.titulo, &anexos_dir(&state, &id, &caminho_relativo))?;
    reindexar_tudo(&state.db, &state.config.notes_root).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn links(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    caminho_por_id(&state, &usuario.0, &id).await?;
    let visivel = crate::espacos::visivel_sql("n", &usuario.0);
    let visivel_saida = visivel.clone();
    let id_entrada = id.clone();
    let id_saida = id.clone();
    let entrada: Vec<(String, String)> = state
        .db
        .with(move |conn| {
            let mut stmt = conn.prepare(
                &format!("SELECT n.id, n.titulo FROM links_nota l JOIN nota n ON n.id = l.nota_id_origem WHERE l.nota_id_destino = ?1 AND {visivel}"),
            )?;
            let linhas = stmt.query_map([&id_entrada], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await?;
    let saida: Vec<(String, String)> = state
        .db
        .with(move |conn| {
            let mut stmt = conn.prepare(
                &format!("SELECT n.id, n.titulo FROM links_nota l JOIN nota n ON n.id = l.nota_id_destino WHERE l.nota_id_origem = ?1 AND {visivel_saida}"),
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
pub async fn obter_pagina(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let caminho_relativo = caminho_por_id(&state, &usuario.0, &id).await?;
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
pub async fn atualizar_pagina(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(id): Path<String>, Json(payload): Json<serde_json::Value>) -> AppResult<Json<serde_json::Value>> {
    let caminho_relativo = caminho_por_id(&state, &usuario.0, &id).await?;
    let dir = anexos_dir(&state, &id, &caminho_relativo);
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join("pagina.json"), serde_json::to_string_pretty(&payload).unwrap_or_default())?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// --- Anexos (biblioteca global `src/Media`, referenciada em Markdown) -----

/// Upload real (`multipart/form-data`, campo `arquivo`) — grava em
/// `src/Media/AAAA-MM/` e devolve o corpo já com a referência Markdown anexada
/// ao final, pro cliente atualizar o editor sem um segundo round trip.
pub async fn enviar_anexo(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(id): Path<String>, multipart: Multipart) -> AppResult<Json<serde_json::Value>> {
    let caminho_relativo = caminho_por_id(&state, &usuario.0, &id).await?;
    // A mídia vai para a biblioteca do espaço onde o item mora.
    let espaco = crate::espacos::espaco_do_caminho(&state.config.notes_root, &caminho_relativo).unwrap_or_else(|| crate::espacos::fisica("pessoal", &usuario.0));
    let midia = crate::routes::media::enviar_para_biblioteca(&state, &espaco, multipart).await?;
    let referencia_relativa = midia.caminho;
    let bruto = std::fs::read_to_string(absoluto(&state, &caminho_relativo))?;
    let doc = frontmatter::parse::<NotaFrontMatter>(&bruto)?;
    let mut fm = doc.front_matter;
    fm.atualizado_em = Utc::now();
    let linha_md = if midia.mime.starts_with("image/") {
        format!("![{}]({referencia_relativa})", midia.nome)
    } else {
        format!("[{}]({referencia_relativa})", midia.nome)
    };
    let novo_corpo = if doc.body.trim().is_empty() { linha_md.clone() } else { format!("{}\n\n{linha_md}", doc.body.trim_end()) };
    let conteudo = frontmatter::serialize(&fm, &novo_corpo)?;
    std::fs::write(absoluto(&state, &caminho_relativo), conteudo)?;
    reindexar_tudo(&state.db, &state.config.notes_root).await?;

    Ok(Json(serde_json::json!({
        "nome_arquivo": midia.nome,
        "url_relativa": referencia_relativa,
        "tamanho_bytes": midia.tamanho_bytes,
        "corpo": novo_corpo,
    })))
}

/// Serve o próprio arquivo (download/preview) — sem autenticação extra além
/// da sessão já exigida por `rotas_protegidas` (seção 11.1).
pub async fn obter_anexo(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path((id, nome_arquivo)): Path<(String, String)>) -> AppResult<([(axum::http::HeaderName, String); 1], Vec<u8>)> {
    let caminho_relativo = caminho_por_id(&state, &usuario.0, &id).await?;
    // O nome chega decodificado (`%2F` vira `/`): sem esta checagem, `../../..` alcança arquivos de outro espaço.
    if !crate::espacos::nome_de_arquivo_seguro(&nome_arquivo) {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    let caminho = anexos_dir(&state, &id, &caminho_relativo).join(&nome_arquivo);
    if !caminho.is_file() {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    let bytes = std::fs::read(&caminho)?;
    Ok(([(axum::http::header::CONTENT_TYPE, mime_por_extensao(&nome_arquivo).to_string())], bytes))
}
