//! Personalização do Feed por pessoa (`/me/feed/ocultos`): itens, pastas e tags que ela não quer ver no Feed.
//! Só filtra o Feed (`GET /feed`); o item continua em listas, pastas e busca.

use axum::extract::State;
use axum::{Extension, Json};
use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult, CampoInvalido};
use crate::middleware::auth_guard::UsuarioAutenticado;
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct ItemOculto {
    pub id: String,
    /// "nota" | "tarefa" | `None` quando o item já não existe.
    pub tipo: Option<String>,
    pub titulo: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PastaOculta {
    pub espaco: String,
    pub caminho: String,
}

#[derive(Debug, Serialize, Default)]
pub struct Ocultos {
    pub itens: Vec<ItemOculto>,
    pub pastas: Vec<PastaOculta>,
    pub tags: Vec<String>,
}

/// Pedaço de SQL (condições unidas por `AND`) que tira do Feed o que a pessoa ocultou.
/// `alias` é o da tabela de origem (`nota`/`tarefa`), `tabela_tag` a de tags dela e `coluna_tag` a chave.
pub fn filtro_sql(alias: &str, tabela_tag: &str, coluna_tag: &str, usuario_id: &str) -> String {
    let uid = format!("'{}'", usuario_id.replace('\'', "''"));
    format!(
        "{alias}.id NOT IN (SELECT ref FROM feed_oculto WHERE usuario_id = {uid} AND tipo = 'item') \
         AND NOT EXISTS (SELECT 1 FROM feed_oculto o WHERE o.usuario_id = {uid} AND o.tipo = 'pasta' AND o.espaco = {alias}.espaco AND {alias}.pasta_id IS NOT NULL \
            AND ({alias}.pasta_id = o.ref OR substr({alias}.pasta_id, 1, length(o.ref) + 1) = o.ref || '/')) \
         AND NOT EXISTS (SELECT 1 FROM {tabela_tag} x JOIN feed_oculto o ON o.usuario_id = {uid} AND o.tipo = 'tag' AND o.ref = x.tag WHERE x.{coluna_tag} = {alias}.id)"
    )
}

async fn ler(state: &AppState, usuario_id: &str) -> AppResult<Ocultos> {
    let uid = usuario_id.to_string();
    let linhas: Vec<(String, String, String)> = state
        .db
        .with_read(move |conn| {
            let mut stmt = conn.prepare("SELECT tipo, espaco, ref FROM feed_oculto WHERE usuario_id = ?1 ORDER BY criado_em")?;
            let linhas = stmt.query_map([&uid], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await?;
    let ids: Vec<String> = linhas.iter().filter(|l| l.0 == "item").map(|l| l.2.clone()).collect();
    let titulos = state
        .db
        .with_read(move |conn| {
            let mut mapa = std::collections::HashMap::new();
            for id in ids {
                let achado = conn
                    .query_row("SELECT 'nota', titulo FROM nota WHERE id = ?1 UNION ALL SELECT 'tarefa', titulo FROM tarefa WHERE id = ?1", [&id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
                    .ok();
                mapa.insert(id, achado);
            }
            Ok(mapa)
        })
        .await?;
    let mut saida = Ocultos::default();
    for (tipo, espaco, r) in linhas {
        match tipo.as_str() {
            "item" => {
                let achado = titulos.get(&r).cloned().flatten();
                saida.itens.push(ItemOculto { tipo: achado.as_ref().map(|a| a.0.clone()), titulo: achado.map(|a| a.1), id: r });
            }
            "pasta" => saida.pastas.push(PastaOculta { espaco, caminho: r }),
            _ => saida.tags.push(r),
        }
    }
    Ok(saida)
}

/// `GET /me/feed/ocultos`
pub async fn listar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>) -> AppResult<Json<Ocultos>> {
    Ok(Json(ler(&state, &usuario.0).await?))
}

#[derive(Debug, Deserialize)]
pub struct AlterarPayload {
    /// "item" | "pasta" | "tag"
    pub tipo: String,
    /// id do item, caminho da pasta ou nome da tag.
    #[serde(rename = "ref")]
    pub referencia: String,
    /// Obrigatório para pasta (`pessoal` ou `equipe:<id>`).
    #[serde(default)]
    pub espaco: Option<String>,
    /// `true` oculta, `false` volta a mostrar.
    pub oculto: bool,
}

/// `PUT /me/feed/ocultos` — oculta ou volta a mostrar um item, uma pasta ou uma tag no Feed.
pub async fn alterar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Json(p): Json<AlterarPayload>) -> AppResult<Json<Ocultos>> {
    let mut campos = Vec::new();
    if !matches!(p.tipo.as_str(), "item" | "pasta" | "tag") {
        campos.push(CampoInvalido { campo: "tipo".into(), motivo: "esperado item, pasta ou tag".into() });
    }
    let referencia = p.referencia.trim().trim_start_matches('#').to_string();
    if referencia.is_empty() || referencia.chars().count() > 300 {
        campos.push(CampoInvalido { campo: "ref".into(), motivo: "informe o item, a pasta ou a tag".into() });
    }
    let espaco = if p.tipo == "pasta" { p.espaco.clone().unwrap_or_default() } else { String::new() };
    if p.tipo == "pasta" {
        if espaco.is_empty() { campos.push(CampoInvalido { campo: "espaco".into(), motivo: "informe o espaço da pasta".into() }); }
        else if p.oculto { crate::espacos::exigir_acesso(&state, &usuario.0, &espaco).await?; }
    }
    if !campos.is_empty() {
        return Err(AppError::validation(campos));
    }
    let (uid, tipo, oculto) = (usuario.0.clone(), p.tipo.clone(), p.oculto);
    let agora = Utc::now().to_rfc3339();
    state
        .db
        .with(move |conn| {
            if oculto {
                conn.execute("INSERT OR IGNORE INTO feed_oculto (usuario_id, tipo, espaco, ref, criado_em) VALUES (?1, ?2, ?3, ?4, ?5)", rusqlite::params![uid, tipo, espaco, referencia, agora])
            } else {
                conn.execute("DELETE FROM feed_oculto WHERE usuario_id = ?1 AND tipo = ?2 AND espaco = ?3 AND ref = ?4", rusqlite::params![uid, tipo, espaco, referencia])
            }
        })
        .await?;
    Ok(Json(ler(&state, &usuario.0).await?))
}
