//! Layout em disco por espaço: `<notes_root>/<nome de usuário|Nome da Equipe>/{Notas,Tarefas}`.
//!
//! Cada diretório de espaço carrega um marcador `.espaco` com a **chave física**
//! (`pessoal:<usuario_id>` ou `equipe:<id>`), então renomear a pessoa ou a equipe
//! não desassocia os arquivos: o nome da pasta é só cosmético, quem manda é o marcador.
//!
//! O espaço *lógico* (front-matter, banco, API, cliente) continua sendo `pessoal` ou
//! `equipe:<id>`: "pessoal" significa "só de quem criou". A chave física só existe aqui,
//! para decidir em qual pasta o arquivo mora (`fisica`) e de quem é (`dono`).

use crate::{error::AppResult, state::AppState};
use ecos_core::naming;
use rusqlite::OptionalExtension;
use std::path::{Path, PathBuf};

/// Pasta do layout anterior (um único espaço pessoal, sem dono); só existe até `migrar_pessoal_por_usuario`.
pub const PESSOAL_DIR: &str = "Pessoal";
pub const MARCADOR: &str = ".espaco";
const PREFIXO_PESSOAL: &str = "pessoal:";

/// Chave física de um espaço lógico para um usuário: `pessoal` vira `pessoal:<usuario_id>`.
pub fn fisica(espaco: &str, usuario_id: &str) -> String {
    if espaco == "pessoal" { format!("{PREFIXO_PESSOAL}{usuario_id}") } else { espaco.to_string() }
}

/// Espaço lógico de uma chave física (`pessoal:<id>` -> `pessoal`).
pub fn logica(chave: &str) -> &str {
    if chave.starts_with(PREFIXO_PESSOAL) { "pessoal" } else { chave }
}

/// Dono de uma chave física pessoal.
pub fn dono(chave: &str) -> Option<&str> {
    chave.strip_prefix(PREFIXO_PESSOAL)
}

fn literal(valor: &str) -> String {
    format!("'{}'", valor.replace('\'', "''"))
}

/// Condição SQL de visibilidade para tabelas com `espaco` + `criado_por` (nota, tarefa, evento):
/// itens pessoais só do criador; itens de equipe só para membros. `alias` pode ser vazio.
pub fn visivel_sql(alias: &str, usuario_id: &str) -> String {
    let p = if alias.is_empty() { String::new() } else { format!("{alias}.") };
    let uid = literal(usuario_id);
    format!(
        "(({p}espaco = 'pessoal' AND {p}criado_por = {uid}) OR ({p}espaco LIKE 'equipe:%' AND substr({p}espaco, 8) IN (SELECT equipe_id FROM membro_equipe WHERE usuario_id = {uid})))"
    )
}

/// Igual à anterior, para tabelas cuja coluna `espaco` guarda a chave física (pasta_cache, documento_cache, categoria_evento).
pub fn visivel_chave_sql(alias: &str, usuario_id: &str) -> String {
    let p = if alias.is_empty() { String::new() } else { format!("{alias}.") };
    let uid = literal(usuario_id);
    let chave = literal(&format!("{PREFIXO_PESSOAL}{usuario_id}"));
    format!("({p}espaco = {chave} OR ({p}espaco LIKE 'equipe:%' AND substr({p}espaco, 8) IN (SELECT equipe_id FROM membro_equipe WHERE usuario_id = {uid})))")
}

/// Recusa (403) escrever em espaço de equipe de que o usuário não é membro. `pessoal` é sempre do próprio usuário.
pub async fn exigir_acesso(state: &AppState, usuario_id: &str, espaco: &str) -> AppResult<()> {
    let Some(equipe_id) = espaco.strip_prefix("equipe:") else { return Ok(()) };
    let (uid, eid) = (usuario_id.to_string(), equipe_id.to_string());
    let membro = state
        .db
        .with(move |conn| conn.query_row("SELECT EXISTS(SELECT 1 FROM membro_equipe WHERE equipe_id = ?1 AND usuario_id = ?2)", [&eid, &uid], |r| r.get::<_, bool>(0)))
        .await?;
    if membro { Ok(()) } else { Err(crate::error::AppError::new(ecos_core::ErrorCode::Forbidden)) }
}

/// Chaves físicas que o usuário pode ler: a pessoal dele e as equipes de que é membro.
pub async fn chaves_acessiveis(state: &AppState, usuario_id: &str) -> AppResult<Vec<String>> {
    let uid = usuario_id.to_string();
    let equipes: Vec<String> = state
        .db
        .with(move |conn| {
            let mut stmt = conn.prepare("SELECT equipe_id FROM membro_equipe WHERE usuario_id = ?1")?;
            let linhas = stmt.query_map([&uid], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await?;
    let mut chaves = vec![format!("{PREFIXO_PESSOAL}{usuario_id}")];
    chaves.extend(equipes.into_iter().map(|id| format!("equipe:{id}")));
    Ok(chaves)
}

/// Pastas do sistema que nunca são espaços.
const RESERVADOS: [&str; 3] = ["src", "Notas", "Tarefas"];

fn ler_marcador(dir: &Path) -> Option<String> {
    let valor = std::fs::read_to_string(dir.join(MARCADOR)).ok()?;
    let valor = valor.trim();
    (!valor.is_empty()).then(|| valor.to_string())
}

/// Todos os espaços já materializados em disco, pela chave física do marcador. O `Pessoal/` do
/// layout anterior (marcador `pessoal`) aparece até a migração para a pasta do dono.
pub fn listar(notes_root: &Path) -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    let Ok(entradas) = std::fs::read_dir(notes_root) else { return out };
    for entrada in entradas.flatten() {
        let caminho = entrada.path();
        if !caminho.is_dir() {
            continue;
        }
        let nome = entrada.file_name().to_string_lossy().to_string();
        if nome.starts_with('.') || RESERVADOS.contains(&nome.as_str()) {
            continue;
        }
        if let Some(espaco) = ler_marcador(&caminho) {
            if espaco == "pessoal" || espaco.starts_with(PREFIXO_PESSOAL) || espaco.starts_with("equipe:") {
                out.push((espaco, caminho));
            }
        }
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

pub fn dir_existente(notes_root: &Path, espaco: &str) -> Option<PathBuf> {
    listar(notes_root).into_iter().find(|(e, _)| e == espaco).map(|(_, d)| d)
}

/// Diretório do espaço, criando (com marcador) se ainda não existir. `nome` só
/// serve pra batizar a pasta de uma equipe nova.
pub fn garantir_dir(notes_root: &Path, espaco: &str, nome: Option<&str>) -> std::io::Result<PathBuf> {
    if let Some(dir) = dir_existente(notes_root, espaco) {
        std::fs::create_dir_all(&dir)?;
        if !dir.join(MARCADOR).exists() {
            std::fs::write(dir.join(MARCADOR), espaco)?;
        }
        return Ok(dir);
    }
    let base = if espaco == "pessoal" {
        PESSOAL_DIR.to_string()
    } else {
        let bruto = nome.map(str::to_string).unwrap_or_else(|| espaco.split_once(':').map(|(_, id)| id).unwrap_or(espaco).to_string());
        let limpo = naming::sanitizar_nome_arquivo(&bruto);
        if RESERVADOS.contains(&limpo.as_str()) || limpo == PESSOAL_DIR { format!("{limpo} (espaço)") } else { limpo }
    };
    let mut dir = notes_root.join(&base);
    let mut contador = 2u32;
    while dir.exists() {
        dir = notes_root.join(format!("{base} ({contador})"));
        contador += 1;
    }
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join(MARCADOR), espaco)?;
    Ok(dir)
}

/// Raiz da árvore (`Notas` ou `Tarefas`) de um espaço.
pub async fn raiz(state: &AppState, espaco: &str, arvore: &str) -> AppResult<PathBuf> {
    let notes_root = state.config.notes_root.clone();
    // Só consulta o banco para batizar uma pasta nova (equipe: nome da equipe; pessoal: nome de usuário do dono).
    let nome = if dir_existente(&notes_root, espaco).is_some() {
        None
    } else if let Some(id) = espaco.strip_prefix("equipe:") {
        let id = id.to_string();
        state.db.with(move |conn| conn.query_row("SELECT nome FROM equipe WHERE id = ?1", [&id], |r| r.get::<_, String>(0)).optional()).await?
    } else if let Some(id) = dono(espaco) {
        let id = id.to_string();
        state.db.with(move |conn| conn.query_row("SELECT nome_usuario FROM usuario WHERE id = ?1", [&id], |r| r.get::<_, String>(0)).optional()).await?
    } else {
        None
    };
    let dir = garantir_dir(&notes_root, espaco, nome.as_deref())?;
    let arvore = dir.join(arvore);
    std::fs::create_dir_all(&arvore)?;
    Ok(arvore)
}

/// Espaço a que um caminho relativo à `notes_root` pertence (pelo diretório de topo).
pub fn espaco_do_caminho(notes_root: &Path, relativo: &str) -> Option<String> {
    let topo = relativo.split('/').next()?;
    listar(notes_root).into_iter().find(|(_, d)| d.file_name().is_some_and(|n| n == topo)).map(|(e, _)| e)
}

/// Subpasta de mídia de cada espaço: `<Espaço>/src/Media/AAAA-MM/`.
pub const MIDIA_DIR: &str = "src/Media";
/// Prefixo das referências à mídia nos Markdown. É o mesmo em qualquer espaço: o espaço é resolvido no servidor.
pub const PREFIXO_MIDIA: &str = "src/Media/";

/// Onde está um arquivo de mídia, dado o caminho dentro da biblioteca (`2026-09/x-<ULID>.png`).
/// Os nomes levam um ULID, então basta procurar nos espaços: quem pede não precisa saber de qual é.
/// Só procura nos espaços em `permitidos` (ver `chaves_acessiveis`): mídia de outra pessoa não existe para quem pede.
pub fn achar_midia(notes_root: &Path, relativo: &str, permitidos: &[String]) -> Option<(String, PathBuf)> {
    use std::path::Component;
    let rel = Path::new(relativo);
    if relativo.is_empty() || rel.components().any(|c| !matches!(c, Component::Normal(_))) {
        return None;
    }
    listar(notes_root).into_iter().filter(|(espaco, _)| permitidos.contains(espaco)).find_map(|(espaco, dir)| {
        let arquivo = dir.join(MIDIA_DIR).join(rel);
        arquivo.is_file().then_some((espaco, arquivo))
    })
}

fn decodificar_percentual(texto: &str) -> String {
    let bytes = texto.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Some(hex) = std::str::from_utf8(&bytes[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(hex);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Caminhos (dentro da biblioteca, sem o prefixo `src/Media/`) que o corpo referencia — cru e decodificado.
pub fn midias_referenciadas(corpo: &str) -> Vec<String> {
    let mut achados: Vec<String> = Vec::new();
    let mut resto = corpo;
    while let Some(i) = resto.find(PREFIXO_MIDIA) {
        let depois = &resto[i + PREFIXO_MIDIA.len()..];
        let fim = depois.find(|c: char| matches!(c, ')' | ']' | '"' | '\'' | '<' | '>' | '\n' | '\r')).unwrap_or(depois.len());
        let bruto = depois[..fim].trim();
        if !bruto.is_empty() {
            for candidato in [bruto.to_string(), decodificar_percentual(bruto)] {
                if !achados.contains(&candidato) {
                    achados.push(candidato);
                }
            }
        }
        resto = &depois[fim..];
    }
    achados
}

fn algum_md_referencia(dir_espaco: &Path, relativo: &str) -> bool {
    let alvo = format!("{PREFIXO_MIDIA}{relativo}");
    ["Notas", "Tarefas"].iter().any(|arvore| {
        walkdir::WalkDir::new(dir_espaco.join(arvore))
            .into_iter()
            .filter_map(Result::ok)
            .filter(|e| e.file_type().is_file() && e.path().extension().is_some_and(|x| x == "md"))
            .any(|e| std::fs::read_to_string(e.path()).is_ok_and(|c| c.contains(&alvo)))
    })
}

/// O item trocou de espaço: leva a mídia que o corpo referencia para a biblioteca do novo espaço.
/// Se outro Markdown do espaço antigo ainda usa o arquivo, ele é copiado (o original fica); senão, movido.
pub fn levar_midia(notes_root: &Path, corpo: &str, de: &str, para: &str) -> std::io::Result<()> {
    if de == para {
        return Ok(());
    }
    let Some(dir_de) = dir_existente(notes_root, de) else { return Ok(()) };
    let dir_para = garantir_dir(notes_root, para, None)?;
    for relativo in midias_referenciadas(corpo) {
        let origem = dir_de.join(MIDIA_DIR).join(&relativo);
        let seguro = Path::new(&relativo).components().all(|c| matches!(c, std::path::Component::Normal(_)));
        if !seguro || !origem.is_file() {
            continue;
        }
        let destino = dir_para.join(MIDIA_DIR).join(&relativo);
        if destino.exists() {
            continue;
        }
        if let Some(p) = destino.parent() {
            std::fs::create_dir_all(p)?;
        }
        if algum_md_referencia(&dir_de, &relativo) {
            std::fs::copy(&origem, &destino)?;
        } else {
            std::fs::rename(&origem, &destino).or_else(|_| std::fs::copy(&origem, &destino).and_then(|_| std::fs::remove_file(&origem)))?;
        }
    }
    Ok(())
}

/// Vault antigo: `src/` na raiz. Vira `Pessoal/src/` (a mídia é de quem a enviou; hoje tudo era do Pessoal).
fn migrar_midia_legada(notes_root: &Path) -> std::io::Result<()> {
    let legado = notes_root.join("src");
    if !legado.is_dir() {
        return Ok(());
    }
    let pessoal = garantir_dir(notes_root, "pessoal", None)?;
    let destino = pessoal.join("src");
    // Arquivo a arquivo (não o diretório inteiro): renomear a pasta falha com `Permission denied`
    // em bind mounts do Docker no Windows. Se o destino já existe, nada é sobrescrito.
    tracing::info!(de = %legado.display(), para = %destino.display(), "movendo a mídia para o espaço Pessoal");
    let arquivos: Vec<PathBuf> = walkdir::WalkDir::new(&legado).into_iter().filter_map(Result::ok).filter(|e| e.file_type().is_file()).map(|e| e.into_path()).collect();
    let mut sobrou = false;
    for arquivo in arquivos {
        let rel = arquivo.strip_prefix(&legado).unwrap_or(&arquivo).to_path_buf();
        let alvo = destino.join(&rel);
        if alvo.exists() {
            tracing::warn!(arquivo = %arquivo.display(), "mídia legada já existe no Pessoal; mantida onde estava");
            sobrou = true;
        } else {
            mover(&arquivo, &alvo)?;
        }
    }
    if !sobrou {
        std::fs::remove_dir_all(&legado)?;
    }
    Ok(())
}

fn campo_frontmatter(conteudo: &str, campo: &str) -> Option<String> {
    let mut linhas = conteudo.lines();
    if linhas.next()?.trim() != "---" {
        return None;
    }
    let prefixo = format!("{campo}:");
    for linha in linhas {
        if linha.trim() == "---" {
            break;
        }
        if let Some(valor) = linha.strip_prefix(&prefixo) {
            return Some(valor.trim().trim_matches('"').to_string());
        }
    }
    None
}

fn copiar_arvore(origem: &Path, destino: &Path) -> std::io::Result<()> {
    for e in walkdir::WalkDir::new(origem).into_iter().filter_map(Result::ok) {
        let rel = e.path().strip_prefix(origem).unwrap_or(e.path());
        let alvo = destino.join(rel);
        if e.file_type().is_dir() {
            std::fs::create_dir_all(&alvo)?;
        } else {
            if let Some(p) = alvo.parent() {
                std::fs::create_dir_all(p)?;
            }
            std::fs::copy(e.path(), &alvo)?;
        }
    }
    Ok(())
}

fn mover(de: &Path, para: &Path) -> std::io::Result<()> {
    if let Some(p) = para.parent() {
        std::fs::create_dir_all(p)?;
    }
    // `rename` pode falhar entre montagens/permissões diferentes: cai para copiar e remover.
    std::fs::rename(de, para).or_else(|_| std::fs::copy(de, para).and_then(|_| std::fs::remove_file(de)))
}

/// Migra o layout antigo (`Notas/` e `Tarefas/` direto na raiz, com o espaço só
/// no front-matter) para `<Espaço>/{Notas,Tarefas}`. Idempotente: sem árvores
/// legadas não faz nada. Antes de mover, guarda uma cópia em
/// `.ecos/backup-pre-espacos/`.
pub async fn migrar_legado(state_db: &crate::db::IndexDb, notes_root: &Path) -> anyhow::Result<()> {
    migrar_midia_legada(notes_root)?;
    let legados: Vec<&str> = ["Notas", "Tarefas"].into_iter().filter(|a| notes_root.join(a).is_dir()).collect();
    if legados.is_empty() {
        return Ok(());
    }
    let nomes: std::collections::HashMap<String, String> = state_db
        .with(|conn| {
            let mut stmt = conn.prepare("SELECT id, nome FROM equipe")?;
            let linhas = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?.collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await
        .map(|v| v.into_iter().collect())
        .unwrap_or_default();

    let backup = notes_root.join(".ecos").join("backup-pre-espacos");
    for arvore in &legados {
        copiar_arvore(&notes_root.join(arvore), &backup.join(arvore))?;
    }
    tracing::info!(backup = %backup.display(), "migrando notas e tarefas para o layout por espaço");

    let destino_de = |espaco: &str, arvore: &str| -> std::io::Result<PathBuf> {
        let nome = espaco.strip_prefix("equipe:").and_then(|id| nomes.get(id)).map(String::as_str);
        Ok(garantir_dir(notes_root, espaco, nome)?.join(arvore))
    };

    for arvore in legados {
        let raiz_legada = notes_root.join(arvore);
        let arquivos: Vec<PathBuf> = walkdir::WalkDir::new(&raiz_legada)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|e| e.file_type().is_file())
            .map(|e| e.into_path())
            .filter(|p| !p.components().any(|c| c.as_os_str() == "_anexos"))
            .collect();
        for arquivo in arquivos {
            let rel = arquivo.strip_prefix(&raiz_legada).unwrap_or(&arquivo).to_path_buf();
            let conteudo = if arquivo.extension().is_some_and(|e| e == "md") { std::fs::read_to_string(&arquivo).ok() } else { None };
            let espaco = conteudo
                .as_deref()
                .and_then(|c| campo_frontmatter(c, "espaco"))
                .filter(|e| e == "pessoal" || e.starts_with("equipe:"))
                .unwrap_or_else(|| "pessoal".to_string());
            let raiz_destino = destino_de(&espaco, arvore)?;
            // Anexos irmãos do `.md` (`_anexos/<id>/`) vão juntos.
            let anexos = conteudo.as_deref().and_then(|c| campo_frontmatter(c, "id")).and_then(|id| {
                let origem = arquivo.parent()?.join("_anexos").join(&id);
                origem.is_dir().then_some((origem, id))
            });
            let alvo = raiz_destino.join(&rel);
            mover(&arquivo, &alvo)?;
            if let Some((origem, id)) = anexos {
                mover(&origem, &alvo.parent().unwrap_or(&raiz_destino).join("_anexos").join(id))?;
            }
        }
        // Pastas restantes (vazias ou com anexos órfãos) ficam no Pessoal.
        let pessoal = destino_de("pessoal", arvore)?;
        let restos: Vec<PathBuf> = walkdir::WalkDir::new(&raiz_legada).min_depth(1).contents_first(true).into_iter().filter_map(Result::ok).map(|e| e.into_path()).collect();
        for resto in restos {
            let rel = resto.strip_prefix(&raiz_legada).unwrap_or(&resto).to_path_buf();
            if resto.is_dir() {
                std::fs::create_dir_all(pessoal.join(&rel))?;
            } else if resto.is_file() {
                mover(&resto, &pessoal.join(&rel))?;
            }
        }
        std::fs::remove_dir_all(&raiz_legada)?;
    }
    Ok(())
}

/// Layout com um único `Pessoal/` (sem dono) -> uma pasta pessoal por usuário. Tudo o que estava em
/// `Pessoal/` passa ao primeiro usuário cadastrado (o dono da instância). Idempotente: sem a pasta
/// legada (marcador `pessoal`) não faz nada; sem usuário cadastrado, deixa como está e avisa.
pub async fn migrar_pessoal_por_usuario(state_db: &crate::db::IndexDb, notes_root: &Path) -> anyhow::Result<()> {
    let Some((_, legado)) = listar(notes_root).into_iter().find(|(e, _)| e == "pessoal") else { return Ok(()) };
    let dono: Option<(String, String)> = state_db
        .with(|conn| {
            conn.query_row("SELECT id, nome_usuario FROM usuario ORDER BY criado_em, id LIMIT 1", [], |r| Ok((r.get(0)?, r.get(1)?))).optional()
        })
        .await?;
    let Some((usuario_id, login)) = dono else {
        tracing::warn!(pasta = %legado.display(), "há um Pessoal/ legado, mas nenhum usuário cadastrado: migração adiada");
        return Ok(());
    };
    let chave = fisica("pessoal", &usuario_id);
    if dir_existente(notes_root, &chave).is_some() {
        tracing::error!(pasta = %legado.display(), "Pessoal/ legado e pasta do dono coexistem: nada foi movido, resolva manualmente");
        return Ok(());
    }
    let limpo = naming::sanitizar_nome_arquivo(&login);
    let base = if RESERVADOS.contains(&limpo.as_str()) || limpo == PESSOAL_DIR { format!("{limpo} (espaço)") } else { limpo };
    let mut destino = notes_root.join(&base);
    let mut contador = 2u32;
    while destino.exists() {
        destino = notes_root.join(format!("{base} ({contador})"));
        contador += 1;
    }
    tracing::info!(de = %legado.display(), para = %destino.display(), usuario = %usuario_id, "movendo o espaço Pessoal para a pasta do dono");
    // `rename` falha em bind mounts do Docker no Windows (ver `migrar_midia_legada`): cai para copiar e remover.
    if std::fs::rename(&legado, &destino).is_err() {
        copiar_arvore(&legado, &destino)?;
        std::fs::remove_dir_all(&legado)?;
    }
    std::fs::write(destino.join(MARCADOR), &chave)?;
    if let Some(nome) = destino.file_name().and_then(|n| n.to_str()) {
        reescrever_lixeira(notes_root, nome, &chave);
    }
    Ok(())
}

/// A lixeira guarda caminhos (`Pessoal/Notas/x.md`) e o espaço de origem da mídia (`pessoal`): aponta tudo para o novo dono.
/// Best effort: falha aqui só deixa itens antigos fora da lixeira, não compromete a migração.
fn reescrever_lixeira(notes_root: &Path, pasta_nova: &str, chave: &str) {
    let lixeira = notes_root.join(".ecos").join("lixeira");
    if let Ok(entradas) = std::fs::read_dir(lixeira.join("documentos")) {
        for entrada in entradas.flatten() {
            let arquivo = entrada.path().join("registro.json");
            let Ok(bruto) = std::fs::read(&arquivo) else { continue };
            let Ok(mut registro) = serde_json::from_slice::<serde_json::Value>(&bruto) else { continue };
            let mut mudou = false;
            for ponteiro in ["/item/caminho_original", "/anexos"] {
                let Some(valor) = registro.pointer_mut(ponteiro) else { continue };
                if let Some(novo) = valor.as_str().and_then(|c| c.strip_prefix(&format!("{PESSOAL_DIR}/"))).map(|resto| format!("{pasta_nova}/{resto}")) {
                    *valor = serde_json::Value::String(novo);
                    mudou = true;
                }
            }
            if mudou {
                if let Ok(saida) = serde_json::to_vec(&registro) {
                    let _ = std::fs::write(&arquivo, saida);
                }
            }
        }
    }
    if let Ok(entradas) = std::fs::read_dir(lixeira.join("media")) {
        for entrada in entradas.flatten() {
            let caminho = entrada.path();
            if caminho.extension().is_some_and(|e| e == "espaco") && std::fs::read_to_string(&caminho).is_ok_and(|v| v.trim() == "pessoal") {
                let _ = std::fs::write(&caminho, chave);
            }
        }
    }
}

#[cfg(test)]
mod testes {
    use super::*;
    use crate::db::IndexDb;

    fn tarefa(id: &str, espaco: &str) -> String {
        format!("---\nid: {id}\ntitulo: T {id}\nstatus: pendente\nespaco: {espaco}\ncriado_em: 2026-09-01T10:00:00Z\n---\ncorpo\n")
    }

    #[tokio::test]
    async fn migra_layout_antigo_separando_por_espaco_e_reindexa() {
        let raiz = std::env::temp_dir().join(format!("ecos-espacos-{}", ecos_core::new_id()));
        let legado = raiz.join("Tarefas");
        std::fs::create_dir_all(legado.join("Projeto").join("_anexos").join("b")).unwrap();
        std::fs::create_dir_all(legado.join("Vazia")).unwrap();
        std::fs::write(legado.join("a.md"), tarefa("a", "pessoal")).unwrap();
        std::fs::write(legado.join("Projeto").join("b.md"), tarefa("b", "equipe:EQ1")).unwrap();
        std::fs::write(legado.join("Projeto").join("_anexos").join("b").join("x.txt"), "anexo").unwrap();

        let db = IndexDb::open(&raiz.join("indice.db")).unwrap();
        migrar_legado(&db, &raiz).await.unwrap();

        assert!(!legado.exists());
        assert!(raiz.join(PESSOAL_DIR).join("Tarefas").join("a.md").is_file());
        assert!(raiz.join(PESSOAL_DIR).join("Tarefas").join("Vazia").is_dir());
        let dir_equipe = dir_existente(&raiz, "equipe:EQ1").expect("diretório da equipe");
        assert!(dir_equipe.join("Tarefas").join("Projeto").join("b.md").is_file());
        assert!(dir_equipe.join("Tarefas").join("Projeto").join("_anexos").join("b").join("x.txt").is_file());
        assert!(raiz.join(".ecos").join("backup-pre-espacos").join("Tarefas").join("a.md").is_file());

        crate::db::reindex::reindexar_tudo(&db, &raiz).await.unwrap();
        let linhas: Vec<(String, String)> = db
            .with(|c| {
                let mut stmt = c.prepare("SELECT id, espaco FROM tarefa ORDER BY id")?;
                let l = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<Vec<_>, _>>()?;
                Ok(l)
            })
            .await
            .unwrap();
        assert_eq!(linhas, vec![("a".into(), "pessoal".into()), ("b".into(), "equipe:EQ1".into())]);
        let _ = std::fs::remove_dir_all(&raiz);
    }

    fn raiz_temp(nome: &str) -> PathBuf {
        let raiz = std::env::temp_dir().join(format!("ecos-{nome}-{}", ecos_core::new_id()));
        std::fs::create_dir_all(&raiz).unwrap();
        raiz
    }

    fn escreve(caminho: &Path, texto: &str) {
        std::fs::create_dir_all(caminho.parent().unwrap()).unwrap();
        std::fs::write(caminho, texto).unwrap();
    }

    #[test]
    fn referencias_de_midia_no_corpo_cruas_e_decodificadas() {
        let corpo = "![foto](src/Media/2026-09/foto-01ABC.png)\n[relatório final](src/Media/2026-09/relat%C3%B3rio%20final-01DEF.pdf)\ntexto sem link\n[com espaço](src/Media/2026-09/meu arquivo-01GHI.txt)";
        let refs = midias_referenciadas(corpo);
        assert!(refs.contains(&"2026-09/foto-01ABC.png".to_string()));
        assert!(refs.contains(&"2026-09/relat%C3%B3rio%20final-01DEF.pdf".to_string()));
        assert!(refs.contains(&"2026-09/relatório final-01DEF.pdf".to_string()));
        assert!(refs.contains(&"2026-09/meu arquivo-01GHI.txt".to_string()));
        assert!(midias_referenciadas("sem mídia").is_empty());
    }

    #[test]
    fn achar_midia_procura_em_todos_os_espacos_e_recusa_caminho_fora_da_biblioteca() {
        let raiz = raiz_temp("achar-midia");
        let pessoal = garantir_dir(&raiz, "pessoal:U1", Some("ana")).unwrap();
        let equipe = garantir_dir(&raiz, "equipe:EQ1", Some("Time A")).unwrap();
        let permitidos = vec!["pessoal:U1".to_string(), "equipe:EQ1".to_string()];
        escreve(&pessoal.join(MIDIA_DIR).join("2026-09").join("a-01.png"), "a");
        escreve(&equipe.join(MIDIA_DIR).join("2026-09").join("b-02.png"), "b");
        assert_eq!(achar_midia(&raiz, "2026-09/a-01.png", &permitidos).unwrap().0, "pessoal:U1");
        assert_eq!(achar_midia(&raiz, "2026-09/b-02.png", &permitidos).unwrap().0, "equipe:EQ1");
        assert!(achar_midia(&raiz, "2026-09/nao-existe.png", &permitidos).is_none());
        assert!(achar_midia(&raiz, "../Pessoal/Notas/x.md", &permitidos).is_none());
        assert!(achar_midia(&raiz, "", &permitidos).is_none());
        // Quem não tem acesso ao espaço não encontra o arquivo (mídia de outra pessoa / de equipe alheia).
        let so_a_dele = vec!["pessoal:U2".to_string()];
        assert!(achar_midia(&raiz, "2026-09/a-01.png", &so_a_dele).is_none());
        assert!(achar_midia(&raiz, "2026-09/b-02.png", &so_a_dele).is_none());
        let _ = std::fs::remove_dir_all(&raiz);
    }

    #[tokio::test]
    async fn migra_o_src_legado_para_o_pessoal_sem_perder_arquivo() {
        let raiz = raiz_temp("src-legado");
        escreve(&raiz.join("src").join("Media").join("2026-09").join("x-01.png"), "conteudo");
        let db = IndexDb::open(&raiz.join("indice.db")).unwrap();
        migrar_legado(&db, &raiz).await.unwrap();
        assert!(!raiz.join("src").exists());
        assert_eq!(std::fs::read_to_string(raiz.join(PESSOAL_DIR).join("src").join("Media").join("2026-09").join("x-01.png")).unwrap(), "conteudo");
        // Idempotente: uma segunda passada não muda nada.
        migrar_legado(&db, &raiz).await.unwrap();
        assert!(raiz.join(PESSOAL_DIR).join("src").join("Media").join("2026-09").join("x-01.png").is_file());
        // `src` continua reservado: nunca vira um espaço.
        assert!(listar(&raiz).iter().all(|(e, _)| e == "pessoal"));
        let _ = std::fs::remove_dir_all(&raiz);
    }

    #[test]
    fn src_legado_com_conflito_nao_sobrescreve_nem_apaga() {
        let raiz = raiz_temp("src-conflito");
        escreve(&raiz.join("src").join("Media").join("2026-09").join("igual.png"), "legado");
        escreve(&raiz.join("src").join("Media").join("2026-09").join("novo.png"), "novo");
        escreve(&raiz.join(PESSOAL_DIR).join("src").join("Media").join("2026-09").join("igual.png"), "ja-no-pessoal");
        escreve(&raiz.join(PESSOAL_DIR).join(MARCADOR), "pessoal");
        migrar_midia_legada(&raiz).unwrap();
        let base = raiz.join(PESSOAL_DIR).join("src").join("Media").join("2026-09");
        assert_eq!(std::fs::read_to_string(base.join("igual.png")).unwrap(), "ja-no-pessoal");
        assert_eq!(std::fs::read_to_string(base.join("novo.png")).unwrap(), "novo");
        assert!(raiz.join("src").join("Media").join("2026-09").join("igual.png").is_file(), "o conflito fica onde estava");
        let _ = std::fs::remove_dir_all(&raiz);
    }

    #[test]
    fn trocar_de_espaco_move_a_midia_exclusiva_e_copia_a_compartilhada() {
        let raiz = raiz_temp("levar-midia");
        let pessoal = garantir_dir(&raiz, "pessoal", None).unwrap();
        let equipe = garantir_dir(&raiz, "equipe:EQ1", Some("Time A")).unwrap();
        let midia = |dir: &Path, nome: &str| dir.join(MIDIA_DIR).join("2026-09").join(nome);
        escreve(&midia(&pessoal, "so-dela-01.png"), "1");
        escreve(&midia(&pessoal, "dividida-02.png"), "2");
        // Outra nota que ficou no Pessoal ainda usa a "dividida".
        escreve(&pessoal.join("Notas").join("outra.md"), "![x](src/Media/2026-09/dividida-02.png)");
        let corpo = "![a](src/Media/2026-09/so-dela-01.png) e ![b](src/Media/2026-09/dividida-02.png) e ![c](src/Media/2026-09/inexistente-03.png)";

        levar_midia(&raiz, corpo, "pessoal", "equipe:EQ1").unwrap();

        assert!(!midia(&pessoal, "so-dela-01.png").exists(), "exclusiva sai do espaço antigo");
        assert_eq!(std::fs::read_to_string(midia(&equipe, "so-dela-01.png")).unwrap(), "1");
        assert!(midia(&pessoal, "dividida-02.png").is_file(), "compartilhada fica no antigo");
        assert_eq!(std::fs::read_to_string(midia(&equipe, "dividida-02.png")).unwrap(), "2");
        assert!(!midia(&equipe, "inexistente-03.png").exists());
        // Os dois links continuam resolvendo, agora pelo espaço novo (e o antigo, no caso da copiada).
        assert_eq!(achar_midia(&raiz, "2026-09/so-dela-01.png", &["equipe:EQ1".to_string()]).unwrap().0, "equipe:EQ1");
        // Mesmo espaço: não faz nada.
        levar_midia(&raiz, corpo, "pessoal", "pessoal").unwrap();
        let _ = std::fs::remove_dir_all(&raiz);
    }

    #[test]
    fn cada_usuario_tem_a_propria_pasta_pessoal_e_o_login_so_batiza() {
        let raiz = raiz_temp("pessoal-por-usuario");
        let ana = garantir_dir(&raiz, "pessoal:U1", Some("ana")).unwrap();
        let bia = garantir_dir(&raiz, "pessoal:U2", Some("bia")).unwrap();
        assert_ne!(ana, bia);
        assert_eq!(ana.file_name().unwrap(), "ana");
        assert_eq!(std::fs::read_to_string(ana.join(MARCADOR)).unwrap(), "pessoal:U1");
        // Reabrir devolve a mesma pasta mesmo que o nome sugerido mude (o marcador manda).
        assert_eq!(garantir_dir(&raiz, "pessoal:U1", Some("outro-nome")).unwrap(), ana);
        // Um login que colide com nome reservado não vira `Notas/` nem `src/`.
        let reservado = garantir_dir(&raiz, "pessoal:U3", Some("Notas")).unwrap();
        assert_eq!(reservado.file_name().unwrap(), "Notas (espaço)");
        let chaves: Vec<String> = listar(&raiz).into_iter().map(|(e, _)| e).collect();
        assert_eq!(chaves, vec!["pessoal:U1", "pessoal:U2", "pessoal:U3"]);
        assert_eq!(espaco_do_caminho(&raiz, "bia/Notas/x.md").as_deref(), Some("pessoal:U2"));
        assert_eq!((fisica("pessoal", "U1"), fisica("equipe:E", "U1")), ("pessoal:U1".to_string(), "equipe:E".to_string()));
        assert_eq!((logica("pessoal:U1"), logica("equipe:E"), dono("pessoal:U1"), dono("equipe:E")), ("pessoal", "equipe:E", Some("U1"), None));
        let _ = std::fs::remove_dir_all(&raiz);
    }

    #[tokio::test]
    async fn migra_o_pessoal_legado_para_a_pasta_do_primeiro_usuario() {
        let raiz = raiz_temp("pessoal-legado");
        let db = IndexDb::open(&raiz.join("indice.db")).unwrap();
        db.with(|c| {
            c.execute("INSERT INTO usuario (id, nome_usuario, senha_hash, recovery_key_hash, criado_em) VALUES ('U2', 'bia', 'x', 'x', '2026-02-01')", [])?;
            c.execute("INSERT INTO usuario (id, nome_usuario, senha_hash, recovery_key_hash, criado_em) VALUES ('U1', 'diogo', 'x', 'x', '2026-01-01')", [])?;
            Ok(())
        }).await.unwrap();
        let legado = garantir_dir(&raiz, "pessoal", None).unwrap();
        escreve(&legado.join("Notas").join("antiga.md"), &format!("---\nid: N1\ntitulo: Antiga\nmodo: texto\nespaco: pessoal\ntags: []\ncriado_em: 2026-01-01T00:00:00Z\natualizado_em: 2026-01-01T00:00:00Z\n---\ncorpo\n"));
        escreve(&legado.join("src").join("Media").join("2026-09").join("m-01.png"), "img");
        escreve(&raiz.join(".ecos/lixeira/documentos/documento-X/registro.json"), r#"{"item":{"id":"documento-X","nome":"n","tipo":"nota","caminho_original":"Pessoal/Notas/velha.md","tamanho_bytes":1,"mime":"text/markdown","excluido_em":"2026-01-01T00:00:00Z"},"anexos":null}"#);
        escreve(&raiz.join(".ecos/lixeira/media/M1.espaco"), "pessoal");

        migrar_pessoal_por_usuario(&db, &raiz).await.unwrap();

        let dono = raiz.join("diogo");
        assert!(!legado.exists(), "a pasta Pessoal some");
        assert_eq!(std::fs::read_to_string(dono.join(MARCADOR)).unwrap(), "pessoal:U1", "dono é o primeiro cadastrado, não o primeiro por id");
        assert!(dono.join("Notas").join("antiga.md").is_file() && dono.join("src/Media/2026-09/m-01.png").is_file());
        assert!(std::fs::read_to_string(raiz.join(".ecos/lixeira/documentos/documento-X/registro.json")).unwrap().contains("diogo/Notas/velha.md"));
        assert_eq!(std::fs::read_to_string(raiz.join(".ecos/lixeira/media/M1.espaco")).unwrap(), "pessoal:U1");
        // Idempotente.
        migrar_pessoal_por_usuario(&db, &raiz).await.unwrap();
        assert!(dono.join("Notas").join("antiga.md").is_file());

        // O reindex atribui a nota ao dono da pasta, mesmo sem `criado_por` no arquivo.
        crate::db::reindex::reindexar_tudo(&db, &raiz).await.unwrap();
        let (espaco, por): (String, Option<String>) = db.with(|c| c.query_row("SELECT espaco, criado_por FROM nota WHERE id = 'N1'", [], |r| Ok((r.get(0)?, r.get(1)?)))).await.unwrap();
        assert_eq!((espaco.as_str(), por.as_deref()), ("pessoal", Some("U1")));
        let _ = std::fs::remove_dir_all(&raiz);
    }

    #[tokio::test]
    async fn sem_usuario_cadastrado_o_pessoal_legado_fica_onde_esta() {
        let raiz = raiz_temp("pessoal-sem-usuario");
        let db = IndexDb::open(&raiz.join("indice.db")).unwrap();
        let legado = garantir_dir(&raiz, "pessoal", None).unwrap();
        migrar_pessoal_por_usuario(&db, &raiz).await.unwrap();
        assert!(legado.is_dir());
        let _ = std::fs::remove_dir_all(&raiz);
    }
}
