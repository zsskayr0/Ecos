//! Tarefas & Agenda (seção 11.6). Mesmo mecanismo de arquivo `.md` da Nota
//! (seção 1.3), árvore `Tarefas/` independente da de `Notas/`.

use axum::extract::{Multipart, Path, Query, State};
use axum::{Extension, Json};
use chrono::{Datelike, NaiveDate, NaiveTime, Timelike, Utc};
use ecos_core::types::{Espaco, EventoExternoRef, Subtarefa, TarefaFrontMatter, TarefaPrioridade, TarefaStatus, TempoRegistrado, TipoTempo};
use ecos_core::{frontmatter, naming, new_id, ErrorCode};
use rusqlite::OptionalExtension;
use serde::Deserialize;
use std::path::PathBuf;

use crate::db::reindex::reindexar_tudo;
use crate::error::{AppError, AppResult, CampoInvalido};
use crate::middleware::auth_guard::UsuarioAutenticado;
use crate::routes::anexos_comuns::mime_por_extensao;
use crate::routes::pagination::{codificar, decodificar, limite_efetivo, Pagina};
use crate::state::AppState;

fn tarefas_dir(state: &AppState) -> PathBuf {
    // Só fallback: a raiz real de cada árvore depende do espaço (`espacos::raiz`).
    state.config.notes_root.join(crate::espacos::PESSOAL_DIR).join("Tarefas")
}

fn absoluto(state: &AppState, caminho_relativo: &str) -> PathBuf {
    state.config.notes_root.join(caminho_relativo)
}

/// Mesmo padrão já usado pra foto/desenho de Nota (arquitetura seção 1.3):
/// anexo é um arquivo irmão do `.md`, numa subpasta `_anexos/<id>/` — nunca
/// BLOB em banco (isso é exclusivo do Cofre). Referenciado no corpo via
/// link relativo Markdown; o backend nunca precisa entender a referência,
/// só preservar o arquivo.
fn anexos_dir(state: &AppState, tarefa_id: &str, caminho_relativo: &str) -> PathBuf {
    let pai = absoluto(state, caminho_relativo).parent().map(|p| p.to_path_buf()).unwrap_or_else(|| tarefas_dir(state));
    pai.join("_anexos").join(tarefa_id)
}

// `caminho_anexo_sem_colisao`, `mime_por_extensao`, `eh_imagem` — ver
// `routes::anexos_comuns` (compartilhado com o upload de anexo de Nota).

/// Front-matter aceita `Subtarefa` completa; o payload de entrada permite
/// `id` ausente (subtarefa nova, criada nesta chamada) — o servidor
/// preenche com `new_id()` pra manter identidade estável nas próximas
/// edições/toggles.
#[derive(Debug, Deserialize)]
pub struct SubtarefaPayload {
    #[serde(default)]
    pub id: Option<String>,
    pub titulo: String,
    #[serde(default)]
    pub concluida: bool,
}

fn subtarefas_de_payload(payload: Vec<SubtarefaPayload>) -> Vec<Subtarefa> {
    payload
        .into_iter()
        .map(|s| Subtarefa { id: s.id.unwrap_or_else(new_id), titulo: s.titulo, concluida: s.concluida })
        .collect()
}

#[derive(Debug, Deserialize)]
pub struct ListarQuery {
    pub pasta: Option<String>,
    pub data_de: Option<NaiveDate>,
    pub data_ate: Option<NaiveDate>,
    /// Intervalo (dias, no fuso `tz`) em que a Tarefa foi concluída — só devolve concluídas.
    pub concluida_de: Option<NaiveDate>,
    pub concluida_ate: Option<NaiveDate>,
    /// Fuso do cliente em minutos a leste de UTC (`scheduled_at` é UTC; sem isso o "dia" seria o dia UTC).
    pub tz: Option<i32>,
    pub status: Option<String>,
    pub espaco: Option<String>,
    pub cursor: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct CriarTimeEntryPayload { pub tipo: String, pub inicio_em: chrono::DateTime<Utc>, pub duracao_min: i64, #[serde(default)] pub foco: String }

pub async fn listar_time_entries(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<Vec<serde_json::Value>>> {
    let itens = state.db.with(move |conn| {
        let mut stmt = conn.prepare("SELECT id,tipo,inicio_em,fim_em,duracao_min,foco,criado_em FROM tarefa_time_entry WHERE tarefa_id=? ORDER BY inicio_em DESC")?;
        let rows = stmt.query_map([id], |r| Ok(serde_json::json!({
            "id": r.get::<_, String>(0)?, "tipo": r.get::<_, String>(1)?, "inicio_em": r.get::<_, String>(2)?,
            "fim_em": r.get::<_, Option<String>>(3)?, "duracao_min": r.get::<_, i64>(4)?, "foco": r.get::<_, String>(5)?, "criado_em": r.get::<_, String>(6)?
        })))?.collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }).await?;
    Ok(Json(itens))
}

fn duracao_de_tempo_valida(duracao_min: i64) -> AppResult<()> {
    if (1..=24 * 60).contains(&duracao_min) {
        Ok(())
    } else {
        Err(AppError::validation(vec![CampoInvalido { campo: "duracao_min".into(), motivo: "deve estar entre 1 e 1440 minutos".into() }]))
    }
}

/// Lê o `.md` da Tarefa, deixa `f` mexer no tempo registrado, grava e reindexa. O tempo mora no arquivo (fonte da
/// verdade): se ficasse só no índice, o `reindexar_tudo` da próxima edição de qualquer item o apagaria.
async fn editar_tempo<T>(state: &AppState, tarefa_id: &str, f: impl FnOnce(&mut Vec<TempoRegistrado>) -> AppResult<T>) -> AppResult<T> {
    let caminho_relativo = caminho_por_id(state, tarefa_id).await?;
    let caminho = absoluto(state, &caminho_relativo);
    let bruto = std::fs::read_to_string(&caminho)?;
    let doc = frontmatter::parse::<TarefaFrontMatter>(&bruto)?;
    let mut fm = doc.front_matter;
    let resultado = f(&mut fm.tempo)?;
    std::fs::write(&caminho, frontmatter::serialize(&fm, &doc.body)?)?;
    reindexar_tudo(&state.db, &state.config.notes_root).await?;
    Ok(resultado)
}

pub async fn criar_time_entry(State(state): State<AppState>, Path(tarefa_id): Path<String>, Json(payload): Json<CriarTimeEntryPayload>) -> AppResult<Json<serde_json::Value>> {
    let tipo = match payload.tipo.as_str() {
        "planejado" => TipoTempo::Planejado,
        "real" => TipoTempo::Real,
        _ => return Err(AppError::validation(vec![CampoInvalido { campo: "tipo".into(), motivo: "deve ser 'planejado' ou 'real'".into() }])),
    };
    duracao_de_tempo_valida(payload.duracao_min)?;
    let id = new_id();
    let novo = TempoRegistrado { id: id.clone(), tipo, inicio_em: payload.inicio_em, duracao_min: payload.duracao_min, foco: payload.foco, criado_em: Utc::now() };
    editar_tempo(&state, &tarefa_id, |tempo| { tempo.push(novo); Ok(()) }).await?;
    Ok(Json(serde_json::json!({ "id": id })))
}

#[derive(Debug, Deserialize)]
pub struct AtualizarTimeEntryPayload {
    #[serde(default)]
    pub inicio_em: Option<chrono::DateTime<Utc>>,
    #[serde(default)]
    pub duracao_min: Option<i64>,
    #[serde(default)]
    pub foco: Option<String>,
}

/// Move/redimensiona um bloco de tempo. Só mexe no bloco: a data da Tarefa (`scheduled_at`/`due_date`) nunca muda.
pub async fn atualizar_time_entry(State(state): State<AppState>, Path((tarefa_id, entrada_id)): Path<(String, String)>, Json(payload): Json<AtualizarTimeEntryPayload>) -> AppResult<Json<serde_json::Value>> {
    if let Some(d) = payload.duracao_min {
        duracao_de_tempo_valida(d)?;
    }
    editar_tempo(&state, &tarefa_id, |tempo| {
        let entrada = tempo.iter_mut().find(|t| t.id == entrada_id).ok_or(AppError::new(ErrorCode::NotFound))?;
        if let Some(inicio) = payload.inicio_em {
            entrada.inicio_em = inicio;
        }
        if let Some(d) = payload.duracao_min {
            entrada.duracao_min = d;
        }
        if let Some(foco) = payload.foco {
            entrada.foco = foco;
        }
        Ok(())
    })
    .await?;
    Ok(Json(serde_json::json!({ "id": entrada_id })))
}

pub async fn excluir_time_entry(State(state): State<AppState>, Path((tarefa_id, entrada_id)): Path<(String, String)>) -> AppResult<Json<serde_json::Value>> {
    editar_tempo(&state, &tarefa_id, |tempo| {
        let antes = tempo.len();
        tempo.retain(|t| t.id != entrada_id);
        if tempo.len() == antes { Err(AppError::new(ErrorCode::NotFound)) } else { Ok(()) }
    })
    .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Debug, Deserialize)]
pub struct BlocosQuery {
    pub data_de: NaiveDate,
    pub data_ate: NaiveDate,
    /// Fuso do cliente (minutos a leste de UTC), como em `ListarQuery::tz`.
    pub tz: Option<i32>,
    /// `planejado` (padrão) ou `real`.
    pub tipo: Option<String>,
}

/// Blocos de tempo (com o resumo da Tarefa dona) cujo início cai entre os dois dias, contados no fuso do cliente. É o
/// que o calendário desenha; não depende da data da Tarefa.
pub async fn listar_blocos(State(state): State<AppState>, Query(q): Query<BlocosQuery>) -> AppResult<Json<Vec<serde_json::Value>>> {
    let tz_mod = modificador_tz(q.tz);
    let tipo = if q.tipo.as_deref() == Some("real") { "real" } else { "planejado" };
    let (de, ate) = (q.data_de.to_string(), q.data_ate.to_string());
    let blocos = state
        .db
        .with(move |conn| {
            let sql = format!(
                "SELECT e.id, e.tarefa_id, e.tipo, e.inicio_em, e.duracao_min, e.foco, t.titulo, t.status, t.prioridade, t.duration_min \
                 FROM tarefa_time_entry e JOIN tarefa t ON t.id = e.tarefa_id \
                 WHERE e.tipo = ?1 AND date(datetime(e.inicio_em, '{tz_mod}')) >= date(?2) AND date(datetime(e.inicio_em, '{tz_mod}')) <= date(?3) \
                 ORDER BY e.inicio_em, e.id"
            );
            let mut stmt = conn.prepare(&sql)?;
            let linhas = stmt
                .query_map(rusqlite::params![tipo, de, ate], |r| {
                    Ok(serde_json::json!({
                        "id": r.get::<_, String>(0)?, "tarefa_id": r.get::<_, String>(1)?, "tipo": r.get::<_, String>(2)?,
                        "inicio_em": r.get::<_, String>(3)?, "duracao_min": r.get::<_, i64>(4)?, "foco": r.get::<_, String>(5)?,
                        "titulo": r.get::<_, String>(6)?, "status": r.get::<_, String>(7)?, "prioridade": r.get::<_, String>(8)?,
                        "tarefa_duration_min": r.get::<_, Option<i64>>(9)?,
                    }))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await?;
    Ok(Json(blocos))
}

pub async fn listar(State(state): State<AppState>, Query(q): Query<ListarQuery>) -> AppResult<Json<Pagina<serde_json::Value>>> {
    let limite = limite_efetivo(q.limit);
    let cursor = q.cursor.as_deref().and_then(decodificar);
    let tz_mod = modificador_tz(q.tz);

    let linhas: Vec<serde_json::Value> = state
        .db
        .with(move |conn| {
            let mut sql = String::from(
                "SELECT t.id, t.caminho_arquivo, t.titulo, t.status, t.scheduled_at, t.duration_min, t.due_date, t.espaco, \
                 t.criado_em, t.prioridade, t.criado_por, u.nome_usuario, COALESCE(t.atualizado_em, t.criado_em), t.pasta_id, \
                 (SELECT json_group_array(tag) FROM tarefa_tag WHERE tarefa_id = t.id), t.concluida_em \
                 FROM tarefa t LEFT JOIN usuario u ON u.id = t.criado_por",
            );
            let mut condicoes = Vec::new();
            let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

            if let Some(pasta) = &q.pasta {
                condicoes.push("COALESCE(t.pasta_id, '') = ?".to_string());
                params.push(Box::new(pasta.clone()));
            }
            if let Some(status) = &q.status {
                condicoes.push("t.status = ?".to_string());
                params.push(Box::new(status.clone()));
            }
            if let Some(espaco) = &q.espaco {
                condicoes.push("t.espaco = ?".to_string());
                params.push(Box::new(espaco.clone()));
            }
            if let Some(data_de) = q.data_de {
                condicoes.push(format!("COALESCE(date(datetime(t.scheduled_at, '{tz_mod}')), date(t.due_date)) >= date(?)"));
                params.push(Box::new(data_de.to_string()));
            }
            if let Some(data_ate) = q.data_ate {
                condicoes.push(format!("COALESCE(date(datetime(t.scheduled_at, '{tz_mod}')), date(t.due_date)) <= date(?)"));
                params.push(Box::new(data_ate.to_string()));
            }
            if let Some(de) = q.concluida_de {
                condicoes.push(format!("date(datetime(t.concluida_em, '{tz_mod}')) >= date(?)"));
                params.push(Box::new(de.to_string()));
            }
            if let Some(ate) = q.concluida_ate {
                condicoes.push(format!("date(datetime(t.concluida_em, '{tz_mod}')) <= date(?)"));
                params.push(Box::new(ate.to_string()));
            }
            if let Some(c) = &cursor {
                condicoes.push("(t.criado_em, t.id) < (?, ?)".to_string());
                params.push(Box::new(c.valor_ordenacao.clone()));
                params.push(Box::new(c.id.clone()));
            }
            if !condicoes.is_empty() {
                sql.push_str(" WHERE ");
                sql.push_str(&condicoes.join(" AND "));
            }
            sql.push_str(" ORDER BY t.criado_em DESC, t.id DESC LIMIT ?");
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
                        "prioridade": r.get::<_, String>(9)?,
                        "criado_por": r.get::<_, Option<String>>(10)?,
                        "criado_por_nome": r.get::<_, Option<String>>(11)?,
                        "atualizado_em": r.get::<_, String>(12)?,
                        "pasta": r.get::<_, Option<String>>(13)?,
                        "tags": serde_json::from_str::<Vec<String>>(&r.get::<_, String>(14)?).unwrap_or_default(),
                        "concluida_em": r.get::<_, Option<String>>(15)?,
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
    pub corpo: Option<String>,
    #[serde(default)]
    pub pasta: Option<String>,
    #[serde(default)]
    pub scheduled_at: Option<chrono::DateTime<Utc>>,
    #[serde(default)]
    pub duration_min: Option<i64>,
    #[serde(default)]
    pub due_date: Option<NaiveDate>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub prioridade: Option<TarefaPrioridade>,
    #[serde(default)]
    pub subtarefas: Vec<SubtarefaPayload>,
    #[serde(default)]
    pub espaco: Option<String>,
}

pub async fn criar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Json(payload): Json<CriarTarefaPayload>) -> AppResult<Json<serde_json::Value>> {
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
    let raiz = crate::espacos::raiz(&state, &espaco.to_string(), "Tarefas").await?;
    let dir = match pasta_relativa {
        Some(p) => raiz.join(p),
        None => raiz,
    };
    std::fs::create_dir_all(&dir)?;

    let nome_arquivo = naming::sanitizar_nome_arquivo(&payload.titulo);
    let caminho_absoluto = naming::caminho_sem_colisao(&dir, &nome_arquivo, "md");

    let agora = Utc::now();
    let fm = TarefaFrontMatter {
        id: new_id(),
        titulo: payload.titulo.clone(),
        status: TarefaStatus::Pendente,
        scheduled_at: payload.scheduled_at,
        duration_min: Some(payload.duration_min.unwrap_or(5)),
        due_date: payload.due_date,
        tags: payload.tags,
        prioridade: payload.prioridade.unwrap_or(TarefaPrioridade::Baixa),
        subtarefas: subtarefas_de_payload(payload.subtarefas),
        espaco,
        evento_externo: EventoExternoRef::default(),
        criado_em: agora,
        atualizado_em: Some(agora),
        tempo: Vec::new(),
        concluida_em: None,
        criado_por: Some(usuario.0.clone()),
    };
    let conteudo = frontmatter::serialize(&fm, payload.corpo.as_deref().unwrap_or(""))?;
    std::fs::write(&caminho_absoluto, conteudo)?;

    reindexar_tudo(&state.db, &state.config.notes_root).await?;

    Ok(Json(serde_json::json!({
        "id": fm.id, "tipo": "tarefa", "titulo": fm.titulo, "scheduled_at": fm.scheduled_at,
        "duration_min": fm.duration_min, "espaco": fm.espaco.to_string(), "status": "pendente",
        "prioridade": fm.prioridade, "criado_em": fm.criado_em, "atualizado_em": fm.atualizado_em,
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

/// GAP-11 fechada: antes não existia `GET /tarefas/:id`, só a varredura de
/// `listar` no cliente. Mesma forma de `notas::obter` — lê o `.md` direto,
/// devolve front-matter inteiro + corpo.
pub async fn obter(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let caminho_relativo = caminho_por_id(&state, &id).await?;
    let bruto = std::fs::read_to_string(absoluto(&state, &caminho_relativo))?;
    let doc = frontmatter::parse::<TarefaFrontMatter>(&bruto)?;
    let fm = doc.front_matter;
    let pasta = pasta_relativa_do_caminho(&caminho_relativo);
    Ok(Json(serde_json::json!({
        "id": fm.id,
        "titulo": fm.titulo,
        "status": fm.status,
        "scheduled_at": fm.scheduled_at,
        "duration_min": fm.duration_min,
        "due_date": fm.due_date,
        "tags": fm.tags,
        "prioridade": fm.prioridade,
        "subtarefas": fm.subtarefas,
        "espaco": fm.espaco.to_string(),
        "criado_em": fm.criado_em,
        "atualizado_em": fm.atualizado_em.unwrap_or(fm.criado_em),
        "concluida_em": fm.concluida_em,
        "caminho_arquivo": caminho_relativo,
        "pasta": pasta,
        "corpo": doc.body,
    })))
}

/// `Tarefas/<pasta.../>arquivo.md` -> `Some("pasta...")`; raiz -> `None`.
fn pasta_relativa_do_caminho(caminho_relativo: &str) -> Option<String> {
    let sem_raiz = caminho_relativo.strip_prefix("Tarefas/")?;
    let pai = sem_raiz.rsplit_once('/')?.0;
    Some(pai.to_string())
}

// Omitted property preserves the value; explicit null clears it.
fn nullable_patch<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

#[cfg(test)]
mod nullable_task_dates_tests {
    use super::AtualizarTarefaPayload;

    #[test]
    fn omitted_dates_are_preserved_and_null_dates_are_cleared() {
        let omitted: AtualizarTarefaPayload = serde_json::from_str(r#"{}"#).unwrap();
        assert!(omitted.scheduled_at.is_none());
        assert!(omitted.due_date.is_none());
        let clear: AtualizarTarefaPayload = serde_json::from_str(r#"{"scheduled_at":null,"due_date":null}"#).unwrap();
        assert_eq!(clear.scheduled_at, Some(None));
        assert_eq!(clear.due_date, Some(None));
    }

    #[test]
    fn explicit_dates_are_deserialized_and_invalid_values_are_rejected() {
        let set: AtualizarTarefaPayload = serde_json::from_str(r#"{"scheduled_at":"2026-09-20T12:00:00Z","due_date":"2026-09-20"}"#).unwrap();
        assert!(set.scheduled_at.unwrap().is_some());
        assert_eq!(set.due_date.unwrap().unwrap().to_string(), "2026-09-20");
        assert!(serde_json::from_str::<AtualizarTarefaPayload>(r#"{"due_date":"not-a-date"}"#).is_err());
    }
}

#[derive(Debug, Deserialize)]
pub struct AtualizarTarefaPayload {
    #[serde(default)]
    pub titulo: Option<String>,
    #[serde(default)]
    pub pasta: Option<String>,
    #[serde(default)]
    pub espaco: Option<String>,
    #[serde(default, deserialize_with = "nullable_patch")]
    pub scheduled_at: Option<Option<chrono::DateTime<Utc>>>,
    #[serde(default)]
    pub duration_min: Option<i64>,
    #[serde(default, deserialize_with = "nullable_patch")]
    pub due_date: Option<Option<NaiveDate>>,
    #[serde(default)]
    pub corpo: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub prioridade: Option<TarefaPrioridade>,
    #[serde(default)]
    pub subtarefas: Option<Vec<SubtarefaPayload>>,
}

pub async fn atualizar(State(state): State<AppState>, Path(id): Path<String>, Json(payload): Json<AtualizarTarefaPayload>) -> AppResult<Json<serde_json::Value>> {
    let caminho_relativo_atual = caminho_por_id(&state, &id).await?;
    let caminho_absoluto_atual = absoluto(&state, &caminho_relativo_atual);
    let bruto = std::fs::read_to_string(&caminho_absoluto_atual)?;
    let doc = frontmatter::parse::<TarefaFrontMatter>(&bruto)?;
    let mut fm = doc.front_matter;
    let mut corpo = doc.body;

    if let Some(titulo) = &payload.titulo {
        fm.titulo = titulo.clone();
    }
    let espaco_antes = fm.espaco.to_string();
    if let Some(espaco) = payload.espaco {
        fm.espaco = espaco.parse().map_err(|motivo: String| AppError::validation(vec![CampoInvalido { campo: "espaco".into(), motivo }]))?;
    }
    if let Some(scheduled_at) = payload.scheduled_at {
        fm.scheduled_at = scheduled_at;
    }
    if let Some(duracao) = payload.duration_min {
        // A Agenda redimensiona tarefas no arrasto: uma duração de 0 ou negativa nunca é uma edição válida.
        if !(1..=24 * 60).contains(&duracao) {
            return Err(AppError::validation(vec![CampoInvalido { campo: "duration_min".into(), motivo: "deve estar entre 1 e 1440 minutos".into() }]));
        }
        fm.duration_min = Some(duracao);
    }
    if let Some(due_date) = payload.due_date {
        fm.due_date = due_date;
    }
    if let Some(tags) = payload.tags {
        fm.tags = tags;
    }
    if let Some(prioridade) = payload.prioridade {
        fm.prioridade = prioridade;
    }
    if let Some(subtarefas) = payload.subtarefas {
        fm.subtarefas = subtarefas_de_payload(subtarefas);
    }
    if let Some(novo_corpo) = payload.corpo {
        corpo = novo_corpo;
    }

    // Trocar de espaço move o arquivo para a árvore do novo espaço (a pasta antiga não existe lá).
    let raiz_destino = crate::espacos::raiz(&state, &fm.espaco.to_string(), "Tarefas").await?;
    let dir_destino = match payload.pasta.as_deref() {
        Some(p) if !p.is_empty() => raiz_destino.join(p),
        Some(_) => raiz_destino.clone(),
        None if fm.espaco.to_string() != espaco_antes => raiz_destino.clone(),
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

    fm.atualizado_em = Some(Utc::now());
    let conteudo = frontmatter::serialize(&fm, &corpo)?;
    if caminho_absoluto_destino == caminho_absoluto_atual {
        std::fs::write(&caminho_absoluto_atual, conteudo)?;
    } else {
        std::fs::write(&caminho_absoluto_destino, conteudo)?;
        std::fs::remove_file(&caminho_absoluto_atual)?;
        // A biblioteca de mídia é por espaço: o que o corpo referencia vai junto para o novo espaço.
        if fm.espaco.to_string() != espaco_antes {
            if let Err(err) = crate::espacos::levar_midia(&state.config.notes_root, &corpo, &espaco_antes, &fm.espaco.to_string()) {
                tracing::warn!(error = %err, "não foi possível levar a mídia para o novo espaço");
            }
        }
        // A Tarefa mudou de pasta — seus anexos são arquivos irmãos do
        // `.md` (`_anexos/<id>/`, ver `anexos_dir`); sem mover essa pasta
        // junto, os links Markdown no corpo continuariam válidos por
        // caminho relativo *desde que* `_anexos` se mova com ela — então
        // ela precisa ir junto, ou os links quebram.
        let anexos_origem = anexos_dir(&state, &fm.id, &caminho_relativo_atual);
        if anexos_origem.is_dir() {
            let caminho_relativo_destino = caminho_absoluto_destino.strip_prefix(&state.config.notes_root).unwrap_or(&caminho_absoluto_destino).to_string_lossy().replace('\\', "/");
            let anexos_destino = anexos_dir(&state, &fm.id, &caminho_relativo_destino);
            if let Some(pai) = anexos_destino.parent() {
                std::fs::create_dir_all(pai)?;
            }
            std::fs::rename(&anexos_origem, &anexos_destino)?;
        }
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
    fm.definir_status(novo_status, Utc::now());
    let conteudo = frontmatter::serialize(&fm, &doc.body)?;
    std::fs::write(&caminho_absoluto, conteudo)?;

    reindexar_tudo(&state.db, &state.config.notes_root).await?;
    Ok(Json(serde_json::json!({ "id": fm.id, "status": payload.status, "concluida_em": fm.concluida_em })))
}

pub async fn excluir(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let caminho_relativo = caminho_por_id(&state, &id).await?;
    let bruto = std::fs::read_to_string(absoluto(&state, &caminho_relativo))?;
    let doc = frontmatter::parse::<TarefaFrontMatter>(&bruto)?;
    let dir_anexos = anexos_dir(&state, &id, &caminho_relativo);
    crate::routes::lixeira::mover(&state, &caminho_relativo, "tarefa", &doc.front_matter.titulo, &dir_anexos)?;
    reindexar_tudo(&state.db, &state.config.notes_root).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// --- Anexos: ativos globais em `src/Media`, por link Markdown ------------

/// Upload real (`multipart/form-data`, campo `arquivo`) — grava o arquivo
/// na biblioteca `src/Media/AAAA-MM/` e devolve o corpo já com a referência Markdown
/// anexada ao final, pra o cliente atualizar o editor sem um segundo round
/// trip. O `.md` nunca sabe que a referência existe além disso: é texto
/// comum, editável/removível como qualquer outra linha do corpo.
pub async fn enviar_anexo(State(state): State<AppState>, Path(id): Path<String>, multipart: Multipart) -> AppResult<Json<serde_json::Value>> {
    let caminho_relativo = caminho_por_id(&state, &id).await?;
    // A mídia vai para a biblioteca do espaço onde o item mora.
    let espaco = crate::espacos::espaco_do_caminho(&state.config.notes_root, &caminho_relativo).unwrap_or_else(|| "pessoal".to_string());
    let midia = crate::routes::media::enviar_para_biblioteca(&state, &espaco, multipart).await?;
    let referencia_relativa = midia.caminho;
    let bruto = std::fs::read_to_string(absoluto(&state, &caminho_relativo))?;
    let doc = frontmatter::parse::<TarefaFrontMatter>(&bruto)?;
    let fm = doc.front_matter;
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
pub async fn obter_anexo(
    State(state): State<AppState>,
    Path((id, nome_arquivo)): Path<(String, String)>,
) -> AppResult<([(axum::http::HeaderName, String); 1], Vec<u8>)> {
    let caminho_relativo = caminho_por_id(&state, &id).await?;
    let caminho = anexos_dir(&state, &id, &caminho_relativo).join(&nome_arquivo);
    if !caminho.is_file() {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    let bytes = std::fs::read(&caminho)?;
    Ok(([(axum::http::header::CONTENT_TYPE, mime_por_extensao(&nome_arquivo).to_string())], bytes))
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

/// Modificador do SQLite (`+N minutes`) — só entra número inteiro, então é seguro interpolar.
fn modificador_tz(tz: Option<i32>) -> String {
    format!("{:+} minutes", tz.unwrap_or(0).clamp(-14 * 60, 14 * 60))
}

fn bloco_cobre_dia(dias_semana: &str, dia_iso: u32) -> bool {
    dias_semana == "diario" || dias_semana.split(',').any(|d| d.trim().parse::<u32>() == Ok(dia_iso))
}

#[derive(Debug, Deserialize)]
pub struct CapacidadeQuery {
    pub data: NaiveDate,
    /// Ver `ListarQuery::tz`.
    pub tz: Option<i32>,
}

/// Cálculo simplificado (seção 4.3 do handoff): soma minutos por
/// classificação de bloco de rotina que cobre o dia, sem resolver
/// sobreposição minuto a minuto entre blocos/eventos/tarefas — suficiente
/// pra dar o número consolidado que o front pede, mas não é uma agenda
/// minuto-exata.
pub async fn capacidade(State(state): State<AppState>, Query(q): Query<CapacidadeQuery>) -> AppResult<Json<serde_json::Value>> {
    let dia_iso = q.data.weekday().number_from_monday();
    let data_str = q.data.to_string();
    let tz_mod = modificador_tz(q.tz);

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
            let tz_mod = tz_mod.clone();
            move |conn| {
                conn.query_row(
                    &format!("SELECT COALESCE(SUM((strftime('%s', fim) - strftime('%s', inicio)) / 60), 0) \
                     FROM evento_externo_cache WHERE date(datetime(inicio, '{tz_mod}')) = date(?1)"),
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
            let tz_mod = tz_mod.clone();
            move |conn| {
                conn.query_row(
                    &format!("SELECT COALESCE(SUM(duration_min), 0) FROM tarefa \
                     WHERE status = 'pendente' AND date(datetime(scheduled_at, '{tz_mod}')) = date(?1)"),
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
        "disponivel_producao_total_min": disponivel_producao_min,
        "tempo_livre_min": tempo_livre_min,
        "estourado": estourado,
    })))
}

#[cfg(test)]
mod testes_agenda_mover_e_redimensionar {
    use crate::{auth::session, config::{Ambiente, Config}, db::IndexDb, state::AppState};
    use axum::{body::{to_bytes, Body}, http::{Request, StatusCode}, Router};
    use ecos_core::new_id;
    use std::sync::{Arc, Mutex};
    use tower::Service;

    async fn chamar(app: &Router, metodo: &str, uri: &str, token: &str, corpo: Option<serde_json::Value>) -> (StatusCode, serde_json::Value) {
        let mut pedido = Request::builder().method(metodo).uri(uri).header("authorization", format!("Bearer {token}"));
        let corpo = match corpo {
            Some(c) => { pedido = pedido.header("content-type", "application/json"); Body::from(c.to_string()) }
            None => Body::empty(),
        };
        let resposta = app.clone().call(pedido.body(corpo).unwrap()).await.unwrap();
        let status = resposta.status();
        let bytes = to_bytes(resposta.into_body(), 1024 * 1024).await.unwrap();
        (status, serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null))
    }

    async fn app_de_teste() -> (Router, String, std::path::PathBuf) {
        let temp = std::env::temp_dir().join(format!("ecos-agenda-test-{}", new_id()));
        std::fs::create_dir_all(&temp).unwrap();
        let segredo = b"segredo-efemero-exclusivo-do-teste-de-agenda".to_vec();
        let state = AppState {
            db: IndexDb::open(&temp.join("index.db")).unwrap(),
            config: Arc::new(Config {
                ambiente: Ambiente::Desenvolvimento, porta: 0, notes_root: temp.clone(), index_db_path: temp.join("index.db"),
                vault_enabled: false, vault_internal_url: String::new(), session_secret: segredo.clone(), ranking_interval_secs: 300,
                static_dir: None, cookie_secure: false, google: None,
            }),
            http: reqwest::Client::new(), pareamentos: Arc::new(Mutex::new(Default::default())),
        };
        state.db.with(|conn| {
            conn.execute("INSERT INTO usuario (id, nome_usuario, senha_hash, recovery_key_hash) VALUES ('usuario-teste', 'teste', 'efemero', 'efemero')", [])?;
            Ok(())
        }).await.unwrap();
        let token = session::emitir_access_token("usuario-teste", &segredo).unwrap();
        (crate::routes::montar(state), token, temp)
    }

    async fn obter(app: &Router, token: &str, id: &str) -> serde_json::Value {
        let (status, corpo) = chamar(app, "GET", &format!("/api/v1/tarefas/{id}"), token, None).await;
        assert_eq!(status, StatusCode::OK);
        corpo
    }

    async fn ids_do_dia(app: &Router, token: &str, dia: &str, tz: i32) -> Vec<String> {
        let (status, corpo) = chamar(app, "GET", &format!("/api/v1/tarefas?data_de={dia}&data_ate={dia}&tz={tz}&limit=100"), token, None).await;
        assert_eq!(status, StatusCode::OK);
        corpo["items"].as_array().unwrap().iter().map(|t| t["id"].as_str().unwrap().to_string()).collect()
    }

    #[tokio::test]
    async fn mover_entre_dias_dia_inteiro_e_redimensionar_persistem_sem_mexer_no_que_nao_foi_pedido() {
        let (app, token, raiz) = app_de_teste().await;
        let (status, criada) = chamar(&app, "POST", "/api/v1/tarefas", &token, Some(serde_json::json!({
            "titulo": "Reunião", "scheduled_at": "2026-09-21T13:00:00Z", "duration_min": 45, "due_date": "2026-09-30"
        }))).await;
        assert_eq!(status, StatusCode::OK);
        let id = criada["id"].as_str().unwrap().to_string();
        let patch = |corpo: serde_json::Value| { let (app, token, id) = (app.clone(), token.clone(), id.clone()); async move { chamar(&app, "PATCH", &format!("/api/v1/tarefas/{id}"), &token, Some(corpo)).await } };

        // 1) Mover para outro dia (só scheduled_at): a duração e o prazo NÃO mudam.
        let (status, _) = patch(serde_json::json!({ "scheduled_at": "2026-09-23T13:00:00Z" })).await;
        assert_eq!(status, StatusCode::OK);
        let t = obter(&app, &token, &id).await;
        assert_eq!(t["scheduled_at"], "2026-09-23T13:00:00Z");
        assert_eq!(t["duration_min"], 45, "mover entre dias não pode alterar a duração");
        assert_eq!(t["due_date"], "2026-09-30", "mover o bloco não move o prazo");
        assert!(ids_do_dia(&app, &token, "2026-09-23", -180).await.contains(&id));
        assert!(!ids_do_dia(&app, &token, "2026-09-21", -180).await.contains(&id));

        // 2) Para o "dia todo": some o horário, a data (única) vira o dia novo, duração intacta.
        let (status, _) = patch(serde_json::json!({ "scheduled_at": null, "due_date": "2026-09-24" })).await;
        assert_eq!(status, StatusCode::OK);
        let t = obter(&app, &token, &id).await;
        assert!(t["scheduled_at"].is_null());
        assert_eq!(t["due_date"], "2026-09-24");
        assert_eq!(t["duration_min"], 45);
        assert!(ids_do_dia(&app, &token, "2026-09-24", -180).await.contains(&id));

        // 3) Do dia todo para um horário — 23:30 em Brasília (UTC-3) já é o dia 25 em UTC.
        let (status, _) = patch(serde_json::json!({ "scheduled_at": "2026-09-25T02:30:00Z", "due_date": "2026-09-24" })).await;
        assert_eq!(status, StatusCode::OK);
        assert!(ids_do_dia(&app, &token, "2026-09-24", -180).await.contains(&id), "no fuso do cliente (UTC-3) é dia 24");
        assert!(!ids_do_dia(&app, &token, "2026-09-25", -180).await.contains(&id));
        assert!(ids_do_dia(&app, &token, "2026-09-25", 0).await.contains(&id), "em UTC o mesmo instante é dia 25");

        // 4) Redimensionar: só duration_min muda; o horário fica.
        let (status, _) = patch(serde_json::json!({ "duration_min": 90 })).await;
        assert_eq!(status, StatusCode::OK);
        let t = obter(&app, &token, &id).await;
        assert_eq!(t["duration_min"], 90);
        assert_eq!(t["scheduled_at"], "2026-09-25T02:30:00Z");

        // 5) Duração inválida é recusada e nada muda.
        for invalida in [0, -15, 1441] {
            let (status, _) = patch(serde_json::json!({ "duration_min": invalida })).await;
            assert!(status.is_client_error(), "duração {invalida} deveria ser recusada, veio {status}");
        }
        assert_eq!(obter(&app, &token, &id).await["duration_min"], 90);

        // 6) Persistiu de verdade no arquivo `.md` (fonte da verdade), não só na memória/índice.
        let arquivo = walkdir::WalkDir::new(raiz.join("Pessoal").join("Tarefas")).into_iter().filter_map(Result::ok).find(|e| e.path().extension().map_or(false, |x| x == "md")).unwrap();
        let conteudo = std::fs::read_to_string(arquivo.path()).unwrap();
        assert!(conteudo.contains("duration_min: 90"), "front matter: {conteudo}");
        assert!(conteudo.contains("2026-09-25T02:30:00"), "front matter: {conteudo}");
        let _ = std::fs::remove_dir_all(&raiz);
    }

    async fn blocos(app: &Router, token: &str, dia: &str, tz: i32) -> Vec<serde_json::Value> {
        let (status, corpo) = chamar(app, "GET", &format!("/api/v1/agenda/blocos?data_de={dia}&data_ate={dia}&tz={tz}"), token, None).await;
        assert_eq!(status, StatusCode::OK);
        corpo.as_array().unwrap().clone()
    }

    #[tokio::test]
    async fn blocos_de_tempo_persistem_sobrevivem_ao_reindex_e_nunca_mudam_a_data_da_tarefa() {
        let (app, token, raiz) = app_de_teste().await;
        let (_, criada) = chamar(&app, "POST", "/api/v1/tarefas", &token, Some(serde_json::json!({
            "titulo": "Escrever relatório", "scheduled_at": "2026-09-30T12:00:00Z", "due_date": "2026-10-05", "duration_min": 45
        }))).await;
        let id = criada["id"].as_str().unwrap().to_string();
        let url = format!("/api/v1/tarefas/{id}/time-entries");

        // 1) Alocar tempo: 22/09 às 10:00 (Brasília), 45 min.
        let (status, bloco) = chamar(&app, "POST", &url, &token, Some(serde_json::json!({ "tipo": "planejado", "inicio_em": "2026-09-22T13:00:00Z", "duracao_min": 45 }))).await;
        assert_eq!(status, StatusCode::OK);
        let bloco_id = bloco["id"].as_str().unwrap().to_string();

        // 2) O defeito antigo: qualquer outra edição reindexava tudo e apagava o bloco. Agora ele sobrevive.
        chamar(&app, "POST", "/api/v1/tarefas", &token, Some(serde_json::json!({ "titulo": "Outra tarefa qualquer" }))).await;
        chamar(&app, "POST", "/api/v1/notas", &token, Some(serde_json::json!({ "titulo": "Uma nota" }))).await;
        let (_, lista) = chamar(&app, "GET", &url, &token, None).await;
        assert_eq!(lista.as_array().unwrap().len(), 1, "o bloco sumiu depois de outra edição");

        // 3) O calendário lê os blocos por dia no fuso do cliente.
        let do_dia = blocos(&app, &token, "2026-09-22", -180).await;
        assert_eq!(do_dia.len(), 1);
        assert_eq!(do_dia[0]["titulo"], "Escrever relatório");
        assert_eq!(do_dia[0]["duracao_min"], 45);
        assert!(blocos(&app, &token, "2026-09-23", -180).await.is_empty());

        // 4) Mover o bloco: só o início muda; a duração fica e a data da Tarefa NÃO é tocada.
        let (status, _) = chamar(&app, "PATCH", &format!("{url}/{bloco_id}"), &token, Some(serde_json::json!({ "inicio_em": "2026-09-24T18:00:00Z" }))).await;
        assert_eq!(status, StatusCode::OK);
        let movido = blocos(&app, &token, "2026-09-24", -180).await;
        assert_eq!(movido.len(), 1);
        assert_eq!(movido[0]["duracao_min"], 45, "mover não pode alterar a duração");
        assert!(blocos(&app, &token, "2026-09-22", -180).await.is_empty());

        // 5) Redimensionar: só a duração muda.
        chamar(&app, "PATCH", &format!("{url}/{bloco_id}"), &token, Some(serde_json::json!({ "duracao_min": 90 }))).await;
        let redim = blocos(&app, &token, "2026-09-24", -180).await;
        assert_eq!(redim[0]["duracao_min"], 90);
        assert_eq!(redim[0]["inicio_em"].as_str().unwrap().replace("+00:00", "Z"), "2026-09-24T18:00:00Z");

        // 6) Fuso: 22:30 em Brasília do dia 22 já é dia 23 em UTC.
        let (_, noite) = chamar(&app, "POST", &url, &token, Some(serde_json::json!({ "tipo": "planejado", "inicio_em": "2026-09-23T01:30:00Z", "duracao_min": 30 }))).await;
        assert_eq!(blocos(&app, &token, "2026-09-22", -180).await.len(), 1, "no fuso do cliente (UTC-3) é dia 22");
        assert_eq!(blocos(&app, &token, "2026-09-23", 0).await.len(), 1, "em UTC o mesmo instante é dia 23");
        let noite_id = noite["id"].as_str().unwrap().to_string();

        // 7) Valores inválidos são recusados (criar e atualizar) e bloco inexistente dá 404.
        for invalida in [0, -5, 1441] {
            let (s1, _) = chamar(&app, "POST", &url, &token, Some(serde_json::json!({ "tipo": "planejado", "inicio_em": "2026-09-22T13:00:00Z", "duracao_min": invalida }))).await;
            let (s2, _) = chamar(&app, "PATCH", &format!("{url}/{bloco_id}"), &token, Some(serde_json::json!({ "duracao_min": invalida }))).await;
            assert!(s1.is_client_error() && s2.is_client_error(), "duração {invalida} deveria ser recusada");
        }
        let (status, _) = chamar(&app, "PATCH", &format!("{url}/nao-existe"), &token, Some(serde_json::json!({ "duracao_min": 30 }))).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(blocos(&app, &token, "2026-09-24", -180).await[0]["duracao_min"], 90);

        // 8) Nada disso mexeu na data nem na duração da própria Tarefa.
        let t = obter(&app, &token, &id).await;
        assert_eq!(t["scheduled_at"], "2026-09-30T12:00:00Z");
        assert_eq!(t["due_date"], "2026-10-05");
        assert_eq!(t["duration_min"], 45);

        // 9) Persistiu no `.md` (a fonte da verdade), não só no índice.
        let arquivo = walkdir::WalkDir::new(raiz.join("Pessoal").join("Tarefas")).into_iter().filter_map(Result::ok)
            .find(|e| std::fs::read_to_string(e.path()).map_or(false, |c| c.contains("Escrever relatório"))).unwrap();
        let conteudo = std::fs::read_to_string(arquivo.path()).unwrap();
        assert!(conteudo.contains("planejado") && conteudo.contains("duracao_min: 90"), "front matter: {conteudo}");

        // 10) Remover o bloco não apaga a Tarefa; remover de novo dá 404.
        let (status, _) = chamar(&app, "DELETE", &format!("{url}/{noite_id}"), &token, None).await;
        assert_eq!(status, StatusCode::OK);
        let (status, _) = chamar(&app, "DELETE", &format!("{url}/{noite_id}"), &token, None).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(obter(&app, &token, &id).await["titulo"], "Escrever relatório");

        // 11) Apagar a Tarefa leva os blocos dela junto (o calendário não fica com bloco órfão).
        let (status, _) = chamar(&app, "DELETE", &format!("/api/v1/tarefas/{id}"), &token, None).await;
        assert_eq!(status, StatusCode::OK);
        assert!(blocos(&app, &token, "2026-09-24", -180).await.is_empty());
        let _ = std::fs::remove_dir_all(&raiz);
    }
}
