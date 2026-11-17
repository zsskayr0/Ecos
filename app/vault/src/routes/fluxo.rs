use crate::{
    error::{AppError, AppResult},
    state::AppState,
};
use axum::{
    extract::{Path, Query, State},
    Json,
};
use chrono::{Datelike, Months, NaiveDate};
use ecos_core::{new_id, ErrorCode};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize)]
pub struct Ocorrencia {
    pub recorrencia_id: String,
    pub data: String,
    pub tipo: String,
    pub descricao: String,
    pub valor_centavos: i64,
}

/// Data da `n`-ésima ocorrência (0-based), sempre derivada da âncora `inicio`.
fn data_n(inicio: NaiveDate, frequencia: &str, intervalo: i64, dia: Option<u32>, n: i64) -> Option<NaiveDate> {
    match frequencia {
        "semanal" => inicio.checked_add_signed(chrono::Duration::days(n * intervalo * 7)),
        _ => inicio
            .with_day(1)
            .and_then(|d| d.checked_add_months(Months::new((n * intervalo * if frequencia == "anual" { 12 } else { 1 }) as u32)))
            .and_then(|d| {
                let last = d.checked_add_months(Months::new(1))?.pred_opt()?.day();
                d.with_day(dia.unwrap_or(inicio.day()).clamp(1, 31).min(last))
            }),
    }
}

/// Regra de datas de uma recorrência: a única fonte das datas de ocorrência (previsão, tela de Recorrências e
/// mensalidades). Datas sempre derivadas da âncora original: fevereiro não desloca março para o dia 28.
pub(crate) struct Serie {
    pub inicio: NaiveDate,
    pub fim: Option<String>,
    pub frequencia: String,
    pub intervalo: i64,
    pub dia: Option<u32>,
    pub total: Option<i64>,
    pub parcelada: bool,
}

impl Serie {
    /// Ocorrências naturais em `[de, ate]`, com o índice (0-based) de cada uma. Não olha exclusões nem lançamentos.
    pub(crate) fn datas(&self, de: NaiveDate, ate: NaiveDate) -> Vec<(i64, NaiveDate)> {
        let mut datas = Vec::new();
        if !(1..=1200).contains(&self.intervalo) {
            return datas;
        }
        for n in 0..10_000i64 {
            if self.parcelada && n >= self.total.unwrap_or(0) {
                break;
            }
            let Some(date) = data_n(self.inicio, &self.frequencia, self.intervalo, self.dia, n) else { break };
            if date > ate || self.fim.as_ref().is_some_and(|f| date.to_string() > *f) {
                break;
            }
            if date < de || date < self.inicio {
                continue;
            }
            datas.push((n, date));
        }
        datas
    }

    pub(crate) fn carregar(conn: &Connection, recorrencia_id: &str) -> rusqlite::Result<Option<Serie>> {
        let linha: Option<(String, Option<String>, String, i64, Option<u32>, Option<i64>, String)> = conn
            .query_row("SELECT data_inicio,data_fim,frequencia,intervalo,dia_vencimento,total_parcelas,tipo_recorrencia FROM transacao_recorrente WHERE id=?1", [recorrencia_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)))
            .optional()?;
        Ok(linha.and_then(|(inicio, fim, frequencia, intervalo, dia, total, tipo)| {
            let inicio = NaiveDate::parse_from_str(&inicio, "%Y-%m-%d").ok()?;
            Some(Serie { inicio, fim, frequencia, intervalo, dia, total, parcelada: tipo == "parcelada" })
        }))
    }
}

/// Datas de ocorrência de uma recorrência em `[de, ate]`, sem as puladas (`recorrencia_exclusao`). Conta as já
/// lançadas e as ainda não lançadas; recorrência inexistente ou com âncora inválida devolve lista vazia.
pub(crate) fn datas_sem_exclusoes(conn: &Connection, recorrencia_id: &str, de: NaiveDate, ate: NaiveDate) -> rusqlite::Result<Vec<NaiveDate>> {
    let Some(serie) = Serie::carregar(conn, recorrencia_id)? else { return Ok(Vec::new()) };
    let mut datas = Vec::new();
    for (_, date) in serie.datas(de, ate) {
        let excluida: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM recorrencia_exclusao WHERE transacao_recorrente_id=?1 AND data_ocorrencia=?2)", rusqlite::params![recorrencia_id, date.to_string()], |r| r.get(0))?;
        if !excluida {
            datas.push(date);
        }
    }
    Ok(datas)
}

/// Aniversário de `base` depois de `anos` anos; 29/02 em ano não bissexto vira 28/02 (mesma conta das ocorrências anuais).
pub(crate) fn aniversario(base: NaiveDate, anos: i64) -> Option<NaiveDate> {
    data_n(base, "anual", 1, None, anos)
}

pub fn ocorrencias(
    conn: &Connection,
    de: NaiveDate,
    ate: NaiveDate,
) -> rusqlite::Result<Vec<Ocorrencia>> {
    let mut stmt = conn.prepare("SELECT id,tipo,descricao,valor_centavos,data_inicio,data_fim,frequencia,intervalo,dia_vencimento,total_parcelas,tipo_recorrencia,ocorrencias_legadas FROM transacao_recorrente WHERE ativa=1")?;
    let mut result = Vec::new();
    let mut rows = stmt.query([])?;
    while let Some(r) = rows.next()? {
        let id: String = r.get(0)?;
        let inicio: String = r.get(4)?;
        let Ok(inicio) = NaiveDate::parse_from_str(&inicio, "%Y-%m-%d") else {
            continue;
        };
        let serie = Serie { inicio, fim: r.get(5)?, frequencia: r.get(6)?, intervalo: r.get(7)?, dia: r.get(8)?, total: r.get(9)?, parcelada: r.get::<_, String>(10)? == "parcelada" };
        let legado: i64 = r.get(11)?;
        for (n, date) in serie.datas(de, ate) {
            if n < legado {
                continue;
            }
            let iso = date.to_string();
            let existe: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM ocorrencia_processada WHERE recorrencia_id=?1 AND data_ocorrencia=?2 UNION ALL SELECT 1 FROM recorrencia_exclusao WHERE transacao_recorrente_id=?1 AND data_ocorrencia=?2)", rusqlite::params![id,iso], |r| r.get(0))?;
            if !existe {
                result.push(Ocorrencia {
                    recorrencia_id: id.clone(),
                    tipo: r.get(1)?,
                    descricao: r.get(2)?,
                    valor_centavos: crate::mensalidade::valor_em(conn, &id, &iso)?,
                    data: iso,
                });
            }
        }
    }
    result.sort_by(|a, b| a.data.cmp(&b.data));
    Ok(result)
}

/// Uma linha da tela de Recorrências: a ocorrência (data natural), o número da parcela e, se já virou
/// lançamento, o lançamento. Exclusões (puladas) ficam de fora.
#[derive(Clone, Serialize)]
pub struct OcorrenciaCompleta {
    pub recorrencia_id: String,
    pub data: String,
    pub parcela: Option<i64>,
    pub transacao_id: Option<String>,
    pub status: Option<String>,
    pub valor_centavos: i64,
    pub data_lancamento: Option<String>,
}

pub fn ocorrencias_completas(conn: &Connection, de: NaiveDate, ate: NaiveDate) -> rusqlite::Result<Vec<OcorrenciaCompleta>> {
    let mut stmt = conn.prepare("SELECT id,valor_centavos,data_inicio,data_fim,frequencia,intervalo,dia_vencimento,total_parcelas,tipo_recorrencia,ocorrencias_legadas FROM transacao_recorrente WHERE ativa=1")?;
    let mut result = Vec::new();
    let mut rows = stmt.query([])?;
    while let Some(r) = rows.next()? {
        let id: String = r.get(0)?;
        let Ok(inicio) = NaiveDate::parse_from_str(&r.get::<_, String>(2)?, "%Y-%m-%d") else { continue };
        let serie = Serie { inicio, fim: r.get(3)?, frequencia: r.get(4)?, intervalo: r.get(5)?, dia: r.get(6)?, total: r.get(7)?, parcelada: r.get::<_, String>(8)? == "parcelada" };
        let parcelada = serie.parcelada;
        let legado: i64 = r.get(9)?;
        for (n, date) in serie.datas(de, ate) {
            let iso = date.to_string();
            let excluida: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM recorrencia_exclusao WHERE transacao_recorrente_id=?1 AND data_ocorrencia=?2)", rusqlite::params![id, iso], |r| r.get(0))?;
            if excluida {
                continue;
            }
            let lancamento: Option<(String, String, i64, String)> = conn
                .query_row("SELECT t.id,t.status,t.valor_centavos,t.data FROM ocorrencia_processada p JOIN transacao t ON t.id=p.transacao_id WHERE p.recorrencia_id=?1 AND p.data_ocorrencia=?2", rusqlite::params![id, iso], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
                .optional()?;
            let processada: bool = lancamento.is_some() || conn.query_row("SELECT EXISTS(SELECT 1 FROM ocorrencia_processada WHERE recorrencia_id=?1 AND data_ocorrencia=?2)", rusqlite::params![id, iso], |r| r.get(0))?;
            // Lançamento apagado depois de gerado, ou ocorrência anterior à migração sem lançamento: não aparece.
            if lancamento.is_none() && (processada || n < legado) {
                continue;
            }
            let (transacao_id, status, valor_centavos, data_lancamento) = match lancamento {
                Some((t, s, v, d)) => (Some(t), Some(s), v, Some(d)),
                // Ainda não lançada: o previsto é o valor na data da ocorrência (reajuste de mensalidade).
                None => (None, None, crate::mensalidade::valor_em(conn, &id, &iso)?, None),
            };
            result.push(OcorrenciaCompleta { recorrencia_id: id.clone(), data: iso, parcela: parcelada.then_some(n + 1), transacao_id, status, valor_centavos, data_lancamento });
        }
    }
    result.sort_by(|a, b| a.data.cmp(&b.data).then_with(|| a.recorrencia_id.cmp(&b.recorrencia_id)));
    Ok(result)
}

pub async fn listar_completas(State(state): State<AppState>, Query(q): Query<super::financeiro::Periodo>) -> AppResult<Json<serde_json::Value>> {
    q.validar()?;
    let rows = state.db.with(move |c| ocorrencias_completas(c, q.data_de, q.data_ate)).await?;
    Ok(Json(serde_json::json!(rows)))
}

pub fn materializar(
    conn: &Connection,
    id: &str,
    original: &str,
    destino: &str,
    confirmar: bool,
) -> rusqlite::Result<String> {
    let existente: Option<String> = conn.query_row("SELECT transacao_id FROM ocorrencia_processada WHERE recorrencia_id=?1 AND data_ocorrencia=?2", [id,original], |r| r.get(0)).optional()?;
    if let Some(tx) = existente {
        return Ok(tx);
    }
    let tx = new_id();
    // Valor na data da ocorrência (reajuste de mensalidade), não na data em que o lançamento é gerado.
    let valor = crate::mensalidade::valor_em(conn, id, original).optional()?;
    conn.execute("INSERT INTO transacao(id,tipo,descricao,valor_centavos,data,categoria_id,conta_id,beneficiario_id,forma_pagamento,observacoes,espaco,origem,criado_por,transacao_recorrente_id,data_ocorrencia,status,conciliada) SELECT ?1,tipo,descricao,COALESCE(?7,valor_centavos),?2,categoria_id,conta_id,beneficiario_id,forma_pagamento,observacoes,espaco,'recorrencia_gerada',COALESCE(criado_por,'sistema'),id,?3,?4,?5 FROM transacao_recorrente WHERE id=?6", rusqlite::params![tx,destino,original,if confirmar {"efetivada"} else {"pendente"},confirmar,id,valor])?;
    conn.execute(
        "INSERT INTO ocorrencia_processada VALUES(?1,?2,?3)",
        [id, original, &tx],
    )?;
    conn.execute(
        "UPDATE transacao_recorrente SET parcelas_geradas=parcelas_geradas+1 WHERE id=?1",
        [id],
    )?;
    Ok(tx)
}

pub async fn listar(
    State(state): State<AppState>,
    Query(q): Query<super::financeiro::Periodo>,
) -> AppResult<Json<serde_json::Value>> {
    q.validar()?;
    let rows = state
        .db
        .with(move |c| ocorrencias(c, q.data_de, q.data_ate))
        .await?;
    Ok(Json(serde_json::json!(rows)))
}

#[derive(Deserialize)]
pub struct Agendar {
    pub data_ocorrencia: NaiveDate,
    pub data: NaiveDate,
    /// Conclusão parcial: o que foi de fato pago/recebido. O restante vira pendência avulsa ligada à recorrência.
    #[serde(default)]
    pub valor_centavos: Option<i64>,
    /// `false` só agenda a ocorrência (lançamento pendente na data escolhida), sem efetivar.
    #[serde(default = "verdadeiro")]
    pub confirmar: bool,
}

fn verdadeiro() -> bool {
    true
}

pub async fn concluir(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(p): Json<Agendar>,
) -> AppResult<Json<serde_json::Value>> {
    if p.valor_centavos.is_some_and(|v| v <= 0) {
        return Err(AppError::new(ErrorCode::TransactionInvalidAmount));
    }
    if p.confirmar && p.data > crate::routes::transacoes::limite_para_efetivar() {
        return Err(crate::routes::transacoes::erro_efetivar_futuro());
    }
    if p.confirmar {
        super::mensalidades::exigir_ocorrencia_liberada(&state, id.clone(), p.data_ocorrencia).await?;
    }
    let result = state.db.with(move |c| {
        let tx = c.unchecked_transaction()?;
        let original = p.data_ocorrencia.to_string();
        let existente: Option<(String, String)> = tx.query_row("SELECT p.transacao_id,t.status FROM ocorrencia_processada p JOIN transacao t ON t.id=p.transacao_id WHERE p.recorrencia_id=?1 AND p.data_ocorrencia=?2", rusqlite::params![id,original], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
        let transacao_id = if let Some((transacao_id, status)) = existente {
            // Já existe: só avança se ainda estiver pendente, então repetir a chamada não duplica nada.
            if status != "pendente" { return Ok(Some(transacao_id)); }
            tx.execute("UPDATE transacao SET data=?1, atualizado_em=datetime('now') WHERE id=?2", rusqlite::params![p.data.to_string(), transacao_id])?;
            transacao_id
        } else {
            if !ocorrencias(&tx,p.data_ocorrencia,p.data_ocorrencia)?.iter().any(|r| r.recorrencia_id==id) { return Ok(None); }
            materializar(&tx,&id,&original,&p.data.to_string(),p.confirmar)?
        };
        if p.confirmar {
            tx.execute("UPDATE transacao SET status='efetivada', conciliada=1, atualizado_em=datetime('now') WHERE id=?1", [&transacao_id])?;
            if let Some(pago) = p.valor_centavos {
                let (tipo, descricao, categoria, beneficiario, espaco): (String, String, Option<String>, Option<String>, String) = tx.query_row("SELECT tipo,descricao,categoria_id,beneficiario_id,espaco FROM transacao_recorrente WHERE id=?1", [&id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))?;
                // Valor cheio da ocorrência na data dela (o mesmo que o lançamento recebeu ao ser gerado).
                let cheio = crate::mensalidade::valor_em(&tx, &id, &original)?;
                if pago < cheio {
                    tx.execute("UPDATE transacao SET valor_centavos=?1 WHERE id=?2", rusqlite::params![pago, transacao_id])?;
                    let nota = format!("Referente a {} — {} {} de {}.", p.data_ocorrencia.format("%d/%m/%Y"), if tipo == "entrada" { "recebido" } else { "pago" }, moeda(pago), moeda(cheio));
                    tx.execute("INSERT INTO pendencia_avulsa (id,tipo,descricao,valor_centavos,categoria_id,beneficiario_id,transacao_recorrente_id,observacoes,espaco,criado_por) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)", rusqlite::params![new_id(), tipo, format!("Restante de {descricao}"), cheio - pago, categoria, beneficiario, id, nota, espaco, crate::db::autor_atual()])?;
                }
            }
        }
        tx.commit()?;
        Ok(Some(transacao_id))
    }).await?;
    let id = result.ok_or_else(|| {
        AppError::new(ErrorCode::ValidationError).with_message("Ocorrência inexistente ou excluída")
    })?;
    tracing::info!("ocorrência financeira concluída");
    Ok(Json(serde_json::json!({"transacao_id":id})))
}

/// 123456 → "R$ 1.234,56".
fn moeda(centavos: i64) -> String {
    let milhares = (centavos / 100).to_string().as_bytes().rchunks(3).rev().map(|c| std::str::from_utf8(c).unwrap_or("")).collect::<Vec<_>>().join(".");
    format!("R$ {milhares},{:02}", centavos % 100)
}

#[derive(Deserialize)]
pub struct Reagendar {
    pub data: NaiveDate,
}
pub async fn reagendar(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(p): Json<Reagendar>,
) -> AppResult<Json<serde_json::Value>> {
    let n = state
        .db
        .with(move |c| {
            c.execute(
                "UPDATE transacao SET data=?1, atualizado_em=datetime('now') WHERE id=?2",
                rusqlite::params![p.data.to_string(), id],
            )
        })
        .await?;
    if n == 0 {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    Ok(Json(serde_json::json!({"ok":true})))
}

#[cfg(test)]
mod testes {
    use super::*;
    #[test]
    fn migracao_nao_recria_ocorrencias_legadas_excluidas() {
        let c=Connection::open_in_memory().unwrap();
        c.execute_batch(include_str!("../../migrations/0001_init_up.sql")).unwrap();
        c.execute("INSERT INTO transacao_recorrente(id,tipo,descricao,valor_centavos,tipo_recorrencia,data_inicio,parcelas_geradas,espaco) VALUES('r','saida','Mensal',100,'fixa','2026-01-31',2,'pessoal')",[]).unwrap();
        c.execute_batch(include_str!("../../migrations/0002_financeiro.sql")).unwrap();
        c.execute_batch(include_str!("../../migrations/0004_autoria.sql")).unwrap();
        let oc=ocorrencias(&c,"2026-01-01".parse().unwrap(),"2026-03-31".parse().unwrap()).unwrap();
        assert_eq!(oc.len(),1);assert_eq!(oc[0].data,"2026-03-31");
        let tx=c.unchecked_transaction().unwrap();
        let id=materializar(&tx,"r","2026-03-31","2026-04-02",true).unwrap();
        assert_eq!(materializar(&tx,"r","2026-03-31","2026-04-02",false).unwrap(),id);
        tx.commit().unwrap();
        assert!(ocorrencias(&c,"2026-01-01".parse().unwrap(),"2026-03-31".parse().unwrap()).unwrap().is_empty());
    }

    fn banco() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(include_str!("../../migrations/0001_init_up.sql")).unwrap();
        c.execute_batch(include_str!("../../migrations/0002_financeiro.sql")).unwrap();
        c.execute_batch(include_str!("../../migrations/0004_autoria.sql")).unwrap();
        c
    }

    #[test]
    fn listagem_completa_mistura_lancamentos_pendentes_e_respeita_exclusoes() {
        let c = banco();
        c.execute("INSERT INTO transacao_recorrente(id,tipo,descricao,valor_centavos,tipo_recorrencia,data_inicio,espaco) VALUES('r','saida','Aluguel',100000,'fixa','2026-01-10','pessoal')", []).unwrap();
        let tx = c.unchecked_transaction().unwrap();
        let t1 = materializar(&tx, "r", "2026-01-10", "2026-01-10", true).unwrap();
        materializar(&tx, "r", "2026-02-10", "2026-02-12", false).unwrap();
        tx.commit().unwrap();
        c.execute("INSERT INTO recorrencia_exclusao(transacao_recorrente_id,data_ocorrencia) VALUES('r','2026-03-10')", []).unwrap();
        let linhas = ocorrencias_completas(&c, "2026-01-01".parse().unwrap(), "2026-04-30".parse().unwrap()).unwrap();
        let datas: Vec<_> = linhas.iter().map(|l| l.data.as_str()).collect();
        assert_eq!(datas, ["2026-01-10", "2026-02-10", "2026-04-10"]);
        assert_eq!(linhas[0].transacao_id.as_deref(), Some(t1.as_str()));
        assert_eq!(linhas[0].status.as_deref(), Some("efetivada"));
        assert_eq!(linhas[1].status.as_deref(), Some("pendente"));
        assert_eq!(linhas[1].data_lancamento.as_deref(), Some("2026-02-12"));
        assert!(linhas[2].transacao_id.is_none());
    }

    #[test]
    fn parcelada_numera_as_parcelas() {
        let c = banco();
        c.execute("INSERT INTO transacao_recorrente(id,tipo,descricao,valor_centavos,tipo_recorrencia,total_parcelas,data_inicio,espaco) VALUES('p','saida','Celular',5000,'parcelada',3,'2026-05-05','pessoal')", []).unwrap();
        let linhas = ocorrencias_completas(&c, "2026-01-01".parse().unwrap(), "2026-12-31".parse().unwrap()).unwrap();
        assert_eq!(linhas.iter().map(|l| l.parcela).collect::<Vec<_>>(), [Some(1), Some(2), Some(3)]);
    }

    #[test]
    fn moeda_formata_milhares() {
        assert_eq!(moeda(123456), "R$ 1.234,56");
        assert_eq!(moeda(5), "R$ 0,05");
    }
}
