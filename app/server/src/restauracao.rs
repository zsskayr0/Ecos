//! Restauração de um pacote de exportação (`GET /me/export`) — nunca destrutiva.
//!
//! Fluxo em três passos, todos sob a sessão da própria pessoa:
//! 1. `POST /me/restauracao/validar` — envia o `.zip`; o servidor confere o formato, a versão e o CRC de cada arquivo,
//!    compara com o que já existe e devolve o relatório (novos, iguais, conflitos, ignorados). Nada é gravado em
//!    `Notas/`/`Tarefas/`: o pacote fica numa área temporária à espera da decisão.
//! 2. `POST /me/restauracao/:token/aplicar` — com a frase `RESTAURAR`: gera antes um backup de segurança da pessoa,
//!    grava só o que não existe (arquivo existente é preservado; conflito vira cópia "(restaurado)" ou é ignorado) e,
//!    se falhar no meio, desfaz tudo o que gravou.
//! 3. `DELETE /me/restauracao/:token` — cancela e descarta o pacote enviado.
//!
//! Escopo: o espaço Pessoal de quem restaura (notas, tarefas, eventos, séries e mídia) e, se a pessoa pedir, as
//! preferências e a rotina. Itens de equipe, foto de perfil e Cofre não são restaurados por aqui.

use axum::extract::{Multipart, Path as RotaPath, State};
use axum::{Extension, Json};
use ecos_core::types::{EventoFrontMatter, NotaFrontMatter, TarefaFrontMatter};
use ecos_core::{frontmatter, new_id, ErrorCode};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::path::{Component, Path, PathBuf};

use crate::conta::{ARQUIVO_CONFIGURACOES, FORMATO_PACOTE, VERSAO_FORMATO_PACOTE};
use crate::error::{AppError, AppResult, CampoInvalido};
use crate::middleware::auth_guard::UsuarioAutenticado;
use crate::state::AppState;
use crate::zip::{crc32_arquivo, LeitorZip};

pub const FRASE_RESTAURAR: &str = "RESTAURAR";
/// Limite do pacote enviado (o formato .zip clássico já não passa de 4 GB).
pub const TAMANHO_MAXIMO_PACOTE_BYTES: usize = 1 << 30;
const LIMITE_LEITURA_MD: u64 = 20 * 1024 * 1024;
const VALIDADE_PACOTE: std::time::Duration = std::time::Duration::from_secs(3600);
const MAX_LISTADOS: usize = 200;

/// Uma restauração por vez: duas aplicações simultâneas poderiam disputar os mesmos nomes de arquivo.
static TRAVA: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
enum Tipo {
    Nota,
    Tarefa,
    Evento,
    Serie,
    Midia,
    Outro,
}

#[derive(Debug, Clone)]
struct Item {
    indice: usize,
    /// Caminho relativo à pasta pessoal (`Notas/ideia.md`).
    rel: String,
    tipo: Tipo,
}

#[derive(Debug, Clone)]
struct Conflito {
    item: Item,
    motivo: String,
    /// Pode ser restaurado como cópia ("(restaurado)") sem sobrepor nada nem duplicar identificador.
    copiavel: bool,
}

#[derive(Debug, Default)]
struct Analise {
    versao_formato: Option<u64>,
    gerado_em: Option<String>,
    origem: Option<String>,
    novos: Vec<Item>,
    iguais: usize,
    conflitos: Vec<Conflito>,
    ignorados: Vec<(String, String)>,
    itens_de_equipe: usize,
    configuracoes: Option<serde_json::Value>,
    totais: BTreeMap<Tipo, usize>,
}

fn nome_seguro(nome: &str) -> bool {
    !nome.is_empty()
        && nome.len() <= 512
        && !nome.contains(['\\', ':', '\0'])
        && !nome.chars().any(char::is_control)
        && Path::new(nome).components().all(|c| matches!(c, Component::Normal(_)))
}

fn tipo_pelo_caminho(rel: &str) -> Option<Tipo> {
    let mut partes = rel.split('/');
    match (partes.next()?, partes.next()) {
        ("Notas", Some(_)) => Some(Tipo::Nota),
        ("Tarefas", Some(_)) => Some(Tipo::Tarefa),
        ("Eventos", Some(_)) => Some(Tipo::Evento),
        ("Series", Some(_)) => Some(Tipo::Serie),
        ("src", Some("Media")) if rel.matches('/').count() >= 2 => Some(Tipo::Midia),
        _ => None,
    }
}

/// Valida o pacote e o compara com o que já existe. Erro = pacote inválido ou incompatível (a restauração inteira
/// é recusada); problemas só de um item viram `ignorados`.
fn analisar(zip: &Path, dir_pessoal: Option<&Path>, ids_existentes: &HashSet<String>) -> Result<Analise, String> {
    let mut leitor = LeitorZip::abrir(zip).map_err(|e| e.to_string())?;
    leitor.verificar_tudo().map_err(|e| e.to_string())?;
    let mut nomes = HashSet::new();
    for e in &leitor.entradas {
        if !nome_seguro(&e.nome) {
            return Err(format!("o pacote contém um caminho inválido (\"{}\")", e.nome.chars().take(80).collect::<String>()));
        }
        if !nomes.insert(e.nome.clone()) {
            return Err(format!("o pacote repete o arquivo \"{}\"", e.nome));
        }
    }
    let i_manifesto = leitor.entradas.iter().position(|e| e.nome == "manifesto.json").ok_or("o arquivo não é um pacote de exportação do Ecos (falta manifesto.json)")?;
    let bruto = leitor.ler(i_manifesto, 4 * 1024 * 1024).map_err(|e| e.to_string())?;
    let manifesto: serde_json::Value = serde_json::from_slice(&bruto).map_err(|_| "manifesto.json ilegível")?;

    let mut analise = Analise::default();
    match manifesto.get("formato").and_then(|v| v.as_str()) {
        Some(f) if f == FORMATO_PACOTE => {
            let versao = manifesto.get("versao_formato").and_then(|v| v.as_u64()).ok_or("o manifesto não informa a versão do formato")?;
            if versao > VERSAO_FORMATO_PACOTE as u64 {
                return Err(format!("este pacote usa o formato {versao}, mais novo que o aceito por este servidor ({VERSAO_FORMATO_PACOTE}). Atualize o Ecos e tente de novo"));
            }
            analise.versao_formato = Some(versao);
        }
        Some(outro) => return Err(format!("formato de pacote desconhecido (\"{}\")", outro.chars().take(40).collect::<String>())),
        // Exportações anteriores à restauração não traziam `formato`: aceitas se o resto do manifesto é o do Ecos.
        None if manifesto.pointer("/usuario/nome_usuario").is_some_and(|v| v.is_string()) => analise.versao_formato = Some(0),
        None => return Err("o arquivo não é um pacote de exportação do Ecos".into()),
    }
    analise.gerado_em = manifesto.get("gerado_em").and_then(|v| v.as_str()).map(str::to_string);
    analise.origem = manifesto.pointer("/usuario/nome_usuario").and_then(|v| v.as_str()).map(str::to_string);
    let pasta = manifesto.get("pasta_pessoal").and_then(|v| v.as_str()).map(str::to_string).or_else(|| analise.origem.clone()).ok_or("o manifesto não identifica a pasta pessoal")?;
    if !nome_seguro(&pasta) || pasta.contains('/') {
        return Err("o manifesto aponta para uma pasta inválida".into());
    }
    let prefixo = format!("{pasta}/");

    if let Some(i) = leitor.entradas.iter().position(|e| e.nome == ARQUIVO_CONFIGURACOES) {
        analise.configuracoes = leitor.ler(i, 4 * 1024 * 1024).ok().and_then(|b| serde_json::from_slice(&b).ok());
    }

    let entradas = leitor.entradas.clone();
    let mut ids_do_pacote: HashSet<String> = HashSet::new();
    for (indice, entrada) in entradas.iter().enumerate() {
        let nome = entrada.nome.as_str();
        if matches!(nome, "manifesto.json" | "LEIA-ME.txt") || nome == ARQUIVO_CONFIGURACOES {
            continue;
        }
        if nome.starts_with("perfil/") {
            analise.ignorados.push((nome.to_string(), "a foto de perfil não é restaurada por aqui".into()));
            continue;
        }
        let Some(rel) = nome.strip_prefix(&prefixo) else {
            // Outra pasta de topo: item de equipe.
            analise.itens_de_equipe += 1;
            continue;
        };
        let Some(tipo_base) = tipo_pelo_caminho(rel) else {
            analise.ignorados.push((nome.to_string(), "tipo de arquivo que a restauração não recria".into()));
            continue;
        };
        let em_anexos = rel.split('/').any(|s| s == "_anexos");
        let eh_md = rel.ends_with(".md") && !em_anexos && matches!(tipo_base, Tipo::Nota | Tipo::Tarefa | Tipo::Evento);
        let mut id = None;
        let tipo = if eh_md { tipo_base } else if tipo_base == Tipo::Midia || tipo_base == Tipo::Serie { tipo_base } else { Tipo::Outro };
        if eh_md {
            let motivo_invalido = match leitor.ler(indice, LIMITE_LEITURA_MD) {
                Err(e) => Some(e.to_string()),
                Ok(bytes) => match String::from_utf8(bytes) {
                    Err(_) => Some("o arquivo não é texto UTF-8".to_string()),
                    Ok(texto) => {
                        let achado = match tipo_base {
                            Tipo::Nota => frontmatter::parse::<NotaFrontMatter>(&texto).map(|d| d.front_matter.id).map_err(|e| e.to_string()),
                            Tipo::Tarefa => frontmatter::parse::<TarefaFrontMatter>(&texto).map(|d| d.front_matter.id).map_err(|e| e.to_string()),
                            _ => frontmatter::parse::<EventoFrontMatter>(&texto).map(|d| d.front_matter.id).map_err(|e| e.to_string()),
                        };
                        match achado {
                            Ok(valor) if !valor.trim().is_empty() => {
                                id = Some(valor);
                                None
                            }
                            Ok(_) => Some("front-matter sem identificador".to_string()),
                            Err(e) => Some(format!("front-matter inválido ({e})")),
                        }
                    }
                },
            };
            if let Some(motivo) = motivo_invalido {
                analise.ignorados.push((nome.to_string(), motivo));
                continue;
            }
        }
        *analise.totais.entry(tipo).or_insert(0) += 1;
        let item = Item { indice, rel: rel.to_string(), tipo };

        if let Some(id) = &id {
            if !ids_do_pacote.insert(id.clone()) {
                analise.ignorados.push((nome.to_string(), "identificador repetido dentro do pacote".into()));
                continue;
            }
        }
        // O que já existe no destino.
        if let Some(base) = dir_pessoal {
            let destino = base.join(rel);
            if destino.is_file() {
                if crc32_arquivo(&destino).map(|(crc, tam)| crc == entrada.crc && tam == entrada.tamanho).unwrap_or(false) {
                    analise.iguais += 1;
                    continue;
                }
            } else if destino.exists() {
                analise.conflitos.push(Conflito { item, motivo: "já existe uma pasta com esse nome".into(), copiavel: false });
                continue;
            }
            // Um ancestral que é arquivo impediria criar a pasta.
            let mut ancestral = destino.parent();
            let mut bloqueado = false;
            while let Some(p) = ancestral {
                if p == base {
                    break;
                }
                if p.is_file() {
                    bloqueado = true;
                    break;
                }
                ancestral = p.parent();
            }
            if bloqueado {
                analise.conflitos.push(Conflito { item, motivo: "um arquivo existente ocupa o lugar de uma pasta do pacote".into(), copiavel: false });
                continue;
            }
            if destino.is_file() {
                let copiavel = matches!(tipo, Tipo::Nota | Tipo::Tarefa | Tipo::Evento | Tipo::Midia) && id.as_ref().is_none_or(|i| !ids_existentes.contains(i));
                let motivo = if id.as_ref().is_some_and(|i| ids_existentes.contains(i)) {
                    "o item já existe aqui com conteúdo diferente (a versão atual foi preservada)"
                } else {
                    "já existe um arquivo com esse nome e conteúdo diferente (o atual foi preservado)"
                };
                analise.conflitos.push(Conflito { item, motivo: motivo.into(), copiavel });
                continue;
            }
        }
        if let Some(id) = &id {
            if ids_existentes.contains(id) {
                analise.conflitos.push(Conflito { item, motivo: "já existe, neste servidor, um item com o mesmo identificador".into(), copiavel: false });
                continue;
            }
        }
        analise.novos.push(item);
    }
    if analise.novos.is_empty() && analise.conflitos.is_empty() && analise.iguais == 0 && analise.configuracoes.is_none() {
        return Err("o pacote não tem dados pessoais para restaurar".into());
    }
    Ok(analise)
}

fn erro_pacote(motivo: String) -> AppError {
    AppError::new(ErrorCode::ValidationError).with_message(format!("O arquivo não pode ser restaurado: {motivo}."))
}

fn pasta_pacotes(state: &AppState, usuario_id: &str) -> PathBuf {
    state.config.notes_root.join(".ecos").join("tmp").join("restauracao").join(usuario_id)
}

fn token_valido(token: &str) -> bool {
    ulid::Ulid::from_string(token).is_ok()
}

/// Apaga pacotes enviados e esquecidos (a pessoa fechou a tela sem cancelar).
fn limpar_vencidos(dir: &Path) {
    let Ok(entradas) = std::fs::read_dir(dir) else { return };
    for e in entradas.flatten() {
        let vencido = e.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|idade| idade > VALIDADE_PACOTE);
        if vencido {
            let _ = std::fs::remove_file(e.path());
        }
    }
}

async fn ids_existentes(state: &AppState) -> AppResult<HashSet<String>> {
    Ok(state
        .db
        .with(|conn| {
            let mut stmt = conn.prepare("SELECT id FROM nota UNION SELECT id FROM tarefa UNION SELECT id FROM evento")?;
            let ids = stmt.query_map([], |r| r.get::<_, String>(0))?.collect::<Result<HashSet<_>, _>>()?;
            Ok(ids)
        })
        .await?)
}

fn relatorio(analise: &Analise, token: &str, tamanho_bytes: u64) -> serde_json::Value {
    let lista_conflitos: Vec<serde_json::Value> = analise.conflitos.iter().take(MAX_LISTADOS)
        .map(|c| serde_json::json!({ "caminho": c.item.rel, "tipo": c.item.tipo, "motivo": c.motivo, "copiavel": c.copiavel })).collect();
    let lista_ignorados: Vec<serde_json::Value> = analise.ignorados.iter().take(MAX_LISTADOS)
        .map(|(c, m)| serde_json::json!({ "caminho": c, "motivo": m })).collect();
    let totais: BTreeMap<String, usize> = analise.totais.iter().map(|(t, n)| (serde_json::to_value(t).ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default(), *n)).collect();
    serde_json::json!({
        "token": token,
        "formato_versao": analise.versao_formato,
        "gerado_em": analise.gerado_em,
        "origem": analise.origem,
        "tamanho_bytes": tamanho_bytes,
        "totais": totais,
        "novos": analise.novos.len(),
        "iguais": analise.iguais,
        "conflitos_total": analise.conflitos.len(),
        "conflitos": lista_conflitos,
        "ignorados_total": analise.ignorados.len(),
        "ignorados": lista_ignorados,
        "itens_de_equipe": analise.itens_de_equipe,
        "tem_configuracoes": analise.configuracoes.is_some(),
    })
}

/// `POST /me/restauracao/validar` (multipart, campo `arquivo`).
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
    let token = new_id();
    let destino = dir.join(format!("{token}.zip"));
    let gravar = async {
        use tokio::io::AsyncWriteExt;
        let mut arquivo = tokio::fs::File::create(&destino).await.map_err(AppError::from)?;
        let mut total = 0usize;
        while let Some(pedaco) = campo.chunk().await.map_err(|_| AppError::new(ErrorCode::ValidationError).with_message("O envio foi interrompido ou excedeu o limite."))? {
            total += pedaco.len();
            if total > TAMANHO_MAXIMO_PACOTE_BYTES {
                return Err(AppError::validation(vec![CampoInvalido { campo: "arquivo".into(), motivo: "maior que o limite de 1 GB".into() }]));
            }
            arquivo.write_all(&pedaco).await.map_err(AppError::from)?;
        }
        arquivo.flush().await.map_err(AppError::from)?;
        Ok::<usize, AppError>(total)
    };
    let tamanho = match gravar.await {
        Ok(t) => t as u64,
        Err(e) => {
            let _ = std::fs::remove_file(&destino);
            return Err(e);
        }
    };

    let chave = crate::espacos::fisica("pessoal", &usuario.0);
    let dir_pessoal = crate::espacos::dir_existente(&state.config.notes_root, &chave);
    let ids = ids_existentes(&state).await?;
    let caminho = destino.clone();
    let analise = tokio::task::spawn_blocking(move || analisar(&caminho, dir_pessoal.as_deref(), &ids))
        .await
        .map_err(|e| { tracing::error!(error = %e, "análise do pacote"); AppError::new(ErrorCode::InternalError) })?;
    match analise {
        Ok(a) => Ok(Json(relatorio(&a, &token, tamanho))),
        Err(motivo) => {
            let _ = std::fs::remove_file(&destino);
            Err(erro_pacote(motivo))
        }
    }
}

/// `DELETE /me/restauracao/:token` — cancela antes de gravar qualquer coisa.
pub async fn cancelar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, RotaPath(token): RotaPath<String>) -> AppResult<Json<serde_json::Value>> {
    if !token_valido(&token) {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    let _ = std::fs::remove_file(pasta_pacotes(&state, &usuario.0).join(format!("{token}.zip")));
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Debug, Deserialize)]
pub struct AplicarPayload {
    pub confirm: String,
    /// `ignorar` (padrão) ou `copiar` — conflitos nunca sobrescrevem o que existe.
    #[serde(default)]
    pub conflitos: Option<String>,
    /// Substitui as preferências de calendário e a rotina atuais pelas do pacote.
    #[serde(default)]
    pub restaurar_configuracoes: bool,
}

/// `stem (restaurado).ext`, `stem (restaurado 2).ext`... sem colidir com o disco nem com o que já foi planejado.
fn nome_de_copia(base: &Path, rel: &str, ocupados: &HashSet<String>) -> String {
    let (dir, arquivo) = rel.rsplit_once('/').map(|(d, a)| (format!("{d}/"), a)).unwrap_or((String::new(), rel));
    let (stem, ext) = arquivo.rsplit_once('.').filter(|(s, _)| !s.is_empty()).map(|(s, e)| (s, format!(".{e}"))).unwrap_or((arquivo, String::new()));
    for n in 1.. {
        let sufixo = if n == 1 { " (restaurado)".to_string() } else { format!(" (restaurado {n})") };
        let candidato = format!("{dir}{stem}{sufixo}{ext}");
        if !ocupados.contains(&candidato) && !base.join(&candidato).exists() {
            return candidato;
        }
    }
    unreachable!()
}

/// Grava os itens; qualquer falha desfaz o que esta chamada criou (arquivos e pastas). `falhar_apos` só existe para
/// testar o desfazer no meio do processo.
fn aplicar_itens(zip: &Path, base: &Path, itens: &[(Item, String)], falhar_apos: Option<usize>) -> Result<(), String> {
    let mut leitor = LeitorZip::abrir(zip).map_err(|e| e.to_string())?;
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
    for (n, (item, rel)) in itens.iter().enumerate() {
        let resultado: Result<(), String> = (|| {
            if falhar_apos == Some(n) {
                return Err("falha simulada no meio da restauração".into());
            }
            let destino = base.join(rel);
            if destino.exists() {
                return Err(format!("{rel} passou a existir durante a restauração"));
            }
            let pai = destino.parent().ok_or("caminho inválido")?;
            let mut faltando = Vec::new();
            let mut p = Some(pai);
            while let Some(d) = p {
                if d.exists() {
                    break;
                }
                faltando.push(d.to_path_buf());
                p = d.parent();
            }
            std::fs::create_dir_all(pai).map_err(|e| format!("não foi possível criar a pasta de {rel}: {e}"))?;
            pastas.extend(faltando);
            let temporario = destino.with_file_name(format!(".{}.ecos-restaurando", destino.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()));
            leitor.copiar_para(item.indice, &temporario).map_err(|e| e.to_string())?;
            std::fs::rename(&temporario, &destino).map_err(|e| {
                let _ = std::fs::remove_file(&temporario);
                format!("não foi possível gravar {rel}: {e}")
            })?;
            arquivos.push(destino);
            Ok(())
        })();
        if let Err(e) = resultado {
            desfazer(&arquivos, &mut pastas);
            return Err(e);
        }
    }
    Ok(())
}

const TIPOS_BLOCO: [&str; 6] = ["sono", "trabalho_fixo", "refeicao", "deslocamento", "bloqueio_pessoal", "outro"];
const CLASSIFICACOES: [&str; 3] = ["indisponivel", "disponivel_producao", "tempo_livre"];

fn hora_valida(v: &str) -> bool {
    v.split_once(':').is_some_and(|(h, m)| h.len() == 2 && m.len() == 2 && h.parse::<u8>().is_ok_and(|h| h < 24) && m.parse::<u8>().is_ok_and(|m| m < 60))
}

/// Aplica `configuracoes.json` do pacote (preferências de calendário e rotina). Devolve quantos itens foram aplicados
/// e avisos sobre os que foram descartados por valor inválido.
async fn restaurar_configuracoes(state: &AppState, usuario_id: &str, cfg: &serde_json::Value) -> AppResult<(usize, Vec<String>)> {
    let mut avisos = Vec::new();
    let prefs = cfg.get("preferencias_calendario").filter(|v| v.is_object()).and_then(|p| {
        let pais = p.get("pais")?.as_str()?.trim().to_string();
        let fuso = p.get("fuso")?.as_str()?.to_string();
        let inicio = p.get("inicio_dia")?.as_str()?.to_string();
        let prazos = p.get("mostrar_prazos").and_then(|v| v.as_bool()).unwrap_or(true);
        let ok = !pais.is_empty() && pais.chars().count() <= 80 && fuso.parse::<chrono_tz::Tz>().is_ok() && hora_valida(&inicio);
        ok.then_some((pais, fuso, inicio, prazos))
    });
    if cfg.get("preferencias_calendario").is_some_and(|v| v.is_object()) && prefs.is_none() {
        avisos.push("As preferências de calendário do pacote têm valores inválidos e foram ignoradas.".to_string());
    }
    let mut blocos: Vec<(String, String, String, String, String)> = Vec::new();
    let mut descartados = 0;
    if let Some(lista) = cfg.get("rotina").and_then(|v| v.as_array()) {
        for b in lista {
            let campo = |k: &str| b.get(k).and_then(|v| v.as_str()).map(str::to_string);
            match (campo("tipo"), campo("hora_inicio"), campo("hora_fim"), campo("dias_semana"), campo("classificacao")) {
                (Some(t), Some(i), Some(f), Some(d), Some(c))
                    if TIPOS_BLOCO.contains(&t.as_str()) && CLASSIFICACOES.contains(&c.as_str()) && hora_valida(&i) && hora_valida(&f) && !d.is_empty() && d.len() <= 40 =>
                {
                    blocos.push((t, i, f, d, c));
                }
                _ => descartados += 1,
            }
        }
    }
    if descartados > 0 {
        avisos.push(format!("{descartados} bloco(s) de rotina do pacote eram inválidos e foram ignorados."));
    }
    let tem_rotina = cfg.get("rotina").is_some_and(|v| v.is_array());
    let aplicados = usize::from(prefs.is_some()) + if tem_rotina { blocos.len() } else { 0 };
    let uid = usuario_id.to_string();
    state
        .db
        .with(move |conn| {
            let tx = conn.unchecked_transaction()?;
            if let Some((pais, fuso, inicio, prazos)) = prefs {
                tx.execute(
                    "INSERT INTO preferencia_calendario (usuario_id, pais, fuso, inicio_dia, mostrar_prazos, atualizado_em) VALUES (?1, ?2, ?3, ?4, ?5, ?6) \
                     ON CONFLICT(usuario_id) DO UPDATE SET pais = excluded.pais, fuso = excluded.fuso, inicio_dia = excluded.inicio_dia, mostrar_prazos = excluded.mostrar_prazos, atualizado_em = excluded.atualizado_em",
                    rusqlite::params![uid, pais, fuso, inicio, prazos, chrono::Utc::now().to_rfc3339()],
                )?;
            }
            if tem_rotina {
                tx.execute("INSERT OR IGNORE INTO perfil_rotina (usuario_id) VALUES (?1)", [&uid])?;
                tx.execute("DELETE FROM bloco_rotina WHERE usuario_id = ?1", [&uid])?;
                for (t, i, f, d, c) in blocos {
                    tx.execute(
                        "INSERT INTO bloco_rotina (id, usuario_id, tipo, hora_inicio, hora_fim, dias_semana, classificacao) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                        rusqlite::params![new_id(), uid, t, i, f, d, c],
                    )?;
                }
            }
            tx.commit()
        })
        .await?;
    Ok((aplicados, avisos))
}

/// `POST /me/restauracao/:token/aplicar`
pub async fn aplicar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, RotaPath(token): RotaPath<String>, Json(payload): Json<AplicarPayload>) -> AppResult<Json<serde_json::Value>> {
    if payload.confirm != FRASE_RESTAURAR {
        return Err(AppError::new(ErrorCode::ConfirmationPhraseRequired));
    }
    let copiar = match payload.conflitos.as_deref() {
        None | Some("ignorar") => false,
        Some("copiar") => true,
        Some(_) => return Err(AppError::validation(vec![CampoInvalido { campo: "conflitos".into(), motivo: "deve ser ignorar ou copiar".into() }])),
    };
    if !token_valido(&token) {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    let pacote = pasta_pacotes(&state, &usuario.0).join(format!("{token}.zip"));
    if !pacote.is_file() {
        return Err(AppError::new(ErrorCode::NotFound).with_message("O pacote enviado não está mais disponível (expirou ou foi cancelado). Envie o arquivo de novo."));
    }
    let _trava = TRAVA.lock().await;

    // Reanalisa agora: entre o relatório e a confirmação o servidor pode ter mudado.
    let chave = crate::espacos::fisica("pessoal", &usuario.0);
    let dir_pessoal = crate::espacos::dir_existente(&state.config.notes_root, &chave);
    let ids = ids_existentes(&state).await?;
    let (p, d) = (pacote.clone(), dir_pessoal.clone());
    let analise = tokio::task::spawn_blocking(move || analisar(&p, d.as_deref(), &ids))
        .await
        .map_err(|e| { tracing::error!(error = %e, "análise do pacote"); AppError::new(ErrorCode::InternalError) })?
        .map_err(erro_pacote)?;

    // Backup de segurança ANTES de gravar: se não der para gerá-lo, nada é restaurado.
    let carimbo = chrono::Utc::now().format("%Y%m%d-%H%M%S");
    let pasta_backup = state.config.notes_root.join(".ecos").join("backups").join("restauracao").join(&usuario.0);
    std::fs::create_dir_all(&pasta_backup)?;
    let nome_backup = format!("pre-restauracao-{carimbo}.zip");
    let arquivo_backup = pasta_backup.join(&nome_backup);
    if let Err(e) = crate::conta::gerar_pacote(&state, &usuario.0, &arquivo_backup).await {
        let _ = std::fs::remove_file(&arquivo_backup);
        tracing::error!(erro = ?e, "restauração recusada: backup de segurança falhou");
        return Err(AppError::new(ErrorCode::InternalError).with_message("Não foi possível gerar o backup de segurança antes de restaurar. Nada foi alterado."));
    }

    // Plano: novos, mais as cópias dos conflitos (se pedido).
    let nome_usuario: String = {
        let id = usuario.0.clone();
        state.db.with(move |c| c.query_row("SELECT nome_usuario FROM usuario WHERE id = ?1", [&id], |r| r.get(0))).await?
    };
    let base = match dir_pessoal {
        Some(d) => d,
        None => crate::espacos::garantir_dir(&state.config.notes_root, &chave, Some(&nome_usuario))?,
    };
    let mut ocupados: HashSet<String> = analise.novos.iter().map(|i| i.rel.clone()).collect();
    let mut plano: Vec<(Item, String)> = analise.novos.iter().map(|i| (i.clone(), i.rel.clone())).collect();
    let mut copias = 0usize;
    let mut ignorados_conflito = 0usize;
    for c in &analise.conflitos {
        if copiar && c.copiavel {
            let novo = nome_de_copia(&base, &c.item.rel, &ocupados);
            ocupados.insert(novo.clone());
            plano.push((c.item.clone(), novo));
            copias += 1;
        } else {
            ignorados_conflito += 1;
        }
    }
    let restaurados = plano.len();
    let (p, b) = (pacote.clone(), base.clone());
    tokio::task::spawn_blocking(move || aplicar_itens(&p, &b, &plano, None))
        .await
        .map_err(|e| { tracing::error!(error = %e, "restauração"); AppError::new(ErrorCode::InternalError) })?
        .map_err(|motivo| {
            tracing::error!(%motivo, "restauração falhou; o que foi gravado foi desfeito");
            AppError::new(ErrorCode::InternalError).with_message(format!("A restauração falhou e foi desfeita; nenhum arquivo ficou pela metade ({motivo}). Seus dados atuais não foram alterados."))
        })?;

    let mut avisos = Vec::new();
    let mut configuracoes_aplicadas = 0;
    if payload.restaurar_configuracoes {
        match &analise.configuracoes {
            Some(cfg) => match restaurar_configuracoes(&state, &usuario.0, cfg).await {
                Ok((n, a)) => {
                    configuracoes_aplicadas = n;
                    avisos.extend(a);
                }
                Err(_) => avisos.push("Os arquivos foram restaurados, mas não foi possível aplicar as configurações. Elas continuam como estavam.".into()),
            },
            None => avisos.push("O pacote não tem configurações para restaurar.".into()),
        }
    }
    if let Err(e) = crate::db::reindex::reindexar_tudo(&state.db, &state.config.notes_root).await {
        tracing::error!(error = %e, "reindex após restauração falhou");
        avisos.push("O índice de busca será refeito no próximo início do servidor.".into());
    }
    let _ = std::fs::remove_file(&pacote);

    Ok(Json(serde_json::json!({
        "ok": true,
        "restaurados": restaurados - copias,
        "copias": copias,
        "iguais": analise.iguais,
        "conflitos_ignorados": ignorados_conflito,
        "configuracoes_aplicadas": configuracoes_aplicadas,
        "backup": nome_backup,
        "avisos": avisos,
    })))
}

#[cfg(test)]
mod testes {
    use super::*;
    use crate::zip::ZipWriter;

    fn pacote(dir: &Path, manifesto: serde_json::Value, itens: &[(&str, &[u8])]) -> PathBuf {
        let caminho = dir.join(format!("{}.zip", new_id()));
        let mut z = ZipWriter::new(std::fs::File::create(&caminho).unwrap());
        z.adicionar_bytes("manifesto.json", manifesto.to_string().as_bytes()).unwrap();
        for (nome, dados) in itens {
            z.adicionar_bytes(nome, dados).unwrap();
        }
        z.finalizar().unwrap();
        caminho
    }

    fn manifesto() -> serde_json::Value {
        serde_json::json!({ "formato": FORMATO_PACOTE, "versao_formato": VERSAO_FORMATO_PACOTE, "pasta_pessoal": "ana", "usuario": { "nome_usuario": "ana" } })
    }

    fn nota(id: &str) -> Vec<u8> {
        format!("---\nid: {id}\ntitulo: {id}\nmodo: texto\nespaco: pessoal\ntags: []\ncriado_em: 2026-01-01T00:00:00Z\natualizado_em: 2026-01-01T00:00:00Z\n---\ncorpo {id}\n").into_bytes()
    }

    fn tarefa(id: &str) -> Vec<u8> {
        format!("---\nid: {id}\ntitulo: {id}\nstatus: pendente\nespaco: pessoal\ncriado_em: 2026-01-01T00:00:00Z\n---\n").into_bytes()
    }

    fn temp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("ecos-rest-{}", new_id()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn rejeita_pacote_invalido_ou_incompativel() {
        let t = temp();
        let vazio = HashSet::new();
        // Não é zip.
        let lixo = t.join("x.zip");
        std::fs::write(&lixo, b"isto nao e um pacote de exportacao do ecos, de jeito nenhum").unwrap();
        assert!(analisar(&lixo, None, &vazio).is_err());
        // Zip qualquer, sem manifesto.
        let sem = t.join("sem.zip");
        let mut z = ZipWriter::new(std::fs::File::create(&sem).unwrap());
        z.adicionar_bytes("ana/Notas/a.md", &nota("A")).unwrap();
        z.finalizar().unwrap();
        assert!(analisar(&sem, None, &vazio).unwrap_err().contains("manifesto"));
        // Formato mais novo.
        let mut m = manifesto();
        m["versao_formato"] = serde_json::json!(VERSAO_FORMATO_PACOTE + 1);
        let novo = pacote(&t, m, &[("ana/Notas/a.md", &nota("A"))]);
        assert!(analisar(&novo, None, &vazio).unwrap_err().contains("mais novo"));
        // Formato de outro produto.
        let mut m = manifesto();
        m["formato"] = serde_json::json!("outro-app");
        let outro = pacote(&t, m, &[("ana/Notas/a.md", &nota("A"))]);
        assert!(analisar(&outro, None, &vazio).is_err());
        // Caminho que escapa da pasta.
        let fuga = pacote(&t, manifesto(), &[("ana/../../etc/passwd", b"x")]);
        assert!(analisar(&fuga, None, &vazio).unwrap_err().contains("caminho inválido"));
        let _ = std::fs::remove_dir_all(&t);
    }

    #[test]
    fn classifica_novos_iguais_conflitos_e_ignorados_sem_tocar_no_destino() {
        let t = temp();
        let base = t.join("ana");
        std::fs::create_dir_all(base.join("Notas")).unwrap();
        // Igual ao do pacote; diferente com o mesmo nome; id que já existe em outro caminho.
        std::fs::write(base.join("Notas/igual.md"), nota("IGUAL")).unwrap();
        std::fs::write(base.join("Notas/difere.md"), b"conteudo atual").unwrap();
        let p = pacote(&t, manifesto(), &[
            ("ana/Notas/igual.md", &nota("IGUAL")),
            ("ana/Notas/difere.md", &nota("DIFERE")),
            ("ana/Notas/nova.md", &nota("NOVA")),
            ("ana/Notas/id-existente.md", &nota("JA-EXISTE")),
            ("ana/Notas/quebrada.md", b"sem front-matter"),
            ("ana/src/Media/2026-09/foto-01.png", &[1u8, 2, 3]),
            ("Equipe X/Notas/da-equipe.md", &nota("EQ")),
            ("perfil/avatar.png", &[0x89, b'P']),
        ]);
        let ids: HashSet<String> = ["JA-EXISTE".to_string()].into();
        let a = analisar(&p, Some(&base), &ids).unwrap();
        let novos: Vec<&str> = a.novos.iter().map(|i| i.rel.as_str()).collect();
        assert_eq!(novos, vec!["Notas/nova.md", "src/Media/2026-09/foto-01.png"]);
        assert_eq!(a.iguais, 1);
        assert_eq!(a.conflitos.len(), 2);
        let difere = a.conflitos.iter().find(|c| c.item.rel == "Notas/difere.md").unwrap();
        assert!(difere.copiavel);
        let id = a.conflitos.iter().find(|c| c.item.rel == "Notas/id-existente.md").unwrap();
        assert!(!id.copiavel);
        assert_eq!(a.itens_de_equipe, 1);
        assert!(a.ignorados.iter().any(|(n, _)| n == "ana/Notas/quebrada.md"));
        assert_eq!(std::fs::read(base.join("Notas/difere.md")).unwrap(), b"conteudo atual", "analisar não escreve nada");
        let _ = std::fs::remove_dir_all(&t);
    }

    #[test]
    fn falha_no_meio_desfaz_arquivos_e_pastas_criados() {
        let t = temp();
        let base = t.join("ana");
        std::fs::create_dir_all(&base).unwrap();
        std::fs::write(base.join("existente.txt"), b"nao toque").unwrap();
        let p = pacote(&t, manifesto(), &[("ana/Notas/a.md", &nota("A")), ("ana/Tarefas/b.md", &tarefa("B")), ("ana/src/Media/2026-09/c.png", b"png")]);
        let a = analisar(&p, Some(&base), &HashSet::new()).unwrap();
        let plano: Vec<(Item, String)> = a.novos.iter().map(|i| (i.clone(), i.rel.clone())).collect();
        assert_eq!(plano.len(), 3);
        // Falha ao chegar no terceiro: os dois primeiros e as pastas criadas somem.
        let erro = aplicar_itens(&p, &base, &plano, Some(2)).unwrap_err();
        assert!(erro.contains("simulada"));
        assert!(!base.join("Notas").exists() && !base.join("Tarefas").exists() && !base.join("src").exists(), "pastas criadas foram desfeitas");
        assert_eq!(std::fs::read(base.join("existente.txt")).unwrap(), b"nao toque");
        // Sem falha: grava tudo; rodar de novo não sobrescreve (o arquivo passou a existir).
        aplicar_itens(&p, &base, &plano, None).unwrap();
        assert_eq!(std::fs::read(base.join("Notas/a.md")).unwrap(), nota("A"));
        assert!(aplicar_itens(&p, &base, &plano, None).is_err());
        assert_eq!(std::fs::read(base.join("Notas/a.md")).unwrap(), nota("A"));
        let _ = std::fs::remove_dir_all(&t);
    }

    #[test]
    fn nome_de_copia_nao_colide() {
        let t = temp();
        std::fs::create_dir_all(t.join("Notas")).unwrap();
        std::fs::write(t.join("Notas/a (restaurado).md"), b"x").unwrap();
        let ocupados = HashSet::new();
        assert_eq!(nome_de_copia(&t, "Notas/a.md", &ocupados), "Notas/a (restaurado 2).md");
        assert_eq!(nome_de_copia(&t, "Notas/b.md", &ocupados), "Notas/b (restaurado).md");
        let _ = std::fs::remove_dir_all(&t);
    }
}
