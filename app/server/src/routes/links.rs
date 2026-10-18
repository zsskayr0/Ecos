//! Wikilinks entre notas e tarefas: links de um item, resolução de títulos em lote e sugestões para o editor.
//! Tudo passa pela visibilidade das listagens: título de item invisível nunca sai daqui.

use axum::extract::{Query, State};
use axum::{Extension, Json};
use ecos_core::wikilink::{self, Candidato, TipoItem};
use rusqlite::Connection;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::error::{AppError, AppResult, CampoInvalido};
use ecos_core::ErrorCode;
use crate::espacos::{fisica, visivel_sql};
use crate::middleware::auth_guard::UsuarioAutenticado;
use crate::state::AppState;

pub const MAX_TITULOS: usize = 200;
pub const MAX_SUGESTOES: usize = 50;

/// Todos os itens (notas e tarefas) que a pessoa enxerga, já como candidatos de resolução.
fn candidatos_visiveis(conn: &Connection, uid: &str) -> rusqlite::Result<Vec<Candidato>> {
    let mut out = Vec::new();
    for (tabela, alias, tipo) in [("nota", "n", TipoItem::Nota), ("tarefa", "t", TipoItem::Tarefa)] {
        let mut stmt = conn.prepare(&format!(
            "SELECT {alias}.id, {alias}.titulo, {alias}.espaco, COALESCE({alias}.criado_por, ''), {alias}.atualizado_em FROM {tabela} {alias} WHERE {}",
            visivel_sql(alias, uid)
        ))?;
        let linhas = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, String>(4)?)))?;
        for l in linhas {
            let (id, titulo, espaco, criado_por, atualizado_em) = l?;
            out.push(Candidato { tipo, id, titulo, espaco: fisica(&espaco, &criado_por), atualizado_em });
        }
    }
    Ok(out)
}

type Lado = Vec<(String, String, &'static str)>;

/// Entrada e saída de links de um item (já validado como visível), só com itens visíveis, ordenados por título.
pub async fn links_do_item(state: &AppState, uid: &str, tipo: TipoItem, id: &str) -> AppResult<Value> {
    let (uid, id, tipo) = (uid.to_string(), id.to_string(), tipo.como_str());
    let (entrada, saida): (Lado, Lado) = state
        .db
        .with_read(move |conn| {
            let vis_n = visivel_sql("n", &uid);
            let vis_t = visivel_sql("t", &uid);
            let lado = |dono: &str, outro: &str| -> rusqlite::Result<Lado> {
                let mut itens: Lado = Vec::new();
                for (tabela, alias, vis, t) in [("nota", "n", &vis_n, "nota"), ("tarefa", "t", &vis_t, "tarefa")] {
                    let sql = format!(
                        "SELECT {alias}.id, {alias}.titulo FROM link_item l JOIN {tabela} {alias} ON l.{outro}_tipo = '{t}' AND {alias}.id = l.{outro}_id \
                         WHERE l.{dono}_tipo = ?1 AND l.{dono}_id = ?2 AND {vis}"
                    );
                    let mut stmt = conn.prepare(&sql)?;
                    for l in stmt.query_map([tipo, id.as_str()], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
                        let (i, titulo) = l?;
                        itens.push((i, titulo, t));
                    }
                }
                itens.sort_by(|a, b| wikilink::normalizar_titulo(&a.1).cmp(&wikilink::normalizar_titulo(&b.1)).then(a.2.cmp(b.2)).then(a.0.cmp(&b.0)));
                Ok(itens)
            };
            Ok((lado("destino", "origem")?, lado("origem", "destino")?))
        })
        .await?;
    let json_de = |v: Lado| v.into_iter().map(|(id, titulo, tipo)| json!({ "id": id, "titulo": titulo, "tipo": tipo })).collect::<Vec<_>>();
    Ok(json!({ "entrada": json_de(entrada), "saida": json_de(saida) }))
}

#[derive(Debug, Deserialize)]
pub struct OrigemLink {
    pub tipo: String,
    pub id: String,
}

#[derive(Debug, Deserialize)]
pub struct CorpoResolver {
    pub titulos: Vec<String>,
    pub origem: Option<OrigemLink>,
}

fn invalido(campo: &str, motivo: &str) -> AppError {
    AppError::validation(vec![CampoInvalido { campo: campo.into(), motivo: motivo.into() }])
}

/// `POST /links/resolver`: título -> item (ou `null`), em lote.
pub async fn resolver(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Json(corpo): Json<CorpoResolver>) -> AppResult<Json<Value>> {
    if corpo.titulos.len() > MAX_TITULOS {
        return Err(invalido("titulos", &format!("no máximo {MAX_TITULOS} títulos por chamada")));
    }
    let origem = match &corpo.origem {
        Some(o) => Some((
            match o.tipo.as_str() {
                "nota" => TipoItem::Nota,
                "tarefa" => TipoItem::Tarefa,
                _ => return Err(invalido("origem.tipo", "use 'nota' ou 'tarefa'")),
            },
            o.id.clone(),
        )),
        None => None,
    };
    let uid = usuario.0.clone();
    let titulos = corpo.titulos;
    let resolvidos = state
        .db
        .with_read(move |conn| {
            let candidatos = candidatos_visiveis(conn, &uid)?;
            // Espaço da origem: ela precisa ser visível; do contrário a resposta é "não existe".
            let espaco_origem = match &origem {
                Some((t, id)) => match candidatos.iter().find(|c| c.tipo == *t && c.id == *id) {
                    Some(c) => Some(c.espaco.clone()),
                    None => return Ok(None),
                },
                None => None,
            };
            let pessoal = format!("pessoal:{uid}");
            let ignorar = origem.as_ref().map(|(t, id)| (*t, id.as_str()));
            let mut mapa = serde_json::Map::new();
            for bruto in titulos {
                let achado = wikilink::parse_referencia(&bruto).and_then(|r| wikilink::resolver(&r, espaco_origem.as_deref(), Some(&pessoal), ignorar, &candidatos));
                let valor = achado.map_or(Value::Null, |c| json!({ "tipo": c.tipo.como_str(), "id": c.id, "titulo": c.titulo }));
                mapa.insert(bruto, valor);
            }
            Ok(Some(mapa))
        })
        .await?;
    match resolvidos {
        Some(mapa) => Ok(Json(json!({ "resolvidos": mapa }))),
        None => Err(AppError::new(ErrorCode::NotFound)),
    }
}

#[derive(Debug, Deserialize)]
pub struct ParSugestoes {
    pub q: Option<String>,
    pub limite: Option<usize>,
    pub excluir_id: Option<String>,
}

/// `GET /links/sugestoes`: autocompletar do editor (prefixo antes de substring, depois os mais recentes).
pub async fn sugestoes(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Query(par): Query<ParSugestoes>) -> AppResult<Json<Value>> {
    let limite = par.limite.unwrap_or(20).clamp(1, MAX_SUGESTOES);
    let q = wikilink::normalizar_titulo(par.q.as_deref().unwrap_or(""));
    let excluir = par.excluir_id.unwrap_or_default();
    let uid = usuario.0.clone();
    let itens = state
        .db
        .with_read(move |conn| {
            let mut pontuados: Vec<(u8, Candidato)> = candidatos_visiveis(conn, &uid)?
                .into_iter()
                .filter(|c| c.id != excluir)
                .filter_map(|c| {
                    let t = wikilink::normalizar_titulo(&c.titulo);
                    if q.is_empty() || t.starts_with(&q) {
                        Some((0, c))
                    } else if t.contains(&q) {
                        Some((1, c))
                    } else {
                        None
                    }
                })
                .collect();
            pontuados.sort_by(|a, b| a.0.cmp(&b.0).then(b.1.atualizado_em.cmp(&a.1.atualizado_em)).then(a.1.id.cmp(&b.1.id)));
            pontuados.truncate(limite);
            Ok(pontuados.into_iter().map(|(_, c)| json!({ "id": c.id, "titulo": c.titulo, "tipo": c.tipo.como_str(), "atualizado_em": c.atualizado_em })).collect::<Vec<_>>())
        })
        .await?;
    Ok(Json(Value::Array(itens)))
}
