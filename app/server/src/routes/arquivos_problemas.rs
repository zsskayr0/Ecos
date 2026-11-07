//! Arquivos fora do padrão de nome (`note-<Título>.md` / `task-<Título>.md`, ver `ecos_core::naming`): listar e
//! corrigir. Corrigir renomeia na mesma pasta (o tipo nunca muda) e põe o título em `aliases`, para links por nome
//! de arquivo continuarem achando o item. Editar um item fora do padrão também o renomeia (ver `naming::nome_ao_editar`).

use axum::extract::State;
use axum::{Extension, Json};
use ecos_core::types::{NotaFrontMatter, TarefaFrontMatter};
use ecos_core::{frontmatter, naming};
use serde::Deserialize;

use crate::db::reindex_incremental::{reindexar_itens, relativo, Mudanca};
use crate::error::{AppError, AppResult, CampoInvalido};
use crate::middleware::auth_guard::UsuarioAutenticado;
use crate::state::AppState;

#[derive(Debug, Clone)]
struct ItemFora {
    tarefa: bool,
    id: String,
    titulo: String,
    caminho: String,
}

/// Itens visíveis para a pessoa cujo nome de arquivo não segue o padrão do tipo.
async fn fora_do_padrao(state: &AppState, usuario_id: &str) -> AppResult<Vec<ItemFora>> {
    let visivel = crate::espacos::visivel_sql("", usuario_id);
    let linhas: Vec<ItemFora> = state
        .db
        .with_read(move |conn| {
            let mut out = Vec::new();
            for (tabela, tarefa) in [("nota", false), ("tarefa", true)] {
                let mut stmt = conn.prepare(&format!("SELECT id, titulo, caminho_arquivo FROM {tabela} WHERE {visivel} ORDER BY caminho_arquivo"))?;
                let itens = stmt.query_map([], |r| Ok(ItemFora { tarefa, id: r.get(0)?, titulo: r.get(1)?, caminho: r.get(2)? }))?;
                for i in itens {
                    out.push(i?);
                }
            }
            Ok(out)
        })
        .await?;
    Ok(linhas.into_iter().filter(|i| !nome_no_padrao(i.tarefa, &i.caminho)).collect())
}

/// O caminho do índice (`Espaço/Notas/Pasta/x.md`) segue o padrão do tipo?
pub fn nome_no_padrao(tarefa: bool, caminho: &str) -> bool {
    let nome = caminho.rsplit('/').next().unwrap_or(caminho);
    naming::no_padrao(tarefa, nome.strip_suffix(".md").unwrap_or(nome))
}

fn problema(i: &ItemFora) -> &'static str {
    let nome = i.caminho.rsplit('/').next().unwrap_or(&i.caminho);
    if nome.starts_with(naming::prefixo(!i.tarefa)) {
        "prefixo_de_outro_tipo"
    } else {
        "sem_prefixo"
    }
}

pub async fn listar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>) -> AppResult<Json<serde_json::Value>> {
    let itens: Vec<serde_json::Value> = fora_do_padrao(&state, &usuario.0)
        .await?
        .iter()
        .map(|i| {
            serde_json::json!({
                "tipo": if i.tarefa { "tarefa" } else { "nota" },
                "id": i.id,
                "titulo": i.titulo,
                "caminho": i.caminho,
                "problema": problema(i),
                "nome_sugerido": format!("{}.md", naming::nome_padrao(i.tarefa, &i.titulo)),
            })
        })
        .collect();
    Ok(Json(serde_json::json!({ "itens": itens })))
}

#[derive(Debug, Deserialize)]
pub struct AlvoCorrecao {
    pub tipo: String,
    pub id: String,
}

#[derive(Debug, Deserialize)]
pub struct CorrigirPayload {
    /// Itens a corrigir; vazio exige `todos: true` (nunca corrige tudo por omissão).
    #[serde(default)]
    pub itens: Vec<AlvoCorrecao>,
    #[serde(default)]
    pub todos: bool,
}

/// Conteúdo regravado com o título em `aliases` (o resto do front-matter e o corpo ficam como estão).
fn com_alias(tarefa: bool, bruto: &str) -> anyhow::Result<String> {
    if tarefa {
        let mut doc = frontmatter::parse::<TarefaFrontMatter>(bruto)?;
        let titulo = doc.front_matter.titulo.clone();
        naming::atualizar_aliases(&mut doc.front_matter.aliases, None, &titulo);
        Ok(frontmatter::serialize(&doc.front_matter, &doc.body)?)
    } else {
        let mut doc = frontmatter::parse::<NotaFrontMatter>(bruto)?;
        let titulo = doc.front_matter.titulo.clone();
        naming::atualizar_aliases(&mut doc.front_matter.aliases, None, &titulo);
        Ok(frontmatter::serialize(&doc.front_matter, &doc.body)?)
    }
}

pub async fn corrigir(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Json(payload): Json<CorrigirPayload>) -> AppResult<Json<serde_json::Value>> {
    if payload.itens.is_empty() && !payload.todos {
        return Err(AppError::validation(vec![CampoInvalido { campo: "itens".into(), motivo: "informe os itens ou `todos: true`".into() }]));
    }
    // Só o que está fora do padrão E é visível para a pessoa: um id de outra pessoa simplesmente não está na lista.
    let candidatos = fora_do_padrao(&state, &usuario.0).await?;
    let alvos: Vec<ItemFora> = if payload.todos {
        candidatos
    } else {
        candidatos.into_iter().filter(|c| payload.itens.iter().any(|a| a.id == c.id && (a.tipo == "tarefa") == c.tarefa)).collect()
    };

    let raiz = state.config.notes_root.clone();
    let mut mudancas = Vec::new();
    let mut corrigidos = Vec::new();
    let mut falhas = Vec::new();
    for item in &alvos {
        let atual = raiz.join(&item.caminho);
        let resultado = (|| -> anyhow::Result<std::path::PathBuf> {
            let bruto = std::fs::read_to_string(&atual)?;
            let novo_conteudo = com_alias(item.tarefa, &bruto)?;
            let dir = atual.parent().ok_or_else(|| anyhow::anyhow!("arquivo sem pasta"))?;
            let destino = naming::caminho_sem_colisao(dir, &naming::nome_padrao(item.tarefa, &item.titulo), "md");
            // Grava o novo nome primeiro: se algo falhar no meio, sobra o original, nunca nenhum dos dois.
            std::fs::write(&destino, novo_conteudo)?;
            std::fs::remove_file(&atual)?;
            Ok(destino)
        })();
        match resultado {
            Ok(destino) => {
                tracing::info!(de = %item.caminho, para = %destino.display(), "nome de arquivo corrigido");
                mudancas.push(Mudanca::Removido(item.caminho.clone()));
                mudancas.push(Mudanca::Escrito(relativo(&raiz, &destino)));
                corrigidos.push(serde_json::json!({ "id": item.id, "de": item.caminho, "para": relativo(&raiz, &destino) }));
            }
            Err(err) => {
                tracing::warn!(arquivo = %item.caminho, error = %err, "não foi possível corrigir o nome do arquivo");
                falhas.push(serde_json::json!({ "id": item.id, "caminho": item.caminho, "motivo": err.to_string() }));
            }
        }
    }
    if !mudancas.is_empty() {
        reindexar_itens(&state.db, &raiz, &mudancas).await?;
    }
    Ok(Json(serde_json::json!({ "corrigidos": corrigidos, "falhas": falhas })))
}
