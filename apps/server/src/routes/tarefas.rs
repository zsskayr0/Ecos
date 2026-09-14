//! Tarefas & Agenda (seção 11.6). Mesmo mecanismo de arquivo `.md` da Nota
//! (seção 1.3), árvore `Tarefas/` independente da de `Notas/`.

use axum::extract::{Path, Query, State};
use axum::Json;
use chrono::{Datelike, NaiveDate, NaiveTime, Timelike, Utc};
use ecos_core::types::{Espaco, EventoExternoRef, TarefaFrontMatter, TarefaStatus};
use ecos_core::{frontmatter, naming, new_id, ErrorCode};
use rusqlite::OptionalExtension;
use serde::Deserialize;
use std::path::PathBuf;

use crate::db::reindex::reindexar_tudo;
use crate::error::{AppError, AppResult, CampoInvalido};
use crate::routes::pagination::{codificar, decodificar, limite_efetivo, Pagina};
use crate::state::AppState;

fn tarefas_dir(state: &AppState) -> PathBuf {
    state.config.notes_root.join("Tarefas")
}

fn absoluto(state: &AppState, caminho_relativo: &str) -> PathBuf {
    state.config.notes_root.join(caminho_relativo)
}

#[derive(Debug, Deserialize)]
pub struct ListarQuery {
    pub pasta: Option<String>,
    pub data_de: Option<NaiveDate>,
    pub data_ate: Option<NaiveDate>,
    pub status: Option<String>,
    pub espaco: Option<String>,
    pub cursor: Option<String>,
    pub limit: Option<i64>,
}

pub async fn listar(State(state): State<AppState>, Query(q): Query<ListarQuery>) -> AppResult<Json<Pagina<serde_json::Value>>> {
    let limite = limite_efetivo(q.limit);
    let cursor = q.cursor.as_deref().and_then(decodificar);

    let linhas: Vec<serde_json::Value> = state
        .db
        .with(move |conn| {
            let mut sql = String::from(
                "SELECT id, caminho_arquivo, titulo, status, scheduled_at, duration_min, due_date, espaco, criado_em \
                 FROM tarefa",
            );
            let mut condicoes = Vec::new();
            let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

            if let Some(pasta) = &q.pasta {
                condicoes.push("COALESCE(pasta_id, '') = ?".to_string());
                params.push(Box::new(pasta.clone()));
            }
            if let Some(status) = &q.status {
                condicoes.push("status = ?".to_string());
                params.push(Box::new(status.clone()));
            }
            if let Some(espaco) = &q.espaco {
                condicoes.push("espaco = ?".to_string());
                params.push(Box::new(espaco.clone()));
            }
            if let Some(data_de) = q.data_de {
                condicoes.push("date(scheduled_at) >= date(?)".to_string());
                params.push(Box::new(data_de.to_string()));
            }
            if let Some(data_ate) = q.data_ate {
                condicoes.push("date(scheduled_at) <= date(?)".to_string());
                params.push(Box::new(data_ate.to_string()));
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
            let linhas = stmt
                .query_map(refs.as_slice(), |r| {
                    Ok(serde_json::json!({
                        "id": r.get::<_, String>(0)?,
                        "caminho_arquivo": r.get::<_, String>(1)?,
                        "titulo": r.get::<_, String>(2)?,
                        "status": r.get::<_, String>(3)?,
                        "scheduled_at": r.get::<_, Option<String>>(4)?,
                        "duration_min": r.get::<_, Option<i64>>(5)?,
                        "due_date": r.get::<_, Option<String>>(6)?,
                        "espaco": r.get::<_, String>(7)?,
                        "criado_em": r.get::<_, String>(8)?,
                    }))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await?;

    let tem_mais = linhas.len() as i64 > limite;
    let items: Vec<serde_json::Value> = if tem_mais { linhas[..limite as usize].to_vec() } else { linhas };
    let next_cursor = if tem_mais {
        items.last().and_then(|v| Some(codificar(v["criado_em"].as_str()?, v["id"].as_str()?)))
    } else {
        None
    };

    Ok(Json(Pagina { items, next_cursor }))
}

#[derive(Debug, Deserialize)]
pub struct CriarTarefaPayload {
    pub titulo: String,
    #[serde(default)]
    pub pasta: Option<String>,
    #[serde(default)]
    pub scheduled_at: Option<chrono::DateTime<Utc>>,
    #[serde(default)]
    pub duration_min: Option<i64>,
    #[serde(default)]
    pub due_date: Option<NaiveDate>,
    #[serde(default)]
    pub espaco: Option<String>,
}

pub async fn criar(State(state): State<AppState>, Json(payload): Json<CriarTarefaPayload>) -> AppResult<Json<serde_json::Value>> {
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
        Some(p) => tarefas_dir(&state).join(p),
        None => tarefas_dir(&state),
    };
    std::fs::create_dir_all(&dir)?;

    let nome_arquivo = naming::sanitizar_nome_arquivo(&payload.titulo);
    let caminho_absoluto = naming::caminho_sem_colisao(&dir, &nome_arquivo, "md");

    let fm = TarefaFrontMatter {
        id: new_id(),
        titulo: payload.titulo.clone(),
        status: TarefaStatus::Pendente,
        scheduled_at: payload.scheduled_at,
        duration_min: payload.duration_min,
        due_date: payload.due_date,
        espaco,
        evento_externo: EventoExternoRef::default(),
        criado_em: Utc::now(),
    };
    let conteudo = frontmatter::serialize(&fm, "")?;
    std::fs::write(&caminho_absoluto, conteudo)?;

    reindexar_tudo(&state.db, &state.config.notes_root).await?;

    Ok(Json(serde_json::json!({
        "id": fm.id, "tipo": "tarefa", "titulo": fm.titulo, "scheduled_at": fm.scheduled_at,
        "duration_min": fm.duration_min, "espaco": fm.espaco.to_string(), "status": "pendente",
        "criado_em": fm.criado_em,
    })))
}

async fn caminho_por_id(state: &AppState, id: &str) -> AppResult<String> {
    let id_owned = id.to_string();
    let caminho: Option<String> = state
        .db
        .with(move |conn| conn.query_row("SELECT caminho_arquivo FROM tarefa WHERE id = ?1", [&id_owned], |r| r.get(0)).optional())
        .await?;
    caminho.ok_or(AppError::new(ErrorCode::NotFound))
}

// Nota: `Option<T>` simples aqui — campo omitido = não mexe, campo presente
// (mesmo `null`) também é tratado como "não mexe" pelos tipos de data
// abaixo. Limpar `scheduled_at`/`duration_min`/`due_date` de volta pra
// `null` via PATCH fica fora desta primeira versão (exigiria um esquema de
// Option duplo dedicado); remover o agendamento por ora é recriar a Tarefa.
#[derive(Debug, Deserialize)]
pub struct AtualizarTarefaPayload {
    #[serde(default)]
    pub titulo: Option<String>,
    #[serde(default)]
    pub pasta: Option<String>,
    #[serde(default)]
    pub scheduled_at: Option<chrono::DateTime<Utc>>,
    #[serde(default)]
    pub duration_min: Option<i64>,
    #[serde(default)]
    pub due_date: Option<NaiveDate>,
}

pub async fn atualizar(State(state): State<AppState>, Path(id): Path<String>, Json(payload): Json<AtualizarTarefaPayload>) -> AppResult<Json<serde_json::Value>> {
    let caminho_relativo_atual = caminho_por_id(&state, &id).await?;
    let caminho_absoluto_atual = absoluto(&state, &caminho_relativo_atual);
    let bruto = std::fs::read_to_string(&caminho_absoluto_atual)?;
    let doc = frontmatter::parse::<TarefaFrontMatter>(&bruto)?;
    let mut fm = doc.front_matter;

    if let Some(titulo) = &payload.titulo {
        fm.titulo = titulo.clone();
    }
    if payload.scheduled_at.is_some() {
        fm.scheduled_at = payload.scheduled_at;
    }
    if payload.duration_min.is_some() {
        fm.duration_min = payload.duration_min;
    }
    if payload.due_date.is_some() {
        fm.due_date = payload.due_date;
    }

    let dir_destino = match payload.pasta.as_deref() {
        Some(p) if !p.is_empty() => tarefas_dir(&state).join(p),
        Some(_) => tarefas_dir(&state),
        None => caminho_absoluto_atual
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| tarefas_dir(&state)),
    };
    std::fs::create_dir_all(&dir_destino)?;

    let nome_arquivo = naming::sanitizar_nome_arquivo(&fm.titulo);
    let caminho_absoluto_destino = if dir_destino.join(format!("{nome_arquivo}.md")) == caminho_absoluto_atual {
        caminho_absoluto_atual.clone()
    } else {
        naming::caminho_sem_colisao(&dir_destino, &nome_arquivo, "md")
    };

    let conteudo = frontmatter::serialize(&fm, &doc.body)?;
    if caminho_absoluto_destino == caminho_absoluto_atual {
        std::fs::write(&caminho_absoluto_atual, conteudo)?;
    } else {
        std::fs::write(&caminho_absoluto_destino, conteudo)?;
        std::fs::remove_file(&caminho_absoluto_atual)?;
    }

    reindexar_tudo(&state.db, &state.config.notes_root).await?;
    Ok(Json(serde_json::json!({ "id": fm.id, "titulo": fm.titulo })))
}

#[derive(Debug, Deserialize)]
pub struct StatusPayload {
    pub status: String,
}

pub async fn atualizar_status(State(state): State<AppState>, Path(id): Path<String>, Json(payload): Json<StatusPayload>) -> AppResult<Json<serde_json::Value>> {
    let novo_status = match payload.status.as_str() {
        "pendente" => TarefaStatus::Pendente,
        "concluida" => TarefaStatus::Concluida,
        _ => {
            return Err(AppError::validation(vec![CampoInvalido {
                campo: "status".into(),
                motivo: "deve ser 'pendente' ou 'concluida'".into(),
            }]))
        }
    };
    let caminho_relativo = caminho_por_id(&state, &id).await?;
    let caminho_absoluto = absoluto(&state, &caminho_relativo);
    let bruto = std::fs::read_to_string(&caminho_absoluto)?;
    let doc = frontmatter::parse::<TarefaFrontMatter>(&bruto)?;
    let mut fm = doc.front_matter;
    fm.status = novo_status;
    let conteudo = frontmatter::serialize(&fm, &doc.body)?;
    std::fs::write(&caminho_absoluto, conteudo)?;

    reindexar_tudo(&state.db, &state.config.notes_root).await?;
    Ok(Json(serde_json::json!({ "id": fm.id, "status": payload.status })))
}

pub async fn excluir(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let caminho_relativo = caminho_por_id(&state, &id).await?;
    std::fs::remove_file(absoluto(&state, &caminho_relativo))?;
    reindexar_tudo(&state.db, &state.config.notes_root).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// --- Agenda / capacidade (seção 4.3 do handoff, contrato seção 11.6) ------

fn minutos_do_bloco(hora_inicio: &str, hora_fim: &str) -> i64 {
    let parse = |s: &str| NaiveTime::parse_from_str(s, "%H:%M").ok();
    let (Some(inicio), Some(fim)) = (parse(hora_inicio), parse(hora_fim)) else {
        return 0;
    };
    let inicio_min = inicio.num_seconds_from_midnight() as i64 / 60;
    let mut fim_min = fim.num_seconds_from_midnight() as i64 / 60;
    if fim_min <= inicio_min {
        fim_min += 24 * 60; // bloco atravessa a meia-noite (ex. sono)
    }
    fim_min - inicio_min
}

fn bloco_cobre_dia(dias_semana: &str, dia_iso: u32) -> bool {
    dias_semana == "diario" || dias_semana.split(',').any(|d| d.trim().parse::<u32>() == Ok(dia_iso))
}

#[derive(Debug, Deserialize)]
pub struct CapacidadeQuery {
    pub data: NaiveDate,
}

/// Cálculo simplificado (seção 4.3 do handoff): soma minutos por
/// classificação de bloco de rotina que cobre o dia, sem resolver
/// sobreposição minuto a minuto entre blocos/eventos/tarefas — suficiente
/// pra dar o número consolidado que o front pede, mas não é uma agenda
/// minuto-exata.
pub async fn capacidade(State(state): State<AppState>, Query(q): Query<CapacidadeQuery>) -> AppResult<Json<serde_json::Value>> {
    let dia_iso = q.data.weekday().number_from_monday();
    let data_str = q.data.to_string();

    let blocos: Vec<(String, String, String, String)> = state
        .db
        .with(|conn| {
            let mut stmt = conn.prepare("SELECT hora_inicio, hora_fim, dias_semana, classificacao FROM bloco_rotina")?;
            let linhas = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?.collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await?;

    let mut consumido_rotina_min = 0i64;
    let mut disponivel_producao_min = 0i64;
    let mut tempo_livre_min = 0i64;
    for (inicio, fim, dias, classificacao) in &blocos {
        if !bloco_cobre_dia(dias, dia_iso) {
            continue;
        }
        let minutos = minutos_do_bloco(inicio, fim);
        match classificacao.as_str() {
            "indisponivel" => consumido_rotina_min += minutos,
            "disponivel_producao" => disponivel_producao_min += minutos,
            "tempo_livre" => tempo_livre_min += minutos,
            _ => {}
        }
    }

    let consumido_eventos_externos_min: i64 = state
        .db
        .with({
            let data_str = data_str.clone();
            move |conn| {
                conn.query_row(
                    "SELECT COALESCE(SUM((strftime('%s', fim) - strftime('%s', inicio)) / 60), 0) \
                     FROM evento_externo_cache WHERE date(inicio) = date(?1)",
                    [&data_str],
                    |r| r.get(0),
                )
            }
        })
        .await?;

    let consumido_tarefas_min: i64 = state
        .db
        .with({
            let data_str = data_str.clone();
            move |conn| {
                conn.query_row(
                    "SELECT COALESCE(SUM(duration_min), 0) FROM tarefa \
                     WHERE status = 'pendente' AND date(scheduled_at) = date(?1)",
                    [&data_str],
                    |r| r.get(0),
                )
            }
        })
        .await?;

    let total_dia_min = 1440i64;
    let consumo_producao = consumido_eventos_externos_min + consumido_tarefas_min;
    let disponivel_producao_restante = disponivel_producao_min - consumo_producao;
    let estourado = disponivel_producao_restante < 0;

    Ok(Json(serde_json::json!({
        "data": q.data,
        "total_dia_min": total_dia_min,
        "consumido_rotina_min": consumido_rotina_min,
        "consumido_eventos_externos_min": consumido_eventos_externos_min,
        "consumido_tarefas_min": consumido_tarefas_min,
        "disponivel_producao_min": disponivel_producao_restante.max(0),
        "tempo_livre_min": tempo_livre_min,
        "estourado": estourado,
    })))
}
