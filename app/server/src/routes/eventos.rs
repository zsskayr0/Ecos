//! Eventos de calendário e categorias. Cada evento é um `.md` em `<espaço>/Eventos/` (fonte da verdade; o corpo é a
//! descrição) e a tabela `evento` é só índice. Eventos `privado` nunca saem do Ecos; os `google` ficam com
//! `sync_pendente` até o job de sincronização enviá-los.

use axum::extract::{Path, Query, State};
use axum::{Extension, Json};
use chrono::{DateTime, Utc};
use ecos_core::types::{CategoriaEvento, Espaco, EventoFrontMatter, EventoVisibilidade, Excecao, GoogleRef};
use ecos_core::{frontmatter, naming, new_id, ErrorCode};
use rusqlite::OptionalExtension;
use serde::Deserialize;
use std::path::PathBuf;

use crate::db::reindex::reindexar_tudo;
use crate::error::{AppError, AppResult, CampoInvalido};
use crate::eventos_fs;
use crate::middleware::auth_guard::UsuarioAutenticado;
use crate::state::AppState;

const LIMITE_PADRAO: i64 = 500;
const LIMITE_MAXIMO: i64 = 2000;

fn invalido(campo: &str, motivo: &str) -> AppError {
    AppError::validation(vec![CampoInvalido { campo: campo.into(), motivo: motivo.into() }])
}

// Omitted property preserves the value; explicit null clears it.
fn nullable_patch<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

fn absoluto(state: &AppState, relativo: &str) -> PathBuf {
    state.config.notes_root.join(relativo)
}

fn vazio_para_none(valor: Option<String>) -> Option<String> {
    valor.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

fn validar_campos(titulo: &str, inicio: DateTime<Utc>, fim: DateTime<Utc>, local: Option<&str>, rrule: Option<&str>) -> AppResult<()> {
    let mut campos = Vec::new();
    if titulo.trim().is_empty() {
        campos.push(CampoInvalido { campo: "titulo".into(), motivo: "não pode ser vazio".into() });
    } else if titulo.chars().count() > 300 {
        campos.push(CampoInvalido { campo: "titulo".into(), motivo: "máximo de 300 caracteres".into() });
    }
    if fim <= inicio {
        campos.push(CampoInvalido { campo: "fim".into(), motivo: "deve ser depois do início".into() });
    }
    if local.is_some_and(|l| l.chars().count() > 300) {
        campos.push(CampoInvalido { campo: "local".into(), motivo: "máximo de 300 caracteres".into() });
    }
    if let Some(r) = rrule {
        if !r.starts_with("RRULE:") || !r.contains("FREQ=") || r.len() > 500 || r.contains('\n') {
            campos.push(CampoInvalido { campo: "rrule".into(), motivo: "esperado 'RRULE:FREQ=...' (RFC 5545)".into() });
        }
    }
    if campos.is_empty() { Ok(()) } else { Err(AppError::validation(campos)) }
}

fn cor_valida(cor: &str) -> bool {
    cor.len() == 7 && cor.starts_with('#') && cor[1..].chars().all(|c| c.is_ascii_hexdigit())
}

fn deduplicar(ids: Vec<String>) -> Vec<String> {
    let mut vistos = std::collections::HashSet::new();
    ids.into_iter().filter(|id| vistos.insert(id.clone())).collect()
}

/// Rejeita ids de tarefa/nota que não existem (o reindex descartaria em silêncio; aqui o cliente recebe o erro).
async fn validar_vinculos(state: &AppState, tarefas: &[String], notas: &[String]) -> AppResult<()> {
    let (t, n) = (tarefas.to_vec(), notas.to_vec());
    let (faltam_t, faltam_n) = state
        .db
        .with(move |conn| {
            let mut ft = Vec::new();
            for id in &t {
                if !conn.query_row("SELECT EXISTS(SELECT 1 FROM tarefa WHERE id = ?1)", [id], |r| r.get::<_, bool>(0))? {
                    ft.push(id.clone());
                }
            }
            let mut fnota = Vec::new();
            for id in &n {
                if !conn.query_row("SELECT EXISTS(SELECT 1 FROM nota WHERE id = ?1)", [id], |r| r.get::<_, bool>(0))? {
                    fnota.push(id.clone());
                }
            }
            Ok((ft, fnota))
        })
        .await?;
    let mut campos = Vec::new();
    if !faltam_t.is_empty() {
        campos.push(CampoInvalido { campo: "tarefas".into(), motivo: format!("não existem: {}", faltam_t.join(", ")) });
    }
    if !faltam_n.is_empty() {
        campos.push(CampoInvalido { campo: "notas".into(), motivo: format!("não existem: {}", faltam_n.join(", ")) });
    }
    if campos.is_empty() { Ok(()) } else { Err(AppError::validation(campos)) }
}

fn garantir_categoria(dir_eventos: &std::path::Path, categoria_id: &str) -> AppResult<()> {
    if eventos_fs::ler_categorias(dir_eventos).iter().any(|c| c.id == categoria_id) {
        Ok(())
    } else {
        Err(invalido("categoria_id", "categoria não existe neste espaço"))
    }
}

async fn caminho_por_id(state: &AppState, id: &str) -> AppResult<String> {
    let id = id.to_string();
    let caminho: Option<String> = state.db.with(move |conn| conn.query_row("SELECT caminho_arquivo FROM evento WHERE id = ?1", [&id], |r| r.get(0)).optional()).await?;
    caminho.ok_or(AppError::new(ErrorCode::NotFound))
}

const SELECT_EVENTO: &str = "SELECT e.id, e.titulo, e.inicio, e.fim, e.dia_inteiro, e.fuso, e.local, e.categoria_id, c.nome, c.cor, c.icone, \
    e.visibilidade, e.rrule, e.espaco, e.google_event_id, e.sync_pendente, e.criado_em, e.atualizado_em, \
    (SELECT json_group_array(json_object('id', t.id, 'titulo', t.titulo)) FROM evento_tarefa et JOIN tarefa t ON t.id = et.tarefa_id WHERE et.evento_id = e.id), \
    (SELECT json_group_array(json_object('id', n.id, 'titulo', n.titulo)) FROM evento_nota en JOIN nota n ON n.id = en.nota_id WHERE en.evento_id = e.id) \
    , e.excecoes, e.recorrencia_extra, e.cor \
    FROM evento e LEFT JOIN categoria_evento c ON c.id = e.categoria_id";

fn linha_json(r: &rusqlite::Row<'_>) -> rusqlite::Result<serde_json::Value> {
    let categoria_id: Option<String> = r.get(7)?;
    let categoria = match (&categoria_id, r.get::<_, Option<String>>(8)?) {
        (Some(id), Some(nome)) => serde_json::json!({ "id": id, "nome": nome, "cor": r.get::<_, String>(9)?, "icone": r.get::<_, Option<String>>(10)? }),
        _ => serde_json::Value::Null,
    };
    let lista = |i: usize| -> rusqlite::Result<serde_json::Value> {
        Ok(serde_json::from_str(&r.get::<_, String>(i)?).unwrap_or_else(|_| serde_json::json!([])))
    };
    Ok(serde_json::json!({
        "id": r.get::<_, String>(0)?,
        "titulo": r.get::<_, String>(1)?,
        "inicio": r.get::<_, String>(2)?,
        "fim": r.get::<_, String>(3)?,
        "dia_inteiro": r.get::<_, bool>(4)?,
        "fuso": r.get::<_, Option<String>>(5)?,
        "local": r.get::<_, Option<String>>(6)?,
        "categoria_id": categoria_id,
        "categoria": categoria,
        "visibilidade": r.get::<_, String>(11)?,
        "rrule": r.get::<_, Option<String>>(12)?,
        "espaco": r.get::<_, String>(13)?,
        "origem_google": r.get::<_, Option<String>>(14)?.is_some(),
        "sync_pendente": r.get::<_, bool>(15)?,
        "criado_em": r.get::<_, String>(16)?,
        "atualizado_em": r.get::<_, String>(17)?,
        "tarefas": lista(18)?,
        "notas": lista(19)?,
        "excecoes": lista(20)?,
        "recorrencia_extra": lista(21)?,
        "cor": r.get::<_, Option<String>>(22)?,
    }))
}

async fn detalhe(state: &AppState, id: &str) -> AppResult<serde_json::Value> {
    let caminho_relativo = caminho_por_id(state, id).await?;
    let corpo = frontmatter::parse::<EventoFrontMatter>(&std::fs::read_to_string(absoluto(state, &caminho_relativo))?)?.body;
    let id = id.to_string();
    let linha = state
        .db
        .with(move |conn| conn.query_row(&format!("{SELECT_EVENTO} WHERE e.id = ?1"), [&id], linha_json).optional())
        .await?
        .ok_or(AppError::new(ErrorCode::NotFound))?;
    let mut linha = linha;
    linha["descricao"] = serde_json::Value::String(corpo);
    Ok(linha)
}

// ---------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct ListarQuery {
    pub de: Option<DateTime<Utc>>,
    pub ate: Option<DateTime<Utc>>,
    /// Id da categoria, ou `sem` para eventos sem categoria.
    pub categoria: Option<String>,
    pub espaco: Option<String>,
    pub tarefa: Option<String>,
    pub nota: Option<String>,
    pub limit: Option<i64>,
}

/// Eventos que se sobrepõem a `[de, ate)`. Séries (com `rrule`) vêm uma vez, como mestre — a expansão de ocorrências
/// fica a cargo de quem consome.
pub async fn listar(State(state): State<AppState>, Query(q): Query<ListarQuery>) -> AppResult<Json<Vec<serde_json::Value>>> {
    let limite = q.limit.unwrap_or(LIMITE_PADRAO).clamp(1, LIMITE_MAXIMO);
    let linhas = state
        .db
        .with(move |conn| {
            let mut sql = String::from(SELECT_EVENTO);
            let mut condicoes: Vec<String> = Vec::new();
            let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
            match (q.de, q.ate) {
                (Some(de), Some(ate)) => {
                    condicoes.push("((e.rrule IS NOT NULL AND e.inicio < ?) OR (e.fim > ? AND e.inicio < ?))".into());
                    params.push(Box::new(ate.to_rfc3339()));
                    params.push(Box::new(de.to_rfc3339()));
                    params.push(Box::new(ate.to_rfc3339()));
                }
                (Some(de), None) => {
                    condicoes.push("(e.rrule IS NOT NULL OR e.fim > ?)".into());
                    params.push(Box::new(de.to_rfc3339()));
                }
                (None, Some(ate)) => {
                    condicoes.push("e.inicio < ?".into());
                    params.push(Box::new(ate.to_rfc3339()));
                }
                (None, None) => {}
            }
            match q.categoria.as_deref() {
                Some("sem") => condicoes.push("e.categoria_id IS NULL".into()),
                Some(c) => {
                    condicoes.push("e.categoria_id = ?".into());
                    params.push(Box::new(c.to_string()));
                }
                None => {}
            }
            if let Some(espaco) = q.espaco {
                condicoes.push("e.espaco = ?".into());
                params.push(Box::new(espaco));
            }
            if let Some(tarefa) = q.tarefa {
                condicoes.push("e.id IN (SELECT evento_id FROM evento_tarefa WHERE tarefa_id = ?)".into());
                params.push(Box::new(tarefa));
            }
            if let Some(nota) = q.nota {
                condicoes.push("e.id IN (SELECT evento_id FROM evento_nota WHERE nota_id = ?)".into());
                params.push(Box::new(nota));
            }
            if !condicoes.is_empty() {
                sql.push_str(" WHERE ");
                sql.push_str(&condicoes.join(" AND "));
            }
            sql.push_str(" ORDER BY e.inicio, e.id LIMIT ?");
            params.push(Box::new(limite));
            let mut stmt = conn.prepare(&sql)?;
            let refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
            let linhas = stmt.query_map(refs.as_slice(), linha_json)?.collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await?;
    Ok(Json(linhas))
}

pub async fn obter(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    Ok(Json(detalhe(&state, &id).await?))
}

#[derive(Debug, Deserialize)]
pub struct CriarEventoPayload {
    pub titulo: String,
    pub inicio: DateTime<Utc>,
    pub fim: DateTime<Utc>,
    #[serde(default)]
    pub dia_inteiro: bool,
    #[serde(default)]
    pub fuso: Option<String>,
    #[serde(default)]
    pub local: Option<String>,
    #[serde(default)]
    pub descricao: Option<String>,
    #[serde(default)]
    pub categoria_id: Option<String>,
    /// Cor própria (`#RRGGBB`), só do Ecos.
    #[serde(default)]
    pub cor: Option<String>,
    #[serde(default)]
    pub visibilidade: EventoVisibilidade,
    #[serde(default)]
    pub rrule: Option<String>,
    #[serde(default)]
    pub tarefas: Vec<String>,
    #[serde(default)]
    pub notas: Vec<String>,
    #[serde(default)]
    pub espaco: Option<String>,
}

pub async fn criar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Json(payload): Json<CriarEventoPayload>) -> AppResult<Json<serde_json::Value>> {
    let local = vazio_para_none(payload.local);
    let rrule = vazio_para_none(payload.rrule);
    validar_campos(&payload.titulo, payload.inicio, payload.fim, local.as_deref(), rrule.as_deref())?;
    let espaco: Espaco = payload
        .espaco
        .as_deref()
        .unwrap_or("pessoal")
        .parse()
        .map_err(|motivo: String| AppError::validation(vec![CampoInvalido { campo: "espaco".into(), motivo }]))?;
    let dir = crate::espacos::raiz(&state, &espaco.to_string(), eventos_fs::DIR).await?;
    let cor = vazio_para_none(payload.cor);
    if cor.as_deref().is_some_and(|c| !cor_valida(c)) {
        return Err(invalido("cor", "esperado '#RRGGBB'"));
    }
    let categoria_id = vazio_para_none(payload.categoria_id);
    if let Some(c) = &categoria_id {
        garantir_categoria(&dir, c)?;
    }
    let (tarefas, notas) = (deduplicar(payload.tarefas), deduplicar(payload.notas));
    validar_vinculos(&state, &tarefas, &notas).await?;

    let agora = Utc::now();
    let fm = EventoFrontMatter {
        id: new_id(),
        titulo: payload.titulo.trim().to_string(),
        inicio: payload.inicio,
        fim: payload.fim,
        dia_inteiro: payload.dia_inteiro,
        fuso: vazio_para_none(payload.fuso),
        local,
        categoria_id,
        cor,
        visibilidade: payload.visibilidade,
        rrule,
        recorrencia_extra: Vec::new(),
        excecoes: Vec::new(),
        tarefas,
        notas,
        google: GoogleRef::default(),
        sync_pendente: payload.visibilidade == EventoVisibilidade::Google,
        espaco,
        criado_em: agora,
        atualizado_em: agora,
        criado_por: Some(usuario.0.clone()),
    };
    let caminho = naming::caminho_sem_colisao(&dir, &naming::sanitizar_nome_arquivo(&fm.titulo), "md");
    std::fs::write(&caminho, frontmatter::serialize(&fm, payload.descricao.as_deref().unwrap_or(""))?)?;
    reindexar_tudo(&state.db, &state.config.notes_root).await?;
    tracing::info!(evento_id = %fm.id, visibilidade = fm.visibilidade.como_str(), "evento criado");
    if fm.visibilidade == EventoVisibilidade::Google {
        crate::calendario::sync::agendar_envio(&state, &usuario.0);
    }
    Ok(Json(detalhe(&state, &fm.id).await?))
}

/// Lê o `.md`, deixa `f` alterar o front-matter/corpo (devolvendo se a mudança interessa ao Google), grava e reindexa.
/// Trocar o título renomeia o arquivo.
async fn editar_evento(state: &AppState, id: &str, f: impl FnOnce(&mut EventoFrontMatter, &mut String) -> AppResult<bool>) -> AppResult<()> {
    let relativo = caminho_por_id(state, id).await?;
    let atual = absoluto(state, &relativo);
    let doc = frontmatter::parse::<EventoFrontMatter>(&std::fs::read_to_string(&atual)?)?;
    let (mut fm, mut corpo) = (doc.front_matter, doc.body);
    let titulo_antes = fm.titulo.clone();
    let afeta_google = f(&mut fm, &mut corpo)?;
    validar_campos(&fm.titulo, fm.inicio, fm.fim, fm.local.as_deref(), fm.rrule.as_deref())?;
    if afeta_google && fm.visibilidade == EventoVisibilidade::Google {
        fm.sync_pendente = true;
    } else if fm.visibilidade == EventoVisibilidade::Privado && fm.google.event_id.is_none() {
        // Virou privado antes de ir ao Google: não há nada a enviar nem a apagar lá.
        fm.sync_pendente = false;
    }
    fm.atualizado_em = Utc::now();
    let conteudo = frontmatter::serialize(&fm, &corpo)?;
    if fm.titulo != titulo_antes {
        let dir = atual.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| state.config.notes_root.clone());
        let destino = naming::caminho_sem_colisao(&dir, &naming::sanitizar_nome_arquivo(&fm.titulo), "md");
        std::fs::write(&destino, conteudo)?;
        std::fs::remove_file(&atual)?;
    } else {
        std::fs::write(&atual, conteudo)?;
    }
    reindexar_tudo(&state.db, &state.config.notes_root).await?;
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct AtualizarEventoPayload {
    #[serde(default)]
    pub titulo: Option<String>,
    #[serde(default)]
    pub inicio: Option<DateTime<Utc>>,
    #[serde(default)]
    pub fim: Option<DateTime<Utc>>,
    #[serde(default)]
    pub dia_inteiro: Option<bool>,
    #[serde(default, deserialize_with = "nullable_patch")]
    pub fuso: Option<Option<String>>,
    #[serde(default, deserialize_with = "nullable_patch")]
    pub local: Option<Option<String>>,
    #[serde(default, deserialize_with = "nullable_patch")]
    pub categoria_id: Option<Option<String>>,
    /// `null` tira a cor própria (volta a valer a da categoria).
    #[serde(default, deserialize_with = "nullable_patch")]
    pub cor: Option<Option<String>>,
    #[serde(default, deserialize_with = "nullable_patch")]
    pub rrule: Option<Option<String>>,
    #[serde(default)]
    pub descricao: Option<String>,
    #[serde(default)]
    pub visibilidade: Option<EventoVisibilidade>,
    #[serde(default)]
    pub tarefas: Option<Vec<String>>,
    #[serde(default)]
    pub notas: Option<Vec<String>>,
}

pub async fn atualizar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(id): Path<String>, Json(p): Json<AtualizarEventoPayload>) -> AppResult<Json<serde_json::Value>> {
    if let Some(Some(c)) = &p.categoria_id {
        let espaco = espaco_do_evento(&state, &id).await?;
        let dir = crate::espacos::raiz(&state, &espaco, eventos_fs::DIR).await?;
        garantir_categoria(&dir, c)?;
    }
    if let Some(Some(c)) = &p.cor {
        if !cor_valida(c) {
            return Err(invalido("cor", "esperado '#RRGGBB'"));
        }
    }
    if p.tarefas.is_some() || p.notas.is_some() {
        validar_vinculos(&state, p.tarefas.as_deref().unwrap_or(&[]), p.notas.as_deref().unwrap_or(&[])).await?;
    }
    editar_evento(&state, &id, |fm, corpo| {
        // Recorrência é do Google: aqui não se cria nem muda regra, e uma série vinda de lá não se reescreve (só se
        // muda ou cancela uma ocorrência: `/eventos/:id/ocorrencias`). Categoria e vínculos continuam livres.
        if p.rrule.is_some() {
            return Err(AppError::new(ErrorCode::Conflict).with_message("As recorrências são criadas e editadas no Google Calendar."));
        }
        let mexe_na_serie = p.titulo.is_some() || p.inicio.is_some() || p.fim.is_some() || p.dia_inteiro.is_some() || p.fuso.is_some() || p.local.is_some() || p.descricao.is_some() || p.visibilidade.is_some();
        if fm.rrule.is_some() && fm.google.event_id.is_some() && mexe_na_serie {
            return Err(AppError::new(ErrorCode::Conflict).with_message("Esta série é gerenciada no Google Calendar. Aqui você pode mudar ou cancelar uma ocorrência."));
        }
        let mut afeta_google = false;
        if let Some(t) = p.titulo {
            fm.titulo = t.trim().to_string();
            afeta_google = true;
        }
        if let Some(i) = p.inicio {
            fm.inicio = i;
            afeta_google = true;
        }
        if let Some(f) = p.fim {
            fm.fim = f;
            afeta_google = true;
        }
        if let Some(d) = p.dia_inteiro {
            fm.dia_inteiro = d;
            afeta_google = true;
        }
        if let Some(v) = p.fuso {
            fm.fuso = vazio_para_none(v);
            afeta_google = true;
        }
        if let Some(v) = p.local {
            fm.local = vazio_para_none(v);
            afeta_google = true;
        }
        if let Some(v) = p.categoria_id {
            fm.categoria_id = vazio_para_none(v);
            afeta_google = true;
        }
        if let Some(v) = p.rrule {
            fm.rrule = vazio_para_none(v);
            afeta_google = true;
        }
        if let Some(d) = p.descricao {
            *corpo = d;
            afeta_google = true;
        }
        if let Some(v) = p.visibilidade {
            fm.visibilidade = v;
            afeta_google = true;
        }
        // A cor é só do Ecos: mudar a cor nunca marca o evento para o Google (nem mexe numa série do Google).
        if let Some(c) = p.cor {
            fm.cor = vazio_para_none(c);
        }
        if let Some(t) = p.tarefas {
            fm.tarefas = deduplicar(t);
        }
        if let Some(n) = p.notas {
            fm.notas = deduplicar(n);
        }
        Ok(afeta_google)
    })
    .await?;
    let resultado = detalhe(&state, &id).await?;
    // Evento que está no Google (ou acabou de ser marcado para ir): o envio não espera o próximo ciclo. Tornar privado
    // também conta, porque é o que apaga o evento lá.
    if resultado["visibilidade"] == "google" || resultado["origem_google"] == true {
        crate::calendario::sync::agendar_envio(&state, &usuario.0);
    }
    Ok(Json(resultado))
}

async fn espaco_do_evento(state: &AppState, id: &str) -> AppResult<String> {
    let id = id.to_string();
    let espaco: Option<String> = state.db.with(move |conn| conn.query_row("SELECT espaco FROM evento WHERE id = ?1", [&id], |r| r.get(0)).optional()).await?;
    espaco.ok_or(AppError::new(ErrorCode::NotFound))
}

#[derive(Debug, Deserialize)]
pub struct VinculosPayload {
    #[serde(default)]
    pub tarefas: Vec<String>,
    #[serde(default)]
    pub notas: Vec<String>,
}

/// Substitui os vínculos do evento. Vínculos são só do Ecos: não marcam o evento para sincronizar.
pub async fn definir_vinculos(State(state): State<AppState>, Path(id): Path<String>, Json(p): Json<VinculosPayload>) -> AppResult<Json<serde_json::Value>> {
    let (tarefas, notas) = (deduplicar(p.tarefas), deduplicar(p.notas));
    validar_vinculos(&state, &tarefas, &notas).await?;
    editar_evento(&state, &id, |fm, _| {
        fm.tarefas = tarefas;
        fm.notas = notas;
        Ok(false)
    })
    .await?;
    Ok(Json(detalhe(&state, &id).await?))
}

pub async fn excluir(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let relativo = caminho_por_id(&state, &id).await?;
    let doc = frontmatter::parse::<EventoFrontMatter>(&std::fs::read_to_string(absoluto(&state, &relativo))?)?;
    if doc.front_matter.rrule.is_some() && doc.front_matter.google.event_id.is_some() {
        return Err(AppError::new(ErrorCode::Conflict).with_message("Uma série só se apaga no Google Calendar. Aqui você pode cancelar uma ocorrência."));
    }
    crate::routes::lixeira::mover(&state, &relativo, "evento", &doc.front_matter.titulo, std::path::Path::new(""))?;
    reindexar_tudo(&state.db, &state.config.notes_root).await?;
    tracing::info!(evento_id = %id, "evento excluído (lixeira)");
    // O `.md` já foi para a lixeira: o pedido de apagar no Google precisa sobreviver em outro lugar até ser enviado.
    if let Some(google_id) = doc.front_matter.google.event_id.clone() {
        let calendario = doc.front_matter.google.calendar_id.clone().unwrap_or_else(|| "primary".into());
        let agora = Utc::now().to_rfc3339();
        if let Err(e) = state
            .db
            .with(move |conn| conn.execute("INSERT OR IGNORE INTO evento_exclusao_google (calendar_id, google_event_id, criado_em) VALUES (?1, ?2, ?3)", rusqlite::params![calendario, google_id, agora]))
            .await
        {
            tracing::error!(error = %e, evento_id = %id, "não foi possível registrar a exclusão para enviar ao Google");
        } else {
            crate::calendario::sync::agendar_envio(&state, &usuario.0);
        }
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn eventos_vinculados(state: &AppState, tabela: &'static str, coluna: &'static str, id: String) -> AppResult<Vec<serde_json::Value>> {
    let linhas = state
        .db
        .with(move |conn| {
            let sql = format!("{SELECT_EVENTO} WHERE e.id IN (SELECT evento_id FROM {tabela} WHERE {coluna} = ?1) ORDER BY e.inicio DESC");
            let mut stmt = conn.prepare(&sql)?;
            let linhas = stmt.query_map([&id], linha_json)?.collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await?;
    Ok(linhas)
}

// ---------------------------------------------------------------------
// Ocorrências de séries (só uma, nunca a série toda)
// ---------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct AtualizarOcorrenciaPayload {
    /// Início ORIGINAL da ocorrência (o que a série previa, antes de qualquer remarcação): é a chave da exceção.
    pub original: DateTime<Utc>,
    #[serde(default)]
    pub titulo: Option<String>,
    #[serde(default)]
    pub inicio: Option<DateTime<Utc>>,
    #[serde(default)]
    pub fim: Option<DateTime<Utc>>,
    #[serde(default, deserialize_with = "nullable_patch")]
    pub local: Option<Option<String>>,
    #[serde(default)]
    pub descricao: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CancelarOcorrenciaQuery {
    pub original: DateTime<Utc>,
}

fn exigir_serie(fm: &EventoFrontMatter, original: DateTime<Utc>) -> AppResult<()> {
    if fm.rrule.is_none() {
        return Err(invalido("original", "este evento não é uma série"));
    }
    if original < fm.inicio - chrono::Duration::minutes(1) {
        return Err(invalido("original", "anterior ao início da série"));
    }
    Ok(())
}

/// A exceção da ocorrência que começaria em `original` (criada vazia se ainda não existe).
fn excecao_de(fm: &mut EventoFrontMatter, original: DateTime<Utc>) -> &mut Excecao {
    let procurar = |fm: &EventoFrontMatter| fm.excecoes.iter().position(|x| (x.original - original).num_seconds().abs() < 60);
    if procurar(fm).is_none() {
        fm.excecoes.push(Excecao {
            original,
            cancelada: false,
            titulo: None,
            inicio: None,
            fim: None,
            local: None,
            descricao: None,
            google: GoogleRef::default(),
            sync_pendente: false,
            atualizado_em: Utc::now(),
        });
        fm.excecoes.sort_by_key(|x| x.original);
    }
    let i = procurar(fm).expect("acabou de ser criada");
    &mut fm.excecoes[i]
}

/// Muda só uma ocorrência (horário, título, local, descrição). No Google vira a exceção daquela instância.
pub async fn atualizar_ocorrencia(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(id): Path<String>, Json(p): Json<AtualizarOcorrenciaPayload>) -> AppResult<Json<serde_json::Value>> {
    if p.titulo.as_deref().is_some_and(|t| t.trim().is_empty() || t.chars().count() > 300) {
        return Err(invalido("titulo", "obrigatório, até 300 caracteres"));
    }
    if p.local.as_ref().and_then(|l| l.as_deref()).is_some_and(|l| l.chars().count() > 300) {
        return Err(invalido("local", "máximo de 300 caracteres"));
    }
    editar_evento(&state, &id, |fm, _| {
        exigir_serie(fm, p.original)?;
        let duracao = fm.fim - fm.inicio;
        let no_google = fm.visibilidade == EventoVisibilidade::Google;
        let exc = excecao_de(fm, p.original);
        if exc.cancelada {
            return Err(AppError::new(ErrorCode::Conflict).with_message("Esta ocorrência foi cancelada."));
        }
        if let Some(t) = &p.titulo {
            exc.titulo = Some(t.trim().to_string());
        }
        if let Some(i) = p.inicio {
            exc.inicio = Some(i);
        }
        if let Some(f) = p.fim {
            exc.fim = Some(f);
        }
        if let Some(l) = &p.local {
            exc.local = Some(l.clone().unwrap_or_default().trim().to_string());
        }
        if let Some(d) = &p.descricao {
            exc.descricao = Some(d.clone());
        }
        let inicio = exc.inicio.unwrap_or(exc.original);
        if exc.fim.unwrap_or(inicio + duracao) <= inicio {
            return Err(invalido("fim", "deve ser depois do início"));
        }
        exc.sync_pendente = no_google;
        exc.atualizado_em = Utc::now();
        Ok(false)
    })
    .await?;
    let resultado = detalhe(&state, &id).await?;
    if resultado["visibilidade"] == "google" {
        crate::calendario::sync::agendar_envio(&state, &usuario.0);
    }
    Ok(Json(resultado))
}

/// Cancela só uma ocorrência: some da série (no Google, a instância é cancelada).
pub async fn cancelar_ocorrencia(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(id): Path<String>, Query(q): Query<CancelarOcorrenciaQuery>) -> AppResult<Json<serde_json::Value>> {
    editar_evento(&state, &id, |fm, _| {
        exigir_serie(fm, q.original)?;
        let no_google = fm.visibilidade == EventoVisibilidade::Google;
        let exc = excecao_de(fm, q.original);
        exc.cancelada = true;
        (exc.titulo, exc.inicio, exc.fim, exc.local, exc.descricao) = (None, None, None, None, None);
        exc.sync_pendente = no_google;
        exc.atualizado_em = Utc::now();
        Ok(false)
    })
    .await?;
    let resultado = detalhe(&state, &id).await?;
    if resultado["visibilidade"] == "google" {
        crate::calendario::sync::agendar_envio(&state, &usuario.0);
    }
    Ok(Json(resultado))
}

/// Backlinks: eventos vinculados a uma Tarefa.
pub async fn da_tarefa(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<Vec<serde_json::Value>>> {
    Ok(Json(eventos_vinculados(&state, "evento_tarefa", "tarefa_id", id).await?))
}

/// Backlinks: eventos vinculados a uma Nota.
pub async fn da_nota(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<Vec<serde_json::Value>>> {
    Ok(Json(eventos_vinculados(&state, "evento_nota", "nota_id", id).await?))
}

// ---------------------------------------------------------------------
// Tempo por categoria
// ---------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct TempoQuery {
    pub de: DateTime<Utc>,
    pub ate: DateTime<Utc>,
    pub espaco: Option<String>,
    /// Só eventos vinculados a esta Tarefa.
    pub tarefa: Option<String>,
}

/// Minutos por categoria entre `de` e `ate` (eventos cortados nas bordas do intervalo). Dia inteiro não conta como
/// tempo gasto. Séries (`rrule`) ainda não são expandidas: ficam de fora e vêm contadas em `recorrentes_ignorados`.
pub async fn tempo(State(state): State<AppState>, Query(q): Query<TempoQuery>) -> AppResult<Json<serde_json::Value>> {
    if q.ate <= q.de {
        return Err(invalido("ate", "deve ser depois de 'de'"));
    }
    let resultado = state
        .db
        .with(move |conn| {
            let (de, ate) = (q.de.to_rfc3339(), q.ate.to_rfc3339());
            let mut filtro = String::new();
            let mut extras: Vec<String> = Vec::new();
            if let Some(espaco) = q.espaco {
                filtro.push_str(" AND e.espaco = ?");
                extras.push(espaco);
            }
            if let Some(tarefa) = q.tarefa {
                filtro.push_str(" AND e.id IN (SELECT evento_id FROM evento_tarefa WHERE tarefa_id = ?)");
                extras.push(tarefa);
            }
            let mut params: Vec<&dyn rusqlite::ToSql> = vec![&de, &ate, &ate, &de];
            params.extend(extras.iter().map(|e| e as &dyn rusqlite::ToSql));
            let sql = format!(
                "SELECT e.categoria_id, c.nome, c.cor, COUNT(*), \
                 CAST(ROUND(SUM((julianday(MIN(e.fim, ?2)) - julianday(MAX(e.inicio, ?1))) * 1440.0)) AS INTEGER) AS minutos \
                 FROM evento e LEFT JOIN categoria_evento c ON c.id = e.categoria_id \
                 WHERE e.dia_inteiro = 0 AND e.rrule IS NULL AND e.inicio < ?3 AND e.fim > ?4{filtro} \
                 GROUP BY e.categoria_id ORDER BY minutos DESC"
            );
            let mut stmt = conn.prepare(&sql)?;
            let itens = stmt
                .query_map(params.as_slice(), |r| {
                    let categoria_id: Option<String> = r.get(0)?;
                    let nome: Option<String> = r.get(1)?;
                    Ok(serde_json::json!({
                        "categoria_id": categoria_id,
                        "nome": nome.unwrap_or_else(|| "Sem categoria".into()),
                        "cor": r.get::<_, Option<String>>(2)?,
                        "quantidade": r.get::<_, i64>(3)?,
                        "minutos": r.get::<_, i64>(4)?,
                    }))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            let total: i64 = itens.iter().map(|i| i["minutos"].as_i64().unwrap_or(0)).sum();
            let recorrentes: i64 = conn.query_row(
                &format!("SELECT COUNT(*) FROM evento e WHERE e.dia_inteiro = 0 AND e.rrule IS NOT NULL AND e.inicio < ?1{filtro}"),
                rusqlite::params_from_iter(std::iter::once(&ate).chain(extras.iter())),
                |r| r.get(0),
            )?;
            Ok(serde_json::json!({ "total_min": total, "itens": itens, "recorrentes_ignorados": recorrentes }))
        })
        .await?;
    Ok(Json(resultado))
}

// ---------------------------------------------------------------------
// Categorias
// ---------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct CategoriasQuery {
    pub espaco: Option<String>,
}

pub async fn listar_categorias(State(state): State<AppState>, Query(q): Query<CategoriasQuery>) -> AppResult<Json<Vec<serde_json::Value>>> {
    let linhas = state
        .db
        .with(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT c.id, c.espaco, c.nome, c.cor, c.icone, (SELECT COUNT(*) FROM evento e WHERE e.categoria_id = c.id) \
                 FROM categoria_evento c WHERE (?1 IS NULL OR c.espaco = ?1) ORDER BY c.nome COLLATE NOCASE",
            )?;
            let linhas = stmt
                .query_map([&q.espaco], |r| {
                    Ok(serde_json::json!({
                        "id": r.get::<_, String>(0)?, "espaco": r.get::<_, String>(1)?, "nome": r.get::<_, String>(2)?,
                        "cor": r.get::<_, String>(3)?, "icone": r.get::<_, Option<String>>(4)?, "eventos": r.get::<_, i64>(5)?,
                    }))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await?;
    Ok(Json(linhas))
}

fn validar_categoria(nome: &str, cor: &str) -> AppResult<()> {
    let mut campos = Vec::new();
    if nome.trim().is_empty() || nome.chars().count() > 60 {
        campos.push(CampoInvalido { campo: "nome".into(), motivo: "obrigatório, até 60 caracteres".into() });
    }
    if !cor_valida(cor) {
        campos.push(CampoInvalido { campo: "cor".into(), motivo: "esperado '#RRGGBB'".into() });
    }
    if campos.is_empty() { Ok(()) } else { Err(AppError::validation(campos)) }
}

#[derive(Debug, Deserialize)]
pub struct CriarCategoriaPayload {
    pub nome: String,
    pub cor: String,
    #[serde(default)]
    pub icone: Option<String>,
    #[serde(default)]
    pub espaco: Option<String>,
}

pub async fn criar_categoria(State(state): State<AppState>, Json(p): Json<CriarCategoriaPayload>) -> AppResult<Json<serde_json::Value>> {
    validar_categoria(&p.nome, &p.cor)?;
    let espaco: Espaco = p.espaco.as_deref().unwrap_or("pessoal").parse().map_err(|motivo: String| AppError::validation(vec![CampoInvalido { campo: "espaco".into(), motivo }]))?;
    let dir = crate::espacos::raiz(&state, &espaco.to_string(), eventos_fs::DIR).await?;
    let mut categorias = eventos_fs::ler_categorias(&dir);
    let nome = p.nome.trim().to_string();
    if categorias.iter().any(|c| c.nome.eq_ignore_ascii_case(&nome)) {
        return Err(AppError::new(ErrorCode::Conflict).with_message("Já existe uma categoria com esse nome."));
    }
    let nova = CategoriaEvento { id: new_id(), nome, cor: p.cor, icone: vazio_para_none(p.icone) };
    categorias.push(nova.clone());
    eventos_fs::escrever_categorias(&dir, &categorias)?;
    reindexar_tudo(&state.db, &state.config.notes_root).await?;
    Ok(Json(serde_json::json!({ "id": nova.id, "espaco": espaco.to_string(), "nome": nova.nome, "cor": nova.cor, "icone": nova.icone })))
}

async fn espaco_da_categoria(state: &AppState, id: &str) -> AppResult<String> {
    let id = id.to_string();
    let espaco: Option<String> = state.db.with(move |conn| conn.query_row("SELECT espaco FROM categoria_evento WHERE id = ?1", [&id], |r| r.get(0)).optional()).await?;
    espaco.ok_or(AppError::new(ErrorCode::NotFound))
}

#[derive(Debug, Deserialize)]
pub struct AtualizarCategoriaPayload {
    #[serde(default)]
    pub nome: Option<String>,
    #[serde(default)]
    pub cor: Option<String>,
    #[serde(default, deserialize_with = "nullable_patch")]
    pub icone: Option<Option<String>>,
}

pub async fn atualizar_categoria(State(state): State<AppState>, Path(id): Path<String>, Json(p): Json<AtualizarCategoriaPayload>) -> AppResult<Json<serde_json::Value>> {
    let espaco = espaco_da_categoria(&state, &id).await?;
    let dir = crate::espacos::raiz(&state, &espaco, eventos_fs::DIR).await?;
    let mut categorias = eventos_fs::ler_categorias(&dir);
    let pos = categorias.iter().position(|c| c.id == id).ok_or(AppError::new(ErrorCode::NotFound))?;
    let mut c = categorias[pos].clone();
    if let Some(nome) = p.nome {
        c.nome = nome.trim().to_string();
    }
    if let Some(cor) = p.cor {
        c.cor = cor;
    }
    if let Some(icone) = p.icone {
        c.icone = vazio_para_none(icone);
    }
    validar_categoria(&c.nome, &c.cor)?;
    if categorias.iter().any(|o| o.id != id && o.nome.eq_ignore_ascii_case(&c.nome)) {
        return Err(AppError::new(ErrorCode::Conflict).with_message("Já existe uma categoria com esse nome."));
    }
    categorias[pos] = c.clone();
    eventos_fs::escrever_categorias(&dir, &categorias)?;
    reindexar_tudo(&state.db, &state.config.notes_root).await?;
    Ok(Json(serde_json::json!({ "id": c.id, "espaco": espaco, "nome": c.nome, "cor": c.cor, "icone": c.icone })))
}

/// Remove a categoria; os eventos que a usavam voltam a "sem categoria" (o `.md` de cada um é reescrito).
pub async fn excluir_categoria(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let espaco = espaco_da_categoria(&state, &id).await?;
    let dir = crate::espacos::raiz(&state, &espaco, eventos_fs::DIR).await?;
    let mut categorias = eventos_fs::ler_categorias(&dir);
    categorias.retain(|c| c.id != id);
    let afetados: Vec<String> = {
        let id = id.clone();
        state.db.with(move |conn| {
            let mut stmt = conn.prepare("SELECT id FROM evento WHERE categoria_id = ?1")?;
            let ids = stmt.query_map([&id], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
            Ok(ids)
        }).await?
    };
    for evento_id in &afetados {
        editar_evento(&state, evento_id, |fm, _| {
            fm.categoria_id = None;
            Ok(true)
        })
        .await?;
    }
    eventos_fs::escrever_categorias(&dir, &categorias)?;
    reindexar_tudo(&state.db, &state.config.notes_root).await?;
    Ok(Json(serde_json::json!({ "ok": true, "eventos_afetados": afetados.len() })))
}
