//! Catálogo único de tags de Notas e Tarefas.
//!
//! As tags moram no front-matter dos `.md` (fonte de verdade); o catálogo é derivado do índice
//! (`nota_tag` + `tarefa_tag`), que guarda o nome canônico (`ecos_core::tags`). Renomear, mesclar e
//! remover reescrevem os arquivos afetados e depois reindexam: ou todos os arquivos mudam, ou nenhum.
//!
//! Escrever exige o espaço explícito (`pessoal` ou `equipe:<id>`) e, nele, ser dono/membro — uma tag
//! pessoal e uma tag de equipe com o mesmo nome são catálogos separados.

use axum::extract::{Query, State};
use axum::{Extension, Json};
use ecos_core::types::{NotaFrontMatter, TarefaFrontMatter};
use ecos_core::{frontmatter, tags};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;

use crate::db::reindex::reindexar_tudo;
use crate::error::{AppError, AppResult, CampoInvalido};
use crate::middleware::auth_guard::UsuarioAutenticado;
use crate::state::AppState;

fn invalido(campo: &str, motivo: &str) -> AppError {
    AppError::validation(vec![CampoInvalido { campo: campo.into(), motivo: motivo.into() }])
}

#[derive(Debug, Deserialize)]
pub struct CatalogoQuery {
    pub espaco: Option<String>,
}

#[derive(Debug, Default, Serialize)]
pub struct UsoPorEspaco {
    pub espaco: String,
    pub notas: i64,
    pub tarefas: i64,
}

#[derive(Debug, Serialize)]
pub struct TagCatalogo {
    pub tag: String,
    pub notas: i64,
    pub tarefas: i64,
    pub total: i64,
    pub espacos: Vec<UsoPorEspaco>,
}

/// `GET /tags[?espaco=]` — todas as tags que a pessoa enxerga, com contagem por tipo e por espaço.
pub async fn listar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Query(q): Query<CatalogoQuery>) -> AppResult<Json<Vec<TagCatalogo>>> {
    let visivel_nota = crate::espacos::visivel_sql("n", &usuario.0);
    let visivel_tarefa = crate::espacos::visivel_sql("t", &usuario.0);
    let espaco = q.espaco.clone();
    let linhas: Vec<(String, String, i64, i64)> = state
        .db
        .with(move |conn| {
            let sql = format!(
                "SELECT espaco, tag, SUM(n), SUM(t) FROM ( \
                   SELECT n.espaco AS espaco, nt.tag AS tag, 1 AS n, 0 AS t FROM nota_tag nt JOIN nota n ON n.id = nt.nota_id \
                     WHERE {visivel_nota} AND (?1 IS NULL OR n.espaco = ?1) \
                   UNION ALL \
                   SELECT t.espaco, tt.tag, 0, 1 FROM tarefa_tag tt JOIN tarefa t ON t.id = tt.tarefa_id \
                     WHERE {visivel_tarefa} AND (?1 IS NULL OR t.espaco = ?1) \
                 ) GROUP BY espaco, tag"
            );
            let mut stmt = conn.prepare(&sql)?;
            let linhas = stmt.query_map([&espaco], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?.collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await?;

    let mut por_tag: BTreeMap<String, TagCatalogo> = BTreeMap::new();
    for (espaco, tag, notas, tarefas) in linhas {
        let item = por_tag.entry(tag.clone()).or_insert_with(|| TagCatalogo { tag, notas: 0, tarefas: 0, total: 0, espacos: Vec::new() });
        item.notas += notas;
        item.tarefas += tarefas;
        item.total += notas + tarefas;
        item.espacos.push(UsoPorEspaco { espaco, notas, tarefas });
    }
    let mut saida: Vec<TagCatalogo> = por_tag.into_values().collect();
    saida.sort_by(|a, b| b.total.cmp(&a.total).then_with(|| a.tag.cmp(&b.tag)));
    Ok(Json(saida))
}

#[derive(Debug, Serialize)]
struct Afetados {
    notas: usize,
    tarefas: usize,
}

struct Alteracao {
    caminho: PathBuf,
    original: Vec<u8>,
    novo: String,
}

/// Escreve cada arquivo por um temporário seguido de `rename` (nunca deixa um `.md` pela metade).
/// Se algo falhar no meio, restaura o que já tinha sido trocado.
fn gravar_todos(alteracoes: &[Alteracao]) -> std::io::Result<()> {
    let mut feitos: Vec<&Alteracao> = Vec::new();
    for alt in alteracoes {
        let tmp = alt.caminho.with_extension("md.tag-tmp");
        let resultado = std::fs::write(&tmp, &alt.novo).and_then(|_| std::fs::rename(&tmp, &alt.caminho));
        if let Err(err) = resultado {
            let _ = std::fs::remove_file(&tmp);
            desfazer(&feitos);
            return Err(err);
        }
        feitos.push(alt);
    }
    Ok(())
}

fn desfazer(feitos: &[&Alteracao]) {
    for alt in feitos {
        if let Err(err) = std::fs::write(&alt.caminho, &alt.original) {
            tracing::error!(error = %err, caminho = %alt.caminho.display(), "não foi possível restaurar o arquivo após falha na operação de tags");
        }
    }
}

/// Troca (`destino = Some`) ou remove (`None`) as `origens` em todo item visível do `espaco`.
async fn aplicar(state: &AppState, usuario_id: &str, espaco: &str, origens: Vec<String>, destino: Option<String>) -> AppResult<Afetados> {
    espaco.parse::<ecos_core::types::Espaco>().map_err(|motivo| invalido("espaco", &motivo))?;
    crate::espacos::exigir_acesso(state, usuario_id, espaco).await?;

    let visivel_nota = crate::espacos::visivel_sql("n", usuario_id);
    let visivel_tarefa = crate::espacos::visivel_sql("t", usuario_id);
    let (espaco_q, origens_q) = (espaco.to_string(), origens.clone());
    let (caminhos_notas, caminhos_tarefas): (Vec<String>, Vec<String>) = state
        .db
        .with(move |conn| {
            let marcadores = vec!["?"; origens_q.len()].join(", ");
            let consultar = |sql: String| -> rusqlite::Result<Vec<String>> {
                let mut stmt = conn.prepare(&sql)?;
                let params = std::iter::once(&espaco_q).chain(origens_q.iter());
                let linhas = stmt.query_map(rusqlite::params_from_iter(params), |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
                Ok(linhas)
            };
            let notas = consultar(format!("SELECT DISTINCT n.caminho_arquivo FROM nota n JOIN nota_tag x ON x.nota_id = n.id WHERE n.espaco = ? AND x.tag IN ({marcadores}) AND {visivel_nota}"))?;
            let tarefas = consultar(format!("SELECT DISTINCT t.caminho_arquivo FROM tarefa t JOIN tarefa_tag x ON x.tarefa_id = t.id WHERE t.espaco = ? AND x.tag IN ({marcadores}) AND {visivel_tarefa}"))?;
            Ok((notas, tarefas))
        })
        .await?;

    // Fase 1: calcula tudo em memória. Qualquer arquivo ilegível aborta antes de tocar em disco.
    let raiz = state.config.notes_root.clone();
    let destino_ref = destino.as_deref();
    let mut alteracoes: Vec<Alteracao> = Vec::new();
    let (mut n_notas, mut n_tarefas) = (0usize, 0usize);
    for relativo in &caminhos_notas {
        let caminho = raiz.join(relativo);
        let original = std::fs::read(&caminho)?;
        let texto = String::from_utf8_lossy(&original).into_owned();
        let doc = frontmatter::parse::<NotaFrontMatter>(&texto)?;
        let mut fm = doc.front_matter;
        if let Some(novas) = tags::reescrever(&fm.tags, &origens, destino_ref) {
            fm.tags = novas;
            alteracoes.push(Alteracao { caminho, original, novo: frontmatter::serialize(&fm, &doc.body)? });
            n_notas += 1;
        }
    }
    for relativo in &caminhos_tarefas {
        let caminho = raiz.join(relativo);
        let original = std::fs::read(&caminho)?;
        let texto = String::from_utf8_lossy(&original).into_owned();
        let doc = frontmatter::parse::<TarefaFrontMatter>(&texto)?;
        let mut fm = doc.front_matter;
        if let Some(novas) = tags::reescrever(&fm.tags, &origens, destino_ref) {
            fm.tags = novas;
            alteracoes.push(Alteracao { caminho, original, novo: frontmatter::serialize(&fm, &doc.body)? });
            n_tarefas += 1;
        }
    }

    if alteracoes.is_empty() {
        return Ok(Afetados { notas: 0, tarefas: 0 });
    }

    // Fase 2: grava; Fase 3: reindexa. Se o reindex falhar, devolve os arquivos como estavam.
    gravar_todos(&alteracoes)?;
    if let Err(err) = reindexar_tudo(&state.db, &state.config.notes_root).await {
        desfazer(&alteracoes.iter().collect::<Vec<_>>());
        let _ = reindexar_tudo(&state.db, &state.config.notes_root).await;
        return Err(err.into());
    }
    Ok(Afetados { notas: n_notas, tarefas: n_tarefas })
}

fn canonica_obrigatoria(campo: &str, valor: &str) -> AppResult<String> {
    tags::canonica(valor).ok_or_else(|| invalido(campo, &format!("tag inválida (vazia, com vírgula ou acima de {} caracteres)", tags::TAMANHO_MAXIMO)))
}

#[derive(Debug, Deserialize)]
pub struct RenomearPayload {
    pub espaco: String,
    pub de: String,
    pub para: String,
}

/// `PATCH /tags` — renomeia. Se `para` já existe no espaço, as duas viram uma só (mesclagem).
pub async fn renomear(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Json(p): Json<RenomearPayload>) -> AppResult<Json<serde_json::Value>> {
    let de = canonica_obrigatoria("de", &p.de)?;
    let para = canonica_obrigatoria("para", &p.para)?;
    let afetados = aplicar(&state, &usuario.0, &p.espaco, vec![de], Some(para.clone())).await?;
    Ok(Json(serde_json::json!({ "tag": para, "afetados": afetados })))
}

#[derive(Debug, Deserialize)]
pub struct MesclarPayload {
    pub espaco: String,
    pub origens: Vec<String>,
    pub destino: String,
}

/// `POST /tags/mesclar` — várias tags viram `destino` (que pode ser uma delas ou um nome novo).
pub async fn mesclar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Json(p): Json<MesclarPayload>) -> AppResult<Json<serde_json::Value>> {
    let destino = canonica_obrigatoria("destino", &p.destino)?;
    let origens = tags::normalizar_lista(&p.origens);
    if origens.is_empty() {
        return Err(invalido("origens", "informe ao menos uma tag"));
    }
    let afetados = aplicar(&state, &usuario.0, &p.espaco, origens, Some(destino.clone())).await?;
    Ok(Json(serde_json::json!({ "tag": destino, "afetados": afetados })))
}

#[derive(Debug, Deserialize)]
pub struct RemoverQuery {
    pub espaco: String,
    pub tag: String,
}

/// `DELETE /tags?espaco=&tag=` — tira a tag de todos os itens do espaço (os itens continuam existindo).
pub async fn remover(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Query(q): Query<RemoverQuery>) -> AppResult<Json<serde_json::Value>> {
    let tag = canonica_obrigatoria("tag", &q.tag)?;
    let afetados = aplicar(&state, &usuario.0, &q.espaco, vec![tag], None).await?;
    Ok(Json(serde_json::json!({ "afetados": afetados })))
}
