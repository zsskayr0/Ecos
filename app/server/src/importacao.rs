//! Importador de notas de outros aplicativos (Obsidian, Notion e qualquer pasta de `.md`) — nunca destrutivo.
//!
//! Fluxo, sempre sob a sessão da própria pessoa e só no espaço Pessoal:
//! 1. `POST /me/importacao/validar` — envia um `.zip` (ou um `.md` solto); o servidor valida tamanho, caminhos e
//!    texto, monta as notas e devolve a prévia (novas, já importadas, ignoradas). Nada é gravado em `Notas/`.
//! 2. `POST /me/importacao/:token/aplicar` — com a frase `IMPORTAR`: grava só as notas novas; se falhar no meio,
//!    desfaz o que gravou; salva um relatório recuperável.
//! 3. `DELETE /me/importacao/:token` — cancela e descarta o pacote enviado.
//!
//! Idempotência: cada nota importada tem uma impressão digital (SHA-256 de caminho no pacote + conteúdo) gravada num
//! registro em `.ecos/importacoes/<usuario>.json`, fora da árvore de notas. Importar o mesmo pacote de novo não
//! cria nada. Anexos (imagens/PDF) e outros formatos ficam de fora desta versão e aparecem como ignorados.

use axum::extract::{Multipart, Path as RotaPath, State};
use axum::{Extension, Json};
use chrono::{DateTime, NaiveDate, SecondsFormat, Utc};
use ecos_core::types::{Espaco, NotaFrontMatter, NotaModo};
use ecos_core::{frontmatter, naming, new_id, ErrorCode};
use serde::Deserialize;
use serde_yaml::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult, CampoInvalido};
use crate::middleware::auth_guard::UsuarioAutenticado;
use crate::state::AppState;
use crate::zip::LeitorZip;

pub const FRASE_IMPORTAR: &str = "IMPORTAR";
/// Tamanho máximo do arquivo enviado.
pub const TAMANHO_MAXIMO_BYTES: usize = 100 * 1024 * 1024;
const MAX_NOTAS: usize = 5_000;
const MAX_BYTES_NOTA: u64 = 2 * 1024 * 1024;
const MAX_PROFUNDIDADE: usize = 8;
const MAX_LISTADOS: usize = 200;
const VALIDADE_PACOTE: std::time::Duration = std::time::Duration::from_secs(3600);

/// Uma importação por vez: duas aplicações simultâneas poderiam disputar nomes de arquivo e o registro.
static TRAVA: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Debug, Clone)]
struct ItemNota {
    /// Caminho no pacote (para o relatório).
    origem: String,
    titulo: String,
    /// Pasta sob `Notas/`, já saneada (`""` = raiz).
    pasta: String,
    conteudo: String,
    impressao: String,
}

#[derive(Debug, Default)]
struct Analise {
    formato: &'static str,
    novas: Vec<ItemNota>,
    ja_importadas: usize,
    ignorados: Vec<(String, String)>,
}

// --- Montagem de uma nota -----------------------------------------------------------------------------------------

fn nome_ok(nome: &str) -> bool {
    !nome.is_empty()
        && nome.len() <= 512
        && !nome.starts_with('/')
        && !nome.contains(['\\', ':', '\0'])
        && !nome.chars().any(char::is_control)
        && nome.split('/').all(|p| !p.is_empty() && p != "." && p != "..")
}

/// Remove o sufixo de 32 hexadecimais que o Notion acrescenta a nomes de páginas e pastas.
fn sem_id_notion(nome: &str) -> String {
    if let Some((resto, sufixo)) = nome.rsplit_once(' ') {
        if sufixo.len() == 32 && sufixo.chars().all(|c| c.is_ascii_hexdigit()) && !resto.trim().is_empty() {
            return resto.trim().to_string();
        }
    }
    nome.to_string()
}

fn segmento_pasta(seg: &str) -> String {
    let limpo = naming::sanitizar_nome_arquivo(sem_id_notion(seg).trim());
    limpo.trim_matches('.').trim().chars().take(80).collect()
}

fn titulo_do_corpo(corpo: &str) -> Option<String> {
    let linha = corpo.lines().find(|l| !l.trim().is_empty())?;
    let texto = linha.trim_start().strip_prefix("# ")?.trim();
    (!texto.is_empty()).then(|| texto.to_string())
}

fn data_de(v: &Value) -> Option<DateTime<Utc>> {
    let s = v.as_str()?.trim();
    if let Ok(d) = DateTime::parse_from_rfc3339(s) {
        return Some(d.with_timezone(&Utc));
    }
    // "2026-03-04", "2026-03-04 10:30", "2026-03-04T10:30:00": sem fuso informado, lido como UTC (determinístico).
    let dia = NaiveDate::parse_from_str(s.get(..10)?, "%Y-%m-%d").ok()?;
    let hora = s.get(11..16).and_then(|h| chrono::NaiveTime::parse_from_str(h, "%H:%M").ok()).unwrap_or_default();
    Some(dia.and_time(hora).and_utc())
}

fn tags_de(v: &Value) -> Vec<String> {
    let brutas: Vec<String> = match v {
        Value::Sequence(s) => s.iter().filter_map(|x| x.as_str().map(str::to_string)).collect(),
        Value::String(s) => s.split([',', ' ']).map(str::to_string).collect(),
        _ => Vec::new(),
    };
    ecos_core::tags::normalizar_lista(brutas.iter().map(|t| t.trim().trim_start_matches('#')).filter(|t| !t.is_empty()))
}

/// Constrói a nota do Ecos a partir do texto de um `.md` externo. O corpo nunca é alterado.
fn montar_nota(texto: &str, nome_arquivo: &str, pasta: &str, agora: DateTime<Utc>, usuario: &str) -> Result<(String, String), String> {
    let (mapa, corpo) = match frontmatter::parse::<Value>(texto) {
        Ok(doc) => match doc.front_matter {
            Value::Mapping(m) => (m, doc.body),
            Value::Null => (Default::default(), doc.body),
            _ => return Err("o front-matter não é um mapa YAML".into()),
        },
        Err(frontmatter::FrontMatterError::MissingOpeningDelimiter) => (Default::default(), texto.to_string()),
        Err(e) => return Err(format!("front-matter inválido ({e})")),
    };
    let pega = |nomes: &[&str]| nomes.iter().find_map(|n| mapa.get(*n));
    let titulo = pega(&["titulo", "title"])
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| titulo_do_corpo(&corpo))
        .unwrap_or_else(|| nome_arquivo.trim().to_string());
    if titulo.is_empty() {
        return Err("sem título".into());
    }
    let criado = pega(&["criado_em", "created", "date", "created_at"]).and_then(data_de).unwrap_or(agora);
    let atualizado = pega(&["atualizado_em", "updated", "modified", "updated_at"]).and_then(data_de).unwrap_or(criado).max(criado);
    let tags = pega(&["tags", "tag"]).map(tags_de).unwrap_or_default();
    let fm = NotaFrontMatter {
        id: new_id(),
        titulo: titulo.clone(),
        modo: NotaModo::default(),
        criado_em: criado,
        atualizado_em: atualizado,
        tags,
        pasta_id: (!pasta.is_empty()).then(|| pasta.to_string()),
        espaco: Espaco::Pessoal,
        tarefa_vinculada_id: None,
        ultima_revisao_em: None,
        criado_por: Some(usuario.to_string()),
    };
    let conteudo = frontmatter::serialize(&fm, &corpo).map_err(|e| e.to_string())?;
    Ok((titulo, conteudo))
}

fn impressao(caminho: &str, bruto: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(caminho.as_bytes());
    h.update([0u8]);
    h.update(bruto);
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

// --- Análise do pacote --------------------------------------------------------------------------------------------

fn analisar(arquivo: &Path, nome_original: &str, ja_importadas: &BTreeSet<String>, usuario: &str, agora: DateTime<Utc>) -> Result<Analise, String> {
    let mut cabeca = [0u8; 4];
    {
        use std::io::Read;
        let mut f = std::fs::File::open(arquivo).map_err(|e| e.to_string())?;
        let n = f.read(&mut cabeca).map_err(|e| e.to_string())?;
        if n < 4 {
            cabeca = [0; 4];
        }
    }
    let mut analise = Analise::default();
    let mut vistas: HashSet<String> = HashSet::new();
    let mut registrar = |analise: &mut Analise, origem: String, bruto: Vec<u8>, nome_arquivo: &str, pasta: String| {
        let hash = impressao(&origem, &bruto);
        if !vistas.insert(hash.clone()) {
            analise.ignorados.push((origem, "conteúdo repetido dentro do pacote".into()));
            return;
        }
        if ja_importadas.contains(&hash) {
            analise.ja_importadas += 1;
            return;
        }
        let texto = match String::from_utf8(bruto) {
            Ok(t) => t,
            Err(_) => {
                analise.ignorados.push((origem, "o arquivo não é texto UTF-8".into()));
                return;
            }
        };
        match montar_nota(&texto, nome_arquivo, &pasta, agora, usuario) {
            Ok((titulo, conteudo)) => analise.novas.push(ItemNota { origem, titulo, pasta, conteudo, impressao: hash }),
            Err(motivo) => analise.ignorados.push((origem, motivo)),
        }
    };

    if cabeca == *b"PK\x03\x04" || cabeca == *b"PK\x05\x06" {
        analise.formato = "zip";
        let mut leitor = LeitorZip::abrir_com_deflate(arquivo).map_err(|e| e.to_string())?;
        let entradas = leitor.entradas.clone();
        let mut candidatas = Vec::new();
        for (i, e) in entradas.iter().enumerate() {
            let nome = e.nome.as_str();
            if !nome_ok(nome) {
                analise.ignorados.push((nome.chars().take(80).collect(), "caminho inválido".into()));
                continue;
            }
            let partes: Vec<&str> = nome.split('/').collect();
            let arquivo_nome = *partes.last().unwrap();
            if partes.iter().any(|p| p.starts_with('.') || *p == "__MACOSX") {
                analise.ignorados.push((nome.to_string(), "arquivo de sistema ou configuração".into()));
                continue;
            }
            if !arquivo_nome.to_lowercase().ends_with(".md") {
                analise.ignorados.push((nome.to_string(), "anexos e outros formatos não são importados nesta versão".into()));
                continue;
            }
            if e.tamanho > MAX_BYTES_NOTA {
                analise.ignorados.push((nome.to_string(), "maior que o limite de 2 MB por nota".into()));
                continue;
            }
            candidatas.push((i, partes.iter().map(|s| s.to_string()).collect::<Vec<_>>()));
        }
        if candidatas.len() > MAX_NOTAS {
            return Err(format!("o pacote tem {} notas; o limite é {MAX_NOTAS} por importação", candidatas.len()));
        }
        // Uma única pasta de topo (comum em exportações) não vira pasta no Ecos.
        let topo: BTreeSet<&str> = candidatas.iter().filter(|(_, p)| p.len() > 1).map(|(_, p)| p[0].as_str()).collect();
        let remover_topo = topo.len() == 1 && candidatas.iter().all(|(_, p)| p.len() > 1);
        for (i, partes) in candidatas {
            let nome_completo = partes.join("/");
            let (arquivo_nome, dirs) = partes.split_last().unwrap();
            let dirs = if remover_topo { &dirs[1..] } else { dirs };
            let segmentos: Vec<String> = dirs.iter().map(|d| segmento_pasta(d)).filter(|s| !s.is_empty()).collect();
            if segmentos.len() > MAX_PROFUNDIDADE {
                analise.ignorados.push((nome_completo, "pastas aninhadas demais".into()));
                continue;
            }
            let bruto = match leitor.ler(i, MAX_BYTES_NOTA) {
                Ok(b) => b,
                Err(e) => {
                    analise.ignorados.push((nome_completo, e.to_string()));
                    continue;
                }
            };
            let stem = arquivo_nome.rsplit_once('.').map(|(s, _)| s).unwrap_or(arquivo_nome);
            registrar(&mut analise, nome_completo, bruto, &sem_id_notion(stem), segmentos.join("/"));
        }
    } else {
        analise.formato = "markdown";
        let meta = std::fs::metadata(arquivo).map_err(|e| e.to_string())?;
        if meta.len() > MAX_BYTES_NOTA {
            return Err("o arquivo é maior que o limite de 2 MB por nota".into());
        }
        let nome = Path::new(nome_original).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        if !nome.to_lowercase().ends_with(".md") {
            return Err("envie um .zip ou um arquivo .md".into());
        }
        let bruto = std::fs::read(arquivo).map_err(|e| e.to_string())?;
        let stem = nome.rsplit_once('.').map(|(s, _)| s).unwrap_or(&nome).to_string();
        registrar(&mut analise, nome.clone(), bruto, &stem, String::new());
    }
    if analise.novas.is_empty() && analise.ja_importadas == 0 {
        return Err("o arquivo não tem notas Markdown para importar".into());
    }
    Ok(analise)
}

// --- Registro (idempotência) e relatório --------------------------------------------------------------------------

fn pasta_importacoes(state: &AppState) -> PathBuf {
    state.config.notes_root.join(".ecos").join("importacoes")
}

fn pasta_pacotes(state: &AppState, usuario_id: &str) -> PathBuf {
    state.config.notes_root.join(".ecos").join("tmp").join("importacao").join(usuario_id)
}

fn arquivo_registro(state: &AppState, usuario_id: &str) -> PathBuf {
    pasta_importacoes(state).join(format!("{usuario_id}.json"))
}

fn ler_registro(caminho: &Path) -> BTreeSet<String> {
    std::fs::read(caminho).ok().and_then(|b| serde_json::from_slice::<Vec<String>>(&b).ok()).unwrap_or_default().into_iter().collect()
}

fn gravar_registro(caminho: &Path, registro: &BTreeSet<String>) -> std::io::Result<()> {
    if let Some(pai) = caminho.parent() {
        std::fs::create_dir_all(pai)?;
    }
    let tmp = caminho.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec(&registro.iter().collect::<Vec<_>>())?)?;
    std::fs::rename(tmp, caminho)
}

fn token_valido(token: &str) -> bool {
    ulid::Ulid::from_string(token).is_ok()
}

fn limpar_vencidos(dir: &Path) {
    let Ok(entradas) = std::fs::read_dir(dir) else { return };
    for e in entradas.flatten() {
        if e.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|i| i > VALIDADE_PACOTE) {
            let _ = std::fs::remove_file(e.path());
        }
    }
}

fn erro_pacote(motivo: String) -> AppError {
    AppError::new(ErrorCode::ValidationError).with_message(format!("O arquivo não pode ser importado: {motivo}."))
}

fn relatorio(a: &Analise, token: &str, tamanho: u64) -> serde_json::Value {
    let por_pasta: BTreeMap<&str, usize> = a.novas.iter().fold(BTreeMap::new(), |mut m, n| {
        *m.entry(n.pasta.as_str()).or_insert(0) += 1;
        m
    });
    serde_json::json!({
        "token": token,
        "formato": a.formato,
        "tamanho_bytes": tamanho,
        "novas": a.novas.len(),
        "ja_importadas": a.ja_importadas,
        "ignorados_total": a.ignorados.len(),
        "por_pasta": por_pasta,
        "itens": a.novas.iter().take(MAX_LISTADOS).map(|n| serde_json::json!({ "origem": n.origem, "titulo": n.titulo, "pasta": n.pasta })).collect::<Vec<_>>(),
        "ignorados": a.ignorados.iter().take(MAX_LISTADOS).map(|(c, m)| serde_json::json!({ "caminho": c, "motivo": m })).collect::<Vec<_>>(),
    })
}

// --- Gravação -----------------------------------------------------------------------------------------------------

/// Grava as notas; qualquer falha desfaz arquivos e pastas criados por esta chamada.
fn gravar_notas(base: &Path, notas: &[ItemNota], falhar_apos: Option<usize>) -> Result<Vec<PathBuf>, String> {
    let raiz = base.join("Notas");
    let mut arquivos: Vec<PathBuf> = Vec::new();
    let mut pastas: Vec<PathBuf> = Vec::new();
    let desfazer = |arquivos: &[PathBuf], pastas: &mut Vec<PathBuf>| {
        for a in arquivos {
            let _ = std::fs::remove_file(a);
        }
        pastas.sort_by_key(|p| std::cmp::Reverse(p.components().count()));
        for p in pastas.iter() {
            let _ = std::fs::remove_dir(p);
        }
    };
    for (n, nota) in notas.iter().enumerate() {
        let r: Result<(), String> = (|| {
            if falhar_apos == Some(n) {
                return Err("falha simulada no meio da importação".into());
            }
            let dir = if nota.pasta.is_empty() { raiz.clone() } else { raiz.join(&nota.pasta) };
            if !dir.starts_with(&raiz) {
                return Err("caminho fora da raiz".into());
            }
            let mut p = Some(dir.as_path());
            let mut faltando = Vec::new();
            while let Some(d) = p {
                if d.exists() {
                    break;
                }
                faltando.push(d.to_path_buf());
                p = d.parent();
            }
            std::fs::create_dir_all(&dir).map_err(|e| format!("não foi possível criar a pasta de {}: {e}", nota.origem))?;
            pastas.extend(faltando);
            let destino = naming::caminho_sem_colisao(&dir, &naming::sanitizar_nome_arquivo(&nota.titulo), "md");
            // `create_new`: nunca sobrescreve um arquivo que apareceu entre a análise e a gravação.
            use std::io::Write;
            let mut f = std::fs::OpenOptions::new().write(true).create_new(true).open(&destino).map_err(|e| format!("não foi possível gravar {}: {e}", nota.origem))?;
            arquivos.push(destino);
            f.write_all(nota.conteudo.as_bytes()).and_then(|_| f.sync_all()).map_err(|e| format!("não foi possível gravar {}: {e}", nota.origem))?;
            Ok(())
        })();
        if let Err(e) = r {
            desfazer(&arquivos, &mut pastas);
            return Err(e);
        }
    }
    Ok(arquivos)
}

// --- Rotas --------------------------------------------------------------------------------------------------------

/// `POST /me/importacao/validar` (multipart, campo `arquivo`).
pub async fn validar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, mut multipart: Multipart) -> AppResult<Json<serde_json::Value>> {
    let dir = pasta_pacotes(&state, &usuario.0);
    std::fs::create_dir_all(&dir)?;
    limpar_vencidos(&dir);
    let mut campo = multipart.next_field().await
        .map_err(|_| AppError::new(ErrorCode::ValidationError).with_message("O envio do arquivo está incompleto ou inválido. Selecione o arquivo novamente."))?
        .ok_or_else(|| AppError::new(ErrorCode::ValidationError).with_message("Nenhum arquivo foi enviado."))?;
    if campo.name() != Some("arquivo") {
        return Err(AppError::new(ErrorCode::ValidationError).with_message("O envio não contém um arquivo válido."));
    }
    let nome_original = campo.file_name().unwrap_or("").to_string();
    let token = new_id();
    let destino = dir.join(format!("{token}.bin"));
    let gravar = async {
        use tokio::io::AsyncWriteExt;
        let mut f = tokio::fs::File::create(&destino).await.map_err(AppError::from)?;
        let mut total = 0usize;
        while let Some(pedaco) = campo.chunk().await.map_err(|_| AppError::new(ErrorCode::ValidationError).with_message("O envio foi interrompido ou excedeu o limite."))? {
            total += pedaco.len();
            if total > TAMANHO_MAXIMO_BYTES {
                return Err(AppError::validation(vec![CampoInvalido { campo: "arquivo".into(), motivo: "maior que o limite de 100 MB".into() }]));
            }
            f.write_all(&pedaco).await.map_err(AppError::from)?;
        }
        f.flush().await.map_err(AppError::from)?;
        Ok::<usize, AppError>(total)
    };
    let tamanho = match gravar.await {
        Ok(t) => t as u64,
        Err(e) => {
            let _ = std::fs::remove_file(&destino);
            return Err(e);
        }
    };
    // O nome original só é usado para título e extensão; guarda ao lado do pacote.
    let _ = std::fs::write(dir.join(format!("{token}.nome")), nome_original.as_bytes());
    let registro = ler_registro(&arquivo_registro(&state, &usuario.0));
    let (caminho, uid) = (destino.clone(), usuario.0.clone());
    let analise = tokio::task::spawn_blocking(move || analisar(&caminho, &nome_original, &registro, &uid, Utc::now()))
        .await
        .map_err(|e| { tracing::error!(error = %e, "análise da importação"); AppError::new(ErrorCode::InternalError) })?;
    match analise {
        Ok(a) => Ok(Json(relatorio(&a, &token, tamanho))),
        Err(motivo) => {
            let _ = std::fs::remove_file(&destino);
            let _ = std::fs::remove_file(dir.join(format!("{token}.nome")));
            Err(erro_pacote(motivo))
        }
    }
}

/// `DELETE /me/importacao/:token`.
pub async fn cancelar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, RotaPath(token): RotaPath<String>) -> AppResult<Json<serde_json::Value>> {
    if !token_valido(&token) {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    let dir = pasta_pacotes(&state, &usuario.0);
    let _ = std::fs::remove_file(dir.join(format!("{token}.bin")));
    let _ = std::fs::remove_file(dir.join(format!("{token}.nome")));
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Debug, Deserialize)]
pub struct AplicarPayload {
    pub confirm: String,
}

/// `POST /me/importacao/:token/aplicar`.
pub async fn aplicar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, RotaPath(token): RotaPath<String>, Json(payload): Json<AplicarPayload>) -> AppResult<Json<serde_json::Value>> {
    if payload.confirm != FRASE_IMPORTAR {
        return Err(AppError::new(ErrorCode::ConfirmationPhraseRequired));
    }
    if !token_valido(&token) {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    let dir = pasta_pacotes(&state, &usuario.0);
    let pacote = dir.join(format!("{token}.bin"));
    if !pacote.is_file() {
        return Err(AppError::new(ErrorCode::NotFound).with_message("O arquivo enviado não está mais disponível (expirou ou foi cancelado). Envie de novo."));
    }
    let nome_original = std::fs::read_to_string(dir.join(format!("{token}.nome"))).unwrap_or_default();
    let _trava = TRAVA.lock().await;

    let arq_registro = arquivo_registro(&state, &usuario.0);
    let mut registro = ler_registro(&arq_registro);
    let (p, r, uid) = (pacote.clone(), registro.clone(), usuario.0.clone());
    let analise = tokio::task::spawn_blocking(move || analisar(&p, &nome_original, &r, &uid, Utc::now()))
        .await
        .map_err(|e| { tracing::error!(error = %e, "análise da importação"); AppError::new(ErrorCode::InternalError) })?
        .map_err(erro_pacote)?;

    let chave = crate::espacos::fisica("pessoal", &usuario.0);
    let nome_usuario: String = {
        let id = usuario.0.clone();
        state.db.with(move |c| c.query_row("SELECT nome_usuario FROM usuario WHERE id = ?1", [&id], |r| r.get(0))).await?
    };
    let base = match crate::espacos::dir_existente(&state.config.notes_root, &chave) {
        Some(d) => d,
        None => crate::espacos::garantir_dir(&state.config.notes_root, &chave, Some(&nome_usuario))?,
    };
    let novas = analise.novas.clone();
    let b = base.clone();
    let gravadas = tokio::task::spawn_blocking(move || gravar_notas(&b, &novas, None))
        .await
        .map_err(|e| { tracing::error!(error = %e, "importação"); AppError::new(ErrorCode::InternalError) })?
        .map_err(|motivo| {
            tracing::error!(%motivo, "importação falhou; o que foi gravado foi desfeito");
            AppError::new(ErrorCode::InternalError).with_message(format!("A importação falhou e foi desfeita; nenhuma nota ficou pela metade ({motivo}). Seus dados atuais não foram alterados."))
        })?;

    registro.extend(analise.novas.iter().map(|n| n.impressao.clone()));
    let mut avisos = Vec::new();
    if let Err(e) = gravar_registro(&arq_registro, &registro) {
        // Sem o registro, importar de novo duplicaria: desfaz para não deixar o estado ambíguo.
        for g in &gravadas {
            let _ = std::fs::remove_file(g);
        }
        tracing::error!(erro = %e, "importação desfeita: registro não gravado");
        return Err(AppError::new(ErrorCode::InternalError).with_message("Não foi possível registrar a importação; nada foi alterado."));
    }
    if let Err(e) = crate::db::reindex::reindexar_tudo(&state.db, &state.config.notes_root).await {
        tracing::error!(error = %e, "reindex após importação falhou");
        avisos.push("O índice de busca será refeito no próximo início do servidor.".to_string());
    }

    // Relatório recuperável.
    let carimbo = Utc::now();
    let nome_relatorio = format!("relatorio-{}.json", carimbo.format("%Y%m%d-%H%M%S"));
    let corpo = serde_json::json!({
        "gerado_em": carimbo.to_rfc3339_opts(SecondsFormat::Secs, true),
        "formato": analise.formato,
        "importadas": analise.novas.iter().map(|n| serde_json::json!({ "origem": n.origem, "titulo": n.titulo, "pasta": n.pasta })).collect::<Vec<_>>(),
        "ja_importadas": analise.ja_importadas,
        "ignorados": analise.ignorados.iter().map(|(c, m)| serde_json::json!({ "caminho": c, "motivo": m })).collect::<Vec<_>>(),
    });
    let dir_rel = pasta_importacoes(&state).join("relatorios").join(&usuario.0);
    if std::fs::create_dir_all(&dir_rel).and_then(|_| std::fs::write(dir_rel.join(&nome_relatorio), serde_json::to_vec_pretty(&corpo).unwrap_or_default())).is_err() {
        avisos.push("Não foi possível salvar o relatório da importação.".to_string());
    }
    let _ = std::fs::remove_file(&pacote);
    let _ = std::fs::remove_file(dir.join(format!("{token}.nome")));

    Ok(Json(serde_json::json!({
        "ok": true,
        "importadas": analise.novas.len(),
        "ja_importadas": analise.ja_importadas,
        "ignorados": analise.ignorados.len(),
        "relatorio": nome_relatorio,
        "avisos": avisos,
    })))
}

#[cfg(test)]
mod testes {
    use super::*;
    use crate::zip::ZipWriter;
    use std::io::Write;

    fn temp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("ecos-imp-{}", new_id()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    /// ZIP com método deflate (como Notion/Obsidian/Windows geram), montado à mão.
    fn zip_deflate(itens: &[(&str, &[u8])]) -> Vec<u8> {
        let mut saida: Vec<u8> = Vec::new();
        let mut central: Vec<u8> = Vec::new();
        for (nome, dados) in itens {
            let mut enc = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::default());
            enc.write_all(dados).unwrap();
            let comp = enc.finish().unwrap();
            let crc = crate::zip::crc32(dados);
            let desloc = saida.len() as u32;
            let nb = nome.as_bytes();
            saida.extend_from_slice(&0x0403_4B50u32.to_le_bytes());
            saida.extend_from_slice(&[20, 0, 0, 8]); // versão, flags (UTF-8)
            saida.extend_from_slice(&8u16.to_le_bytes());
            saida.extend_from_slice(&[0, 0, 0x21, 0]);
            saida.extend_from_slice(&crc.to_le_bytes());
            saida.extend_from_slice(&(comp.len() as u32).to_le_bytes());
            saida.extend_from_slice(&(dados.len() as u32).to_le_bytes());
            saida.extend_from_slice(&(nb.len() as u16).to_le_bytes());
            saida.extend_from_slice(&0u16.to_le_bytes());
            saida.extend_from_slice(nb);
            saida.extend_from_slice(&comp);
            central.extend_from_slice(&0x0201_4B50u32.to_le_bytes());
            central.extend_from_slice(&[20, 0, 20, 0, 0, 8]);
            central.extend_from_slice(&8u16.to_le_bytes());
            central.extend_from_slice(&[0, 0, 0x21, 0]);
            central.extend_from_slice(&crc.to_le_bytes());
            central.extend_from_slice(&(comp.len() as u32).to_le_bytes());
            central.extend_from_slice(&(dados.len() as u32).to_le_bytes());
            central.extend_from_slice(&(nb.len() as u16).to_le_bytes());
            central.extend_from_slice(&[0u8; 12]);
            central.extend_from_slice(&desloc.to_le_bytes());
            central.extend_from_slice(nb);
        }
        let ini = saida.len() as u32;
        saida.extend_from_slice(&central);
        saida.extend_from_slice(&0x0605_4B50u32.to_le_bytes());
        saida.extend_from_slice(&[0, 0, 0, 0]);
        saida.extend_from_slice(&(itens.len() as u16).to_le_bytes());
        saida.extend_from_slice(&(itens.len() as u16).to_le_bytes());
        saida.extend_from_slice(&(central.len() as u32).to_le_bytes());
        saida.extend_from_slice(&ini.to_le_bytes());
        saida.extend_from_slice(&0u16.to_le_bytes());
        saida
    }

    fn agora() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-10-15T12:00:00Z").unwrap().with_timezone(&Utc)
    }

    #[test]
    fn mapeia_obsidian_e_notion_de_zip_deflate() {
        let t = temp();
        let zip = zip_deflate(&[
            ("Vault/Projetos/Ideia.md", b"---\ntags: [a, \"#b\"]\ncreated: 2026-03-04\n---\n# Minha ideia\ncorpo\n"),
            ("Vault/Diario 0123456789abcdef0123456789abcdef.md", b"sem front-matter\n"),
            ("Vault/.obsidian/app.json", b"{}"),
            ("Vault/img/foto.png", &[1, 2, 3]),
            ("Vault/../../fuga.md", b"x"),
        ]);
        let p = t.join("o.zip");
        std::fs::write(&p, zip).unwrap();
        let a = analisar(&p, "o.zip", &BTreeSet::new(), "u1", agora()).unwrap();
        assert_eq!(a.formato, "zip");
        assert_eq!(a.novas.len(), 2);
        let ideia = a.novas.iter().find(|n| n.origem.ends_with("Ideia.md")).unwrap();
        assert_eq!(ideia.pasta, "Projetos");
        assert_eq!(ideia.titulo, "Minha ideia");
        let fm = frontmatter::parse::<NotaFrontMatter>(&ideia.conteudo).unwrap();
        assert_eq!(fm.front_matter.tags, vec!["a".to_string(), "b".to_string()]);
        assert_eq!(fm.front_matter.criado_em.to_rfc3339(), "2026-03-04T00:00:00+00:00");
        assert_eq!(fm.body, "# Minha ideia\ncorpo\n", "corpo intacto");
        let diario = a.novas.iter().find(|n| n.origem.contains("Diario")).unwrap();
        assert_eq!(diario.titulo, "Diario", "sufixo de id do Notion removido");
        assert_eq!(diario.pasta, "");
        assert_eq!(a.ignorados.len(), 3, "{:?}", a.ignorados);
        assert!(a.ignorados.iter().any(|(c, m)| c.contains("fuga") && m.contains("inválido")));
        let _ = std::fs::remove_dir_all(&t);
    }

    #[test]
    fn repetir_a_importacao_nao_cria_nada_e_gravacao_desfaz_em_falha() {
        let t = temp();
        let mut z = ZipWriter::new(Vec::new());
        z.adicionar_bytes("a.md", b"# A\n1").unwrap();
        z.adicionar_bytes("pasta/b.md", b"# B\n2").unwrap();
        let p = t.join("s.zip");
        std::fs::write(&p, z.finalizar().unwrap()).unwrap();
        let a = analisar(&p, "s.zip", &BTreeSet::new(), "u1", agora()).unwrap();
        assert_eq!(a.novas.len(), 2);
        let base = t.join("u1");
        // Falha no meio: nada fica (nem pastas).
        assert!(gravar_notas(&base, &a.novas, Some(1)).is_err());
        assert!(!base.join("Notas/a.md").exists() && !base.join("Notas/pasta").exists());
        let g = gravar_notas(&base, &a.novas, None).unwrap();
        assert_eq!(g.len(), 2);
        // Segunda análise com o registro: tudo já importado.
        let reg: BTreeSet<String> = a.novas.iter().map(|n| n.impressao.clone()).collect();
        let b = analisar(&p, "s.zip", &reg, "u1", agora()).unwrap();
        assert!(b.novas.is_empty());
        assert_eq!(b.ja_importadas, 2);
        let _ = std::fs::remove_dir_all(&t);
    }

    #[test]
    fn markdown_solto_e_rejeicoes() {
        let t = temp();
        let md = t.join("x.md");
        std::fs::write(&md, "texto\n").unwrap();
        let a = analisar(&md, "Minha nota.md", &BTreeSet::new(), "u1", agora()).unwrap();
        assert_eq!(a.formato, "markdown");
        assert_eq!(a.novas[0].titulo, "Minha nota");
        assert!(analisar(&md, "x.exe", &BTreeSet::new(), "u1", agora()).is_err());
        let lixo = t.join("l.zip");
        std::fs::write(&lixo, b"PK\x03\x04 isto nao e um zip de verdade, apenas lixo").unwrap();
        assert!(analisar(&lixo, "l.zip", &BTreeSet::new(), "u1", agora()).is_err());
        // Deflate que descomprime além do declarado é recusado.
        let mut z = zip_deflate(&[("a.md", b"hello world hello world")]);
        // adultera o tamanho descomprimido declarado (cabeçalho central) para menor que o real
        let pos = z.windows(4).rposition(|w| w == 0x0201_4B50u32.to_le_bytes()).unwrap();
        z[pos + 24..pos + 28].copy_from_slice(&5u32.to_le_bytes());
        let bomba = t.join("b.zip");
        std::fs::write(&bomba, z).unwrap();
        let r = analisar(&bomba, "b.zip", &BTreeSet::new(), "u1", agora());
        assert!(r.is_err() || r.unwrap().novas.is_empty());
        let _ = std::fs::remove_dir_all(&t);
    }
}
