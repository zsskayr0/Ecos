//! Job de ranking do Feed (seção 4) — pipeline periódico, não calculado por
//! request: reindexa, recalcula os 4 scores de cada Nota, marca Tarefas
//! encaixadas do dia, e traz Transação (via `ecos-vault-db`, quando
//! ativado) com o boost de recência da seção 4.3. Grava tudo em
//! `feed_item`, que é o que `GET /feed` lê.

use crate::db::{reindex, IndexDb};
use crate::state::AppState;
use chrono::{DateTime, Utc};
use ecos_core::ranking::Scores;
use ecos_core::types::{FeedMotivo, TarefaPrioridade};
use rusqlite::params;
use serde::Deserialize;
use serde_json::json;
use std::time::Duration;

fn prioridade_de_str(s: &str) -> TarefaPrioridade {
    match s {
        "baixa" => TarefaPrioridade::Baixa,
        "alta" => TarefaPrioridade::Alta,
        _ => TarefaPrioridade::Media,
    }
}

pub fn iniciar(state: AppState) {
    tokio::spawn(async move {
        let intervalo = Duration::from_secs(state.config.ranking_interval_secs.max(30));
        loop {
            if let Err(err) = executar_ciclo(&state).await {
                tracing::error!(error = %err, "falha no ciclo do job de ranking do feed");
            }
            tokio::time::sleep(intervalo).await;
        }
    });
}

pub async fn executar_ciclo(state: &AppState) -> anyhow::Result<()> {
    let resultado = reindex::reindexar_tudo(&state.db, &state.config.notes_root).await?;
    if !resultado.erros.is_empty() {
        tracing::warn!(erros = ?resultado.erros, "reindex encontrou arquivos inválidos");
    }

    recalcular_notas(&state.db).await?;
    recalcular_tarefas_encaixadas(&state.db).await?;

    if state.config.vault_enabled {
        if let Err(err) = recalcular_transacoes(state).await {
            tracing::warn!(error = %err, "não foi possível trazer Transações pro Feed (vault indisponível?)");
        }
    } else {
        state
            .db
            .with(|conn| conn.execute("DELETE FROM feed_item WHERE tipo = 'transacao'", []))
            .await?;
    }

    Ok(())
}

struct LinhaNota {
    id: String,
    atualizado_em: DateTime<Utc>,
    ultima_revisao_em: Option<DateTime<Utc>>,
    espaco: String,
    links_entrada: i64,
    links_saida: i64,
    acessos_7d: i64,
}

fn motivo_str(motivo: FeedMotivo) -> &'static str {
    match motivo {
        FeedMotivo::Esquecimento => "esquecimento",
        FeedMotivo::Orfa => "orfa",
        FeedMotivo::Frescor => "frescor",
        FeedMotivo::Interacao => "interacao",
    }
}

fn dado_bruto(
    motivo: FeedMotivo,
    atualizado_em: DateTime<Utc>,
    ultima_revisao_em: Option<DateTime<Utc>>,
    acessos_7d: i64,
    agora: DateTime<Utc>,
) -> serde_json::Value {
    match motivo {
        FeedMotivo::Esquecimento => {
            let referencia = ultima_revisao_em.unwrap_or(atualizado_em).max(atualizado_em);
            json!({ "dias": ((agora - referencia).num_hours() as f64 / 24.0).round() as i64 })
        }
        FeedMotivo::Orfa => json!({ "orfa": true }),
        FeedMotivo::Frescor => json!({ "horas": (agora - atualizado_em).num_hours() }),
        FeedMotivo::Interacao => json!({ "acessos_7d": acessos_7d }),
    }
}

async fn recalcular_notas(db: &IndexDb) -> anyhow::Result<()> {
    let agora = Utc::now();
    let linhas: Vec<LinhaNota> = db
        .with(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT n.id, n.atualizado_em, n.ultima_revisao_em, n.espaco, n.contagem_acessos_7d, \
                 (SELECT COUNT(*) FROM links_nota WHERE nota_id_destino = n.id) AS links_entrada, \
                 (SELECT COUNT(*) FROM links_nota WHERE nota_id_origem = n.id) AS links_saida \
                 FROM nota n",
            )?;
            let linhas = stmt
                .query_map([], |r| {
                    let atualizado_em: String = r.get(1)?;
                    let ultima_revisao_em: Option<String> = r.get(2)?;
                    Ok(LinhaNota {
                        id: r.get(0)?,
                        atualizado_em: DateTime::parse_from_rfc3339(&atualizado_em)
                            .map(|d| d.with_timezone(&Utc))
                            .unwrap_or(agora),
                        ultima_revisao_em: ultima_revisao_em
                            .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
                            .map(|d| d.with_timezone(&Utc)),
                        espaco: r.get(3)?,
                        acessos_7d: r.get(4)?,
                        links_entrada: r.get(5)?,
                        links_saida: r.get(6)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await?;

    db.with(move |conn| {
        let tx = conn.unchecked_transaction()?;
        tx.execute("DELETE FROM feed_item WHERE tipo = 'nota'", [])?;
        for linha in &linhas {
            let scores = Scores::calcular(
                linha.atualizado_em,
                linha.ultima_revisao_em,
                linha.links_entrada,
                linha.links_saida,
                linha.acessos_7d,
                agora,
            );
            let (motivo, score) = scores.motivo_dominante();
            let bruto = dado_bruto(motivo, linha.atualizado_em, linha.ultima_revisao_em, linha.acessos_7d, agora);
            tx.execute(
                "INSERT INTO feed_item (id, tipo, motivo, score_dominante, dado_bruto, espaco, atualizado_em) \
                 VALUES (?1, 'nota', ?2, ?3, ?4, ?5, ?6)",
                params![
                    linha.id,
                    motivo_str(motivo),
                    score,
                    bruto.to_string(),
                    linha.espaco,
                    linha.atualizado_em.to_rfc3339(),
                ],
            )?;
        }
        tx.commit()
    })
    .await?;

    Ok(())
}

async fn recalcular_tarefas_encaixadas(db: &IndexDb) -> anyhow::Result<()> {
    let hoje = Utc::now().date_naive();
    let inicio = hoje.and_hms_opt(0, 0, 0).unwrap().and_utc().to_rfc3339();
    let fim = hoje.succ_opt().unwrap().and_hms_opt(0, 0, 0).unwrap().and_utc().to_rfc3339();

    let linhas: Vec<(String, String, String, String)> = db
        .with({
            let inicio = inicio.clone();
            let fim = fim.clone();
            move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, espaco, scheduled_at, prioridade FROM tarefa \
                     WHERE status = 'pendente' AND scheduled_at >= ?1 AND scheduled_at < ?2",
                )?;
                let linhas = stmt
                    .query_map(params![inicio, fim], |r| Ok((r.get(0)?, r.get(1)?, r.get::<_, String>(2)?, r.get(3)?)))?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(linhas)
            }
        })
        .await?;

    db.with(move |conn| {
        let tx = conn.unchecked_transaction()?;
        tx.execute("DELETE FROM feed_item WHERE tipo = 'tarefa_encaixada'", [])?;
        for (id, espaco, scheduled_at, prioridade) in &linhas {
            // Boost pela prioridade (seção 3.1 do handoff: "o feed mostra
            // casualmente tarefas, como se fossem ads") em vez de um score
            // fixo — antes toda Tarefa ficava no fim do Feed, agora uma
            // Tarefa de prioridade Alta compete de igual pra igual com uma
            // Nota fresca.
            let score = ecos_core::ranking::boost_tarefa_prioridade(prioridade_de_str(prioridade));
            tx.execute(
                "INSERT INTO feed_item (id, tipo, motivo, score_dominante, dado_bruto, espaco, atualizado_em) \
                 VALUES (?1, 'tarefa_encaixada', NULL, ?2, NULL, ?3, ?4)",
                params![id, score, espaco, scheduled_at],
            )?;
        }
        tx.commit()
    })
    .await?;

    Ok(())
}

#[derive(Debug, Deserialize)]
struct ListaTransacoesResposta {
    items: Vec<TransacaoResumo>,
}

#[derive(Debug, Deserialize)]
struct TransacaoResumo {
    id: String,
    espaco: String,
    criado_em: DateTime<Utc>,
}

async fn recalcular_transacoes(state: &AppState) -> anyhow::Result<()> {
    let url = format!("{}/vault/transacoes?limit=200", state.config.vault_internal_url);
    let resposta: ListaTransacoesResposta = state.http.get(url).send().await?.error_for_status()?.json().await?;
    let agora = Utc::now();

    state
        .db
        .with(move |conn| {
            let tx = conn.unchecked_transaction()?;
            tx.execute("DELETE FROM feed_item WHERE tipo = 'transacao'", [])?;
            for item in &resposta.items {
                let score = ecos_core::ranking::boost_transacao(item.criado_em, agora);
                tx.execute(
                    "INSERT INTO feed_item (id, tipo, motivo, score_dominante, dado_bruto, espaco, atualizado_em) \
                     VALUES (?1, 'transacao', NULL, ?2, NULL, ?3, ?4)",
                    params![item.id, score, item.espaco, item.criado_em.to_rfc3339()],
                )?;
            }
            tx.commit()
        })
        .await?;

    Ok(())
}
