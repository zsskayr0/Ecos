//! Gráfico de conexões do Ecos (estilo Obsidian): notas, tarefas, eventos e tags como nós;
//! wikilinks, vínculos de evento e tags como arestas. Tudo vem do índice derivado e passa pelo
//! mesmo filtro de visibilidade das listagens — nunca aparece nó ou aresta de item que a pessoa
//! não enxerga.

use axum::extract::{Query, State};
use axum::{Extension, Json};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

use crate::error::AppResult;
use crate::espacos::visivel_sql;
use crate::middleware::auth_guard::UsuarioAutenticado;
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct NoGrafico {
    pub id: String,
    /// `nota` | `tarefa` | `evento` | `tag`
    pub tipo: &'static str,
    pub titulo: String,
    pub espaco: Option<String>,
    /// Só tarefas: `pendente` | `concluida`.
    pub status: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ArestaGrafico {
    pub origem: String,
    pub destino: String,
    /// `wikilink` | `evento_nota` | `evento_tarefa` | `tag`
    pub tipo: &'static str,
}

#[derive(Debug, Serialize)]
pub struct Grafico {
    pub nos: Vec<NoGrafico>,
    pub arestas: Vec<ArestaGrafico>,
    /// `true` quando `limite` cortou itens (os mais recentes ficam).
    pub truncado: bool,
}

/// Parâmetros opcionais de escala. Sem nenhum, o contrato é o de sempre: tudo o que a pessoa enxerga.
/// Medido com 5 mil notas + 5 mil tarefas + 20 mil links: ~11 ms e ~1,6 MB (release), ~86 ms (debug).
#[derive(Debug, Default, Deserialize)]
pub struct Parametros {
    /// Máximo de itens (notas, tarefas e eventos somados; tags não contam), dos mais recentemente atualizados.
    pub limite: Option<usize>,
    /// Só itens deste espaço (`pessoal` ou `equipe:<id>`), sempre dentro do que a pessoa enxerga.
    pub espaco: Option<String>,
    /// `false` omite tarefas concluídas. Padrão: incluir.
    pub incluir_concluidas: Option<bool>,
}

fn id_tag(tag: &str) -> String {
    format!("tag:{tag}")
}

pub async fn obter(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Query(par): Query<Parametros>) -> AppResult<Json<Grafico>> {
    let uid = usuario.0.clone();
    let grafico = state
        .db
        .with_read(move |conn| {
            let vis_n = visivel_sql("n", &uid);
            let vis_t = visivel_sql("t", &uid);
            let vis_e = visivel_sql("e", &uid);
            let mut nos: Vec<NoGrafico> = Vec::new();
            let mut arestas: Vec<ArestaGrafico> = Vec::new();
            let mut ids: HashSet<String> = HashSet::new();
            let mut tags: HashSet<String> = HashSet::new();
            let mut truncado = false;
            let mut restante = par.limite.unwrap_or(usize::MAX);
            let espaco = par.espaco.clone();
            let sem_concluidas = par.incluir_concluidas == Some(false);
            let filtro_espaco = |alias: &str| if espaco.is_some() { format!(" AND {alias}.espaco = ?1") } else { String::new() };
            let args = || -> Vec<String> { espaco.iter().cloned().collect() };
            let teto = |restante: usize| if restante == usize::MAX { -1i64 } else { restante.saturating_add(1).min(i64::MAX as usize) as i64 };

            let mut stmt = conn.prepare(&format!("SELECT n.id, n.titulo, n.espaco FROM nota n WHERE {vis_n}{} ORDER BY n.atualizado_em DESC LIMIT {}", filtro_espaco("n"), teto(restante)))?;
            for (i, linha) in stmt.query_map(rusqlite::params_from_iter(args()), |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))?.enumerate() {
                let (id, titulo, espaco) = linha?;
                if i >= restante {
                    truncado = true;
                    break;
                }
                ids.insert(id.clone());
                nos.push(NoGrafico { id, tipo: "nota", titulo, espaco: Some(espaco), status: None });
            }

            restante = restante.saturating_sub(nos.len());
            let extra_t = if sem_concluidas { " AND t.status <> 'concluida'" } else { "" };
            let mut stmt = conn.prepare(&format!("SELECT t.id, t.titulo, t.espaco, t.status FROM tarefa t WHERE {vis_t}{extra_t}{} ORDER BY t.atualizado_em DESC LIMIT {}", filtro_espaco("t"), teto(restante)))?;
            let antes = nos.len();
            for (i, linha) in stmt.query_map(rusqlite::params_from_iter(args()), |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?))
            })?.enumerate() {
                let (id, titulo, espaco, status) = linha?;
                if i >= restante {
                    truncado = true;
                    break;
                }
                ids.insert(id.clone());
                nos.push(NoGrafico { id, tipo: "tarefa", titulo, espaco: Some(espaco), status: Some(status) });
            }

            restante = restante.saturating_sub(nos.len() - antes);
            let mut stmt = conn.prepare(&format!("SELECT e.id, e.titulo, e.espaco FROM evento e WHERE {vis_e}{} ORDER BY e.atualizado_em DESC LIMIT {}", filtro_espaco("e"), teto(restante)))?;
            for (i, linha) in stmt.query_map(rusqlite::params_from_iter(args()), |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))?.enumerate() {
                let (id, titulo, espaco) = linha?;
                if i >= restante {
                    truncado = true;
                    break;
                }
                ids.insert(id.clone());
                nos.push(NoGrafico { id, tipo: "evento", titulo, espaco: Some(espaco), status: None });
            }

            // Arestas só entre nós visíveis: o JOIN com os ids já filtrados acima é o que impede vazamento.
            let mut stmt = conn.prepare("SELECT nota_id_origem, nota_id_destino FROM links_nota")?;
            for linha in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
                let (origem, destino) = linha?;
                if origem != destino && ids.contains(&origem) && ids.contains(&destino) {
                    arestas.push(ArestaGrafico { origem, destino, tipo: "wikilink" });
                }
            }

            let mut stmt = conn.prepare("SELECT evento_id, nota_id FROM evento_nota")?;
            for linha in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
                let (origem, destino) = linha?;
                if ids.contains(&origem) && ids.contains(&destino) {
                    arestas.push(ArestaGrafico { origem, destino, tipo: "evento_nota" });
                }
            }

            let mut stmt = conn.prepare("SELECT evento_id, tarefa_id FROM evento_tarefa")?;
            for linha in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
                let (origem, destino) = linha?;
                if ids.contains(&origem) && ids.contains(&destino) {
                    arestas.push(ArestaGrafico { origem, destino, tipo: "evento_tarefa" });
                }
            }

            for (tabela, coluna) in [("nota_tag", "nota_id"), ("tarefa_tag", "tarefa_id")] {
                let mut stmt = conn.prepare(&format!("SELECT {coluna}, tag FROM {tabela}"))?;
                for linha in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
                    let (item, tag) = linha?;
                    if ids.contains(&item) {
                        tags.insert(tag.clone());
                        arestas.push(ArestaGrafico { origem: item, destino: id_tag(&tag), tipo: "tag" });
                    }
                }
            }

            let mut tags: Vec<String> = tags.into_iter().collect();
            tags.sort();
            for tag in tags {
                nos.push(NoGrafico { id: id_tag(&tag), tipo: "tag", titulo: format!("#{tag}"), espaco: None, status: None });
            }

            Ok(Grafico { nos, arestas, truncado })
        })
        .await?;
    Ok(Json(grafico))
}
