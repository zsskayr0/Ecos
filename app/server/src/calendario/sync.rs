//! Sincronização com o Google Calendar. PULL (Google → `.md`): carga inicial com `timeMin`, depois
//! incremental com `syncToken`; `410 Gone` refaz a carga completa. O evento local é achado pelo `event_id` do
//! Google (ou, num evento que já nasceu no Ecos, por `extendedProperties.private.ecos_id`).
//!
//! Conflito (seção 6.5): vale o mais recente entre `updated` (Google) e `atualizado_em` (local). Edição local
//! ainda não enviada e mais nova que a do Google é preservada.
//!
//! PUSH (Ecos → Google), depois do pull no mesmo ciclo: cria o que nasceu no Ecos, atualiza com `If-Match` (412 =
//! mudou lá: adia e o próximo pull decide pelo mais recente), apaga no Google o que foi excluído aqui ou tornado
//! privado. Exclusões locais ficam em `evento_exclusao_google` até serem enviadas.

use super::crypto::Cofre;
use super::google::{self, EventoGoogle, GoogleErro};
use crate::config::GoogleConfig;
use crate::db::reindex::reindexar_tudo;
use crate::eventos_fs;
use crate::state::AppState;
use chrono::{DateTime, Duration, NaiveDate, SecondsFormat, TimeZone, Utc};
use ecos_core::types::{Espaco, EventoFrontMatter, EventoVisibilidade, Excecao, GoogleRef};
use ecos_core::{frontmatter, naming, new_id};
use rusqlite::{params, OptionalExtension};
use std::collections::HashMap;

/// A carga inicial olha para trás este tanto (o usuário quer somar o tempo já gasto).
const JANELA_INICIAL_DIAS: i64 = 90;
const MAX_PAGINAS: usize = 40;
const MARGEM_TOKEN_SEG: i64 = 60;

/// Um sync por vez (job periódico e botão "sincronizar agora" não se pisam).
static TRAVA: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Debug, Default, Clone, serde::Serialize, PartialEq, Eq)]
pub struct ResumoSync {
    pub criados: usize,
    pub atualizados: usize,
    pub removidos: usize,
    pub inalterados: usize,
    /// Edição local pendente e mais nova que a do Google: mantida (o envio é da Fase 3).
    pub conflitos_mantidos_locais: usize,
    /// Ocorrências de séries (remarcadas, editadas ou canceladas no Google) aplicadas neste ciclo.
    pub excecoes_aplicadas: usize,
    /// Exceções cuja série não existe no Ecos (ex.: série mais antiga que a janela importada).
    pub excecoes_ignoradas: usize,
    /// `true` quando foi carga completa (primeira vez, ou depois de um `410`).
    pub completa: bool,
    /// Eventos do Ecos criados no Google neste ciclo.
    pub enviados_criados: usize,
    pub enviados_atualizados: usize,
    /// Apagados no Google (excluídos ou tornados privados no Ecos).
    pub removidos_no_google: usize,
    /// Mudaram no Google desde a última leitura (412): ficam para o próximo ciclo decidir pelo mais recente.
    pub envios_adiados: usize,
    /// Recusados pelo Google (dados inválidos): ficam pendentes e são tentados de novo.
    pub envios_com_erro: usize,
}

#[derive(Debug)]
pub enum SyncErro {
    /// Sem `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` no ambiente.
    Desligado,
    NaoConectado,
    PrecisaReconectar,
    Google(GoogleErro),
    Interno(String),
}

impl std::fmt::Display for SyncErro {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SyncErro::Desligado => write!(f, "integração com o Google desligada (faltam GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET)"),
            SyncErro::NaoConectado => write!(f, "nenhuma conta Google conectada"),
            SyncErro::PrecisaReconectar => write!(f, "o acesso ao Google foi revogado ou expirou: reconecte a conta"),
            SyncErro::Google(e) => write!(f, "{e}"),
            SyncErro::Interno(m) => write!(f, "erro interno: {m}"),
        }
    }
}

impl From<GoogleErro> for SyncErro {
    fn from(e: GoogleErro) -> Self {
        match e {
            GoogleErro::InvalidGrant => SyncErro::PrecisaReconectar,
            outro => SyncErro::Google(outro),
        }
    }
}
impl From<rusqlite::Error> for SyncErro {
    fn from(e: rusqlite::Error) -> Self { SyncErro::Interno(e.to_string()) }
}
impl From<anyhow::Error> for SyncErro {
    fn from(e: anyhow::Error) -> Self { SyncErro::Interno(e.to_string()) }
}
impl From<std::io::Error> for SyncErro {
    fn from(e: std::io::Error) -> Self { SyncErro::Interno(e.to_string()) }
}
impl From<ecos_core::frontmatter::FrontMatterError> for SyncErro {
    fn from(e: ecos_core::frontmatter::FrontMatterError) -> Self { SyncErro::Interno(e.to_string()) }
}
impl From<crate::error::AppError> for SyncErro {
    fn from(e: crate::error::AppError) -> Self { SyncErro::Interno(format!("{e:?}")) }
}

type R<T> = Result<T, SyncErro>;

struct Linha {
    calendar_id: Option<String>,
    fuso: Option<String>,
    sync_cursor: Option<String>,
    access: Option<Vec<u8>>,
    refresh: Option<Vec<u8>>,
    expira: Option<String>,
    precisa_reconectar: bool,
}

async fn ler_linha(state: &AppState, usuario_id: &str) -> R<Option<Linha>> {
    let usuario = usuario_id.to_string();
    Ok(state
        .db
        .with(move |conn| {
            conn.query_row(
                "SELECT calendar_id, fuso, sync_cursor, access_token_encrypted, refresh_token_encrypted, access_expira_em, precisa_reconectar \
                 FROM config_calendario WHERE usuario_id = ?1 AND provider = 'google'",
                [&usuario],
                |r| Ok(Linha { calendar_id: r.get(0)?, fuso: r.get(1)?, sync_cursor: r.get(2)?, access: r.get(3)?, refresh: r.get(4)?, expira: r.get(5)?, precisa_reconectar: r.get(6)? }),
            )
            .optional()
        })
        .await?)
}

/// Usuários com Google conectado e sem pendência de reconexão (o que o job percorre).
pub async fn usuarios_para_sincronizar(state: &AppState) -> R<Vec<String>> {
    Ok(state
        .db
        .with(|conn| {
            let mut stmt = conn.prepare("SELECT usuario_id FROM config_calendario WHERE provider = 'google' AND precisa_reconectar = 0")?;
            let ids = stmt.query_map([], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
            Ok(ids)
        })
        .await?)
}

/// Access token vigente; renova com o refresh token quando falta pouco para vencer.
async fn token_de_acesso(state: &AppState, cfg: &GoogleConfig, cofre: &Cofre, usuario_id: &str, linha: &Linha) -> R<String> {
    let agora = Utc::now();
    let vigente = linha.expira.as_deref().and_then(|e| DateTime::parse_from_rfc3339(e).ok()).is_some_and(|e| e.with_timezone(&Utc) > agora + Duration::seconds(MARGEM_TOKEN_SEG));
    if vigente {
        if let Some(bytes) = &linha.access {
            return Ok(String::from_utf8(cofre.decifrar(bytes)?).map_err(|_| SyncErro::Interno("access token corrompido".into()))?);
        }
    }
    let refresh = linha.refresh.as_ref().ok_or(SyncErro::PrecisaReconectar)?;
    let refresh = String::from_utf8(cofre.decifrar(refresh)?).map_err(|_| SyncErro::Interno("refresh token corrompido".into()))?;
    let novo = match google::renovar(&state.http, cfg, &refresh).await {
        Ok(t) => t,
        Err(GoogleErro::InvalidGrant) => {
            marcar_reconexao(state, usuario_id).await;
            return Err(SyncErro::PrecisaReconectar);
        }
        Err(e) => return Err(e.into()),
    };
    let expira = (agora + Duration::seconds(novo.expires_in.unwrap_or(3600))).to_rfc3339();
    let access_cifrado = cofre.cifrar(novo.access_token.as_bytes())?;
    // O Google só reenvia o refresh token de vez em quando; se vier um novo, ele passa a valer.
    let refresh_cifrado = novo.refresh_token.as_deref().map(|r| cofre.cifrar(r.as_bytes())).transpose()?;
    let usuario = usuario_id.to_string();
    state
        .db
        .with(move |conn| {
            conn.execute(
                "UPDATE config_calendario SET access_token_encrypted = ?1, access_expira_em = ?2, \
                 refresh_token_encrypted = COALESCE(?3, refresh_token_encrypted) WHERE usuario_id = ?4 AND provider = 'google'",
                params![access_cifrado, expira, refresh_cifrado, usuario],
            )
        })
        .await?;
    Ok(novo.access_token)
}

async fn marcar_reconexao(state: &AppState, usuario_id: &str) {
    let usuario = usuario_id.to_string();
    let _ = state
        .db
        .with(move |conn| {
            conn.execute(
                "UPDATE config_calendario SET precisa_reconectar = 1, ultimo_erro = ?1 WHERE usuario_id = ?2 AND provider = 'google'",
                params![SyncErro::PrecisaReconectar.to_string(), usuario],
            )
        })
        .await;
}

/// Sincroniza (Google → Ecos) a conta do usuário. Seguro de chamar de vários lugares ao mesmo tempo.
pub async fn sincronizar(state: &AppState, usuario_id: &str) -> R<ResumoSync> {
    let cfg = state.config.google.clone().ok_or(SyncErro::Desligado)?;
    let _um_por_vez = TRAVA.lock().await;
    let resultado = executar(state, &cfg, usuario_id).await;
    let usuario = usuario_id.to_string();
    let (agora, erro) = (Utc::now().to_rfc3339(), resultado.as_ref().err().map(|e| e.to_string()));
    match &resultado {
        Ok(r) => tracing::info!(provider = "google", criados = r.criados, atualizados = r.atualizados, removidos = r.removidos, inalterados = r.inalterados, conflitos = r.conflitos_mantidos_locais, excecoes_ignoradas = r.excecoes_ignoradas, completa = r.completa, enviados_criados = r.enviados_criados, enviados_atualizados = r.enviados_atualizados, removidos_no_google = r.removidos_no_google, envios_adiados = r.envios_adiados, envios_com_erro = r.envios_com_erro, "sync do calendário concluído"),
        Err(e) => tracing::warn!(provider = "google", error = %e, "sync do calendário falhou"),
    }
    let ok = erro.is_none();
    let _ = state
        .db
        .with(move |conn| {
            if ok {
                conn.execute("UPDATE config_calendario SET ultima_sync_em = ?1, ultimo_erro = NULL WHERE usuario_id = ?2 AND provider = 'google'", params![agora, usuario])
            } else {
                conn.execute("UPDATE config_calendario SET ultimo_erro = ?1 WHERE usuario_id = ?2 AND provider = 'google'", params![erro, usuario])
            }
        })
        .await;
    resultado
}

async fn executar(state: &AppState, cfg: &GoogleConfig, usuario_id: &str) -> R<ResumoSync> {
    let linha = ler_linha(state, usuario_id).await?.ok_or(SyncErro::NaoConectado)?;
    if linha.precisa_reconectar {
        return Err(SyncErro::PrecisaReconectar);
    }
    let cofre = Cofre::carregar(&state.config.notes_root)?;
    let access = token_de_acesso(state, cfg, &cofre, usuario_id, &linha).await?;
    let calendar_id = linha.calendar_id.clone().unwrap_or_else(|| "primary".into());
    let fuso = linha.fuso.clone().unwrap_or_else(|| "UTC".into());

    let mut completa = linha.sync_cursor.is_none();
    let (eventos, proximo_cursor) = match coletar(state, cfg, &access, &calendar_id, linha.sync_cursor.as_deref()).await {
        Ok(v) => v,
        Err(GoogleErro::Gone) if linha.sync_cursor.is_some() => {
            tracing::info!("syncToken vencido (410): refazendo a carga completa");
            completa = true;
            coletar(state, cfg, &access, &calendar_id, None).await?
        }
        Err(e) => return Err(e.into()),
    };

    let mut resumo = aplicar(state, usuario_id, &eventos, &fuso, &calendar_id).await?;
    resumo.completa = completa;

    // Só depois de aplicar tudo: se algo falhar antes, o próximo ciclo repete a mesma janela.
    if let Some(cursor) = proximo_cursor {
        let usuario = usuario_id.to_string();
        state.db.with(move |conn| conn.execute("UPDATE config_calendario SET sync_cursor = ?1 WHERE usuario_id = ?2 AND provider = 'google'", params![cursor, usuario])).await?;
    } else if completa {
        // Carga completa sem cursor novo não é esperada; deixar o antigo (vencido) faria o 410 se repetir.
        let usuario = usuario_id.to_string();
        state.db.with(move |conn| conn.execute("UPDATE config_calendario SET sync_cursor = NULL WHERE usuario_id = ?1 AND provider = 'google'", [usuario])).await?;
    }

    // Só depois do pull: o que o Google tem de mais novo já foi aplicado e a pendência local que sobrou é a que vale.
    enviar(state, cfg, &access, &calendar_id, &fuso, &mut resumo).await?;
    Ok(resumo)
}

async fn coletar(state: &AppState, cfg: &GoogleConfig, access: &str, calendar_id: &str, cursor: Option<&str>) -> Result<(Vec<EventoGoogle>, Option<String>), GoogleErro> {
    let time_min = (Utc::now() - Duration::days(JANELA_INICIAL_DIAS)).to_rfc3339();
    let mut eventos = Vec::new();
    let mut pagina: Option<String> = None;
    for _ in 0..MAX_PAGINAS {
        let p = google::listar_eventos(&state.http, cfg, access, calendar_id, cursor, Some(&time_min), pagina.as_deref()).await?;
        eventos.extend(p.items);
        match (p.next_page_token, p.next_sync_token) {
            (Some(prox), _) => pagina = Some(prox),
            (None, sync) => return Ok((eventos, sync)),
        }
    }
    Err(GoogleErro::Rede(format!("mais de {MAX_PAGINAS} páginas de eventos numa só sincronização")))
}

// ---------------------------------------------------------------------
// Google -> evento local
// ---------------------------------------------------------------------

#[derive(Debug, PartialEq)]
pub struct Convertido {
    pub titulo: String,
    pub inicio: DateTime<Utc>,
    pub fim: DateTime<Utc>,
    pub dia_inteiro: bool,
    pub fuso: String,
    pub local: Option<String>,
    pub descricao: String,
    pub rrule: Option<String>,
    /// EXDATE/RDATE/EXRULE da série.
    pub recorrencia_extra: Vec<String>,
    pub categoria_pref: Option<String>,
    pub ecos_id: Option<String>,
    pub updated: Option<DateTime<Utc>>,
}

fn meia_noite_em(tz: chrono_tz::Tz, dia: NaiveDate) -> Option<DateTime<Utc>> {
    let naive = dia.and_hms_opt(0, 0, 0)?;
    // Em fusos cuja meia-noite não existe (salto de horário de verão) vale o primeiro instante depois dela.
    tz.from_local_datetime(&naive).earliest().or_else(|| tz.from_local_datetime(&naive).latest()).map(|d| d.with_timezone(&Utc))
}

/// `None` = evento sem início/fim utilizável. `fuso_calendario` resolve o dia inteiro (que no Google é só uma data).
pub fn converter(ev: &EventoGoogle, fuso_calendario: &str) -> Option<Convertido> {
    let (ini, fim) = (ev.start.as_ref()?, ev.end.as_ref()?);
    let tz_padrao: chrono_tz::Tz = fuso_calendario.parse().unwrap_or(chrono_tz::UTC);
    let (inicio, fim, dia_inteiro, fuso) = if let (Some(a), Some(b)) = (&ini.date_time, &fim.date_time) {
        let a = DateTime::parse_from_rfc3339(a).ok()?.with_timezone(&Utc);
        let b = DateTime::parse_from_rfc3339(b).ok()?.with_timezone(&Utc);
        (a, b, false, ini.time_zone.clone().unwrap_or_else(|| fuso_calendario.to_string()))
    } else if let (Some(a), Some(b)) = (&ini.date, &fim.date) {
        let a = meia_noite_em(tz_padrao, a.parse().ok()?)?;
        // No Google o fim de um dia inteiro é exclusivo: já é a meia-noite do dia seguinte, como no Ecos.
        let b = meia_noite_em(tz_padrao, b.parse().ok()?)?;
        (a, b, true, fuso_calendario.to_string())
    } else {
        return None;
    };
    let privadas = ev.extended_properties.as_ref().map(|e| &e.private);
    Some(Convertido {
        titulo: ev.summary.as_deref().map(str::trim).filter(|t| !t.is_empty()).unwrap_or("(sem título)").to_string(),
        inicio,
        fim,
        dia_inteiro,
        fuso,
        local: ev.location.as_deref().map(str::trim).filter(|l| !l.is_empty()).map(str::to_string),
        descricao: ev.description.clone().unwrap_or_default(),
        rrule: ev.recurrence.iter().flatten().find(|r| r.starts_with("RRULE:")).cloned(),
        recorrencia_extra: ev.recurrence.iter().flatten().filter(|r| !r.starts_with("RRULE:")).cloned().collect(),
        categoria_pref: privadas.and_then(|p| p.get("ecos_categoria")).cloned(),
        ecos_id: privadas.and_then(|p| p.get("ecos_id")).cloned(),
        updated: ev.updated.as_deref().and_then(|u| DateTime::parse_from_rfc3339(u).ok()).map(|d| d.with_timezone(&Utc)),
    })
}

// ---------------------------------------------------------------------
// Aplicação no disco
// ---------------------------------------------------------------------

struct Local {
    caminho: String,
    titulo: String,
    etag: Option<String>,
    pendente: bool,
}

async fn achar_local(state: &AppState, google_id: &str, ecos_id: Option<&str>) -> R<Option<Local>> {
    let (g, e) = (google_id.to_string(), ecos_id.map(str::to_string));
    Ok(state
        .db
        .with(move |conn| {
            let colunas = "caminho_arquivo, titulo, google_etag, sync_pendente";
            let mapear = |r: &rusqlite::Row<'_>| Ok(Local { caminho: r.get(0)?, titulo: r.get(1)?, etag: r.get(2)?, pendente: r.get(3)? });
            if let Some(l) = conn.query_row(&format!("SELECT {colunas} FROM evento WHERE google_event_id = ?1"), [&g], mapear).optional()? {
                return Ok(Some(l));
            }
            // Evento nascido no Ecos cujo vínculo com o Google ainda não foi gravado (ou foi perdido ao desconectar).
            match e {
                Some(ecos) => conn.query_row(&format!("SELECT {colunas} FROM evento WHERE id = ?1 AND google_event_id IS NULL"), [&ecos], mapear).optional(),
                None => Ok(None),
            }
        })
        .await?)
}

async fn aplicar(state: &AppState, usuario_id: &str, eventos: &[EventoGoogle], fuso: &str, calendar_id: &str) -> R<ResumoSync> {
    let mut resumo = ResumoSync::default();
    let dir = crate::espacos::raiz(state, "pessoal", eventos_fs::DIR).await?;
    let categorias = eventos_fs::ler_categorias(&dir);

    // Se o mesmo evento aparece mais de uma vez no lote, vale a última versão.
    let mut ultimo: HashMap<&str, usize> = HashMap::new();
    for (i, e) in eventos.iter().enumerate() {
        ultimo.insert(e.id.as_str(), i);
    }

    let mut mudou = false;
    let mut excecoes: Vec<&EventoGoogle> = Vec::new();
    for (i, ev) in eventos.iter().enumerate() {
        if ultimo.get(ev.id.as_str()) != Some(&i) {
            continue;
        }
        if ev.recurring_event_id.is_some() {
            excecoes.push(ev); // depende da série já estar no disco: entra na segunda passada
            continue;
        }
        let conv = if ev.cancelado() { None } else { converter(ev, fuso) };
        let ecos_id = ev.extended_properties.as_ref().and_then(|e| e.private.get("ecos_id")).map(String::as_str);
        let local = achar_local(state, &ev.id, ecos_id).await?;

        if ev.cancelado() {
            if let Some(l) = local {
                crate::routes::lixeira::mover(state, &l.caminho, "evento", &l.titulo, std::path::Path::new(""))?;
                resumo.removidos += 1;
                mudou = true;
            }
            continue;
        }
        let Some(conv) = conv else {
            tracing::warn!(google_event_id = %ev.id, "evento do Google sem início/fim utilizável; ignorado");
            continue;
        };
        let categoria = conv.categoria_pref.as_ref().filter(|c| categorias.iter().any(|x| &x.id == *c)).cloned();
        let ref_google = GoogleRef { calendar_id: Some(calendar_id.to_string()), event_id: Some(ev.id.clone()), etag: ev.etag.clone(), updated: conv.updated };

        match local {
            None => {
                let agora = Utc::now();
                let fm = EventoFrontMatter {
                    id: new_id(),
                    titulo: conv.titulo.clone(),
                    inicio: conv.inicio,
                    fim: conv.fim,
                    dia_inteiro: conv.dia_inteiro,
                    fuso: Some(conv.fuso.clone()),
                    local: conv.local.clone(),
                    categoria_id: categoria,
                    cor: None,
                    visibilidade: EventoVisibilidade::Google,
                    rrule: conv.rrule.clone(),
                    recorrencia_extra: conv.recorrencia_extra.clone(),
                    excecoes: Vec::new(),
                    tarefas: Vec::new(),
                    notas: Vec::new(),
                    google: ref_google,
                    sync_pendente: false,
                    espaco: Espaco::Pessoal,
                    criado_em: conv.updated.unwrap_or(agora),
                    atualizado_em: conv.updated.unwrap_or(agora),
                    criado_por: Some(usuario_id.to_string()),
                };
                let caminho = naming::caminho_sem_colisao(&dir, &naming::sanitizar_nome_arquivo(&fm.titulo), "md");
                std::fs::write(&caminho, frontmatter::serialize(&fm, &conv.descricao)?)?;
                resumo.criados += 1;
                mudou = true;
            }
            Some(l) => {
                if l.etag.is_some() && l.etag == ev.etag {
                    resumo.inalterados += 1;
                    continue;
                }
                let atual = state.config.notes_root.join(&l.caminho);
                let doc = frontmatter::parse::<EventoFrontMatter>(&std::fs::read_to_string(&atual)?)?;
                let (mut fm, mut corpo) = (doc.front_matter, doc.body);
                let google_mais_novo = match (conv.updated, fm.atualizado_em) {
                    (Some(g), local) => g >= local,
                    (None, _) => true,
                };
                if l.pendente && !google_mais_novo {
                    // Vale a edição local; só guardamos o etag novo para o envio (Fase 3) não tomar 412.
                    fm.google = GoogleRef { etag: ev.etag.clone(), ..ref_google };
                    resumo.conflitos_mantidos_locais += 1;
                } else {
                    fm.titulo = conv.titulo.clone();
                    fm.inicio = conv.inicio;
                    fm.fim = conv.fim;
                    fm.dia_inteiro = conv.dia_inteiro;
                    fm.fuso = Some(conv.fuso.clone());
                    fm.local = conv.local.clone();
                    fm.rrule = conv.rrule.clone();
                    fm.recorrencia_extra = conv.recorrencia_extra.clone();
                    if categoria.is_some() {
                        fm.categoria_id = categoria;
                    }
                    fm.visibilidade = EventoVisibilidade::Google;
                    fm.google = ref_google;
                    fm.sync_pendente = false;
                    fm.atualizado_em = conv.updated.unwrap_or_else(Utc::now);
                    corpo = conv.descricao.clone();
                    resumo.atualizados += 1;
                }
                let conteudo = frontmatter::serialize(&fm, &corpo)?;
                if fm.titulo != l.titulo {
                    let pai = atual.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| dir.clone());
                    let destino = naming::caminho_sem_colisao(&pai, &naming::sanitizar_nome_arquivo(&fm.titulo), "md");
                    std::fs::write(&destino, conteudo)?;
                    std::fs::remove_file(&atual)?;
                } else {
                    std::fs::write(&atual, conteudo)?;
                }
                mudou = true;
            }
        }
    }
    if mudou {
        reindexar_tudo(&state.db, &state.config.notes_root).await?;
    }

    // Segunda passada: as séries (e o índice delas) já existem, então dá para pendurar as exceções nelas.
    let mut mudou_excecoes = false;
    for ev in excecoes {
        mudou_excecoes |= aplicar_excecao(state, ev, fuso, calendar_id, &mut resumo).await?;
    }
    if mudou_excecoes {
        reindexar_tudo(&state.db, &state.config.notes_root).await?;
    }
    Ok(resumo)
}

/// Início original da ocorrência a que uma exceção se refere (a chave dela).
fn original_da(ev: &EventoGoogle, fuso_calendario: &str) -> Option<DateTime<Utc>> {
    let q = ev.original_start_time.as_ref()?;
    if let Some(dt) = &q.date_time {
        return DateTime::parse_from_rfc3339(dt).ok().map(|d| d.with_timezone(&Utc));
    }
    let tz: chrono_tz::Tz = fuso_calendario.parse().unwrap_or(chrono_tz::UTC);
    meia_noite_em(tz, q.date.as_ref()?.parse().ok()?)
}

/// Uma ocorrência remarcada, editada ou cancelada no Google entra na série (`excecoes:` do `.md`), só com o que mudou.
/// Mesmo critério de conflito das outras: edição local pendente e mais nova que a do Google é mantida.
async fn aplicar_excecao(state: &AppState, ev: &EventoGoogle, fuso: &str, calendar_id: &str, resumo: &mut ResumoSync) -> R<bool> {
    let Some(mestre_id) = ev.recurring_event_id.as_deref() else { return Ok(false) };
    let (Some(local), Some(original)) = (achar_local(state, mestre_id, None).await?, original_da(ev, fuso)) else {
        resumo.excecoes_ignoradas += 1;
        return Ok(false);
    };
    let arquivo = state.config.notes_root.join(&local.caminho);
    let doc = frontmatter::parse::<EventoFrontMatter>(&std::fs::read_to_string(&arquivo)?)?;
    let (mut fm, corpo) = (doc.front_matter, doc.body);
    let atualizado = ev.updated.as_deref().and_then(|u| DateTime::parse_from_rfc3339(u).ok()).map(|d| d.with_timezone(&Utc));

    let posicao = fm.excecoes.iter().position(|x| (x.original - original).num_seconds().abs() < 60);
    if let Some(i) = posicao {
        let atual = &mut fm.excecoes[i];
        if atual.google.etag.is_some() && atual.google.etag == ev.etag {
            resumo.inalterados += 1;
            return Ok(false);
        }
        if atual.sync_pendente && atualizado.is_some_and(|g| g < atual.atualizado_em) {
            // Vale a edição local; só guardamos o etag novo para o envio não tomar 412.
            atual.google.etag = ev.etag.clone();
            resumo.conflitos_mantidos_locais += 1;
            std::fs::write(&arquivo, frontmatter::serialize(&fm, &corpo)?)?;
            return Ok(true);
        }
    }

    let mut nova = Excecao {
        original,
        cancelada: ev.cancelado(),
        titulo: None,
        inicio: None,
        fim: None,
        local: None,
        descricao: None,
        google: GoogleRef { calendar_id: Some(calendar_id.to_string()), event_id: Some(ev.id.clone()), etag: ev.etag.clone(), updated: atualizado },
        sync_pendente: false,
        atualizado_em: atualizado.unwrap_or_else(Utc::now),
    };
    if !nova.cancelada {
        let Some(conv) = converter(ev, fuso) else {
            resumo.excecoes_ignoradas += 1;
            return Ok(false);
        };
        // Só o que difere da série: o resto continua herdando dela (uma edição posterior da série vale para essas ocorrências).
        // (Duração igual à da série = sem `fim` próprio, mesmo que o início tenha sido remarcado.)
        let fim_padrao = conv.inicio + (fm.fim - fm.inicio);
        let tolerancia = if fm.dia_inteiro { 2 * 3600 } else { 60 }; // dia inteiro: horário de verão muda a duração em horas
        if conv.titulo != fm.titulo {
            nova.titulo = Some(conv.titulo.clone());
        }
        if conv.inicio != original {
            nova.inicio = Some(conv.inicio);
        }
        if (conv.fim - fim_padrao).num_seconds().abs() > tolerancia {
            nova.fim = Some(conv.fim);
        }
        if conv.local.as_deref().unwrap_or("") != fm.local.as_deref().unwrap_or("") {
            nova.local = Some(conv.local.clone().unwrap_or_default());
        }
        if conv.descricao != corpo {
            nova.descricao = Some(conv.descricao.clone());
        }
    }
    match posicao {
        Some(i) => fm.excecoes[i] = nova,
        None => fm.excecoes.push(nova),
    }
    fm.excecoes.sort_by_key(|x| x.original);
    std::fs::write(&arquivo, frontmatter::serialize(&fm, &corpo)?)?;
    resumo.excecoes_aplicadas += 1;
    Ok(true)
}

// ---------------------------------------------------------------------
// Ecos -> Google
// ---------------------------------------------------------------------

/// Falha que não adianta insistir agora (rede, limite de uso, erro do Google): aborta o envio e o job tenta depois.
fn transitorio(e: &GoogleErro) -> bool {
    matches!(e, GoogleErro::Rede(_) | GoogleErro::Http { status: 429 | 500..=599, .. })
}

/// Corpo do evento para a API do Google. `para_criar` tira os campos vazios (num `PATCH`, `null` é como se limpa um campo).
/// `extendedProperties.private` leva o id e a categoria do Ecos: sobrevivem a edições feitas no Google.
pub fn corpo_google(fm: &EventoFrontMatter, descricao: &str, fuso_calendario: &str, para_criar: bool) -> serde_json::Value {
    let (tz, nome_tz) = fm
        .fuso
        .as_deref()
        .and_then(|n| n.parse::<chrono_tz::Tz>().ok().map(|t| (t, n)))
        .or_else(|| fuso_calendario.parse::<chrono_tz::Tz>().ok().map(|t| (t, fuso_calendario)))
        .unwrap_or((chrono_tz::UTC, "UTC"));
    let (inicio, fim) = if fm.dia_inteiro {
        // No Google o dia inteiro é só uma data (fim exclusivo), no fuso do calendário.
        let i = fm.inicio.with_timezone(&tz).date_naive();
        let mut f = fm.fim.with_timezone(&tz).date_naive();
        if f <= i {
            f = i + Duration::days(1);
        }
        (serde_json::json!({ "date": i.to_string() }), serde_json::json!({ "date": f.to_string() }))
    } else {
        let quando = |d: DateTime<Utc>| serde_json::json!({ "dateTime": d.to_rfc3339_opts(SecondsFormat::Secs, true), "timeZone": nome_tz });
        (quando(fm.inicio), quando(fm.fim))
    };
    let mut privadas = serde_json::Map::new();
    privadas.insert("ecos_id".into(), serde_json::json!(fm.id));
    privadas.insert("ecos_categoria".into(), serde_json::json!(fm.categoria_id));
    let mut corpo = serde_json::json!({
        "summary": fm.titulo,
        "description": descricao,
        "location": fm.local,
        "start": inicio,
        "end": fim,
        "recurrence": (fm.rrule.is_some() || !fm.recorrencia_extra.is_empty()).then(|| fm.rrule.iter().chain(fm.recorrencia_extra.iter()).cloned().collect::<Vec<String>>()),
        "extendedProperties": { "private": privadas },
    });
    if para_criar {
        let o = corpo.as_object_mut().expect("objeto");
        o.retain(|_, v| !v.is_null());
        if let Some(p) = o.get_mut("extendedProperties").and_then(|e| e.get_mut("private")).and_then(|p| p.as_object_mut()) {
            p.retain(|_, v| !v.is_null());
        }
    }
    corpo
}

fn guardar_ref(fm: &mut EventoFrontMatter, calendar_id: &str, ev: &EventoGoogle) {
    fm.google = GoogleRef {
        calendar_id: Some(calendar_id.to_string()),
        event_id: Some(ev.id.clone()),
        etag: ev.etag.clone(),
        updated: ev.updated.as_deref().and_then(|u| DateTime::parse_from_rfc3339(u).ok()).map(|d| d.with_timezone(&Utc)),
    };
    fm.sync_pendente = false;
}

/// `Ok(true)` = o arquivo mudou e precisa ser regravado.
#[allow(clippy::too_many_arguments)]
async fn enviar_um(state: &AppState, cfg: &GoogleConfig, access: &str, calendar_id: &str, fuso: &str, fm: &mut EventoFrontMatter, descricao: &str, resumo: &mut ResumoSync) -> Result<bool, GoogleErro> {
    let cal = fm.google.calendar_id.clone().unwrap_or_else(|| calendar_id.to_string());

    if fm.visibilidade == EventoVisibilidade::Privado {
        // Foi tornado privado: some do Google, fica só no Ecos.
        let Some(id) = fm.google.event_id.clone() else { return Ok(false) };
        google::apagar_evento(&state.http, cfg, access, &cal, &id).await?;
        fm.google = GoogleRef::default();
        fm.sync_pendente = false;
        resumo.removidos_no_google += 1;
        return Ok(true);
    }

    if let Some(id) = fm.google.event_id.clone() {
        // Série: quem a gerencia é o Google. O Ecos só reenvia o que é dele (categoria e id em `extendedProperties`),
        // nunca horário nem regra (mexer nisso lá pode descartar as exceções da série).
        let corpo = if fm.rrule.is_some() {
            let completo = corpo_google(fm, descricao, fuso, false);
            serde_json::json!({ "extendedProperties": completo["extendedProperties"] })
        } else {
            corpo_google(fm, descricao, fuso, false)
        };
        match google::atualizar_evento(&state.http, cfg, access, &cal, &id, fm.google.etag.as_deref(), &corpo).await {
            Ok(ev) => {
                guardar_ref(fm, &cal, &ev);
                resumo.enviados_atualizados += 1;
                return Ok(true);
            }
            Err(GoogleErro::PreCondicao) => {
                resumo.envios_adiados += 1;
                return Ok(false);
            }
            // Apagado no Google enquanto aqui ainda existia com edição pendente: recria em vez de perder a edição.
            Err(GoogleErro::NaoEncontrado) => fm.google = GoogleRef::default(),
            Err(e) => return Err(e),
        }
    }
    let ev = google::inserir_evento(&state.http, cfg, access, calendar_id, &corpo_google(fm, descricao, fuso, true)).await?;
    guardar_ref(fm, calendar_id, &ev);
    resumo.enviados_criados += 1;
    Ok(true)
}

/// Id (no Google) da instância de uma série que começaria em `original`. `None` = a série não tem mais essa ocorrência.
async fn achar_instancia(state: &AppState, cfg: &GoogleConfig, access: &str, calendar_id: &str, mestre_id: &str, original: DateTime<Utc>, fuso: &str) -> Result<Option<String>, GoogleErro> {
    // Janela larga (±14 h) para pegar também dia inteiro, que no Google é só uma data.
    let itens = google::listar_instancias(&state.http, cfg, access, calendar_id, mestre_id, original - Duration::hours(14), original + Duration::hours(14)).await?;
    Ok(itens.into_iter().find(|i| original_da(i, fuso).is_some_and(|o| (o - original).num_seconds().abs() < 60)).map(|i| i.id))
}

/// Corpo do `PATCH` de uma instância: os campos da série com as mudanças da exceção por cima. Sem `recurrence` nem
/// `extendedProperties` (uma instância não tem regra própria, e o id do Ecos é o da série).
fn corpo_excecao(mestre: &EventoFrontMatter, exc: &Excecao, descricao: &str, fuso: &str) -> serde_json::Value {
    let duracao = mestre.fim - mestre.inicio;
    let inicio = exc.inicio.unwrap_or(exc.original);
    let fim = exc.fim.unwrap_or(inicio + duracao);
    let mut efetivo = mestre.clone();
    efetivo.titulo = exc.titulo.clone().unwrap_or_else(|| mestre.titulo.clone());
    efetivo.local = match &exc.local {
        Some(l) if l.trim().is_empty() => None,
        Some(l) => Some(l.clone()),
        None => mestre.local.clone(),
    };
    efetivo.inicio = inicio;
    efetivo.fim = fim;
    efetivo.rrule = None;
    efetivo.recorrencia_extra.clear();
    let mut corpo = corpo_google(&efetivo, exc.descricao.as_deref().unwrap_or(descricao), fuso, false);
    if let Some(o) = corpo.as_object_mut() {
        o.remove("recurrence");
        o.remove("extendedProperties");
    }
    corpo
}

/// Envia ao Google as ocorrências alteradas/canceladas no Ecos (a série precisa já existir lá).
#[allow(clippy::too_many_arguments)]
async fn enviar_excecoes(state: &AppState, cfg: &GoogleConfig, access: &str, calendar_id: &str, fuso: &str, fm: &mut EventoFrontMatter, descricao: &str, resumo: &mut ResumoSync, alterou: &mut bool) -> Result<(), GoogleErro> {
    let Some(mestre_id) = fm.google.event_id.clone() else { return Ok(()) };
    let cal = fm.google.calendar_id.clone().unwrap_or_else(|| calendar_id.to_string());
    for i in 0..fm.excecoes.len() {
        if !fm.excecoes[i].sync_pendente {
            continue;
        }
        let exc = fm.excecoes[i].clone();
        let instancia = match exc.google.event_id.clone() {
            Some(id) => Some(id),
            None => achar_instancia(state, cfg, access, &cal, &mestre_id, exc.original, fuso).await?,
        };
        let Some(instancia) = instancia else {
            // A série já não tem essa ocorrência no Google (ou ela já foi cancelada lá): não há o que enviar.
            tracing::warn!(evento = %fm.id, original = %exc.original, "ocorrência não encontrada no Google; nada a enviar");
            fm.excecoes[i].sync_pendente = false;
            *alterou = true;
            continue;
        };
        if exc.cancelada {
            google::apagar_evento(&state.http, cfg, access, &cal, &instancia).await?;
            fm.excecoes[i].google = GoogleRef { calendar_id: Some(cal.clone()), event_id: Some(instancia), etag: None, updated: None };
            fm.excecoes[i].sync_pendente = false;
            resumo.removidos_no_google += 1;
        } else {
            let corpo = corpo_excecao(fm, &exc, descricao, fuso);
            match google::atualizar_evento(&state.http, cfg, access, &cal, &instancia, exc.google.etag.as_deref(), &corpo).await {
                Ok(ev) => {
                    let e = &mut fm.excecoes[i];
                    e.google = GoogleRef {
                        calendar_id: Some(cal.clone()),
                        event_id: Some(ev.id.clone()),
                        etag: ev.etag.clone(),
                        updated: ev.updated.as_deref().and_then(|u| DateTime::parse_from_rfc3339(u).ok()).map(|d| d.with_timezone(&Utc)),
                    };
                    e.sync_pendente = false;
                    resumo.enviados_atualizados += 1;
                }
                Err(GoogleErro::PreCondicao) => {
                    resumo.envios_adiados += 1;
                    continue;
                }
                Err(GoogleErro::NaoEncontrado) => {
                    tracing::warn!(evento = %fm.id, original = %exc.original, "a instância não existe mais no Google; edição descartada do envio");
                    fm.excecoes[i].sync_pendente = false;
                }
                Err(e) => return Err(e),
            }
        }
        *alterou = true;
    }
    Ok(())
}

async fn enviar(state: &AppState, cfg: &GoogleConfig, access: &str, calendar_id: &str, fuso: &str, resumo: &mut ResumoSync) -> R<()> {
    // 1) Exclusões pedidas no Ecos.
    let exclusoes: Vec<(String, String)> = state
        .db
        .with(|conn| {
            let mut stmt = conn.prepare("SELECT calendar_id, google_event_id FROM evento_exclusao_google ORDER BY criado_em")?;
            let v = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<Vec<_>, _>>()?;
            Ok(v)
        })
        .await?;
    for (cal, id) in exclusoes {
        match google::apagar_evento(&state.http, cfg, access, &cal, &id).await {
            Ok(()) => {
                let (c, i) = (cal.clone(), id.clone());
                state.db.with(move |conn| conn.execute("DELETE FROM evento_exclusao_google WHERE calendar_id = ?1 AND google_event_id = ?2", params![c, i])).await?;
                resumo.removidos_no_google += 1;
            }
            Err(GoogleErro::InvalidGrant) => return Err(SyncErro::PrecisaReconectar),
            Err(e) if transitorio(&e) => return Err(e.into()),
            Err(e) => {
                tracing::warn!(google_event_id = %id, error = %e, "o Google recusou apagar o evento; ficará para o próximo ciclo");
                resumo.envios_com_erro += 1;
            }
        }
    }

    // 2) Eventos criados/editados no Ecos (ou tornados privados) que ainda não foram ao Google.
    let arquivos: Vec<String> = state
        .db
        .with(|conn| {
            let mut stmt = conn.prepare(
                "SELECT caminho_arquivo FROM evento WHERE (sync_pendente = 1 AND visibilidade = 'google') OR (visibilidade = 'google' AND excecoes_pendentes > 0) \
                 OR (visibilidade = 'privado' AND google_event_id IS NOT NULL) ORDER BY atualizado_em",
            )?;
            let v = stmt.query_map([], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
            Ok(v)
        })
        .await?;
    let mut mudou = false;
    let mut interrompido: Option<GoogleErro> = None;
    for rel in arquivos {
        let arquivo = state.config.notes_root.join(&rel);
        let doc = frontmatter::parse::<EventoFrontMatter>(&std::fs::read_to_string(&arquivo)?)?;
        let (mut fm, corpo) = (doc.front_matter, doc.body);
        let mut alterou = false;
        let mut erro: Option<GoogleErro> = None;
        // A própria série só vai ao Google se tiver o que enviar (mudança local, ou virou privada).
        if fm.sync_pendente || fm.visibilidade == EventoVisibilidade::Privado {
            match enviar_um(state, cfg, access, calendar_id, fuso, &mut fm, &corpo, resumo).await {
                Ok(m) => alterou = m,
                Err(e) => erro = Some(e),
            }
        }
        if erro.is_none() && fm.visibilidade == EventoVisibilidade::Google && fm.google.event_id.is_some() {
            if let Err(e) = enviar_excecoes(state, cfg, access, calendar_id, fuso, &mut fm, &corpo, resumo, &mut alterou).await {
                erro = Some(e);
            }
        }
        // O que já foi enviado é gravado mesmo se uma falha interrompeu o resto.
        if alterou {
            std::fs::write(&arquivo, frontmatter::serialize(&fm, &corpo)?)?;
            mudou = true;
        }
        match erro {
            None => {}
            Some(e) if transitorio(&e) || matches!(e, GoogleErro::InvalidGrant) => {
                interrompido = Some(e);
                break;
            }
            Some(e) => {
                tracing::warn!(evento = %fm.id, error = %e, "o Google recusou o evento; continua pendente");
                resumo.envios_com_erro += 1;
            }
        }
    }
    // O que já foi enviado precisa entrar no índice mesmo se o ciclo terminou por uma falha no meio.
    if mudou {
        reindexar_tudo(&state.db, &state.config.notes_root).await?;
    }
    match interrompido {
        Some(e) => Err(e.into()),
        None => Ok(()),
    }
}

/// Envia logo (em ~1,5 s) em vez de esperar o próximo ciclo. Várias edições seguidas viram um só envio.
pub fn agendar_envio(state: &AppState, usuario_id: &str) {
    static AGENDADO: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    let Some(cfg) = &state.config.google else { return };
    if !cfg.envio_imediato || AGENDADO.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    let (state, usuario) = (state.clone(), usuario_id.to_string());
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
        AGENDADO.store(false, std::sync::atomic::Ordering::SeqCst); // edições feitas durante este envio agendam o seguinte
        match sincronizar(&state, &usuario).await {
            Ok(_) | Err(SyncErro::NaoConectado) | Err(SyncErro::Desligado) => {}
            Err(e) => tracing::warn!(error = %e, "envio imediato ao Google falhou; o próximo ciclo tenta de novo"),
        }
    });
}

/// Ao desconectar: os eventos ficam no Ecos, sem vínculo e privados (nada fica esperando um Google que não está mais lá).
pub async fn desvincular_eventos(state: &AppState) -> R<usize> {
    // Sem conexão não há para quem enviar: os pedidos de exclusão pendentes perdem o sentido.
    state.db.with(|conn| conn.execute("DELETE FROM evento_exclusao_google", [])).await?;
    let caminhos: Vec<String> = state
        .db
        .with(|conn| {
            let mut stmt = conn.prepare("SELECT caminho_arquivo FROM evento WHERE google_event_id IS NOT NULL OR visibilidade = 'google'")?;
            let v = stmt.query_map([], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
            Ok(v)
        })
        .await?;
    for rel in &caminhos {
        let arquivo = state.config.notes_root.join(rel);
        let doc = frontmatter::parse::<EventoFrontMatter>(&std::fs::read_to_string(&arquivo)?)?;
        let mut fm = doc.front_matter;
        fm.google = GoogleRef::default();
        fm.sync_pendente = false;
        fm.visibilidade = EventoVisibilidade::Privado;
        fm.excecoes.iter_mut().for_each(|x| {
            x.google = GoogleRef::default();
            x.sync_pendente = false;
        });
        std::fs::write(&arquivo, frontmatter::serialize(&fm, &doc.body)?)?;
    }
    if !caminhos.is_empty() {
        reindexar_tudo(&state.db, &state.config.notes_root).await?;
    }
    Ok(caminhos.len())
}

#[cfg(test)]
mod tests_conversao {
    use super::*;
    use crate::calendario::google::Quando;

    fn quando(dt: Option<&str>, d: Option<&str>) -> Option<Quando> {
        Some(Quando { date_time: dt.map(str::to_string), date: d.map(str::to_string), time_zone: None })
    }

    fn base() -> EventoGoogle {
        EventoGoogle { id: "g1".into(), summary: Some("Reunião".into()), ..Default::default() }
    }

    #[test]
    fn evento_com_hora_vira_utc_e_guarda_o_fuso_do_evento() {
        let mut ev = base();
        ev.start = Some(Quando { date_time: Some("2026-09-21T13:00:00-03:00".into()), date: None, time_zone: Some("America/Sao_Paulo".into()) });
        ev.end = quando(Some("2026-09-21T14:30:00-03:00"), None);
        let c = converter(&ev, "UTC").unwrap();
        assert_eq!(c.inicio.to_rfc3339(), "2026-09-21T16:00:00+00:00");
        assert_eq!(c.fim.to_rfc3339(), "2026-09-21T17:30:00+00:00");
        assert!(!c.dia_inteiro);
        assert_eq!(c.fuso, "America/Sao_Paulo");
    }

    #[test]
    fn dia_inteiro_e_meia_noite_no_fuso_do_calendario_com_fim_exclusivo() {
        let mut ev = base();
        ev.start = quando(None, Some("2026-09-21"));
        ev.end = quando(None, Some("2026-09-22"));
        let c = converter(&ev, "America/Sao_Paulo").unwrap();
        assert!(c.dia_inteiro);
        assert_eq!(c.inicio.to_rfc3339(), "2026-09-21T03:00:00+00:00", "meia-noite de Brasília, não de UTC");
        assert_eq!(c.fim.to_rfc3339(), "2026-09-22T03:00:00+00:00");
    }

    #[test]
    fn titulo_vazio_recebe_rotulo_recorrencia_e_propriedades_do_ecos_sao_lidas() {
        let mut ev = base();
        ev.summary = Some("  ".into());
        ev.start = quando(Some("2026-09-21T13:00:00Z"), None);
        ev.end = quando(Some("2026-09-21T14:00:00Z"), None);
        ev.recurrence = Some(vec!["EXDATE:20260928T130000Z".into(), "RRULE:FREQ=WEEKLY;BYDAY=MO".into()]);
        ev.extended_properties = Some(crate::calendario::google::ExtendedProperties { private: [("ecos_categoria".to_string(), "c1".to_string()), ("ecos_id".to_string(), "e1".to_string())].into() });
        let c = converter(&ev, "UTC").unwrap();
        assert_eq!(c.titulo, "(sem título)");
        assert_eq!(c.rrule.as_deref(), Some("RRULE:FREQ=WEEKLY;BYDAY=MO"));
        assert_eq!((c.categoria_pref.as_deref(), c.ecos_id.as_deref()), (Some("c1"), Some("e1")));
    }

    #[test]
    fn sem_inicio_ou_fim_utilizavel_nao_converte_e_fuso_invalido_cai_em_utc() {
        assert!(converter(&base(), "UTC").is_none());
        let mut ev = base();
        ev.start = quando(None, Some("2026-09-21"));
        ev.end = quando(None, Some("2026-09-22"));
        assert_eq!(converter(&ev, "Fuso/Que/Nao/Existe").unwrap().inicio.to_rfc3339(), "2026-09-21T00:00:00+00:00");
    }
}
