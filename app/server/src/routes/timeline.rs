//! `GET /timeline/atividade` — o que aconteceu com Notas e Tarefas num intervalo de dias: criadas, editadas e
//! concluídas. Alimenta a Timeline do cliente, que junta isso com a programação (tarefas e eventos) e o Cofre.
//!
//! Só lê o índice; respeita a mesma visibilidade das listas (espaço e pastas trancadas fechadas).

use axum::extract::{Query, State};
use axum::{Extension, Json};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

use crate::error::AppResult;
use crate::middleware::auth_guard::UsuarioAutenticado;
use crate::state::AppState;

/// Teto de registros por chamada: o cliente pede poucos dias por vez.
const LIMITE: i64 = 600;

#[derive(Debug, Deserialize)]
pub struct AtividadeQuery {
    pub data_de: NaiveDate,
    pub data_ate: NaiveDate,
    /// Fuso do cliente em minutos a leste de UTC (mesmo contrato de `/tarefas`).
    pub tz: Option<i32>,
    pub espaco: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Atividade {
    /// `nota` | `tarefa`
    pub tipo: &'static str,
    pub id: String,
    pub titulo: String,
    /// `criada` | `editada` | `concluida`
    pub acao: &'static str,
    /// Instante UTC (RFC 3339) em que aconteceu.
    pub em: String,
}

fn modificador_tz(tz: Option<i32>) -> String {
    format!("{:+} minutes", tz.unwrap_or(0).clamp(-14 * 60, 14 * 60))
}

/// Edição só conta se veio depois da criação (o reindex grava `atualizado_em` igual ao `criado_em` em item novo).
const MARGEM_EDICAO_SEG: i64 = 60;

pub async fn atividade(
    State(state): State<AppState>,
    Extension(usuario): Extension<UsuarioAutenticado>,
    Query(q): Query<AtividadeQuery>,
) -> AppResult<Json<Vec<Atividade>>> {
    let tz = modificador_tz(q.tz);
    let visivel_n = crate::espacos::visivel_item_sql("n", &usuario.0);
    let visivel_t = crate::espacos::visivel_item_sql("t", &usuario.0);
    let (de, ate) = (q.data_de.to_string(), q.data_ate.to_string());
    let espaco = q.espaco.clone();

    let itens = state
        .db
        .with_read(move |conn| {
            let no_intervalo = |coluna: &str| format!("date(datetime({coluna}, '{tz}')) BETWEEN date(?1) AND date(?2)");
            let editada = |alias: &str, atualizado: &str| {
                format!("({} AND strftime('%s', {atualizado}) - strftime('%s', {alias}.criado_em) > {MARGEM_EDICAO_SEG})", no_intervalo(atualizado))
            };
            let filtro_espaco = |alias: &str| if espaco.is_some() { format!(" AND {alias}.espaco = ?3") } else { String::new() };

            let sql = format!(
                "SELECT 'nota', n.id, n.titulo, 'criada', n.criado_em FROM nota n \
                   WHERE {vn}{en} AND COALESCE(n.arquivada, 0) = 0 AND {cn} \
                 UNION ALL \
                 SELECT 'nota', n.id, n.titulo, 'editada', n.atualizado_em FROM nota n \
                   WHERE {vn}{en} AND COALESCE(n.arquivada, 0) = 0 AND {ed_n} \
                 UNION ALL \
                 SELECT 'tarefa', t.id, t.titulo, 'criada', t.criado_em FROM tarefa t \
                   WHERE {vt}{et} AND {ct} \
                 UNION ALL \
                 SELECT 'tarefa', t.id, t.titulo, 'editada', t.atualizado_em FROM tarefa t \
                   WHERE {vt}{et} AND t.atualizado_em IS NOT NULL AND {ed_t} \
                   AND (t.concluida_em IS NULL OR abs(strftime('%s', t.atualizado_em) - strftime('%s', t.concluida_em)) > {MARGEM_EDICAO_SEG}) \
                 UNION ALL \
                 SELECT 'tarefa', t.id, t.titulo, 'concluida', t.concluida_em FROM tarefa t \
                   WHERE {vt}{et} AND t.status = 'concluida' AND t.concluida_em IS NOT NULL AND {cc} \
                 ORDER BY 5 DESC LIMIT {LIMITE}",
                vn = visivel_n,
                vt = visivel_t,
                en = filtro_espaco("n"),
                et = filtro_espaco("t"),
                cn = no_intervalo("n.criado_em"),
                ct = no_intervalo("t.criado_em"),
                cc = no_intervalo("t.concluida_em"),
                ed_n = editada("n", "n.atualizado_em"),
                ed_t = editada("t", "t.atualizado_em"),
            );

            let mut stmt = conn.prepare(&sql)?;
            let mapear = |r: &rusqlite::Row| -> rusqlite::Result<Atividade> {
                let tipo: String = r.get(0)?;
                let acao: String = r.get(3)?;
                Ok(Atividade {
                    tipo: if tipo == "nota" { "nota" } else { "tarefa" },
                    id: r.get(1)?,
                    titulo: r.get(2)?,
                    acao: match acao.as_str() {
                        "criada" => "criada",
                        "concluida" => "concluida",
                        _ => "editada",
                    },
                    em: r.get(4)?,
                })
            };
            let linhas = match &espaco {
                Some(e) => stmt.query_map(rusqlite::params![de, ate, e], mapear)?.collect::<Result<Vec<_>, _>>()?,
                None => stmt.query_map(rusqlite::params![de, ate], mapear)?.collect::<Result<Vec<_>, _>>()?,
            };
            Ok(linhas)
        })
        .await?;

    Ok(Json(itens))
}
