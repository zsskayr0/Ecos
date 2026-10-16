//! Tarefas recorrentes. A regra e o estado da série moram num arquivo próprio
//! (`<espaço>/Series/<id>.json`), separados das ocorrências, que são Tarefas comuns (`.md`) com `serie:` no
//! front-matter. A próxima ocorrência é criada ao concluir (ou pular/excluir) a atual, de forma idempotente: a data
//! gerada fica registrada na série, então concluir de novo, reabrir, excluir ou reagendar nunca recria uma ocorrência.

use axum::extract::{Path as RotaPath, State};
use axum::{Extension, Json};
use chrono::{DateTime, NaiveDate, NaiveTime, TimeZone, Utc};
use chrono_tz::Tz;
use ecos_core::tarefa_serie::{EstadoSerie, FimDeMes, Frequencia, ModeloSerie, OcorrenciaRef, RegraRecorrencia, SerieTarefa};
use ecos_core::types::{EventoExternoRef, Subtarefa, TarefaFrontMatter, TarefaStatus};
use ecos_core::{frontmatter, naming, new_id, ErrorCode};
use serde::Deserialize;
use std::path::{Path, PathBuf};

use crate::db::reindex::reindexar_tudo;
use crate::error::{AppError, AppResult, CampoInvalido};
use crate::middleware::auth_guard::UsuarioAutenticado;
use crate::routes::tarefas::{absoluto, anexos_dir, caminho_por_id};
use crate::state::AppState;

/// Pasta (dentro do diretório do espaço) onde ficam os arquivos de série.
pub const DIR: &str = "Series";

/// Serializa a geração de ocorrências: duas conclusões simultâneas da mesma série não podem criar a mesma data duas
/// vezes (o processo é único, então um mutex basta).
static TRAVA: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn id_valido(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn localizar(notes_root: &Path, id: &str) -> Option<PathBuf> {
    if !id_valido(id) {
        return None;
    }
    crate::espacos::listar(notes_root).into_iter().map(|(_, d)| d.join(DIR).join(format!("{id}.json"))).find(|p| p.is_file())
}

fn ler(notes_root: &Path, id: &str) -> Option<(SerieTarefa, PathBuf)> {
    let caminho = localizar(notes_root, id)?;
    let texto = std::fs::read_to_string(&caminho).ok()?;
    match serde_json::from_str::<SerieTarefa>(&texto) {
        Ok(serie) => Some((serie, caminho)),
        Err(err) => {
            tracing::warn!(error = %err, arquivo = %caminho.display(), "arquivo de série ilegível; ignorando a recorrência");
            None
        }
    }
}

/// Gravação atômica (tmp + rename), como as categorias de evento.
fn gravar(caminho: &Path, serie: &SerieTarefa) -> std::io::Result<()> {
    if let Some(pai) = caminho.parent() {
        std::fs::create_dir_all(pai)?;
    }
    let json = serde_json::to_vec_pretty(serie).map_err(std::io::Error::other)?;
    let tmp = caminho.with_extension("json.ecos-tmp");
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, caminho)
}

fn tz_de(nome: &str) -> Tz {
    nome.parse().unwrap_or(chrono_tz::UTC)
}

fn data_local(instante: DateTime<Utc>, tz: Tz) -> NaiveDate {
    instante.with_timezone(&tz).date_naive()
}

fn instante(data: NaiveDate, hora: NaiveTime, tz: Tz) -> DateTime<Utc> {
    let local = data.and_time(hora);
    match tz.from_local_datetime(&local) {
        chrono::LocalResult::Single(d) | chrono::LocalResult::Ambiguous(d, _) => d.with_timezone(&Utc),
        // Hora que não existe (início do horário de verão): usa o mesmo relógio em UTC.
        chrono::LocalResult::None => Utc.from_utc_datetime(&local),
    }
}

fn ancora_de(fm: &TarefaFrontMatter, tz: Tz) -> Option<NaiveDate> {
    fm.scheduled_at.map(|d| data_local(d, tz)).or(fm.due_date)
}

fn modelo_de(fm: &TarefaFrontMatter, corpo: &str, tz: Tz, ancora: NaiveDate) -> ModeloSerie {
    ModeloSerie {
        titulo: fm.titulo.clone(),
        corpo: corpo.to_string(),
        duration_min: fm.duration_min,
        prioridade: fm.prioridade,
        tags: fm.tags.clone(),
        subtarefas: fm.subtarefas.iter().map(|s| s.titulo.clone()).collect(),
        hora: fm.scheduled_at.map(|d| d.with_timezone(&tz).time()),
        prazo_apos_dias: fm.due_date.map(|d| (d - ancora).num_days()),
    }
}

fn invalido(campo: &str, motivo: impl Into<String>) -> AppError {
    AppError::validation(vec![CampoInvalido { campo: campo.into(), motivo: motivo.into() }])
}

fn um() -> u32 {
    1
}

#[derive(Debug, Clone, Deserialize)]
pub struct RegraPayload {
    pub frequencia: Frequencia,
    #[serde(default = "um")]
    pub intervalo: u32,
    #[serde(default)]
    pub dias_semana: Vec<u8>,
    #[serde(default)]
    pub fim_de_mes: FimDeMes,
    #[serde(default)]
    pub data_fim: Option<NaiveDate>,
    #[serde(default)]
    pub max_ocorrencias: Option<u32>,
    /// Fuso IANA da série (o cliente manda o do dispositivo).
    #[serde(default)]
    pub timezone: Option<String>,
}

/// Cria a próxima ocorrência da série depois de `depois`, se houver e ainda não existir. Idempotente: devolve `None`
/// quando não há o que gerar (série pausada/encerrada/sem mais datas) ou a data já foi gerada antes.
/// `base_caminho` é a ocorrência de onde herdar pasta, espaço e autor.
pub async fn gerar_proxima(state: &AppState, serie_id: &str, depois: NaiveDate, base_caminho: &str) -> AppResult<Option<String>> {
    let _trava = TRAVA.lock().await;
    let Some((mut serie, arquivo)) = ler(&state.config.notes_root, serie_id) else { return Ok(None) };
    let Some(proxima) = serie.proxima_a_gerar(depois) else { return Ok(None) };
    if serie.geradas.contains(&proxima) {
        return Ok(None);
    }

    // Defesa contra queda entre gravar a Tarefa e gravar a série: se a Tarefa dessa data já existe, só falta registrar.
    let (sid, data) = (serie_id.to_string(), proxima.to_string());
    let existente: Option<String> = state
        .db
        .with(move |conn| {
            use rusqlite::OptionalExtension;
            conn.query_row("SELECT id FROM tarefa WHERE serie_id = ?1 AND ocorrencia_data = ?2", [&sid, &data], |r| r.get(0)).optional()
        })
        .await?;
    if existente.is_some() {
        serie.geradas.push(proxima);
        gravar(&arquivo, &serie)?;
        return Ok(None);
    }

    let base_abs = absoluto(state, base_caminho);
    let bruto = std::fs::read_to_string(&base_abs)?;
    let base = frontmatter::parse::<TarefaFrontMatter>(&bruto)?.front_matter;
    let dir = base_abs.parent().map(Path::to_path_buf).ok_or(AppError::new(ErrorCode::InternalError))?;
    let tz = tz_de(&serie.regra.timezone);
    let modelo = serie.modelo.clone();
    let agora = Utc::now();
    let fm = TarefaFrontMatter {
        id: new_id(),
        titulo: modelo.titulo.clone(),
        status: TarefaStatus::Pendente,
        scheduled_at: modelo.hora.map(|h| instante(proxima, h, tz)),
        duration_min: modelo.duration_min,
        due_date: modelo.prazo_apos_dias.and_then(|d| proxima.checked_add_signed(chrono::Duration::days(d))),
        tags: modelo.tags.clone(),
        prioridade: modelo.prioridade,
        subtarefas: modelo.subtarefas.iter().map(|t| Subtarefa { id: new_id(), titulo: t.clone(), concluida: false }).collect(),
        espaco: base.espaco.clone(),
        evento_externo: EventoExternoRef::default(),
        criado_em: agora,
        atualizado_em: Some(agora),
        tempo: Vec::new(),
        concluida_em: None,
        criado_por: base.criado_por.clone(),
        serie: Some(OcorrenciaRef { serie_id: serie.id.clone(), data: proxima, excecao: false }),
    };
    let nome = naming::sanitizar_nome_arquivo(&fm.titulo);
    let destino = naming::caminho_sem_colisao(&dir, &nome, "md");
    std::fs::write(&destino, frontmatter::serialize(&fm, &modelo.corpo)?)?;
    serie.geradas.push(proxima);
    gravar(&arquivo, &serie)?;
    Ok(Some(fm.id))
}

/// Resumo da série para a API (`serie` no `GET /tarefas/:id`).
fn resumo(serie: &SerieTarefa, ocorrencia: &OcorrenciaRef) -> serde_json::Value {
    serde_json::json!({
        "serie_id": serie.id,
        "estado": serie.estado,
        "regra": serie.regra,
        "ocorrencia_data": ocorrencia.data,
        "excecao": ocorrencia.excecao,
        "total_geradas": serie.geradas.len(),
        "puladas": serie.puladas,
        "proxima_data": serie.proxima_a_gerar(ocorrencia.data),
    })
}

/// `serie` da Tarefa para o `GET`, ou `None` se não for recorrente (ou o arquivo da série sumiu).
pub fn resumo_da_tarefa(state: &AppState, fm: &TarefaFrontMatter) -> Option<serde_json::Value> {
    let ocorrencia = fm.serie.as_ref()?;
    let (serie, _) = ler(&state.config.notes_root, &ocorrencia.serie_id)?;
    Some(resumo(&serie, ocorrencia))
}

fn topo_do_caminho(caminho_relativo: &str) -> &str {
    caminho_relativo.split('/').next().unwrap_or("")
}

fn montar_regra(payload: &RegraPayload, ancora: NaiveDate, fuso: &str) -> AppResult<RegraRecorrencia> {
    if fuso.parse::<Tz>().is_err() {
        return Err(invalido("timezone", "esperado um fuso IANA, como America/Sao_Paulo"));
    }
    let mut dias = payload.dias_semana.clone();
    dias.sort_unstable();
    dias.dedup();
    let regra = RegraRecorrencia {
        frequencia: payload.frequencia,
        intervalo: payload.intervalo,
        dias_semana: dias,
        fim_de_mes: payload.fim_de_mes,
        data_inicio: ancora,
        data_fim: payload.data_fim,
        max_ocorrencias: payload.max_ocorrencias,
        timezone: fuso.to_string(),
    };
    regra.validar().map_err(|motivo| invalido("recorrencia", motivo))?;
    Ok(regra)
}

/// Define (cria ou substitui) a regra de repetição da Tarefa. Numa Tarefa que já é de uma série, vale "esta e as
/// próximas": a contagem recomeça nesta ocorrência e o molde passa a ser o que ela tem agora.
pub async fn aplicar_regra(state: &AppState, usuario_id: &str, tarefa_id: &str, payload: RegraPayload) -> AppResult<serde_json::Value> {
    let caminho_relativo = caminho_por_id(state, usuario_id, tarefa_id).await?;
    let caminho = absoluto(state, &caminho_relativo);
    let bruto = std::fs::read_to_string(&caminho)?;
    let doc = frontmatter::parse::<TarefaFrontMatter>(&bruto)?;
    let mut fm = doc.front_matter;
    let fuso = payload.timezone.clone().filter(|f| !f.trim().is_empty()).unwrap_or_else(|| "America/Sao_Paulo".to_string());
    let tz: Tz = fuso.parse().map_err(|_| invalido("timezone", "esperado um fuso IANA, como America/Sao_Paulo"))?;
    let ancora = match &fm.serie {
        Some(s) => s.data,
        None => ancora_de(&fm, tz).ok_or_else(|| invalido("recorrencia", "defina a data da tarefa (agendamento ou prazo) antes de repeti-la"))?,
    };
    let regra = montar_regra(&payload, ancora, &fuso)?;
    let modelo = modelo_de(&fm, &doc.body, tz, ancora);

    let _trava = TRAVA.lock().await;
    let existente = fm.serie.as_ref().and_then(|s| ler(&state.config.notes_root, &s.serie_id));
    let serie = match existente {
        Some((mut serie, arquivo)) => {
            serie.regra = regra;
            serie.modelo = modelo;
            serie.estado = EstadoSerie::Ativa;
            if !serie.geradas.contains(&ancora) {
                serie.geradas.push(ancora);
            }
            gravar(&arquivo, &serie)?;
            if let Some(s) = fm.serie.as_mut() {
                s.excecao = false;
            }
            serie
        }
        None => {
            let serie = SerieTarefa { id: new_id(), regra, estado: EstadoSerie::Ativa, modelo, geradas: vec![ancora], puladas: Vec::new() };
            let arquivo = state.config.notes_root.join(topo_do_caminho(&caminho_relativo)).join(DIR).join(format!("{}.json", serie.id));
            gravar(&arquivo, &serie)?;
            fm.serie = Some(OcorrenciaRef { serie_id: serie.id.clone(), data: ancora, excecao: false });
            serie
        }
    };
    fm.atualizado_em = Some(Utc::now());
    std::fs::write(&caminho, frontmatter::serialize(&fm, &doc.body)?)?;
    drop(_trava);
    reindexar_tudo(&state.db, &state.config.notes_root).await?;
    let ocorrencia = fm.serie.expect("a Tarefa acabou de entrar na série");
    Ok(resumo(&serie, &ocorrencia))
}

pub async fn definir(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, RotaPath(id): RotaPath<String>, Json(payload): Json<RegraPayload>) -> AppResult<Json<serde_json::Value>> {
    Ok(Json(aplicar_regra(&state, &usuario.0, &id, payload).await?))
}

pub async fn obter(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, RotaPath(id): RotaPath<String>) -> AppResult<Json<serde_json::Value>> {
    let caminho_relativo = caminho_por_id(&state, &usuario.0, &id).await?;
    let doc = frontmatter::parse::<TarefaFrontMatter>(&std::fs::read_to_string(absoluto(&state, &caminho_relativo))?)?;
    resumo_da_tarefa(&state, &doc.front_matter).map(Json).ok_or(AppError::new(ErrorCode::NotFound))
}

#[derive(Debug, Deserialize)]
pub struct AcaoPayload {
    pub acao: String,
}

/// Ocorrências ainda pendentes da série (id, caminho, título), visíveis para a pessoa.
async fn pendentes(state: &AppState, usuario_id: &str, serie_id: &str) -> AppResult<Vec<(String, String, String)>> {
    let visivel = crate::espacos::visivel_sql("", usuario_id);
    let sid = serie_id.to_string();
    Ok(state
        .db
        .with(move |conn| {
            let mut stmt = conn.prepare(&format!("SELECT id, caminho_arquivo, titulo FROM tarefa WHERE serie_id = ?1 AND status = 'pendente' AND {visivel} ORDER BY ocorrencia_data"))?;
            let linhas = stmt.query_map([&sid], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await?)
}

/// Pular, pausar, retomar, encerrar ou deixar de repetir (`remover`).
pub async fn acao(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, RotaPath(id): RotaPath<String>, Json(payload): Json<AcaoPayload>) -> AppResult<Json<serde_json::Value>> {
    let caminho_relativo = caminho_por_id(&state, &usuario.0, &id).await?;
    let caminho = absoluto(&state, &caminho_relativo);
    let doc = frontmatter::parse::<TarefaFrontMatter>(&std::fs::read_to_string(&caminho)?)?;
    let mut fm = doc.front_matter;
    let Some(ocorrencia) = fm.serie.clone() else {
        return Err(invalido("tarefa", "esta tarefa não é recorrente"));
    };
    let Some((_, arquivo)) = ler(&state.config.notes_root, &ocorrencia.serie_id) else {
        return Err(AppError::new(ErrorCode::NotFound).with_message("O arquivo da série desta tarefa não foi encontrado."));
    };
    let mut proxima_id = None;
    match payload.acao.as_str() {
        "pular" => {
            marcar_pulada(&arquivo, &ocorrencia)?;
            proxima_id = gerar_proxima(&state, &ocorrencia.serie_id, ocorrencia.data, &caminho_relativo).await?;
            let dir_anexos = anexos_dir(&state, &id, &caminho_relativo);
            crate::routes::lixeira::mover(&state, &caminho_relativo, "tarefa", &fm.titulo, &dir_anexos)?;
        }
        "pausar" | "encerrar" => {
            let _trava = TRAVA.lock().await;
            let (mut serie, arquivo) = ler(&state.config.notes_root, &ocorrencia.serie_id).ok_or(AppError::new(ErrorCode::NotFound))?;
            serie.estado = if payload.acao == "pausar" { EstadoSerie::Pausada } else { EstadoSerie::Encerrada };
            gravar(&arquivo, &serie)?;
        }
        "retomar" => retomar(&state, &usuario.0, &ocorrencia, &caminho_relativo).await?,
        "remover" => {
            let _trava = TRAVA.lock().await;
            if let Some((mut serie, arquivo)) = ler(&state.config.notes_root, &ocorrencia.serie_id) {
                serie.estado = EstadoSerie::Encerrada;
                gravar(&arquivo, &serie)?;
            }
            fm.serie = None;
            fm.atualizado_em = Some(Utc::now());
            std::fs::write(&caminho, frontmatter::serialize(&fm, &doc.body)?)?;
        }
        _ => return Err(invalido("acao", "deve ser pular, pausar, retomar, encerrar ou remover")),
    }
    reindexar_tudo(&state.db, &state.config.notes_root).await?;
    Ok(Json(serde_json::json!({ "ok": true, "proxima_id": proxima_id })))
}

fn marcar_pulada(arquivo: &Path, ocorrencia: &OcorrenciaRef) -> AppResult<()> {
    let texto = std::fs::read_to_string(arquivo)?;
    let mut serie: SerieTarefa = serde_json::from_str(&texto).map_err(|_| AppError::new(ErrorCode::InternalError))?;
    if !serie.puladas.contains(&ocorrencia.data) {
        serie.puladas.push(ocorrencia.data);
    }
    gravar(arquivo, &serie)?;
    Ok(())
}

/// Reativa a série pausada: as datas que passaram enquanto ela esteve parada viram "puladas" (não são recriadas
/// como atrasadas) e a próxima a partir de hoje é gerada, se não houver ocorrência pendente.
async fn retomar(state: &AppState, usuario_id: &str, ocorrencia: &OcorrenciaRef, caminho_relativo: &str) -> AppResult<()> {
    let ultima = {
        let _trava = TRAVA.lock().await;
        let (mut serie, arquivo) = ler(&state.config.notes_root, &ocorrencia.serie_id).ok_or(AppError::new(ErrorCode::NotFound))?;
        serie.estado = EstadoSerie::Ativa;
        gravar(&arquivo, &serie)?;
        serie
    };
    if !pendentes(state, usuario_id, &ocorrencia.serie_id).await?.is_empty() {
        return Ok(());
    }
    let hoje = data_local(Utc::now(), tz_de(&ultima.regra.timezone));
    let mut cursor = ultima.geradas.iter().max().copied().unwrap_or(ocorrencia.data);
    let mut saltadas = Vec::new();
    for _ in 0..2000 {
        match ultima.regra.proxima_depois_de(cursor) {
            Some(p) if p < hoje => {
                saltadas.push(p);
                cursor = p;
            }
            _ => break,
        }
    }
    if !saltadas.is_empty() {
        let _trava = TRAVA.lock().await;
        if let Some((mut serie, arquivo)) = ler(&state.config.notes_root, &ocorrencia.serie_id) {
            for d in saltadas {
                if !serie.puladas.contains(&d) {
                    serie.puladas.push(d);
                }
            }
            gravar(&arquivo, &serie)?;
        }
    }
    gerar_proxima(state, &ocorrencia.serie_id, cursor, caminho_relativo).await?;
    Ok(())
}

/// Qual parte de uma série uma edição ou exclusão atinge.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Escopo {
    Esta,
    Proximas,
    Serie,
}

impl Escopo {
    pub fn de_texto(texto: Option<&str>) -> AppResult<Escopo> {
        match texto {
            None | Some("") | Some("esta") => Ok(Escopo::Esta),
            Some("proximas") => Ok(Escopo::Proximas),
            Some("serie") => Ok(Escopo::Serie),
            Some(_) => Err(invalido("escopo", "deve ser esta, proximas ou serie")),
        }
    }
}

/// Aplica ao molde da série (e à data-âncora) uma edição feita com escopo `Proximas`/`Serie`. `antes` é a Tarefa
/// como estava; `fm`/`corpo` já com a edição. Devolve as outras ocorrências pendentes que devem receber o mesmo molde
/// (escopo `Serie`).
pub async fn propagar_edicao(state: &AppState, usuario_id: &str, antes: &TarefaFrontMatter, fm: &mut TarefaFrontMatter, corpo: &str, escopo: Escopo) -> AppResult<Vec<String>> {
    let Some(ocorrencia) = fm.serie.clone() else { return Ok(Vec::new()) };
    let _trava = TRAVA.lock().await;
    let Some((mut serie, arquivo)) = ler(&state.config.notes_root, &ocorrencia.serie_id) else { return Ok(Vec::new()) };
    let tz = tz_de(&serie.regra.timezone);
    let ancora_antes = ocorrencia.data;
    let mudou_data = antes.scheduled_at != fm.scheduled_at || antes.due_date != fm.due_date;
    let nova_ancora = if mudou_data { ancora_de(fm, tz).unwrap_or(ancora_antes) } else { ancora_antes };

    serie.modelo = modelo_de(fm, corpo, tz, nova_ancora);
    if nova_ancora != ancora_antes {
        serie.regra.data_inicio = nova_ancora;
        serie.geradas.retain(|d| *d != ancora_antes);
        if !serie.geradas.contains(&nova_ancora) {
            serie.geradas.push(nova_ancora);
        }
        if let Some(s) = fm.serie.as_mut() {
            s.data = nova_ancora;
        }
    }
    if let Some(s) = fm.serie.as_mut() {
        s.excecao = false;
    }
    gravar(&arquivo, &serie)?;
    drop(_trava);

    if escopo != Escopo::Serie {
        return Ok(Vec::new());
    }
    let outras = pendentes(state, usuario_id, &ocorrencia.serie_id).await?;
    Ok(outras.into_iter().filter(|(id, _, _)| *id != fm.id).map(|(_, caminho, _)| caminho).collect())
}

/// Copia o molde para uma outra ocorrência pendente da série (escopo `Serie`), preservando as datas dela.
pub fn aplicar_molde_em_outra(state: &AppState, caminho_relativo: &str, molde: &TarefaFrontMatter, corpo: &str) -> AppResult<()> {
    let caminho = absoluto(state, caminho_relativo);
    let doc = frontmatter::parse::<TarefaFrontMatter>(&std::fs::read_to_string(&caminho)?)?;
    let mut fm = doc.front_matter;
    let titulo_mudou = fm.titulo != molde.titulo;
    fm.titulo = molde.titulo.clone();
    fm.duration_min = molde.duration_min;
    fm.prioridade = molde.prioridade;
    fm.tags = molde.tags.clone();
    fm.subtarefas = molde.subtarefas.iter().map(|s| Subtarefa { id: new_id(), titulo: s.titulo.clone(), concluida: false }).collect();
    if let Some(s) = fm.serie.as_mut() {
        s.excecao = false;
    }
    fm.atualizado_em = Some(Utc::now());
    let conteudo = frontmatter::serialize(&fm, corpo)?;
    let destino = if titulo_mudou {
        let dir = caminho.parent().map(Path::to_path_buf).ok_or(AppError::new(ErrorCode::InternalError))?;
        naming::caminho_sem_colisao(&dir, &naming::sanitizar_nome_arquivo(&fm.titulo), "md")
    } else {
        caminho.clone()
    };
    std::fs::write(&destino, conteudo)?;
    if destino != caminho {
        std::fs::remove_file(&caminho)?;
    }
    Ok(())
}

/// Exclusão de uma ocorrência. `Esta`: a data fica registrada como pulada e a próxima é gerada; `Proximas`: a série
/// é encerrada; `Serie`: encerrada e as outras ocorrências pendentes vão para a lixeira junto. Devolve os
/// `(caminho, título, id)` das outras ocorrências que o chamador deve mover para a lixeira.
pub async fn ao_excluir(state: &AppState, usuario_id: &str, fm: &TarefaFrontMatter, caminho_relativo: &str, escopo: Escopo) -> AppResult<Vec<(String, String, String)>> {
    let Some(ocorrencia) = fm.serie.clone() else { return Ok(Vec::new()) };
    match escopo {
        Escopo::Esta => {
            if let Some(arquivo) = localizar(&state.config.notes_root, &ocorrencia.serie_id) {
                marcar_pulada(&arquivo, &ocorrencia)?;
            }
            gerar_proxima(state, &ocorrencia.serie_id, ocorrencia.data, caminho_relativo).await?;
            Ok(Vec::new())
        }
        Escopo::Proximas | Escopo::Serie => {
            {
                let _trava = TRAVA.lock().await;
                if let Some((mut serie, arquivo)) = ler(&state.config.notes_root, &ocorrencia.serie_id) {
                    serie.estado = EstadoSerie::Encerrada;
                    if !serie.puladas.contains(&ocorrencia.data) {
                        serie.puladas.push(ocorrencia.data);
                    }
                    gravar(&arquivo, &serie)?;
                }
            }
            if escopo == Escopo::Proximas {
                return Ok(Vec::new());
            }
            let outras = pendentes(state, usuario_id, &ocorrencia.serie_id).await?;
            Ok(outras.into_iter().filter(|(id, _, _)| *id != fm.id).map(|(id, caminho, titulo)| (caminho, titulo, id)).collect())
        }
    }
}

/// Leva as ocorrências extras para a lixeira (usado pela exclusão com escopo `Serie`).
pub fn mover_para_lixeira(state: &AppState, extras: &[(String, String, String)]) -> AppResult<()> {
    for (caminho, titulo, id) in extras {
        let dir_anexos = anexos_dir(state, id, caminho);
        crate::routes::lixeira::mover(state, caminho, "tarefa", titulo, &dir_anexos)?;
    }
    Ok(())
}

#[cfg(test)]
mod testes {
    use super::*;
    use crate::auth::testes::{chamar, novo_estado, SEGREDO};
    use axum::http::StatusCode;

    async fn estado_com_usuario() -> (AppState, String) {
        let state = novo_estado();
        state
            .db
            .with(|c| {
                c.execute("INSERT INTO usuario (id, nome_usuario, senha_hash, recovery_key_hash) VALUES ('u1', 'ana', 'x', 'x')", [])?;
                Ok(())
            })
            .await
            .unwrap();
        let token = crate::auth::session::emitir_access_token("u1", SEGREDO).unwrap();
        (state, token)
    }

    async fn criar_recorrente(state: &AppState, token: &str, regra: serde_json::Value) -> String {
        let (status, criada) = chamar(state, "POST", "/api/v1/tarefas", Some(token), serde_json::json!({
            "titulo": "Regar plantas", "scheduled_at": "2026-10-05T12:00:00Z", "duration_min": 15, "tags": ["casa"],
        })).await;
        assert_eq!(status, StatusCode::OK);
        let id = criada["id"].as_str().unwrap().to_string();
        let (status, _) = chamar(state, "PUT", &format!("/api/v1/tarefas/{id}/serie"), Some(token), regra).await;
        assert_eq!(status, StatusCode::OK);
        id
    }

    async fn ocorrencias(state: &AppState) -> Vec<(String, String, String)> {
        state
            .db
            .with(|c| {
                let mut stmt = c.prepare("SELECT id, ocorrencia_data, status FROM tarefa WHERE serie_id IS NOT NULL ORDER BY ocorrencia_data")?;
                let linhas = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<Result<Vec<_>, _>>()?;
                Ok(linhas)
            })
            .await
            .unwrap()
    }

    fn semanal() -> serde_json::Value {
        serde_json::json!({ "frequencia": "diaria", "intervalo": 2, "timezone": "America/Sao_Paulo" })
    }

    #[tokio::test]
    async fn concluir_gera_a_proxima_uma_unica_vez() {
        let (state, token) = estado_com_usuario().await;
        let id = criar_recorrente(&state, &token, semanal()).await;
        assert_eq!(ocorrencias(&state).await.len(), 1);

        for _ in 0..3 {
            let (status, _) = chamar(&state, "PATCH", &format!("/api/v1/tarefas/{id}/status"), Some(&token), serde_json::json!({ "status": "concluida" })).await;
            assert_eq!(status, StatusCode::OK);
        }
        // Reabrir e concluir de novo também não recria.
        chamar(&state, "PATCH", &format!("/api/v1/tarefas/{id}/status"), Some(&token), serde_json::json!({ "status": "pendente" })).await;
        chamar(&state, "PATCH", &format!("/api/v1/tarefas/{id}/status"), Some(&token), serde_json::json!({ "status": "concluida" })).await;

        let todas = ocorrencias(&state).await;
        assert_eq!(todas.len(), 2, "{todas:?}");
        assert_eq!(todas[0].1, "2026-10-05");
        assert_eq!(todas[1].1, "2026-10-07");
        assert_eq!(todas[1].2, "pendente");

        // A nova ocorrência herda o molde e o horário (12:00Z = 09:00 em São Paulo).
        let (_, nova) = chamar(&state, "GET", &format!("/api/v1/tarefas/{}", todas[1].0), Some(&token), serde_json::Value::Null).await;
        assert_eq!(nova["titulo"], "Regar plantas");
        assert_eq!(nova["duration_min"], 15);
        assert_eq!(nova["scheduled_at"], "2026-10-07T12:00:00Z");
        assert_eq!(nova["serie"]["estado"], "ativa");
    }

    #[tokio::test]
    async fn reagendar_e_excluir_esta_ocorrencia_nao_recria_nem_desloca_a_serie() {
        let (state, token) = estado_com_usuario().await;
        let id = criar_recorrente(&state, &token, semanal()).await;
        // Reagendar só esta: a data original da série não muda.
        let (status, _) = chamar(&state, "PATCH", &format!("/api/v1/tarefas/{id}"), Some(&token), serde_json::json!({ "scheduled_at": "2026-10-06T15:00:00Z" })).await;
        assert_eq!(status, StatusCode::OK);
        let (_, t) = chamar(&state, "GET", &format!("/api/v1/tarefas/{id}"), Some(&token), serde_json::Value::Null).await;
        assert_eq!(t["serie"]["ocorrencia_data"], "2026-10-05");

        // Excluir só esta: a data vira "pulada" e a próxima nasce; excluir de novo não duplica.
        let (status, _) = chamar(&state, "DELETE", &format!("/api/v1/tarefas/{id}"), Some(&token), serde_json::Value::Null).await;
        assert_eq!(status, StatusCode::OK);
        let todas = ocorrencias(&state).await;
        assert_eq!(todas.len(), 1, "{todas:?}");
        assert_eq!(todas[0].1, "2026-10-07");

        let proxima = todas[0].0.clone();
        let (_, resumo) = chamar(&state, "GET", &format!("/api/v1/tarefas/{proxima}/serie"), Some(&token), serde_json::Value::Null).await;
        assert_eq!(resumo["puladas"], serde_json::json!(["2026-10-05"]));
    }

    #[tokio::test]
    async fn pausar_nao_gera_e_retomar_pula_o_que_ficou_para_tras() {
        let (state, token) = estado_com_usuario().await;
        let id = criar_recorrente(&state, &token, semanal()).await;
        let (status, _) = chamar(&state, "POST", &format!("/api/v1/tarefas/{id}/serie/acao"), Some(&token), serde_json::json!({ "acao": "pausar" })).await;
        assert_eq!(status, StatusCode::OK);
        chamar(&state, "PATCH", &format!("/api/v1/tarefas/{id}/status"), Some(&token), serde_json::json!({ "status": "concluida" })).await;
        assert_eq!(ocorrencias(&state).await.len(), 1, "série pausada não gera");

        let (status, _) = chamar(&state, "POST", &format!("/api/v1/tarefas/{id}/serie/acao"), Some(&token), serde_json::json!({ "acao": "retomar" })).await;
        assert_eq!(status, StatusCode::OK);
        let todas = ocorrencias(&state).await;
        assert_eq!(todas.len(), 2, "{todas:?}");
        let hoje = Utc::now().date_naive().to_string();
        assert!(todas[1].1 >= hoje, "a nova ocorrência não nasce no passado: {todas:?}");
        // Retomar de novo não duplica (já há uma pendente).
        chamar(&state, "POST", &format!("/api/v1/tarefas/{id}/serie/acao"), Some(&token), serde_json::json!({ "acao": "retomar" })).await;
        assert_eq!(ocorrencias(&state).await.len(), 2);
    }

    #[tokio::test]
    async fn editar_proximas_muda_o_molde_e_so_esta_fica_como_excecao() {
        let (state, token) = estado_com_usuario().await;
        let id = criar_recorrente(&state, &token, semanal()).await;
        // Só esta: título muda aqui, a próxima continua com o molde original.
        chamar(&state, "PATCH", &format!("/api/v1/tarefas/{id}"), Some(&token), serde_json::json!({ "titulo": "Regar só hoje", "escopo": "esta" })).await;
        let (_, t) = chamar(&state, "GET", &format!("/api/v1/tarefas/{id}"), Some(&token), serde_json::Value::Null).await;
        assert_eq!(t["serie"]["excecao"], true);
        chamar(&state, "PATCH", &format!("/api/v1/tarefas/{id}/status"), Some(&token), serde_json::json!({ "status": "concluida" })).await;
        let segunda = ocorrencias(&state).await[1].0.clone();
        let (_, t2) = chamar(&state, "GET", &format!("/api/v1/tarefas/{segunda}"), Some(&token), serde_json::Value::Null).await;
        assert_eq!(t2["titulo"], "Regar plantas");

        // Esta e as próximas: o molde muda e a terceira nasce com o novo título.
        chamar(&state, "PATCH", &format!("/api/v1/tarefas/{segunda}"), Some(&token), serde_json::json!({ "titulo": "Regar com adubo", "escopo": "proximas" })).await;
        chamar(&state, "PATCH", &format!("/api/v1/tarefas/{segunda}/status"), Some(&token), serde_json::json!({ "status": "concluida" })).await;
        let todas = ocorrencias(&state).await;
        assert_eq!(todas.len(), 3);
        let (_, t3) = chamar(&state, "GET", &format!("/api/v1/tarefas/{}", todas[2].0), Some(&token), serde_json::Value::Null).await;
        assert_eq!(t3["titulo"], "Regar com adubo");
    }

    #[tokio::test]
    async fn reindex_preserva_a_serie_e_data_fim_encerra() {
        let (state, token) = estado_com_usuario().await;
        let mut regra = semanal();
        regra["max_ocorrencias"] = serde_json::json!(2);
        let id = criar_recorrente(&state, &token, regra).await;
        chamar(&state, "PATCH", &format!("/api/v1/tarefas/{id}/status"), Some(&token), serde_json::json!({ "status": "concluida" })).await;
        let segunda = ocorrencias(&state).await[1].0.clone();
        // Reindex do zero: a série volta do front-matter + arquivo de série.
        crate::db::reindex::reindexar_tudo(&state.db, &state.config.notes_root).await.unwrap();
        assert_eq!(ocorrencias(&state).await.len(), 2);
        chamar(&state, "PATCH", &format!("/api/v1/tarefas/{segunda}/status"), Some(&token), serde_json::json!({ "status": "concluida" })).await;
        assert_eq!(ocorrencias(&state).await.len(), 2, "max_ocorrencias = 2 encerra a série");
    }

    #[tokio::test]
    async fn regra_invalida_e_tarefa_sem_data_sao_recusadas() {
        let (state, token) = estado_com_usuario().await;
        let (_, sem_data) = chamar(&state, "POST", "/api/v1/tarefas", Some(&token), serde_json::json!({ "titulo": "Sem data" })).await;
        let id = sem_data["id"].as_str().unwrap();
        let (status, _) = chamar(&state, "PUT", &format!("/api/v1/tarefas/{id}/serie"), Some(&token), semanal()).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

        let (_, com_data) = chamar(&state, "POST", "/api/v1/tarefas", Some(&token), serde_json::json!({ "titulo": "Com data", "due_date": "2026-10-05" })).await;
        let id = com_data["id"].as_str().unwrap();
        for regra in [
            serde_json::json!({ "frequencia": "diaria", "intervalo": 0, "timezone": "America/Sao_Paulo" }),
            serde_json::json!({ "frequencia": "diaria", "timezone": "Marte/Olimpo" }),
            serde_json::json!({ "frequencia": "semanal", "dias_semana": [9], "timezone": "UTC" }),
        ] {
            let (status, _) = chamar(&state, "PUT", &format!("/api/v1/tarefas/{id}/serie"), Some(&token), regra).await;
            assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        }
    }
}
