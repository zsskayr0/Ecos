//! `GET /feed` (seção 11.7) — lê o resultado pré-calculado pelo job de
//! ranking (seção 4), nunca recalcula por request.

use axum::extract::{Query, State};
use axum::Json;
use rusqlite::OptionalExtension;
use serde::Deserialize;

use crate::routes::pagination::{codificar, decodificar, limite_efetivo, Pagina};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct FeedQuery {
    pub espaco: Option<String>,
    pub cursor: Option<String>,
    pub limit: Option<i64>,
}

struct LinhaFeed {
    id: String,
    tipo: String,
    motivo: Option<String>,
    score: f64,
    dado_bruto: Option<String>,
    espaco: String,
    atualizado_em: String,
}

pub async fn obter(State(state): State<AppState>, Query(q): Query<FeedQuery>) -> Result<Json<Pagina<serde_json::Value>>, crate::error::AppError> {
    let limite = limite_efetivo(q.limit);
    let cursor = q.cursor.as_deref().and_then(decodificar);

    let linhas: Vec<LinhaFeed> = state
        .db
        .with(move |conn| {
            let mut sql = String::from("SELECT id, tipo, motivo, score_dominante, dado_bruto, espaco, atualizado_em FROM feed_item");
            let mut condicoes = Vec::new();
            let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

            if let Some(espaco) = &q.espaco {
                condicoes.push("espaco = ?".to_string());
                params.push(Box::new(espaco.clone()));
            }
            if let Some(c) = &cursor {
                let score: f64 = c.valor_ordenacao.parse().unwrap_or(0.0);
                condicoes.push("(score_dominante, id) < (?, ?)".to_string());
                params.push(Box::new(score));
                params.push(Box::new(c.id.clone()));
            }
            if !condicoes.is_empty() {
                sql.push_str(" WHERE ");
                sql.push_str(&condicoes.join(" AND "));
            }
            sql.push_str(" ORDER BY score_dominante DESC, id DESC LIMIT ?");
            params.push(Box::new(limite + 1));

            let mut stmt = conn.prepare(&sql)?;
            let refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
            let linhas = stmt
                .query_map(refs.as_slice(), |r| {
                    Ok(LinhaFeed {
                        id: r.get(0)?,
                        tipo: r.get(1)?,
                        motivo: r.get(2)?,
                        score: r.get(3)?,
                        dado_bruto: r.get(4)?,
                        espaco: r.get(5)?,
                        atualizado_em: r.get(6)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await?;

    let tem_mais = linhas.len() as i64 > limite;
    let visiveis: &[LinhaFeed] = if tem_mais { &linhas[..limite as usize] } else { &linhas[..] };

    let mut items = Vec::with_capacity(visiveis.len());
    for linha in visiveis {
        items.push(montar_card(&state, linha).await?);
    }

    let next_cursor = if tem_mais {
        visiveis.last().map(|l| codificar(&l.score.to_string(), &l.id))
    } else {
        None
    };

    Ok(Json(Pagina { items, next_cursor }))
}

async fn montar_card(state: &AppState, linha: &LinhaFeed) -> Result<serde_json::Value, crate::error::AppError> {
    let dado_bruto: Option<serde_json::Value> = linha.dado_bruto.as_deref().and_then(|s| serde_json::from_str(s).ok());

    match linha.tipo.as_str() {
        "nota" => {
            let id = linha.id.clone();
            // User feedback: "no feed, deve ter a foto de perfil e o nome
            // do dono daquele item" — `nota_fts` alone doesn't carry
            // `criado_por`, so this joins back to `nota`/`usuario`.
            let dados: Option<(String, String, Option<String>, Option<String>, Option<String>, String, Option<String>, String)> = state
                .db
                .with(move |conn| {
                    conn.query_row(
                        "SELECT nf.titulo, nf.corpo, n.criado_por, u.nome_usuario, n.pasta_id, n.criado_em, n.ultima_revisao_em, \
                         (SELECT json_group_array(tag) FROM nota_tag WHERE nota_id = n.id) \
                         FROM nota_fts nf JOIN nota n ON n.id = nf.id LEFT JOIN usuario u ON u.id = n.criado_por \
                         WHERE nf.id = ?1",
                        [&id],
                        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?)),
                    )
                    .optional()
                })
                .await?;
            let (titulo, preview, criado_por, criado_por_nome, pasta, criado_em, ultima_revisao_em, tags_json) = dados.unwrap_or_default();
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
            Ok(serde_json::json!({
                "id": linha.id, "tipo": "nota", "motivo": linha.motivo, "dado_bruto": dado_bruto,
                "titulo": titulo, "preview": preview.chars().take(240).collect::<String>(), "corpo": preview, "espaco": linha.espaco, "atualizado_em": linha.atualizado_em,
                "criado_por": criado_por, "criado_por_nome": criado_por_nome,
                "pasta": pasta, "criado_em": criado_em, "ultima_revisao_em": ultima_revisao_em, "tags": tags,
            }))
        }
        "tarefa_encaixada" => {
            let id = linha.id.clone();
            let dados: Option<(String, Option<String>, String, i64, Option<String>, Option<String>, String, Option<String>, String, String)> = state
                .db
                .with(move |conn| {
                    conn.query_row(
                        "SELECT t.titulo, t.scheduled_at, t.prioridade, t.duration_min, t.criado_por, u.nome_usuario, COALESCE(t.atualizado_em, t.criado_em), t.pasta_id, t.criado_em, \
                         (SELECT json_group_array(tag) FROM tarefa_tag WHERE tarefa_id = t.id) \
                         FROM tarefa t LEFT JOIN usuario u ON u.id = t.criado_por WHERE t.id = ?1",
                        [&id],
                        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get::<_, Option<i64>>(3)?.unwrap_or(0), r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?, r.get(9)?)),
                    )
                    .optional()
                })
                .await?;
            let (titulo, scheduled_at, prioridade, duration_min, criado_por, criado_por_nome, atualizado_em, pasta, criado_em, tags_json) = dados.unwrap_or_default();
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
            Ok(serde_json::json!({
                "id": linha.id, "tipo": "tarefa_encaixada", "titulo": titulo, "scheduled_at": scheduled_at,
                "prioridade": prioridade, "duration_min": duration_min, "espaco": linha.espaco,
                "criado_por": criado_por, "criado_por_nome": criado_por_nome, "atualizado_em": atualizado_em,
                "pasta": pasta, "criado_em": criado_em, "tags": tags,
            }))
        }
        "transacao" => {
            if !state.config.vault_enabled {
                return Ok(serde_json::json!({ "id": linha.id, "tipo": "transacao", "espaco": linha.espaco, "atualizado_em": linha.atualizado_em }));
            }
            let url = format!("{}/vault/transacoes/{}", state.config.vault_internal_url, linha.id);
            match state.http.get(url).send().await.ok().filter(|r| r.status().is_success()) {
                Some(resposta) => {
                    let transacao: serde_json::Value = resposta.json().await.unwrap_or(serde_json::json!({}));
                    Ok(serde_json::json!({
                        "id": linha.id, "tipo": "transacao",
                        "valor_centavos": transacao.get("valor_centavos"),
                        "status": transacao.get("status"),
                        "descricao": transacao.get("descricao"),
                        "criado_em": transacao.get("criado_em"),
                    }))
                }
                None => Ok(serde_json::json!({ "id": linha.id, "tipo": "transacao", "espaco": linha.espaco })),
            }
        }
        outro => Ok(serde_json::json!({ "id": linha.id, "tipo": outro })),
    }
}
