//! Materializa ocorrências vencidas de `transacao_recorrente` em
//! `transacao` (`origem='recorrencia_gerada'`), pulando datas em
//! `recorrencia_exclusao` — seção 4.3 do handoff. Usa
//! `ecos_core::recurrence::ocorrencias_vencidas` (mesma lógica testada em
//! `ecos-core`).

use crate::state::AppState;
use chrono::{NaiveDate, Utc};
use ecos_core::new_id;
use ecos_core::recurrence::ocorrencias_vencidas;
use ecos_core::types::{Frequencia, TipoRecorrencia, TransacaoRecorrente, TransacaoTipo};
use std::collections::HashSet;
use std::time::Duration;

const INTERVALO: Duration = Duration::from_secs(15 * 60);

pub fn iniciar(state: AppState) {
    tokio::spawn(async move {
        loop {
            for usuario in state.db.usuarios_destrancados() {
                if let Err(err) = crate::db::USUARIO.scope(usuario.clone(), executar(&state)).await {
                    tracing::error!(error = %err, usuario = %usuario, "job de materialização de recorrências falhou");
                }
            }
            tokio::time::sleep(INTERVALO).await;
        }
    });
}

fn parse_tipo(s: &str) -> TransacaoTipo {
    if s == "entrada" {
        TransacaoTipo::Entrada
    } else {
        TransacaoTipo::Saida
    }
}
fn parse_tipo_recorrencia(s: &str) -> TipoRecorrencia {
    if s == "parcelada" {
        TipoRecorrencia::Parcelada
    } else {
        TipoRecorrencia::Fixa
    }
}
fn parse_frequencia(s: &str) -> Frequencia {
    match s {
        "semanal" => Frequencia::Semanal,
        "anual" => Frequencia::Anual,
        _ => Frequencia::Mensal,
    }
}

async fn executar(state: &AppState) -> Result<(), crate::db::VaultDbError> {
    let hoje = Utc::now().date_naive();

    #[allow(clippy::type_complexity)]
    let recorrentes: Vec<(String, String, String, i64, Option<String>, Option<String>, Option<String>, Option<String>, String, String, i64, Option<i64>, String, Option<String>, Option<i64>, i64, Option<String>, String)> = state
        .db
        .with(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, tipo, descricao, valor_centavos, categoria_id, conta_id, beneficiario_id, forma_pagamento, \
                 tipo_recorrencia, frequencia, intervalo, dia_vencimento, data_inicio, data_fim, total_parcelas, \
                 parcelas_geradas, observacoes, espaco \
                 FROM transacao_recorrente WHERE ativa = 1",
            )?;
            let linhas = stmt
                .query_map([], |r| {
                    Ok((
                        r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?,
                        r.get(8)?, r.get(9)?, r.get(10)?, r.get(11)?, r.get(12)?, r.get(13)?, r.get(14)?, r.get(15)?,
                        r.get(16)?, r.get(17)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await?;

    for (id, tipo, descricao, valor_centavos, categoria_id, conta_id, beneficiario_id, forma_pagamento, tipo_recorrencia, frequencia, intervalo, dia_vencimento, data_inicio, data_fim, total_parcelas, parcelas_geradas, observacoes, espaco) in recorrentes {
        let rec = TransacaoRecorrente {
            id: id.clone(),
            tipo: parse_tipo(&tipo),
            descricao: descricao.clone(),
            valor_centavos,
            categoria_id: categoria_id.clone(),
            conta_id: conta_id.clone(),
            beneficiario_id: beneficiario_id.clone(),
            forma_pagamento: None, // não precisa do enum aqui — grava a string original abaixo
            tipo_recorrencia: parse_tipo_recorrencia(&tipo_recorrencia),
            frequencia: parse_frequencia(&frequencia),
            intervalo,
            dia_vencimento,
            data_inicio: NaiveDate::parse_from_str(&data_inicio, "%Y-%m-%d").unwrap_or(hoje),
            data_fim: data_fim.as_deref().and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()),
            total_parcelas,
            parcelas_geradas,
            observacoes: observacoes.clone(),
            espaco: espaco.parse().unwrap_or(ecos_core::types::Espaco::Pessoal),
            ativa: true,
            criado_em: Utc::now(),
            atualizado_em: Utc::now(),
        };

        let exclusoes: HashSet<NaiveDate> = state
            .db
            .with({
                let id = id.clone();
                move |conn| {
                    let mut stmt = conn.prepare("SELECT data_ocorrencia FROM recorrencia_exclusao WHERE transacao_recorrente_id = ?1")?;
                    let datas = stmt
                        .query_map([&id], |r| r.get::<_, String>(0))?
                        .filter_map(|r| r.ok())
                        .filter_map(|s| NaiveDate::parse_from_str(&s, "%Y-%m-%d").ok())
                        .collect();
                    Ok(datas)
                }
            })
            .await?;

        let novas = ocorrencias_vencidas(&rec, hoje, &exclusoes);
        if novas.is_empty() {
            continue;
        }
        let quantidade_novas = novas.len() as i64;

        state
            .db
            .with({
                let id = id.clone();
                move |conn| {
                    let tx = conn.unchecked_transaction()?;
                    for data_ocorrencia in &novas {
                        let transacao_id = new_id();
                        tx.execute(
                            "INSERT INTO transacao (id, tipo, valor_centavos, data, descricao, categoria_id, conta_id, \
                             beneficiario_id, forma_pagamento, origem, transacao_recorrente_id, espaco, criado_por) \
                             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'recorrencia_gerada', ?10, ?11, 'sistema')",
                            rusqlite::params![
                                transacao_id, tipo, valor_centavos, data_ocorrencia.to_string(), descricao,
                                categoria_id, conta_id, beneficiario_id, forma_pagamento, id, espaco,
                            ],
                        )?;
                    }
                    tx.execute(
                        "UPDATE transacao_recorrente SET parcelas_geradas = parcelas_geradas + ?1, atualizado_em = datetime('now') WHERE id = ?2",
                        rusqlite::params![quantidade_novas, id],
                    )?;
                    tx.commit()
                }
            })
            .await?;

        tracing::info!(recorrencia_id = %id, geradas = quantidade_novas, "recorrência materializada");
    }

    Ok(())
}
