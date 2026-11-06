//! Renomear nota ou tarefa atualizando os wikilinks que apontavam para ela (fase 2 de `wikilinks-backend`).
//!
//! Só reescreve `[[Antigo]]`, `[[Antigo|apelido]]` e `[[nota:Antigo]]`/`[[tarefa:Antigo]]` que, pela mesma
//! resolução do índice, apontavam para o item; blocos de código ficam intocados. As origens de um link ficam
//! sempre no espaço do item (a resolução nunca cruza espaço), então todas são visíveis e editáveis por quem
//! renomeia. A aplicação grava todos os arquivos ou nenhum e deixa um diário em `.ecos/renomeacoes/<id>`
//! (arquivos originais e gravados) para o desfazer.

use axum::extract::{Path, State};
use axum::{Extension, Json};
use chrono::Utc;
use ecos_core::types::{NotaFrontMatter, TarefaFrontMatter};
use ecos_core::wikilink::{self, Candidato, Referencia, TipoItem, Troca};
use ecos_core::{frontmatter, new_id, ErrorCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;

use crate::error::{AppError, AppResult, CampoInvalido};
use crate::espacos::{fisica, visivel_sql};
use crate::middleware::auth_guard::UsuarioAutenticado;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct CorpoRenomear {
    pub titulo: String,
    /// Padrão `true`: reescreve os links. Com `false` só renomeia (o comportamento antigo).
    #[serde(default = "verdadeiro")]
    pub reescrever_links: bool,
    /// Só tarefas de série: `esta` (padrão), `proximas` ou `serie`, como no PATCH.
    #[serde(default)]
    pub escopo: Option<String>,
}

fn verdadeiro() -> bool {
    true
}

struct Mudanca {
    tipo: TipoItem,
    id: String,
    titulo: String,
    caminho: String,
    original: String,
    corpo_novo: String,
    ocorrencias: usize,
    ambiguo: bool,
}

struct Plano {
    alvo_tipo: TipoItem,
    alvo_id: String,
    de: String,
    para: String,
    mudancas: Vec<Mudanca>,
    avisos: Vec<String>,
}

fn invalido(campo: &str, motivo: &str) -> AppError {
    AppError::validation(vec![CampoInvalido { campo: campo.into(), motivo: motivo.into() }])
}

fn raiz(state: &AppState) -> PathBuf {
    state.config.notes_root.clone()
}

/// Itens visíveis como candidatos de resolução, com o caminho relativo do arquivo de cada um.
fn carregar(conn: &rusqlite::Connection, uid: &str) -> rusqlite::Result<Vec<(Candidato, String)>> {
    let mut out = Vec::new();
    for (tabela, alias, tipo) in [("nota", "n", TipoItem::Nota), ("tarefa", "t", TipoItem::Tarefa)] {
        let mut stmt = conn.prepare(&format!(
            "SELECT {alias}.id, {alias}.titulo, {alias}.espaco, COALESCE({alias}.criado_por, ''), {alias}.atualizado_em, {alias}.caminho_arquivo FROM {tabela} {alias} WHERE {}",
            visivel_sql(alias, uid)
        ))?;
        let linhas = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, String>(4)?, r.get::<_, String>(5)?)))?;
        for l in linhas {
            let (id, titulo, espaco, criado_por, atualizado_em, caminho) = l?;
            out.push((Candidato { tipo, id, titulo, espaco: fisica(&espaco, &criado_por), atualizado_em }, caminho));
        }
    }
    Ok(out)
}

fn corpo_de(tipo: TipoItem, bruto: &str) -> Option<String> {
    match tipo {
        TipoItem::Nota => frontmatter::parse::<NotaFrontMatter>(bruto).ok().map(|d| d.body),
        TipoItem::Tarefa => frontmatter::parse::<TarefaFrontMatter>(bruto).ok().map(|d| d.body),
    }
}

/// Arquivo inteiro com o corpo trocado e `atualizado_em` renovado (é uma edição, e o sync olha esse campo).
fn serializar_com_corpo(tipo: TipoItem, bruto: &str, corpo: &str) -> Option<String> {
    match tipo {
        TipoItem::Nota => {
            let mut d = frontmatter::parse::<NotaFrontMatter>(bruto).ok()?;
            d.front_matter.atualizado_em = Utc::now();
            frontmatter::serialize(&d.front_matter, corpo).ok()
        }
        TipoItem::Tarefa => {
            let mut d = frontmatter::parse::<TarefaFrontMatter>(bruto).ok()?;
            d.front_matter.atualizado_em = Some(Utc::now());
            frontmatter::serialize(&d.front_matter, corpo).ok()
        }
    }
}

async fn planejar(state: &AppState, uid: &str, tipo: TipoItem, id: &str, novo: &str, reescrever: bool) -> AppResult<Plano> {
    let novo = novo.trim().to_string();
    if novo.is_empty() {
        return Err(invalido("titulo", "o título não pode ficar vazio"));
    }
    let (u, i) = (uid.to_string(), id.to_string());
    let todos = state.db.with_read(move |conn| carregar(conn, &u)).await?;
    let alvo = todos
        .iter()
        .find(|(c, _)| c.tipo == tipo && c.id == i)
        .map(|(c, _)| c.clone())
        .ok_or(AppError::new(ErrorCode::NotFound))?;
    let mut plano = Plano { alvo_tipo: tipo, alvo_id: id.to_string(), de: alvo.titulo.clone(), para: novo.clone(), mudancas: Vec::new(), avisos: Vec::new() };
    if !reescrever || novo == alvo.titulo || wikilink::normalizar_titulo(&novo) == wikilink::normalizar_titulo(&alvo.titulo) {
        return Ok(plano); // nada muda para quem resolve por título (ou o pedido é só renomear)
    }
    if novo.contains(']') || novo.contains('|') || novo.contains('[') {
        plano.avisos.push("O novo título tem [, ] ou | e não pode ser escrito dentro de [[ ]]: os links não serão reescritos.".into());
        return Ok(plano);
    }

    // Só o espaço do item importa: a resolução nunca cruza espaço.
    let espaco = alvo.espaco.clone();
    let mesmo: Vec<(Candidato, String)> = todos.into_iter().filter(|(c, _)| c.espaco == espaco).collect();
    let antes: Vec<Candidato> = mesmo.iter().map(|(c, _)| c.clone()).collect();
    let depois: Vec<Candidato> = antes
        .iter()
        .map(|c| if c.tipo == tipo && c.id == alvo.id { Candidato { titulo: novo.clone(), atualizado_em: Utc::now().to_rfc3339(), ..c.clone() } } else { c.clone() })
        .collect();
    let aponta_para_alvo = |c: Option<&Candidato>| c.is_some_and(|c| c.tipo == tipo && c.id == alvo.id);

    for (fonte, caminho) in &mesmo {
        if fonte.tipo == tipo && fonte.id == alvo.id {
            continue; // autolink nunca conta
        }
        let Ok(original) = std::fs::read_to_string(raiz(state).join(caminho)) else {
            plano.avisos.push(format!("Não foi possível ler \"{}\"; os links dele não foram verificados.", fonte.titulo));
            continue;
        };
        if !original.contains("[[") {
            continue;
        }
        let Some(corpo) = corpo_de(fonte.tipo, &original) else {
            plano.avisos.push(format!("O arquivo de \"{}\" tem front-matter inválido e foi ignorado.", fonte.titulo));
            continue;
        };
        let mut ambiguo = false;
        let (corpo_novo, ocorrencias) = wikilink::reescrever(&corpo, tipo, |r: &Referencia| {
            let ignorar = Some((fonte.tipo, fonte.id.as_str()));
            if !aponta_para_alvo(wikilink::resolver(r, Some(&espaco), None, ignorar, &antes)) {
                return None;
            }
            let com = |t: Option<TipoItem>| Referencia { tipo: t, titulo: novo.clone() };
            if aponta_para_alvo(wikilink::resolver(&com(r.tipo), Some(&espaco), None, ignorar, &depois)) {
                return Some(Troca { titulo: novo.clone(), forcar_prefixo: false });
            }
            // O título novo colide com outro item que ganharia o link: fixa o tipo com prefixo.
            if r.tipo.is_none() && aponta_para_alvo(wikilink::resolver(&com(Some(tipo)), Some(&espaco), None, ignorar, &depois)) {
                return Some(Troca { titulo: novo.clone(), forcar_prefixo: true });
            }
            ambiguo = true;
            Some(Troca { titulo: novo.clone(), forcar_prefixo: false })
        });
        if ocorrencias > 0 {
            plano.mudancas.push(Mudanca { tipo: fonte.tipo, id: fonte.id.clone(), titulo: fonte.titulo.clone(), caminho: caminho.clone(), original, corpo_novo, ocorrencias, ambiguo });
        }
    }
    plano.mudancas.sort_by(|a, b| wikilink::normalizar_titulo(&a.titulo).cmp(&wikilink::normalizar_titulo(&b.titulo)).then(a.id.cmp(&b.id)));
    if plano.mudancas.iter().any(|m| m.ambiguo) {
        plano.avisos.push("Há outro item com o título novo no mesmo espaço; alguns links podem apontar para ele.".into());
    }
    Ok(plano)
}

fn resumo(plano: &Plano) -> Value {
    json!({
        "de": plano.de,
        "para": plano.para,
        "total_links": plano.mudancas.iter().map(|m| m.ocorrencias).sum::<usize>(),
        "afetados": plano.mudancas.iter().map(|m| json!({
            "id": m.id, "tipo": m.tipo.como_str(), "titulo": m.titulo, "ocorrencias": m.ocorrencias, "ambiguo": m.ambiguo,
        })).collect::<Vec<_>>(),
        "avisos": plano.avisos,
    })
}

async fn previa(state: AppState, uid: String, tipo: TipoItem, id: String, corpo: CorpoRenomear) -> AppResult<Json<Value>> {
    let plano = planejar(&state, &uid, tipo, &id, &corpo.titulo, corpo.reescrever_links).await?;
    Ok(Json(resumo(&plano)))
}

pub async fn previa_nota(State(state): State<AppState>, Extension(u): Extension<UsuarioAutenticado>, Path(id): Path<String>, Json(c): Json<CorpoRenomear>) -> AppResult<Json<Value>> {
    previa(state, u.0, TipoItem::Nota, id, c).await
}

pub async fn previa_tarefa(State(state): State<AppState>, Extension(u): Extension<UsuarioAutenticado>, Path(id): Path<String>, Json(c): Json<CorpoRenomear>) -> AppResult<Json<Value>> {
    previa(state, u.0, TipoItem::Tarefa, id, c).await
}

pub async fn aplicar_nota(State(state): State<AppState>, Extension(u): Extension<UsuarioAutenticado>, Path(id): Path<String>, Json(c): Json<CorpoRenomear>) -> AppResult<Json<Value>> {
    aplicar(state, u, TipoItem::Nota, id, c).await
}

pub async fn aplicar_tarefa(State(state): State<AppState>, Extension(u): Extension<UsuarioAutenticado>, Path(id): Path<String>, Json(c): Json<CorpoRenomear>) -> AppResult<Json<Value>> {
    aplicar(state, u, TipoItem::Tarefa, id, c).await
}

/// Renomeia o item pelo mesmo caminho do PATCH (arquivo, pasta, série, reindex).
async fn renomear_item(state: &AppState, u: &UsuarioAutenticado, tipo: TipoItem, id: &str, titulo: &str, escopo: Option<&str>) -> AppResult<()> {
    let mut campos = json!({ "titulo": titulo });
    if let (TipoItem::Tarefa, Some(e)) = (tipo, escopo) {
        campos["escopo"] = json!(e);
    }
    let (s, e, p) = (State(state.clone()), Extension(u.clone()), Path(id.to_string()));
    match tipo {
        TipoItem::Nota => crate::routes::notas::atualizar(s, e, p, Json(serde_json::from_value(campos).map_err(|_| AppError::new(ErrorCode::InternalError))?)).await.map(|_| ()),
        TipoItem::Tarefa => crate::routes::tarefas::atualizar(s, e, p, Json(serde_json::from_value(campos).map_err(|_| AppError::new(ErrorCode::InternalError))?)).await.map(|_| ()),
    }
}

#[derive(Serialize, Deserialize)]
struct ArquivoDiario {
    caminho: String,
    tipo: String,
}

#[derive(Serialize, Deserialize)]
struct Diario {
    usuario: String,
    tipo: String,
    id: String,
    de: String,
    para: String,
    arquivos: Vec<ArquivoDiario>,
}

fn dir_diarios(state: &AppState) -> PathBuf {
    state.config.notes_root.join(".ecos/renomeacoes")
}

fn id_de_diario_valido(id: &str) -> bool {
    id.strip_prefix("renomeacao-").and_then(|s| ulid::Ulid::from_string(s).ok()).is_some()
}

fn temp_de(destino: &std::path::Path) -> PathBuf {
    let nome = destino.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    destino.with_file_name(format!(".{nome}.renomear.tmp"))
}

fn limpar(temps: &[PathBuf]) {
    for t in temps {
        let _ = std::fs::remove_file(t);
    }
}

async fn aplicar(state: AppState, usuario: UsuarioAutenticado, tipo: TipoItem, id: String, corpo: CorpoRenomear) -> AppResult<Json<Value>> {
    let plano = planejar(&state, &usuario.0, tipo, &id, &corpo.titulo, corpo.reescrever_links).await?;
    let raiz = raiz(&state);

    // 1) Prepara tudo em arquivos temporários ao lado dos originais: nada vira definitivo antes de tudo estar pronto.
    let mut preparados: Vec<(PathBuf, PathBuf, String, String)> = Vec::new(); // (destino, temp, original, novo)
    let mut temps: Vec<PathBuf> = Vec::new();
    for m in &plano.mudancas {
        let destino = raiz.join(&m.caminho);
        let Some(novo) = serializar_com_corpo(m.tipo, &m.original, &m.corpo_novo) else {
            limpar(&temps);
            return Err(AppError::new(ErrorCode::InternalError).with_message("Não foi possível preparar a reescrita dos links."));
        };
        let temp = temp_de(&destino);
        if let Err(e) = std::fs::write(&temp, &novo) {
            limpar(&temps);
            let _ = std::fs::remove_file(&temp);
            return Err(e.into());
        }
        temps.push(temp.clone());
        preparados.push((destino, temp, m.original.clone(), novo));
    }

    // 2) Diário (originais + gravados) para o desfazer, antes de tocar em qualquer arquivo.
    let diario_id = format!("renomeacao-{}", new_id());
    let dir = dir_diarios(&state).join(&diario_id);
    let gravar_diario = || -> std::io::Result<()> {
        std::fs::create_dir_all(&dir)?;
        for (n, (_, _, original, novo)) in preparados.iter().enumerate() {
            std::fs::write(dir.join(format!("{n}.original")), original)?;
            std::fs::write(dir.join(format!("{n}.novo")), novo)?;
        }
        let diario = Diario {
            usuario: usuario.0.clone(),
            tipo: tipo.como_str().into(),
            id: id.clone(),
            de: plano.de.clone(),
            para: plano.para.clone(),
            arquivos: plano.mudancas.iter().map(|m| ArquivoDiario { caminho: m.caminho.clone(), tipo: m.tipo.como_str().into() }).collect(),
        };
        std::fs::write(dir.join("registro.json"), serde_json::to_vec(&diario)?)
    };
    if let Err(e) = gravar_diario() {
        limpar(&temps);
        let _ = std::fs::remove_dir_all(&dir);
        return Err(e.into());
    }

    // 3) Renomeia o item. Se falhar (validação, disco), nada foi trocado ainda.
    if let Err(e) = renomear_item(&state, &usuario, tipo, &id, &plano.para, corpo.escopo.as_deref()).await {
        limpar(&temps);
        let _ = std::fs::remove_dir_all(&dir);
        return Err(e);
    }
    let desfazer_titulo = |state: &AppState| {
        let (state, usuario, id, de, escopo) = (state.clone(), usuario.clone(), id.clone(), plano.de.clone(), corpo.escopo.clone());
        async move {
            let _ = renomear_item(&state, &usuario, tipo, &id, &de, escopo.as_deref()).await;
        }
    };

    // 4) Os originais não podem ter mudado desde a prévia (edição concorrente, propagação de série): senão volta tudo.
    let mudou = preparados.iter().any(|(destino, _, original, _)| std::fs::read_to_string(destino).map_or(true, |atual| &atual != original));
    if mudou {
        limpar(&temps);
        let _ = std::fs::remove_dir_all(&dir);
        desfazer_titulo(&state).await;
        return Err(AppError::new(ErrorCode::Conflict).with_message("Algum arquivo mudou durante a renomeação. Nada foi alterado; tente de novo."));
    }

    // 5) Troca os arquivos; se um falhar, restaura os que já foram e volta o título.
    for (n, (destino, temp, _, _)) in preparados.iter().enumerate() {
        if let Err(e) = std::fs::rename(temp, destino) {
            for (d, _, original, _) in &preparados[..n] {
                let _ = std::fs::write(d, original);
            }
            limpar(&temps);
            let _ = std::fs::remove_dir_all(&dir);
            desfazer_titulo(&state).await;
            let _ = crate::db::reindex::reindexar_tudo(&state.db, &state.config.notes_root).await;
            return Err(e.into());
        }
    }
    if preparados.is_empty() {
        let _ = std::fs::remove_dir_all(&dir); // sem arquivos reescritos, o desfazer do título é o PATCH comum
    }
    crate::db::reindex::reindexar_tudo(&state.db, &state.config.notes_root).await?;

    let mut resposta = resumo(&plano);
    resposta["id"] = json!(plano.alvo_id);
    resposta["tipo"] = json!(plano.alvo_tipo.como_str());
    resposta["atualizados"] = json!(plano.mudancas.len());
    resposta["desfazer_id"] = if preparados.is_empty() { Value::Null } else { json!(diario_id) };
    Ok(Json(resposta))
}

/// `POST /renomeacoes/:id/desfazer`: devolve o título e o texto dos arquivos reescritos. Arquivo editado depois
/// da renomeação não é sobrescrito (vai em `nao_restaurados`).
pub async fn desfazer(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(diario_id): Path<String>) -> AppResult<Json<Value>> {
    if !id_de_diario_valido(&diario_id) {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    let dir = dir_diarios(&state).join(&diario_id);
    let lido: Diario = std::fs::read(dir.join("registro.json"))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .ok_or(AppError::new(ErrorCode::NotFound))?;
    if lido.usuario != usuario.0 {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    let tipo = if lido.tipo == "tarefa" { TipoItem::Tarefa } else { TipoItem::Nota };

    // O item precisa continuar visível e com o título dado pela renomeação.
    let (u, i) = (usuario.0.clone(), lido.id.clone());
    let todos = state.db.with_read(move |conn| carregar(conn, &u)).await?;
    let atual = todos.iter().find(|(c, _)| c.tipo == tipo && c.id == i).map(|(c, _)| c.titulo.clone()).ok_or(AppError::new(ErrorCode::NotFound))?;
    if atual != lido.para {
        return Err(AppError::new(ErrorCode::Conflict).with_message("O título mudou depois da renomeação; não dá para desfazer automaticamente."));
    }

    let raiz = raiz(&state);
    let mut restaurados = 0;
    let mut nao_restaurados: Vec<String> = Vec::new();
    for (n, arq) in lido.arquivos.iter().enumerate() {
        let (Ok(original), Ok(gravado)) = (std::fs::read_to_string(dir.join(format!("{n}.original"))), std::fs::read_to_string(dir.join(format!("{n}.novo")))) else {
            nao_restaurados.push(arq.caminho.clone());
            continue;
        };
        let destino = raiz.join(&arq.caminho);
        match std::fs::read_to_string(&destino) {
            Ok(agora) if agora == gravado && std::fs::write(&destino, original).is_ok() => restaurados += 1,
            _ => nao_restaurados.push(arq.caminho.clone()),
        }
    }
    renomear_item(&state, &usuario, tipo, &lido.id, &lido.de, None).await?;
    crate::db::reindex::reindexar_tudo(&state.db, &state.config.notes_root).await?;
    let _ = std::fs::remove_dir_all(&dir);
    Ok(Json(json!({ "id": lido.id, "titulo": lido.de, "restaurados": restaurados, "nao_restaurados": nao_restaurados })))
}
