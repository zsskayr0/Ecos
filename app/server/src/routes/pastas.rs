//! Pastas (seção 11.5) — sem `:id`, endereçadas por caminho (seção 1.3/1.5:
//! Pasta não é entidade persistida, é o diretório em si).

use axum::extract::{Query, State};
use axum::{Extension, Json};
use ecos_core::ErrorCode;
use rusqlite::OptionalExtension;
use serde::Deserialize;

use crate::db::reindex::reindexar_tudo;
use crate::error::{AppError, AppResult, CampoInvalido};
use crate::middleware::auth_guard::UsuarioAutenticado;
use crate::state::AppState;

async fn raiz_da_arvore(state: &AppState, usuario_id: &str, tipo: &str, espaco: Option<&str>) -> AppResult<std::path::PathBuf> {
    let arvore = if tipo == "tarefa" { "Tarefas" } else { "Notas" };
    let espaco = espaco.filter(|e| !e.is_empty()).unwrap_or("pessoal");
    espaco.parse::<ecos_core::types::Espaco>().map_err(|motivo| AppError::validation(vec![CampoInvalido { campo: "espaco".into(), motivo }]))?;
    crate::espacos::exigir_acesso(state, usuario_id, espaco).await?;
    crate::espacos::raiz(state, &crate::espacos::fisica(espaco, usuario_id), arvore).await
}

/// O caminho vem do cliente e é juntado à raiz do espaço: `..`, barra inicial ou unidade o levariam à pasta de outra pessoa.
/// `pode_ser_vazio` só vale para `pasta_pai` (vazio = raiz); renomear/excluir a própria raiz nunca é permitido.
fn caminho_dentro_da_raiz(campo: &str, caminho: &str, pode_ser_vazio: bool) -> AppResult<()> {
    let vazio_ok = caminho.is_empty() && pode_ser_vazio;
    if vazio_ok || (!caminho.trim().is_empty() && crate::espacos::caminho_relativo_seguro(caminho)) {
        return Ok(());
    }
    Err(AppError::validation(vec![CampoInvalido { campo: campo.into(), motivo: "caminho inválido".into() }]))
}


/// Cor e ícone das pastas ficam num único arquivo na raiz de cada árvore (`.ecos-pastas.json`: caminho -> {cor, icone}),
/// já que a pasta em si é só um diretório. Acompanha a pasta quando o diretório é copiado.
const ARQUIVO_META: &str = ".ecos-pastas.json";
type MetaPastas = std::collections::BTreeMap<String, serde_json::Value>;

fn ler_meta(raiz: &std::path::Path) -> MetaPastas {
    std::fs::read_to_string(raiz.join(ARQUIVO_META)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn gravar_meta(raiz: &std::path::Path, meta: &MetaPastas) -> AppResult<()> {
    let arquivo = raiz.join(ARQUIVO_META);
    if meta.is_empty() {
        let _ = std::fs::remove_file(&arquivo);
        return Ok(());
    }
    std::fs::write(arquivo, serde_json::to_string_pretty(meta).unwrap_or_default())?;
    Ok(())
}

fn cor_valida(cor: &str) -> bool {
    cor.len() == 7 && cor.starts_with('#') && cor[1..].chars().all(|c| c.is_ascii_hexdigit())
}

fn validar_aparencia(cor: &Option<String>, icone: &Option<String>) -> AppResult<()> {
    if let Some(c) = cor.as_deref().filter(|c| !c.is_empty()) {
        if !cor_valida(c) {
            return Err(AppError::validation(vec![CampoInvalido { campo: "cor".into(), motivo: "use o formato #rrggbb".into() }]));
        }
    }
    if let Some(i) = icone.as_deref().filter(|i| !i.is_empty()) {
        if i.len() > 60 || !i.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == ':') {
            return Err(AppError::validation(vec![CampoInvalido { campo: "icone".into(), motivo: "nome de ícone inválido".into() }]));
        }
    }
    Ok(())
}

/// Aplica cor/ícone a uma pasta: `None` mantém, vazio limpa.
fn definir_aparencia(meta: &mut MetaPastas, caminho: &str, cor: &Option<String>, icone: &Option<String>) {
    if cor.is_none() && icone.is_none() {
        return;
    }
    let mut atual = meta.get(caminho).cloned().unwrap_or_else(|| serde_json::json!({}));
    for (campo, valor) in [("cor", cor), ("icone", icone)] {
        match valor.as_deref() {
            Some("") => {
                if let Some(o) = atual.as_object_mut() {
                    o.remove(campo);
                }
            }
            Some(v) => {
                atual[campo] = serde_json::Value::String(v.to_string());
            }
            None => {}
        }
    }
    if atual.as_object().map_or(true, |o| o.is_empty()) {
        meta.remove(caminho);
    } else {
        meta.insert(caminho.to_string(), atual);
    }
}

fn mover_chaves(meta: &mut MetaPastas, de: &str, para: &str) {
    let prefixo = format!("{de}/");
    let afetadas: Vec<String> = meta.keys().filter(|k| k.as_str() == de || k.starts_with(&prefixo)).cloned().collect();
    for chave in afetadas {
        if let Some(valor) = meta.remove(&chave) {
            meta.insert(format!("{para}{}", &chave[de.len()..]), valor);
        }
    }
}

fn remover_chaves(meta: &mut MetaPastas, caminho: &str) {
    let prefixo = format!("{caminho}/");
    meta.retain(|k, _| k != caminho && !k.starts_with(&prefixo));
}

#[derive(Debug, Deserialize)]
pub struct ListarQuery {
    #[serde(default)]
    pub recursivo: bool,
    #[serde(default = "tipo_padrao")]
    pub tipo: String,
    #[serde(default)]
    pub pasta_pai: Option<String>,
    #[serde(default)]
    pub espaco: Option<String>,
}

fn tipo_padrao() -> String {
    "nota".to_string()
}

pub async fn listar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Query(q): Query<ListarQuery>) -> AppResult<Json<serde_json::Value>> {
    let tipo = q.tipo.clone();
    let recursivo = q.recursivo;
    let pasta_pai = q.pasta_pai.clone().unwrap_or_default();
    // Sem `espaco` = tudo o que a pessoa enxerga; com `espaco`, o lógico vira a chave física (pessoal -> pessoal:<id>).
    let espaco = q.espaco.clone().filter(|e| !e.is_empty()).map(|e| crate::espacos::fisica(&e, &usuario.0));
    let visivel_pasta = crate::espacos::visivel_chave_sql("", &usuario.0);
    let visivel_doc = visivel_pasta.clone();
    let visivel_item = crate::espacos::visivel_sql("", &usuario.0);
    let visivel_item_nota = visivel_item.clone();

    let pastas: Vec<(String, String, i64, String)> = state
        .db
        .with_read({
            let tipo = tipo.clone();
            let pasta_pai = pasta_pai.clone();
            let espaco = espaco.clone();
            move |conn| {
                let sql = if espaco.is_some() { format!("SELECT caminho, nome, contagem_itens, espaco FROM pasta_cache WHERE tipo = ?1 AND espaco = ?2 AND {visivel_pasta}") } else { format!("SELECT caminho, nome, contagem_itens, espaco FROM pasta_cache WHERE tipo = ?1 AND {visivel_pasta}") };
                let mut stmt = conn.prepare(&sql)?;
                let converter = |r: &rusqlite::Row<'_>| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?, r.get::<_, String>(3)?));
                let bruto: Vec<(String, String, i64, String)> = if let Some(espaco) = espaco {
                    stmt.query_map(rusqlite::params![tipo, espaco], converter)?.filter_map(|r| r.ok()).collect()
                } else {
                    stmt.query_map([&tipo], converter)?.filter_map(|r| r.ok()).collect()
                };
                let linhas = bruto.into_iter().filter(|(caminho, _, _, _)| {
                    let pai_de_caminho = caminho.rsplit_once('/').map(|(pai, _)| pai).unwrap_or("");
                    pai_de_caminho == pasta_pai || (recursivo && (pasta_pai.is_empty() || caminho.starts_with(&format!("{pasta_pai}/"))))
                }).collect();
                Ok(linhas)
            }
        })
        .await?;

    let arvore = if tipo == "tarefa" { "Tarefas" } else { "Notas" };
    let mut metas: std::collections::HashMap<String, MetaPastas> = std::collections::HashMap::new();
    for (_, _, _, esp) in &pastas {
        if !metas.contains_key(esp) {
            let meta = match crate::espacos::raiz(&state, esp, arvore).await {
                Ok(r) => ler_meta(&r),
                Err(_) => MetaPastas::new(),
            };
            metas.insert(esp.clone(), meta);
        }
    }
    let subpastas: Vec<_> = pastas
        .into_iter()
        .map(|(caminho, nome, contagem_itens, esp)| {
            let aparencia = metas.get(&esp).and_then(|m| m.get(&caminho));
            let campo = |k: &str| aparencia.and_then(|a| a.get(k)).cloned().unwrap_or(serde_json::Value::Null);
            serde_json::json!({ "caminho": caminho, "nome": nome, "contagem_itens": contagem_itens, "cor": campo("cor"), "icone": campo("icone") })
        })
        .collect();

    // Conteúdo direto (Notas e Documentos misturados, seção 11.5) — só faz
    // sentido pra árvore de Notas; Tarefas não tem Documento.
    let espaco_itens = q.espaco.clone().filter(|e| !e.is_empty());
    let itens: Vec<serde_json::Value> = if tipo == "tarefa" {
        state
            .db
            .with_read(move |conn| {
                let mut stmt = conn.prepare(&format!("SELECT id, titulo, status FROM tarefa WHERE COALESCE(pasta_id, '') = ?1 AND (?2 IS NULL OR espaco = ?2) AND {visivel_item}"))?;
                let linhas = stmt
                    .query_map(rusqlite::params![&pasta_pai, &espaco_itens], |r| {
                        Ok(serde_json::json!({ "tipo": "tarefa", "id": r.get::<_, String>(0)?, "titulo": r.get::<_, String>(1)?, "status": r.get::<_, String>(2)? }))
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(linhas)
            })
            .await?
    } else {
        let mut itens = state
            .db
            .with_read({
                let pasta_pai = pasta_pai.clone();
                let espaco_itens = espaco_itens.clone();
                move |conn| {
                    let mut stmt = conn.prepare(&format!("SELECT id, titulo, modo FROM nota WHERE COALESCE(pasta_id, '') = ?1 AND (?2 IS NULL OR espaco = ?2) AND {visivel_item_nota}"))?;
                    let linhas = stmt
                        .query_map(rusqlite::params![&pasta_pai, &espaco_itens], |r| {
                            Ok(serde_json::json!({ "tipo": "nota", "id": r.get::<_, String>(0)?, "titulo": r.get::<_, String>(1)?, "modo": r.get::<_, String>(2)? }))
                        })?
                        .collect::<Result<Vec<_>, _>>()?;
                    Ok(linhas)
                }
            })
            .await?;
        let documentos = state
            .db
            .with_read(move |conn| {
                let mut stmt = conn.prepare(&format!("SELECT caminho, nome, tamanho_bytes, hash_conteudo FROM documento_cache WHERE COALESCE(pasta, '') = ?1 AND {visivel_doc}"))?;
                let linhas = stmt
                    .query_map([&pasta_pai], |r| {
                        Ok(serde_json::json!({
                            "tipo": "documento", "caminho": r.get::<_, String>(0)?, "nome": r.get::<_, String>(1)?,
                            "tamanho_bytes": r.get::<_, i64>(2)?, "hash": r.get::<_, String>(3)?,
                        }))
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(linhas)
            })
            .await?;
        itens.extend(documentos);
        itens
    };

    Ok(Json(serde_json::json!({ "subpastas": subpastas, "itens": itens })))
}

#[derive(Debug, Deserialize)]
pub struct CriarPastaPayload {
    #[serde(default)]
    pub espaco: Option<String>,
    #[serde(default = "tipo_padrao")]
    pub tipo: String,
    #[serde(default)]
    pub pasta_pai: Option<String>,
    pub nome: String,
    #[serde(default)]
    pub cor: Option<String>,
    #[serde(default)]
    pub icone: Option<String>,
}

pub async fn criar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Json(payload): Json<CriarPastaPayload>) -> AppResult<Json<serde_json::Value>> {
    if payload.nome.trim().is_empty() {
        return Err(AppError::validation(vec![CampoInvalido {
            campo: "nome".into(),
            motivo: "não pode ser vazio".into(),
        }]));
    }
    let nome = ecos_core::naming::sanitizar_nome_arquivo(&payload.nome);
    caminho_dentro_da_raiz("pasta_pai", payload.pasta_pai.as_deref().unwrap_or(""), true)?;
    validar_aparencia(&payload.cor, &payload.icone)?;
    let raiz = raiz_da_arvore(&state, &usuario.0, &payload.tipo, payload.espaco.as_deref()).await?;
    let dir = match &payload.pasta_pai {
        Some(p) if !p.is_empty() => raiz.join(p).join(&nome),
        _ => raiz.join(&nome),
    };
    std::fs::create_dir_all(&dir)?;
    let caminho_relativo = dir.strip_prefix(&raiz).unwrap_or(&dir).to_string_lossy().replace('\\', "/");
    if payload.cor.is_some() || payload.icone.is_some() {
        let mut meta = ler_meta(&raiz);
        definir_aparencia(&mut meta, &caminho_relativo, &payload.cor, &payload.icone);
        gravar_meta(&raiz, &meta)?;
    }
    reindexar_tudo(&state.db, &state.config.notes_root).await?;
    Ok(Json(serde_json::json!({ "ok": true, "caminho": caminho_relativo })))
}

#[derive(Debug, Deserialize)]
pub struct RenomearPastaPayload {
    #[serde(default)]
    pub espaco: Option<String>,
    #[serde(default = "tipo_padrao")]
    pub tipo: String,
    pub caminho_atual: String,
    pub novo_caminho: String,
    #[serde(default)]
    pub cor: Option<String>,
    #[serde(default)]
    pub icone: Option<String>,
}

pub async fn renomear(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Json(payload): Json<RenomearPastaPayload>) -> AppResult<Json<serde_json::Value>> {
    caminho_dentro_da_raiz("caminho_atual", &payload.caminho_atual, false)?;
    caminho_dentro_da_raiz("novo_caminho", &payload.novo_caminho, false)?;
    validar_aparencia(&payload.cor, &payload.icone)?;
    let raiz = raiz_da_arvore(&state, &usuario.0, &payload.tipo, payload.espaco.as_deref()).await?;
    let de = raiz.join(&payload.caminho_atual);
    let para = raiz.join(&payload.novo_caminho);
    if !de.is_dir() {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    if let Some(pai) = para.parent() {
        std::fs::create_dir_all(pai)?;
    }
    if de != para {
        std::fs::rename(&de, &para)?;
    }
    let mut meta = ler_meta(&raiz);
    mover_chaves(&mut meta, &payload.caminho_atual, &payload.novo_caminho);
    definir_aparencia(&mut meta, &payload.novo_caminho, &payload.cor, &payload.icone);
    gravar_meta(&raiz, &meta)?;
    reindexar_tudo(&state.db, &state.config.notes_root).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Debug, Deserialize)]
pub struct ExcluirPastaPayload {
    #[serde(default)]
    pub espaco: Option<String>,
    #[serde(default = "tipo_padrao")]
    pub tipo: String,
    pub caminho: String,
}

pub async fn excluir(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Json(payload): Json<ExcluirPastaPayload>) -> AppResult<Json<serde_json::Value>> {
    caminho_dentro_da_raiz("caminho", &payload.caminho, false)?;
    let raiz = raiz_da_arvore(&state, &usuario.0, &payload.tipo, payload.espaco.as_deref()).await?;
    let dir = raiz.join(&payload.caminho);
    if !dir.is_dir() {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    // Cascata pro conteúdo (mesma semântica do `escopo` de Nota/Tarefa,
    // seção 11.5) — remove a árvore inteira, inclusive `_anexos/`.
    std::fs::remove_dir_all(&dir)?;
    let mut meta = ler_meta(&raiz);
    remover_chaves(&mut meta, &payload.caminho);
    gravar_meta(&raiz, &meta)?;
    reindexar_tudo(&state.db, &state.config.notes_root).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn documento(
    State(state): State<AppState>,
    Extension(usuario): Extension<UsuarioAutenticado>, 
    axum::extract::Path(hash): axum::extract::Path<String>,
) -> AppResult<([(axum::http::HeaderName, &'static str); 1], Vec<u8>)> {
    let visivel = crate::espacos::visivel_chave_sql("", &usuario.0);
    let caminho: Option<String> = state
        .db
        .with_read(move |conn| conn.query_row(&format!("SELECT caminho FROM documento_cache WHERE hash_conteudo = ?1 AND {visivel}"), [&hash], |r| r.get(0)).optional())
        .await?;
    let caminho = caminho.ok_or(AppError::new(ErrorCode::NotFound))?;
    let bytes = std::fs::read(state.config.notes_root.join(caminho))?;
    Ok(([(axum::http::header::CONTENT_TYPE, "application/pdf")], bytes))
}
