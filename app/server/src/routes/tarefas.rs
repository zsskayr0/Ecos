//! Tarefas & Agenda (seção 11.6). Mesmo mecanismo de arquivo `.md` da Nota
//! (seção 1.3), árvore `Tarefas/` independente da de `Notas/`.

use axum::extract::{Multipart, Path, Query, State};
use axum::{Extension, Json};
use chrono::{Datelike, NaiveDate, NaiveTime, Timelike, Utc};
use ecos_core::types::{Espaco, EventoExternoRef, Subtarefa, TarefaFrontMatter, TarefaPrioridade, TarefaStatus};
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
    state.config.notes_root.join("Tarefas")
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

pub async fn criar_time_entry(State(state): State<AppState>, Path(tarefa_id): Path<String>, Json(payload): Json<CriarTimeEntryPayload>) -> AppResult<Json<serde_json::Value>> {
    if !matches!(payload.tipo.as_str(), "planejado" | "real") || payload.duracao_min <= 0 { return Err(AppError::validation(vec![CampoInvalido { campo: "time_entry".into(), motivo: "tipo ou duração inválidos".into() }])); }
    let id = new_id(); let agora = Utc::now().to_rfc3339(); let inicio = payload.inicio_em.to_rfc3339(); let fim = (payload.inicio_em + chrono::Duration::minutes(payload.duracao_min)).to_rfc3339(); let tipo = payload.tipo; let foco = payload.foco; let retorno = id.clone();
    state.db.with(move |conn| { conn.execute("INSERT INTO tarefa_time_entry(id,tarefa_id,tipo,inicio_em,fim_em,duracao_min,foco,criado_em) VALUES(?,?,?,?,?,?,?,?)", rusqlite::params![id,tarefa_id,tipo,inicio,fim,payload.duracao_min,foco,agora])?; Ok(()) }).await?;
    Ok(Json(serde_json::json!({"id": retorno})))
}

pub async fn listar(State(state): State<AppState>, Query(q): Query<ListarQuery>) -> AppResult<Json<Pagina<serde_json::Value>>> {
    let limite = limite_efetivo(q.limit);
    let cursor = q.cursor.as_deref().and_then(decodificar);

    let linhas: Vec<serde_json::Value> = state
        .db
        .with(move |conn| {
            let mut sql = String::from(
                "SELECT t.id, t.caminho_arquivo, t.titulo, t.status, t.scheduled_at, t.duration_min, t.due_date, t.espaco, \
                 t.criado_em, t.prioridade, t.criado_por, u.nome_usuario, COALESCE(t.atualizado_em, t.criado_em), t.pasta_id, \
                 (SELECT json_group_array(tag) FROM tarefa_tag WHERE tarefa_id = t.id) \
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
                condicoes.push("date(COALESCE(t.scheduled_at, t.due_date)) >= date(?)".to_string());
                params.push(Box::new(data_de.to_string()));
            }
            if let Some(data_ate) = q.data_ate {
                condicoes.push("date(COALESCE(t.scheduled_at, t.due_date)) <= date(?)".to_string());
                params.push(Box::new(data_ate.to_string()));
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
    let dir = match pasta_relativa {
        Some(p) => tarefas_dir(&state).join(p),
        None => tarefas_dir(&state),
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
    if let Some(scheduled_at) = payload.scheduled_at {
        fm.scheduled_at = scheduled_at;
    }
    if payload.duration_min.is_some() {
        fm.duration_min = payload.duration_min;
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

    fm.atualizado_em = Some(Utc::now());
    let conteudo = frontmatter::serialize(&fm, &corpo)?;
    if caminho_absoluto_destino == caminho_absoluto_atual {
        std::fs::write(&caminho_absoluto_atual, conteudo)?;
    } else {
        std::fs::write(&caminho_absoluto_destino, conteudo)?;
        std::fs::remove_file(&caminho_absoluto_atual)?;
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
    fm.status = novo_status;
    fm.atualizado_em = Some(Utc::now());
    let conteudo = frontmatter::serialize(&fm, &doc.body)?;
    std::fs::write(&caminho_absoluto, conteudo)?;

    reindexar_tudo(&state.db, &state.config.notes_root).await?;
    Ok(Json(serde_json::json!({ "id": fm.id, "status": payload.status })))
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
    let midia = crate::routes::media::enviar_para_biblioteca(&state, multipart).await?;
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
