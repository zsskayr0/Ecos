//! Mensalidades: contrato com data-base sobre uma recorrência de entrada, ciclos anuais de reajuste e o painel
//! previsto × recebido. As regras ficam em funções que recebem a conexão e "hoje" (testáveis com data fixa);
//! os handlers só leem o relógio e chamam essas funções.

use crate::{
    error::{AppError, AppResult},
    mensalidade::{esquema_presente, valor_em},
    routes::fluxo,
    state::AppState,
};
use axum::{
    extract::{Path, Query, State},
    Json,
};
use chrono::{Datelike, Days, Months, NaiveDate, Utc};
use ecos_core::{new_id, ErrorCode};
use rusqlite::{Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;

/// O alerta de um ciclo começa estes dias antes do limite do aviso.
pub const ANTECEDENCIA_ALERTA_DIAS: u64 = 15;
/// Teto de aniversários percorridos por contrato (dois séculos): só evita laço sem fim com dado estranho.
const MAX_CICLOS: i64 = 200;
const MAX_MESES_PREVISTO_RECEBIDO: usize = 24;

pub(crate) fn hoje_utc() -> NaiveDate {
    Utc::now().date_naive()
}

/// Resposta de erro prevista pelo contrato (não é falha do servidor).
#[derive(Debug)]
pub(crate) enum Recusa {
    EsquemaAusente,
    NaoEncontrado(&'static str),
    Invalido(String),
    Conflito(String),
}

impl From<Recusa> for AppError {
    fn from(r: Recusa) -> Self {
        match r {
            Recusa::EsquemaAusente => AppError::new(ErrorCode::Conflict).with_message("O Cofre está numa versão anterior do esquema; Mensalidades fica indisponível até a atualização."),
            Recusa::NaoEncontrado(m) => AppError::new(ErrorCode::NotFound).with_message(m),
            Recusa::Invalido(m) => AppError::new(ErrorCode::ValidationError).with_message(m),
            Recusa::Conflito(m) => AppError::new(ErrorCode::Conflict).with_message(m),
        }
    }
}

#[derive(Debug)]
pub(crate) enum Falha {
    Sql(rusqlite::Error),
    Recusa(Recusa),
}

impl From<rusqlite::Error> for Falha {
    fn from(e: rusqlite::Error) -> Self {
        Falha::Sql(e)
    }
}

impl From<Recusa> for Falha {
    fn from(r: Recusa) -> Self {
        Falha::Recusa(r)
    }
}

type Res<T> = Result<T, Falha>;

fn invalido<T>(mensagem: impl Into<String>) -> Res<T> {
    Err(Recusa::Invalido(mensagem.into()).into())
}

fn data(texto: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(texto, "%Y-%m-%d").ok()
}

/// Divisão arredondada ao inteiro mais próximo, metade para cima.
fn dividir_arredondando(numerador: i128, denominador: i128) -> i64 {
    (numerador * 2 + denominador).div_euclid(denominador * 2) as i64
}

/// `valor` acrescido de `bp` pontos-base (1000 = 10,00%), arredondado ao centavo.
fn aplicar_percentual(valor: i64, bp: i64) -> i64 {
    dividir_arredondando(valor as i128 * (10_000 + bp as i128), 10_000)
}

/// Percentual, em pontos-base, que leva de `anterior` a `novo`.
fn percentual_entre(anterior: i64, novo: i64) -> i64 {
    if anterior <= 0 {
        return 0;
    }
    dividir_arredondando((novo - anterior) as i128 * 10_000, anterior as i128)
}

#[derive(Clone, Debug)]
pub(crate) struct Contrato {
    pub recorrencia_id: String,
    pub data_base: NaiveDate,
    pub ciclos_desde: NaiveDate,
    pub percentual_minimo_bp: i64,
    pub aviso_dias: i64,
}

impl Contrato {
    fn limite_aviso(&self, ciclo: NaiveDate) -> NaiveDate {
        ciclo.checked_sub_days(Days::new(self.aviso_dias.max(0) as u64)).unwrap_or(ciclo)
    }

    /// Aniversários da data-base (N ≥ 1) que contam para o sistema (≥ `ciclos_desde`), em ordem.
    fn aniversarios(&self) -> impl Iterator<Item = NaiveDate> + '_ {
        (1..=MAX_CICLOS).map_while(|n| fluxo::aniversario(self.data_base, n)).filter(|c| *c >= self.ciclos_desde)
    }

    fn e_ciclo(&self, dia: NaiveDate) -> bool {
        self.aniversarios().take_while(|c| *c <= dia).any(|c| c == dia)
    }
}

pub(crate) fn carregar_contrato(conn: &Connection, recorrencia_id: &str) -> rusqlite::Result<Option<Contrato>> {
    let linha: Option<(String, String, i64, i64)> = conn
        .query_row("SELECT data_base, ciclos_desde, percentual_minimo_bp, aviso_dias FROM mensalidade WHERE recorrencia_id = ?1", [recorrencia_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .optional()?;
    Ok(linha.and_then(|(base, desde, minimo, aviso)| Some(Contrato { recorrencia_id: recorrencia_id.to_string(), data_base: data(&base)?, ciclos_desde: data(&desde)?, percentual_minimo_bp: minimo, aviso_dias: aviso })))
}

#[derive(Clone, Debug)]
struct Reajuste {
    id: String,
    recorrencia_id: String,
    ciclo: NaiveDate,
    regra: String,
    valor_anterior: i64,
    valor_novo: i64,
    igpm_bp: Option<i64>,
    aviso_em: Option<NaiveDate>,
    vigente_desde: NaiveDate,
    motivo: Option<String>,
    criado_por: Option<String>,
    criado_em: Option<String>,
}

const COLUNAS_REAJUSTE: &str = "id, recorrencia_id, ciclo, regra, valor_anterior_centavos, valor_novo_centavos, igpm_bp, aviso_em, vigente_desde, motivo, criado_por, criado_em";

fn linha_reajuste(r: &rusqlite::Row) -> rusqlite::Result<Option<Reajuste>> {
    let Some(ciclo) = data(&r.get::<_, String>(2)?) else { return Ok(None) };
    Ok(Some(Reajuste {
        id: r.get(0)?,
        recorrencia_id: r.get(1)?,
        ciclo,
        regra: r.get(3)?,
        valor_anterior: r.get(4)?,
        valor_novo: r.get(5)?,
        igpm_bp: r.get(6)?,
        aviso_em: r.get::<_, Option<String>>(7)?.as_deref().and_then(data),
        // As rotas sempre gravam a vigência; linha antiga sem ela vale a partir do próprio ciclo.
        vigente_desde: r.get::<_, Option<String>>(8)?.as_deref().and_then(data).unwrap_or(ciclo),
        motivo: r.get(9)?,
        criado_por: r.get(10)?,
        criado_em: r.get(11)?,
    }))
}

fn reajustes_por_ciclo(conn: &Connection, recorrencia_id: &str) -> rusqlite::Result<HashMap<NaiveDate, Reajuste>> {
    let mut stmt = conn.prepare(&format!("SELECT {COLUNAS_REAJUSTE} FROM mensalidade_reajuste WHERE recorrencia_id = ?1"))?;
    let linhas = stmt.query_map([recorrencia_id], linha_reajuste)?.collect::<Result<Vec<_>, _>>()?;
    Ok(linhas.into_iter().flatten().map(|r| (r.ciclo, r)).collect())
}

/// Ocorrências da recorrência (sem as puladas) com data em `[de, ate)`.
fn ocorrencias_entre(conn: &Connection, recorrencia_id: &str, de: NaiveDate, ate: NaiveDate) -> rusqlite::Result<i64> {
    let Some(ultimo) = ate.pred_opt().filter(|u| *u >= de) else { return Ok(0) };
    Ok(fluxo::datas_sem_exclusoes(conn, recorrencia_id, de, ultimo)?.len() as i64)
}

fn vespera(dia: NaiveDate) -> String {
    dia.pred_opt().unwrap_or(dia).to_string()
}

/// Primeira data em que um valor novo pode valer: nunca antes do ciclo, nunca antes de `aviso_dias` depois do aviso.
fn vigencia_minima(contrato: &Contrato, ciclo: NaiveDate, aviso_em: NaiveDate) -> NaiveDate {
    ciclo.max(aviso_em.checked_add_days(Days::new(contrato.aviso_dias.max(0) as u64)).unwrap_or(aviso_em))
}

fn reajuste_json(conn: &Connection, contrato: &Contrato, r: &Reajuste) -> rusqlite::Result<Value> {
    let minima = if r.regra == "mantido" { r.ciclo } else { vigencia_minima(contrato, r.ciclo, r.aviso_em.unwrap_or(r.ciclo)) };
    let perda = (r.valor_novo - r.valor_anterior).max(0) * ocorrencias_entre(conn, &r.recorrencia_id, r.ciclo, r.vigente_desde)?;
    Ok(json!({
        "id": if r.id.is_empty() { Value::Null } else { json!(r.id) },
        "ciclo": r.ciclo.to_string(),
        "regra": r.regra,
        "valor_anterior_centavos": r.valor_anterior,
        "valor_novo_centavos": r.valor_novo,
        "percentual_bp": percentual_entre(r.valor_anterior, r.valor_novo),
        "igpm_bp": r.igpm_bp,
        "aviso_em": r.aviso_em.map(|d| d.to_string()),
        "vigente_desde": r.vigente_desde.to_string(),
        "vigencia_minima": minima.to_string(),
        "perda_centavos": perda,
        "motivo": r.motivo,
        "criado_por": r.criado_por,
        "criado_em": r.criado_em,
    }))
}

struct Ciclo {
    ciclo: NaiveDate,
    estado: &'static str,
    limite_aviso: NaiveDate,
    valor_minimo: Option<i64>,
    perda_estimada: Option<i64>,
    reajuste: Option<Reajuste>,
}

impl Ciclo {
    fn sem_decisao(&self) -> bool {
        matches!(self.estado, "atrasado" | "avisar")
    }
}

/// Ciclos do contrato, do primeiro até o próximo ainda `futuro`, em ordem de data. O estado é calculado aqui.
fn ciclos(conn: &Connection, contrato: &Contrato, hoje: NaiveDate) -> rusqlite::Result<Vec<Ciclo>> {
    let mut decididos = reajustes_por_ciclo(conn, &contrato.recorrencia_id)?;
    let mut lista = Vec::new();
    for ciclo in contrato.aniversarios() {
        let limite_aviso = contrato.limite_aviso(ciclo);
        if let Some(r) = decididos.remove(&ciclo) {
            let estado = if r.regra == "mantido" {
                "mantido"
            } else if r.vigente_desde > hoje {
                "agendado"
            } else {
                "aplicado"
            };
            lista.push(Ciclo { ciclo, estado, limite_aviso, valor_minimo: None, perda_estimada: None, reajuste: Some(r) });
            continue;
        }
        let inicio_do_alerta = limite_aviso.checked_sub_days(Days::new(ANTECEDENCIA_ALERTA_DIAS)).unwrap_or(limite_aviso);
        let estado = if hoje > limite_aviso {
            "atrasado"
        } else if hoje >= inicio_do_alerta {
            "avisar"
        } else {
            "futuro"
        };
        // Se o aviso saísse hoje, o valor novo valeria a partir daqui.
        let vigencia = vigencia_minima(contrato, ciclo, hoje);
        let anterior = valor_em(conn, &contrato.recorrencia_id, &vespera(vigencia))?;
        let minimo = aplicar_percentual(anterior, contrato.percentual_minimo_bp);
        let perda = if estado == "atrasado" { Some((minimo - anterior).max(0) * ocorrencias_entre(conn, &contrato.recorrencia_id, ciclo, vigencia)?) } else { None };
        lista.push(Ciclo { ciclo, estado, limite_aviso, valor_minimo: Some(minimo), perda_estimada: perda, reajuste: None });
        if estado == "futuro" {
            break;
        }
    }
    Ok(lista)
}

fn ciclo_json(conn: &Connection, contrato: &Contrato, c: &Ciclo) -> rusqlite::Result<Value> {
    Ok(json!({
        "ciclo": c.ciclo.to_string(),
        "estado": c.estado,
        "limite_aviso": c.limite_aviso.to_string(),
        "valor_minimo_centavos": c.valor_minimo,
        "perda_estimada_centavos": c.perda_estimada,
        "reajuste": match &c.reajuste { Some(r) => reajuste_json(conn, contrato, r)?, None => Value::Null },
    }))
}

/// Item de `GET /vault/mensalidades` e a chave de ordenação por urgência. `None` se a recorrência sumiu.
fn item(conn: &Connection, contrato: &Contrato, hoje: NaiveDate, com_ciclos: bool) -> rusqlite::Result<Option<((u8, String, String), Value)>> {
    let recorrencia: Option<(String, bool, Option<String>, Option<String>, i64)> = conn
        .query_row(
            "SELECT r.descricao, r.ativa, r.beneficiario_id, b.nome, r.valor_centavos FROM transacao_recorrente r LEFT JOIN beneficiario b ON b.id = r.beneficiario_id WHERE r.id = ?1",
            [&contrato.recorrencia_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .optional()?;
    let Some((descricao, ativa, beneficiario_id, beneficiario_nome, valor_atual)) = recorrencia else { return Ok(None) };
    let lista = ciclos(conn, contrato, hoje)?;
    // O mais antigo sem decisão; se não houver, o agendado; se não houver, o próximo futuro.
    let foco = lista.iter().find(|c| c.sem_decisao()).or_else(|| lista.iter().find(|c| c.estado == "agendado")).or_else(|| lista.iter().find(|c| c.estado == "futuro"));
    let urgencia = match foco.map(|c| c.estado) {
        Some("atrasado") => 0,
        Some("avisar") => 1,
        Some("agendado") => 2,
        _ => 3,
    };
    let chave = (urgencia, foco.map(|c| c.ciclo.to_string()).unwrap_or_default(), descricao.to_lowercase());
    let mut corpo = json!({
        "recorrencia_id": contrato.recorrencia_id,
        "descricao": descricao,
        "ativa": ativa,
        "beneficiario_id": beneficiario_id,
        "beneficiario_nome": beneficiario_nome,
        "valor_atual_centavos": valor_atual,
        "data_base": contrato.data_base.to_string(),
        "ciclos_desde": contrato.ciclos_desde.to_string(),
        "percentual_minimo_bp": contrato.percentual_minimo_bp,
        "aviso_dias": contrato.aviso_dias,
        "ciclo_em_foco": match foco { Some(c) => ciclo_json(conn, contrato, c)?, None => Value::Null },
        "ciclos_sem_decisao": lista.iter().filter(|c| c.sem_decisao()).count(),
    });
    if com_ciclos {
        let mut todos = Vec::new();
        for c in lista.iter().rev() {
            todos.push(ciclo_json(conn, contrato, c)?);
        }
        corpo["ciclos"] = Value::Array(todos);
    }
    Ok(Some((chave, corpo)))
}

pub(crate) fn listar_itens(conn: &Connection, hoje: NaiveDate) -> Res<Value> {
    let ids: Vec<String> = conn.prepare("SELECT recorrencia_id FROM mensalidade")?.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?;
    let mut itens = Vec::new();
    for id in ids {
        if let Some(contrato) = carregar_contrato(conn, &id)? {
            itens.extend(item(conn, &contrato, hoje, false)?);
        }
    }
    itens.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(Value::Array(itens.into_iter().map(|(_, v)| v).collect()))
}

pub(crate) fn detalhar(conn: &Connection, recorrencia_id: &str, hoje: NaiveDate, com_ciclos: bool) -> Res<Value> {
    let contrato = carregar_contrato(conn, recorrencia_id)?.ok_or(Recusa::NaoEncontrado("Esta recorrência não tem mensalidade cadastrada."))?;
    Ok(item(conn, &contrato, hoje, com_ciclos)?.ok_or(Recusa::NaoEncontrado("Recorrência não encontrada."))?.1)
}

pub(crate) fn candidatas(conn: &Connection) -> Res<Value> {
    let mut stmt = conn.prepare(
        "SELECT r.id, r.descricao, b.nome, r.valor_centavos, r.data_inicio FROM transacao_recorrente r LEFT JOIN beneficiario b ON b.id = r.beneficiario_id \
         WHERE r.tipo = 'entrada' AND r.tipo_recorrencia = 'fixa' AND r.ativa = 1 AND NOT EXISTS (SELECT 1 FROM mensalidade m WHERE m.recorrencia_id = r.id) \
         ORDER BY lower(COALESCE(b.nome, r.descricao)), r.id",
    )?;
    let linhas = stmt
        .query_map([], |r| {
            Ok(json!({ "recorrencia_id": r.get::<_, String>(0)?, "descricao": r.get::<_, String>(1)?, "beneficiario_nome": r.get::<_, Option<String>>(2)?, "valor_centavos": r.get::<_, i64>(3)?, "data_inicio": r.get::<_, String>(4)? }))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Value::Array(linhas))
}

#[derive(Debug, Deserialize)]
pub struct ContratoPedido {
    pub data_base: NaiveDate,
    #[serde(default)]
    pub ciclos_desde: Option<NaiveDate>,
    #[serde(default)]
    pub percentual_minimo_bp: Option<i64>,
    #[serde(default)]
    pub aviso_dias: Option<i64>,
}

/// Cria ou atualiza o contrato. Campo ausente na atualização mantém o que estava.
pub(crate) fn salvar_contrato(conn: &Connection, recorrencia_id: &str, p: &ContratoPedido, hoje: NaiveDate, autor: Option<&str>) -> Res<Value> {
    let recorrencia: Option<(String, String)> = conn.query_row("SELECT tipo, tipo_recorrencia FROM transacao_recorrente WHERE id = ?1", [recorrencia_id], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
    match recorrencia {
        None => return invalido("Recorrência informada não existe."),
        Some((tipo, _)) if tipo != "entrada" => return invalido("Mensalidade só pode ser cadastrada sobre uma recorrência de entrada."),
        Some((_, tipo_rec)) if tipo_rec != "fixa" => return invalido("Mensalidade não pode ser cadastrada sobre uma recorrência parcelada."),
        _ => {}
    }
    if p.aviso_dias.is_some_and(|d| !(0..=180).contains(&d)) {
        return invalido("aviso_dias deve ficar entre 0 e 180.");
    }
    if p.percentual_minimo_bp.is_some_and(|b| !(0..=10_000).contains(&b)) {
        return invalido("percentual_minimo_bp deve ficar entre 0 e 10000.");
    }
    if fluxo::aniversario(p.data_base, 1).is_none() {
        return invalido("data_base inválida.");
    }
    let atual = carregar_contrato(conn, recorrencia_id)?;
    let ciclos_desde = p.ciclos_desde.or(atual.as_ref().map(|c| c.ciclos_desde)).unwrap_or(hoje);
    let minimo = p.percentual_minimo_bp.or(atual.as_ref().map(|c| c.percentual_minimo_bp)).unwrap_or(1000);
    let aviso = p.aviso_dias.or(atual.as_ref().map(|c| c.aviso_dias)).unwrap_or(30);
    conn.execute(
        "INSERT INTO mensalidade (recorrencia_id, data_base, ciclos_desde, percentual_minimo_bp, aviso_dias, criado_por) VALUES (?1, ?2, ?3, ?4, ?5, ?6) \
         ON CONFLICT(recorrencia_id) DO UPDATE SET data_base = excluded.data_base, ciclos_desde = excluded.ciclos_desde, percentual_minimo_bp = excluded.percentual_minimo_bp, \
         aviso_dias = excluded.aviso_dias, atualizado_em = datetime('now')",
        rusqlite::params![recorrencia_id, p.data_base.to_string(), ciclos_desde.to_string(), minimo, aviso, autor],
    )?;
    detalhar(conn, recorrencia_id, hoje, false)
}

pub(crate) fn remover_contrato(conn: &Connection, recorrencia_id: &str) -> Res<Value> {
    if conn.execute("DELETE FROM mensalidade WHERE recorrencia_id = ?1", [recorrencia_id])? == 0 {
        return Err(Recusa::NaoEncontrado("Esta recorrência não tem mensalidade cadastrada.").into());
    }
    Ok(json!({ "ok": true }))
}

#[derive(Debug, Deserialize)]
pub struct ReajustePedido {
    pub ciclo: NaiveDate,
    pub modo: String,
    #[serde(default)]
    pub igpm_bp: Option<i64>,
    #[serde(default)]
    pub percentual_bp: Option<i64>,
    #[serde(default)]
    pub valor_novo_centavos: Option<i64>,
    #[serde(default)]
    pub aviso_em: Option<NaiveDate>,
    #[serde(default)]
    pub vigente_desde: Option<NaiveDate>,
    #[serde(default)]
    pub motivo: Option<String>,
    #[serde(default)]
    pub simular: bool,
}

/// Mantém `transacao_recorrente.valor_centavos` como "o valor em vigor hoje" quando há reajuste aplicado.
fn sincronizar_valor_atual(conn: &Connection, recorrencia_id: &str, hoje: NaiveDate) -> rusqlite::Result<()> {
    crate::mensalidade::aplicar_vigencia(conn, recorrencia_id, &hoje.to_string()).map(|_| ())
}

/// Calcula a decisão de um ciclo e, se não for simulação, grava. Resposta no formato do reajuste (4.5).
pub(crate) fn registrar_reajuste(conn: &Connection, recorrencia_id: &str, p: &ReajustePedido, hoje: NaiveDate, autor: Option<&str>) -> Res<Value> {
    let contrato = carregar_contrato(conn, recorrencia_id)?.ok_or(Recusa::NaoEncontrado("Esta recorrência não tem mensalidade cadastrada."))?;
    if !contrato.e_ciclo(p.ciclo) {
        return invalido("O ciclo informado não é um aniversário da data-base controlado pelo sistema.");
    }
    let ja_decidido: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM mensalidade_reajuste WHERE recorrencia_id = ?1 AND ciclo = ?2)", [recorrencia_id, &p.ciclo.to_string()], |r| r.get(0))?;
    if ja_decidido {
        return Err(Recusa::Conflito("Este ciclo já tem uma decisão registrada.".into()).into());
    }
    let aviso_em = p.aviso_em.unwrap_or(hoje);
    if aviso_em > hoje {
        return invalido("A data do aviso não pode ser futura.");
    }
    let motivo = p.motivo.as_deref().map(str::trim).filter(|m| !m.is_empty()).map(str::to_string);
    if p.igpm_bp.is_some_and(|b| !(-10_000..=100_000).contains(&b)) {
        return invalido("igpm_bp fora do intervalo aceito.");
    }

    let (regra, vigente_desde, minima, anterior, novo) = match p.modo.as_str() {
        "mantido" => {
            // Na prévia o motivo ainda pode estar em branco; ao gravar é obrigatório.
            if motivo.is_none() && !p.simular {
                return invalido("Informe o motivo para manter o valor.");
            }
            let anterior = valor_em(conn, recorrencia_id, &vespera(p.ciclo))?;
            ("mantido", p.ciclo, p.ciclo, anterior, anterior)
        }
        "automatico" | "negociado" => {
            let minima = vigencia_minima(&contrato, p.ciclo, aviso_em);
            let vigente_desde = p.vigente_desde.unwrap_or(minima);
            if vigente_desde < minima {
                return invalido(format!("O valor novo só pode valer a partir de {} ({} dias depois do aviso e nunca antes do ciclo).", minima.format("%d/%m/%Y"), contrato.aviso_dias));
            }
            let anterior = valor_em(conn, recorrencia_id, &vespera(vigente_desde))?;
            if p.modo == "automatico" {
                let igpm = p.igpm_bp.unwrap_or(0);
                let regra = if igpm > contrato.percentual_minimo_bp { "igpm" } else { "minimo" };
                (regra, vigente_desde, minima, anterior, aplicar_percentual(anterior, igpm.max(contrato.percentual_minimo_bp)))
            } else {
                if motivo.is_none() && !p.simular {
                    return invalido("Informe o motivo do valor negociado.");
                }
                let novo = match (p.percentual_bp, p.valor_novo_centavos) {
                    (Some(bp), None) if (-10_000..=100_000).contains(&bp) => aplicar_percentual(anterior, bp),
                    (Some(_), None) => return invalido("percentual_bp fora do intervalo aceito."),
                    (None, Some(valor)) => valor,
                    _ => return invalido("No modo negociado informe o percentual ou o valor novo (apenas um dos dois)."),
                };
                if novo <= 0 {
                    return invalido("O valor novo deve ser maior que zero.");
                }
                ("negociado", vigente_desde, minima, anterior, novo)
            }
        }
        _ => return invalido("modo deve ser 'automatico', 'negociado' ou 'mantido'."),
    };

    let mut reajuste = Reajuste {
        id: String::new(),
        recorrencia_id: recorrencia_id.to_string(),
        ciclo: p.ciclo,
        regra: regra.to_string(),
        valor_anterior: anterior,
        valor_novo: novo,
        igpm_bp: p.igpm_bp,
        aviso_em: Some(aviso_em),
        vigente_desde,
        motivo,
        criado_por: autor.map(str::to_string),
        criado_em: None,
    };
    if !p.simular {
        let tx = conn.unchecked_transaction()?;
        reajuste.id = new_id();
        tx.execute(
            "INSERT INTO mensalidade_reajuste (id, recorrencia_id, ciclo, valor_anterior_centavos, valor_novo_centavos, regra, igpm_bp, aviso_em, vigente_desde, motivo, criado_por) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            rusqlite::params![reajuste.id, recorrencia_id, p.ciclo.to_string(), anterior, novo, regra, p.igpm_bp, aviso_em.to_string(), vigente_desde.to_string(), reajuste.motivo, autor],
        )?;
        if vigente_desde <= hoje {
            sincronizar_valor_atual(&tx, recorrencia_id, hoje)?;
        }
        reajuste.criado_em = tx.query_row("SELECT criado_em FROM mensalidade_reajuste WHERE id = ?1", [&reajuste.id], |r| r.get(0))?;
        tx.commit()?;
    }
    let mut corpo = reajuste_json(conn, &contrato, &reajuste)?;
    corpo["vigencia_minima"] = json!(minima.to_string());
    Ok(corpo)
}

/// Remove um reajuste (erro de digitação). Recusa se já há lançamento gerado com o valor dele.
pub(crate) fn remover_reajuste(conn: &Connection, id: &str, hoje: NaiveDate) -> Res<Value> {
    let reajuste = conn.query_row(&format!("SELECT {COLUNAS_REAJUSTE} FROM mensalidade_reajuste WHERE id = ?1"), [id], linha_reajuste).optional()?.flatten().ok_or(Recusa::NaoEncontrado("Reajuste não encontrado."))?;
    if reajuste.regra != "mantido" {
        let ja_lancado: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM transacao WHERE transacao_recorrente_id = ?1 AND data_ocorrencia >= ?2)",
            [&reajuste.recorrencia_id, &reajuste.vigente_desde.to_string()],
            |r| r.get(0),
        )?;
        if ja_lancado {
            return Err(Recusa::Conflito("Já existe lançamento gerado com o valor deste reajuste; ele não pode mais ser removido.".into()).into());
        }
    }
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM mensalidade_reajuste WHERE id = ?1", [id])?;
    let restam: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM mensalidade_reajuste WHERE recorrencia_id = ?1 AND vigente_desde IS NOT NULL)", [&reajuste.recorrencia_id], |r| r.get(0))?;
    if restam {
        sincronizar_valor_atual(&tx, &reajuste.recorrencia_id, hoje)?;
    } else if reajuste.vigente_desde <= hoje && reajuste.regra != "mantido" {
        // Era o único e já tinha sido aplicado: sem histórico, o valor da regra volta ao que era antes dele.
        tx.execute("UPDATE transacao_recorrente SET valor_centavos = ?1, atualizado_em = datetime('now') WHERE id = ?2", rusqlite::params![reajuste.valor_anterior, reajuste.recorrencia_id])?;
    }
    tx.commit()?;
    Ok(json!({ "ok": true }))
}

/// Previsto × recebido por mensalidade e mês da ocorrência, em `[de, ate]`.
pub(crate) fn previsto_recebido(conn: &Connection, de: NaiveDate, ate: NaiveDate) -> Res<Value> {
    if de > ate {
        return invalido("Período inválido.");
    }
    let mut meses: Vec<String> = Vec::new();
    let mut cursor = de.with_day(1).unwrap_or(de);
    while cursor <= ate {
        meses.push(cursor.format("%Y-%m").to_string());
        if meses.len() > MAX_MESES_PREVISTO_RECEBIDO {
            return invalido("Período inválido (máximo 24 meses).");
        }
        let Some(proximo) = cursor.checked_add_months(Months::new(1)) else { break };
        cursor = proximo;
    }
    let posicao: HashMap<&str, usize> = meses.iter().enumerate().map(|(i, m)| (m.as_str(), i)).collect();
    let celula = |mes: &str, previsto: i64, recebido: i64, aberto: i64| json!({ "mes": mes, "previsto_centavos": previsto, "recebido_centavos": recebido, "em_aberto_centavos": aberto });

    let mut stmt = conn.prepare(
        "SELECT r.id, r.descricao, b.nome, r.ativa FROM mensalidade m JOIN transacao_recorrente r ON r.id = m.recorrencia_id LEFT JOIN beneficiario b ON b.id = r.beneficiario_id \
         ORDER BY lower(COALESCE(b.nome, r.descricao)), r.id",
    )?;
    let recorrencias: Vec<(String, String, Option<String>, bool)> = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?.collect::<Result<_, _>>()?;
    let mut totais = vec![(0i64, 0i64, 0i64); meses.len()];
    let mut linhas = Vec::new();
    for (id, descricao, beneficiario_nome, ativa) in recorrencias {
        let mut por_mes = vec![(0i64, 0i64); meses.len()];
        for dia in fluxo::datas_sem_exclusoes(conn, &id, de, ate)? {
            let iso = dia.to_string();
            let lancada: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM ocorrencia_processada WHERE recorrencia_id = ?1 AND data_ocorrencia = ?2)", [&id, &iso], |r| r.get(0))?;
            // Recorrência pausada não gera expectativa nova; o que já foi lançado continua contando.
            if !ativa && !lancada {
                continue;
            }
            let Some(&i) = posicao.get(dia.format("%Y-%m").to_string().as_str()) else { continue };
            por_mes[i].0 += valor_em(conn, &id, &iso)?;
            por_mes[i].1 += conn.query_row(
                "SELECT COALESCE(SUM(t.valor_centavos), 0) FROM ocorrencia_processada p JOIN transacao t ON t.id = p.transacao_id WHERE p.recorrencia_id = ?1 AND p.data_ocorrencia = ?2 AND t.status = 'efetivada'",
                [&id, &iso],
                |r| r.get::<_, i64>(0),
            )?;
        }
        let mut colunas = Vec::new();
        for (i, mes) in meses.iter().enumerate() {
            let (previsto, recebido) = por_mes[i];
            let aberto = (previsto - recebido).max(0);
            totais[i] = (totais[i].0 + previsto, totais[i].1 + recebido, totais[i].2 + aberto);
            colunas.push(celula(mes, previsto, recebido, aberto));
        }
        linhas.push(json!({ "recorrencia_id": id, "descricao": descricao, "beneficiario_nome": beneficiario_nome, "meses": colunas }));
    }
    let totais: Vec<Value> = meses.iter().zip(&totais).map(|(mes, t)| celula(mes, t.0, t.1, t.2)).collect();
    Ok(json!({ "meses": meses, "linhas": linhas, "totais": totais }))
}

// ---------------------------------------------------------------------------------------------------------------
// Bloqueio (4.9): efetivar uma ocorrência de mensalidade com ciclo sem decisão até a data dela.
// ---------------------------------------------------------------------------------------------------------------

/// O ciclo mais antigo sem reajuste gravado com data ≤ `data_ocorrencia`. Sem contrato (ou com o esquema numa
/// versão anterior) nada bloqueia.
pub(crate) fn ciclo_pendente_ate(conn: &Connection, recorrencia_id: &str, data_ocorrencia: NaiveDate) -> rusqlite::Result<Option<NaiveDate>> {
    if !esquema_presente(conn)? {
        return Ok(None);
    }
    let Some(contrato) = carregar_contrato(conn, recorrencia_id)? else { return Ok(None) };
    for ciclo in contrato.aniversarios().take_while(|c| *c <= data_ocorrencia) {
        let decidido: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM mensalidade_reajuste WHERE recorrencia_id = ?1 AND ciclo = ?2)", [recorrencia_id, &ciclo.to_string()], |r| r.get(0))?;
        if !decidido {
            return Ok(Some(ciclo));
        }
    }
    Ok(None)
}

/// Bloqueio de efetivar um lançamento: só vale para lançamento ainda pendente gerado por recorrência.
pub(crate) fn pendencia_do_lancamento(conn: &Connection, transacao_id: &str) -> rusqlite::Result<Option<(String, NaiveDate)>> {
    let gerado: Option<(Option<String>, Option<String>, String)> = conn.query_row("SELECT transacao_recorrente_id, data_ocorrencia, status FROM transacao WHERE id = ?1", [transacao_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).optional()?;
    let Some((Some(recorrencia_id), Some(ocorrencia), status)) = gerado else { return Ok(None) };
    let Some(ocorrencia) = data(&ocorrencia).filter(|_| status == "pendente") else { return Ok(None) };
    Ok(ciclo_pendente_ate(conn, &recorrencia_id, ocorrencia)?.map(|ciclo| (recorrencia_id, ciclo)))
}

fn erro_de_bloqueio((recorrencia_id, ciclo): (String, NaiveDate)) -> AppError {
    AppError::new(ErrorCode::MensalidadeReajustePendente).with_details(json!({ "recorrencia_id": recorrencia_id, "ciclo": ciclo.to_string() }))
}

/// Recusa (409 `MENSALIDADE_REAJUSTE_PENDENTE`) se efetivar algum destes lançamentos esbarra num ciclo sem decisão.
pub(crate) async fn exigir_lancamentos_liberados(state: &AppState, ids: Vec<String>) -> AppResult<()> {
    let pendencia = state
        .db
        .with(move |conn| {
            for id in &ids {
                if let Some(p) = pendencia_do_lancamento(conn, id)? {
                    return Ok(Some(p));
                }
            }
            Ok(None)
        })
        .await?;
    pendencia.map_or(Ok(()), |p| Err(erro_de_bloqueio(p)))
}

/// O mesmo para concluir uma ocorrência (lançada ou não). Ocorrência já efetivada não é barrada: nada muda nela.
pub(crate) async fn exigir_ocorrencia_liberada(state: &AppState, recorrencia_id: String, data_ocorrencia: NaiveDate) -> AppResult<()> {
    let pendencia = state
        .db
        .with(move |conn| {
            let efetivada: bool = conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM ocorrencia_processada p JOIN transacao t ON t.id = p.transacao_id WHERE p.recorrencia_id = ?1 AND p.data_ocorrencia = ?2 AND t.status <> 'pendente')",
                [&recorrencia_id, &data_ocorrencia.to_string()],
                |r| r.get(0),
            )?;
            if efetivada {
                return Ok(None);
            }
            Ok(ciclo_pendente_ate(conn, &recorrencia_id, data_ocorrencia)?.map(|ciclo| (recorrencia_id, ciclo)))
        })
        .await?;
    pendencia.map_or(Ok(()), |p| Err(erro_de_bloqueio(p)))
}

// ---------------------------------------------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------------------------------------------

/// Roda uma regra no Cofre do pedido. Esquema numa versão anterior (sem as tabelas da 0014) vira 409.
async fn rodar<T, F>(state: &AppState, f: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce(&Connection) -> Res<T> + Send + 'static,
{
    let resultado = state
        .db
        .with(move |conn| {
            if !esquema_presente(conn)? {
                return Ok(Err(Recusa::EsquemaAusente));
            }
            match f(conn) {
                Ok(valor) => Ok(Ok(valor)),
                Err(Falha::Recusa(r)) => Ok(Err(r)),
                Err(Falha::Sql(e)) => Err(e),
            }
        })
        .await?;
    resultado.map_err(AppError::from)
}

pub async fn listar(State(state): State<AppState>) -> AppResult<Json<Value>> {
    let hoje = hoje_utc();
    Ok(Json(rodar(&state, move |c| listar_itens(c, hoje)).await?))
}

pub async fn listar_candidatas(State(state): State<AppState>) -> AppResult<Json<Value>> {
    Ok(Json(rodar(&state, candidatas).await?))
}

pub async fn obter(State(state): State<AppState>, Path(recorrencia_id): Path<String>) -> AppResult<Json<Value>> {
    let hoje = hoje_utc();
    Ok(Json(rodar(&state, move |c| detalhar(c, &recorrencia_id, hoje, true)).await?))
}

pub async fn salvar(State(state): State<AppState>, Path(recorrencia_id): Path<String>, Json(pedido): Json<ContratoPedido>) -> AppResult<Json<Value>> {
    let (hoje, autor) = (hoje_utc(), crate::db::autor_atual());
    Ok(Json(rodar(&state, move |c| salvar_contrato(c, &recorrencia_id, &pedido, hoje, autor.as_deref())).await?))
}

pub async fn excluir(State(state): State<AppState>, Path(recorrencia_id): Path<String>) -> AppResult<Json<Value>> {
    Ok(Json(rodar(&state, move |c| remover_contrato(c, &recorrencia_id)).await?))
}

pub async fn criar_reajuste(State(state): State<AppState>, Path(recorrencia_id): Path<String>, Json(pedido): Json<ReajustePedido>) -> AppResult<Json<Value>> {
    let (hoje, autor) = (hoje_utc(), crate::db::autor_atual());
    let corpo = rodar(&state, move |c| registrar_reajuste(c, &recorrencia_id, &pedido, hoje, autor.as_deref())).await?;
    Ok(Json(corpo))
}

pub async fn excluir_reajuste(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<Value>> {
    let hoje = hoje_utc();
    Ok(Json(rodar(&state, move |c| remover_reajuste(c, &id, hoje)).await?))
}

pub async fn listar_previsto_recebido(State(state): State<AppState>, Query(q): Query<super::financeiro::Periodo>) -> AppResult<Json<Value>> {
    Ok(Json(rodar(&state, move |c| previsto_recebido(c, q.data_de, q.data_ate)).await?))
}
