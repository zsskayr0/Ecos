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

/// Raízes físicas do espaço, sem repetir. Na árvore única é uma só (a raiz do espaço); a lista existe para o código
/// de pastas continuar valendo se um dia houver mais de uma.
async fn raizes_do_espaco(state: &AppState, usuario_id: &str, tipo: &str, espaco: Option<&str>) -> AppResult<Vec<std::path::PathBuf>> {
    let espaco = espaco.filter(|e| !e.is_empty()).unwrap_or("pessoal");
    espaco.parse::<ecos_core::types::Espaco>().map_err(|motivo| AppError::validation(vec![CampoInvalido { campo: "espaco".into(), motivo }]))?;
    crate::espacos::exigir_acesso(state, usuario_id, espaco).await?;
    let fisica = crate::espacos::fisica(espaco, usuario_id);
    let (primeira, segunda) = if tipo == "tarefa" { ("Tarefas", "Notas") } else { ("Notas", "Tarefas") };
    let mut raizes = vec![crate::espacos::raiz(state, &fisica, primeira).await?];
    let outra = crate::espacos::raiz(state, &fisica, segunda).await?;
    if !raizes.contains(&outra) {
        raizes.push(outra);
    }
    Ok(raizes)
}

/// Cor/ícone de cada pasta lógica: junta os `.ecos-pastas.json` das duas árvores; a do tipo pedido vence.
fn meta_unificada(raizes: &[std::path::PathBuf]) -> MetaPastas {
    let mut meta = MetaPastas::new();
    for raiz in raizes.iter().rev() {
        meta.extend(ler_meta(raiz));
    }
    meta
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
pub(crate) const ARQUIVO_META: &str = ".ecos-pastas.json";
pub(crate) type MetaPastas = std::collections::BTreeMap<String, serde_json::Value>;

pub(crate) fn ler_meta(raiz: &std::path::Path) -> MetaPastas {
    std::fs::read_to_string(raiz.join(ARQUIVO_META)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

pub(crate) fn gravar_meta(raiz: &std::path::Path, meta: &MetaPastas) -> AppResult<()> {
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

/// Tags padrão da pasta (`tags` no `.ecos-pastas.json`): `None` mantém, lista vazia limpa. Guardadas na forma canônica.
fn definir_tags(meta: &mut MetaPastas, caminho: &str, tags: &Option<Vec<String>>) {
    let Some(tags) = tags else { return };
    let lista = ecos_core::tags::normalizar_lista(tags);
    let mut atual = meta.get(caminho).cloned().unwrap_or_else(|| serde_json::json!({}));
    if lista.is_empty() {
        if let Some(o) = atual.as_object_mut() {
            o.remove("tags");
        }
    } else {
        atual["tags"] = serde_json::json!(lista);
    }
    if atual.as_object().map_or(true, |o| o.is_empty()) {
        meta.remove(caminho);
    } else {
        meta.insert(caminho.to_string(), atual);
    }
}

/// Ajustes opcionais da pasta, no mesmo `.ecos-pastas.json`. Campo ausente mantém; vazio/falso/zero limpa.
#[derive(Debug, Default, Deserialize)]
pub struct ExtrasPasta {
    /// Texto curto que descreve a pasta.
    #[serde(default)]
    pub descricao: Option<String>,
    /// Pasta fixada: aparece antes das demais.
    #[serde(default)]
    pub fixada: Option<bool>,
    /// `baixa`, `media` ou `alta`: prioridade das tarefas novas criadas aqui (vazio = a das preferências).
    #[serde(default)]
    pub prioridade_padrao: Option<String>,
    /// Duração estimada (minutos) das tarefas novas criadas aqui (0 = a das preferências).
    #[serde(default)]
    pub duracao_padrao_min: Option<u32>,
}

fn validar_extras(e: &ExtrasPasta) -> AppResult<()> {
    let invalido = |campo: &str, motivo: &str| AppError::validation(vec![CampoInvalido { campo: campo.into(), motivo: motivo.into() }]);
    if e.descricao.as_deref().is_some_and(|d| d.chars().count() > 280) {
        return Err(invalido("descricao", "use até 280 caracteres"));
    }
    if e.prioridade_padrao.as_deref().is_some_and(|p| !matches!(p, "" | "baixa" | "media" | "alta")) {
        return Err(invalido("prioridade_padrao", "use baixa, media ou alta"));
    }
    if e.duracao_padrao_min.is_some_and(|m| m > 1440) {
        return Err(invalido("duracao_padrao_min", "no máximo 24 horas"));
    }
    Ok(())
}

fn definir_extras(meta: &mut MetaPastas, caminho: &str, e: &ExtrasPasta) {
    let mut atual = meta.get(caminho).cloned().unwrap_or_else(|| serde_json::json!({}));
    let mut tocar = |campo: &str, valor: Option<serde_json::Value>| {
        if let Some(o) = atual.as_object_mut() {
            match valor {
                Some(v) => { o.insert(campo.to_string(), v); }
                None => { o.remove(campo); }
            }
        }
    };
    if let Some(d) = &e.descricao {
        let d = d.trim();
        tocar("descricao", (!d.is_empty()).then(|| serde_json::Value::String(d.to_string())));
    }
    if let Some(f) = e.fixada {
        tocar("fixada", f.then(|| serde_json::Value::Bool(true)));
    }
    if let Some(p) = &e.prioridade_padrao {
        tocar("prioridade_padrao", (!p.is_empty()).then(|| serde_json::Value::String(p.clone())));
    }
    if let Some(m) = e.duracao_padrao_min {
        tocar("duracao_padrao_min", (m > 0).then(|| serde_json::json!(m)));
    }
    if atual.as_object().map_or(true, |o| o.is_empty()) {
        meta.remove(caminho);
    } else {
        meta.insert(caminho.to_string(), atual);
    }
}

pub(crate) fn mover_chaves(meta: &mut MetaPastas, de: &str, para: &str) {
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
    /// `nota` (notas e documentos), `tarefa` ou `todos`. Só filtra os itens: as subpastas são sempre as da pasta única.
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

    let pastas: Vec<(String, String, i64, i64, String)> = state
        .db
        .with_read({
            let pasta_pai = pasta_pai.clone();
            let espaco = espaco.clone();
            move |conn| {
                let mut stmt = conn.prepare(&format!("SELECT caminho, nome, contagem_notas, contagem_tarefas, espaco FROM pasta_cache WHERE (?1 IS NULL OR espaco = ?1) AND {visivel_pasta}"))?;
                let converter = |r: &rusqlite::Row<'_>| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?, r.get::<_, i64>(3)?, r.get::<_, String>(4)?));
                let bruto: Vec<(String, String, i64, i64, String)> = stmt.query_map([&espaco], converter)?.filter_map(|r| r.ok()).collect();
                let linhas = bruto.into_iter().filter(|(caminho, _, _, _, _)| {
                    let pai_de_caminho = caminho.rsplit_once('/').map(|(pai, _)| pai).unwrap_or("");
                    pai_de_caminho == pasta_pai || (recursivo && (pasta_pai.is_empty() || caminho.starts_with(&format!("{pasta_pai}/"))))
                }).collect();
                Ok(linhas)
            }
        })
        .await?;

    let arvores: &[&str] = if tipo == "tarefa" { &["Tarefas", "Notas"] } else { &["Notas", "Tarefas"] };
    let mut metas: std::collections::HashMap<String, MetaPastas> = std::collections::HashMap::new();
    for (_, _, _, _, esp) in &pastas {
        if !metas.contains_key(esp) {
            let mut raizes = Vec::new();
            for arvore in arvores {
                if let Ok(r) = crate::espacos::raiz(&state, esp, arvore).await {
                    raizes.push(r);
                }
            }
            metas.insert(esp.clone(), meta_unificada(&raizes));
        }
    }
    let subpastas: Vec<_> = pastas
        .into_iter()
        .map(|(caminho, nome, notas, tarefas, esp)| {
            let aparencia = metas.get(&esp).and_then(|m| m.get(&caminho));
            let campo = |k: &str| aparencia.and_then(|a| a.get(k)).cloned().unwrap_or(serde_json::Value::Null);
            // `contagem_itens` continua sendo a do tipo pedido (contrato antigo); as duas contagens vêm à parte.
            let contagem_itens = match tipo.as_str() { "tarefa" => tarefas, "todos" => notas + tarefas, _ => notas };
            serde_json::json!({ "caminho": caminho, "nome": nome, "contagem_itens": contagem_itens, "contagem_notas": notas, "contagem_tarefas": tarefas, "cor": campo("cor"), "icone": campo("icone"), "tags": campo("tags"), "descricao": campo("descricao"), "fixada": campo("fixada"), "prioridade_padrao": campo("prioridade_padrao"), "duracao_padrao_min": campo("duracao_padrao_min") })
        })
        .collect();

    // Conteúdo direto da pasta: notas e documentos (`nota`), tarefas (`tarefa`) ou tudo junto (`todos`).
    let espaco_itens = q.espaco.clone().filter(|e| !e.is_empty());
    let mut itens: Vec<serde_json::Value> = Vec::new();
    if tipo == "tarefa" || tipo == "todos" {
        let pasta_pai = pasta_pai.clone();
        let espaco_itens = espaco_itens.clone();
        let tarefas: Vec<serde_json::Value> = state
            .db
            .with_read(move |conn| {
                let mut stmt = conn.prepare(&format!("SELECT id, titulo, status, caminho_arquivo FROM tarefa WHERE COALESCE(pasta_id, '') = ?1 AND (?2 IS NULL OR espaco = ?2) AND {visivel_item}"))?;
                let linhas = stmt
                    .query_map(rusqlite::params![&pasta_pai, &espaco_itens], |r| {
                        Ok(serde_json::json!({ "tipo": "tarefa", "id": r.get::<_, String>(0)?, "titulo": r.get::<_, String>(1)?, "status": r.get::<_, String>(2)?, "fora_do_padrao": !crate::routes::arquivos_problemas::nome_no_padrao(true, &r.get::<_, String>(3)?) }))
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(linhas)
            })
            .await?;
        itens.extend(tarefas);
    }
    if tipo != "tarefa" {
        let notas: Vec<serde_json::Value> = state
            .db
            .with_read({
                let pasta_pai = pasta_pai.clone();
                let espaco_itens = espaco_itens.clone();
                move |conn| {
                    let mut stmt = conn.prepare(&format!("SELECT id, titulo, modo, caminho_arquivo FROM nota WHERE COALESCE(pasta_id, '') = ?1 AND (?2 IS NULL OR espaco = ?2) AND {visivel_item_nota}"))?;
                    let linhas = stmt
                        .query_map(rusqlite::params![&pasta_pai, &espaco_itens], |r| {
                            Ok(serde_json::json!({ "tipo": "nota", "id": r.get::<_, String>(0)?, "titulo": r.get::<_, String>(1)?, "modo": r.get::<_, String>(2)?, "fora_do_padrao": !crate::routes::arquivos_problemas::nome_no_padrao(false, &r.get::<_, String>(3)?) }))
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
        itens.extend(notas);
        itens.extend(documentos);
    }

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
    /// Tags padrão das notas e tarefas criadas nesta pasta.
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(flatten)]
    pub extras: ExtrasPasta,
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
    validar_extras(&payload.extras)?;
    let raiz = raizes_do_espaco(&state, &usuario.0, &payload.tipo, payload.espaco.as_deref()).await?.remove(0);
    let dir = match &payload.pasta_pai {
        Some(p) if !p.is_empty() => raiz.join(p).join(&nome),
        _ => raiz.join(&nome),
    };
    std::fs::create_dir_all(&dir)?;
    let caminho_relativo = dir.strip_prefix(&raiz).unwrap_or(&dir).to_string_lossy().replace('\\', "/");
    if payload.cor.is_some() || payload.icone.is_some() || payload.tags.is_some() || payload.extras.descricao.is_some() || payload.extras.fixada.is_some() || payload.extras.prioridade_padrao.is_some() || payload.extras.duracao_padrao_min.is_some() {
        let mut meta = ler_meta(&raiz);
        definir_aparencia(&mut meta, &caminho_relativo, &payload.cor, &payload.icone);
        definir_tags(&mut meta, &caminho_relativo, &payload.tags);
        definir_extras(&mut meta, &caminho_relativo, &payload.extras);
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
    /// Tags padrão da pasta: ausente mantém, lista vazia limpa.
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(flatten)]
    pub extras: ExtrasPasta,
}

pub async fn renomear(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Json(payload): Json<RenomearPastaPayload>) -> AppResult<Json<serde_json::Value>> {
    caminho_dentro_da_raiz("caminho_atual", &payload.caminho_atual, false)?;
    caminho_dentro_da_raiz("novo_caminho", &payload.novo_caminho, false)?;
    validar_aparencia(&payload.cor, &payload.icone)?;
    validar_extras(&payload.extras)?;
    let raizes = raizes_do_espaco(&state, &usuario.0, &payload.tipo, payload.espaco.as_deref()).await?;
    // A pasta lógica pode existir numa árvore ou nas duas: confere tudo antes de mexer em qualquer uma.
    let com_pasta: Vec<&std::path::PathBuf> = raizes.iter().filter(|r| r.join(&payload.caminho_atual).is_dir()).collect();
    if com_pasta.is_empty() {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    let mudou = payload.caminho_atual != payload.novo_caminho;
    if mudou && com_pasta.iter().any(|r| r.join(&payload.novo_caminho).exists()) {
        return Err(AppError::new(ErrorCode::Conflict).with_message("Já existe uma pasta com esse nome."));
    }
    for raiz in &com_pasta {
        let (de, para) = (raiz.join(&payload.caminho_atual), raiz.join(&payload.novo_caminho));
        if let Some(pai) = para.parent() {
            std::fs::create_dir_all(pai)?;
        }
        if mudou {
            std::fs::rename(&de, &para)?;
        }
    }
    for (i, raiz) in raizes.iter().enumerate() {
        let mut meta = ler_meta(raiz);
        mover_chaves(&mut meta, &payload.caminho_atual, &payload.novo_caminho);
        if i == 0 {
            definir_aparencia(&mut meta, &payload.novo_caminho, &payload.cor, &payload.icone);
            definir_tags(&mut meta, &payload.novo_caminho, &payload.tags);
            definir_extras(&mut meta, &payload.novo_caminho, &payload.extras);
        }
        gravar_meta(raiz, &meta)?;
    }
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
    /// A pasta é uma só para notas e tarefas: excluir pela tela de um tipo só leva junto itens do outro com `true`.
    #[serde(default)]
    pub todos_os_tipos: bool,
}

pub async fn excluir(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Json(payload): Json<ExcluirPastaPayload>) -> AppResult<Json<serde_json::Value>> {
    caminho_dentro_da_raiz("caminho", &payload.caminho, false)?;
    let raizes = raizes_do_espaco(&state, &usuario.0, &payload.tipo, payload.espaco.as_deref()).await?;
    let dirs: Vec<std::path::PathBuf> = raizes.iter().map(|r| r.join(&payload.caminho)).filter(|d| d.is_dir()).collect();
    if dirs.is_empty() {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    if !payload.todos_os_tipos {
        // Itens do outro tipo na pasta ou abaixo dela, em qualquer status: quem está na tela de Notas não vê as tarefas.
        let chave = crate::espacos::fisica(payload.espaco.as_deref().filter(|e| !e.is_empty()).unwrap_or("pessoal"), &usuario.0);
        let (logico, dono) = (crate::espacos::logica(&chave).to_string(), crate::espacos::dono(&chave).map(str::to_string));
        let caminho = payload.caminho.clone();
        let outra = if payload.tipo == "tarefa" { "nota" } else { "tarefa" };
        let outros: i64 = state
            .db
            .with_read(move |conn| {
                conn.query_row(
                    &format!("SELECT COUNT(*) FROM {outra} WHERE (pasta_id = ?1 OR pasta_id LIKE ?1 || '/%') AND espaco = ?2 AND (?3 IS NULL OR criado_por IS ?3)"),
                    rusqlite::params![caminho, logico, dono],
                    |r| r.get(0),
                )
            })
            .await?;
        if outros > 0 {
            let o_que = if outra == "tarefa" { "tarefas" } else { "notas" };
            return Err(AppError::new(ErrorCode::Conflict).with_message(format!("A pasta também tem {outros} {o_que}. Confirme para excluir tudo.")));
        }
    }
    // Cascata pro conteúdo (mesma semântica do `escopo` de Nota/Tarefa,
    // seção 11.5) — remove a pasta nas duas árvores, inclusive `_anexos/`.
    for dir in &dirs {
        std::fs::remove_dir_all(dir)?;
    }
    for raiz in &raizes {
        let mut meta = ler_meta(raiz);
        remover_chaves(&mut meta, &payload.caminho);
        gravar_meta(raiz, &meta)?;
    }
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
