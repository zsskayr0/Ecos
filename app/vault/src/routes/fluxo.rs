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

// Datas sempre derivadas da âncora original: fevereiro não desloca março para o dia 28.
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
        let fim: Option<String> = r.get(5)?;
        let frequencia: String = r.get(6)?;
        let intervalo: i64 = r.get(7)?;
        if !(1..=1200).contains(&intervalo) {
            continue;
        }
        let dia: Option<u32> = r.get(8)?;
        let total: Option<i64> = r.get(9)?;
        let parcelada = r.get::<_, String>(10)? == "parcelada";
        let legado: i64 = r.get(11)?;
        for n in 0..10_000i64 {
            if parcelada && n >= total.unwrap_or(0) {
                break;
            }
            let date = match frequencia.as_str() {
                "semanal" => inicio.checked_add_signed(chrono::Duration::days(n * intervalo * 7)),
                _ => inicio
                    .with_day(1)
                    .and_then(|d| {
                        d.checked_add_months(Months::new(
                            (n * intervalo * if frequencia == "anual" { 12 } else { 1 }) as u32,
                        ))
                    })
                    .and_then(|d| {
                        let last = d.checked_add_months(Months::new(1))?.pred_opt()?.day();
                        d.with_day(dia.unwrap_or(inicio.day()).clamp(1, 31).min(last))
                    }),
            };
            let Some(date) = date else { break };
            let iso = date.to_string();
            if date > ate || fim.as_ref().is_some_and(|f| iso > *f) {
                break;
            }
            if n < legado || date < de || date < inicio {
                continue;
            }
            let existe: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM ocorrencia_processada WHERE recorrencia_id=?1 AND data_ocorrencia=?2 UNION ALL SELECT 1 FROM recorrencia_exclusao WHERE transacao_recorrente_id=?1 AND data_ocorrencia=?2)", rusqlite::params![id,iso], |r| r.get(0))?;
            if !existe {
                result.push(Ocorrencia {
                    recorrencia_id: id.clone(),
                    data: iso,
                    tipo: r.get(1)?,
                    descricao: r.get(2)?,
                    valor_centavos: r.get(3)?,
                });
            }
        }
    }
    result.sort_by(|a, b| a.data.cmp(&b.data));
    Ok(result)
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
    conn.execute("INSERT INTO transacao(id,tipo,descricao,valor_centavos,data,categoria_id,conta_id,beneficiario_id,forma_pagamento,observacoes,espaco,origem,criado_por,transacao_recorrente_id,data_ocorrencia,status,conciliada) SELECT ?1,tipo,descricao,valor_centavos,?2,categoria_id,conta_id,beneficiario_id,forma_pagamento,observacoes,espaco,'recorrencia_gerada','sistema',id,?3,?4,?5 FROM transacao_recorrente WHERE id=?6", rusqlite::params![tx,destino,original,if confirmar {"efetivada"} else {"pendente"},confirmar,id])?;
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
}

pub async fn concluir(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(p): Json<Agendar>,
) -> AppResult<Json<serde_json::Value>> {
    let result = state.db.with(move |c| {
        let tx = c.unchecked_transaction()?;
        let original = p.data_ocorrencia.to_string();
        let existente: Option<String> = tx.query_row("SELECT transacao_id FROM ocorrencia_processada WHERE recorrencia_id=?1 AND data_ocorrencia=?2", rusqlite::params![id,original], |r| r.get(0)).optional()?;
        if let Some(id) = existente { return Ok(Some(id)); }
        if !ocorrencias(&tx,p.data_ocorrencia,p.data_ocorrencia)?.iter().any(|r| r.recorrencia_id==id) { return Ok(None); }
        let result = materializar(&tx,&id,&original,&p.data.to_string(),true)?;
        tx.commit()?;
        Ok(Some(result))
    }).await?;
    let id = result.ok_or_else(|| {
        AppError::new(ErrorCode::ValidationError).with_message("Ocorrência inexistente ou excluída")
    })?;
    tracing::info!("ocorrência financeira concluída");
    Ok(Json(serde_json::json!({"transacao_id":id})))
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
        let oc=ocorrencias(&c,"2026-01-01".parse().unwrap(),"2026-03-31".parse().unwrap()).unwrap();
        assert_eq!(oc.len(),1);assert_eq!(oc[0].data,"2026-03-31");
        let tx=c.unchecked_transaction().unwrap();
        let id=materializar(&tx,"r","2026-03-31","2026-04-02",true).unwrap();
        assert_eq!(materializar(&tx,"r","2026-03-31","2026-04-02",false).unwrap(),id);
        tx.commit().unwrap();
        assert!(ocorrencias(&c,"2026-01-01".parse().unwrap(),"2026-03-31".parse().unwrap()).unwrap().is_empty());
    }
}
