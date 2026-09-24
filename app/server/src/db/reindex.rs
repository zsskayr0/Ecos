//! Reindexação completa: varre `Notas/`/`Tarefas/` e repovoa o índice local
//! do zero. Prova em código a regra da seção 1.1 — o índice é cache
//! reconstruível, nunca fonte de verdade: apagar `ecos-index.db` e rodar
//! isto de novo devolve o mesmo estado observável (menos contadores de
//! interação, que só existem no próprio índice).

use super::IndexDb;
use chrono::{DateTime, Utc};
use ecos_core::types::{CalendarioProvider, CategoriaEvento, EventoFrontMatter, NotaFrontMatter, NotaModo, TarefaFrontMatter, TarefaPrioridade, TarefaStatus};
use ecos_core::{frontmatter, wikilink};
use rusqlite::params;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::Path;
use walkdir::WalkDir;

/// Converte contagens diretas em totais recursivos. Um item em
/// `Dev/Apps/Ecos` soma 1 em `Dev/Apps/Ecos`, `Dev/Apps` e `Dev`.
fn acumular_contagens_pastas(contagens: &mut HashMap<(&'static str, String, String), i64>) {
    let diretas: Vec<_> = contagens
        .iter()
        .map(|((tipo, espaco, caminho), contagem)| (*tipo, espaco.clone(), caminho.clone(), *contagem))
        .collect();
    for (tipo, espaco, caminho, contagem) in diretas {
        if contagem == 0 {
            continue;
        }
        let mut descendente = caminho.as_str();
        while let Some((pai, _)) = descendente.rsplit_once('/') {
            *contagens.entry((tipo, espaco.clone(), pai.to_string())).or_insert(0) += contagem;
            descendente = pai;
        }
    }
}

#[cfg(test)]
mod testes_contagem_pastas {
    use super::*;

    #[test]
    fn soma_itens_de_todos_os_descendentes_sem_misturar_tipo_ou_espaco() {
        let mut contagens = HashMap::from([
            (("tarefa", "pessoal:u1".into(), "Dev".into()), 2),
            (("tarefa", "pessoal:u1".into(), "Dev/Apps".into()), 3),
            (("tarefa", "pessoal:u1".into(), "Dev/Apps/Ecos".into()), 5),
            (("nota", "pessoal:u1".into(), "Dev".into()), 7),
            (("tarefa", "equipe:e1".into(), "Dev".into()), 11),
        ]);

        acumular_contagens_pastas(&mut contagens);

        assert_eq!(contagens.get(&("tarefa", "pessoal:u1".into(), "Dev".into())), Some(&10));
        assert_eq!(contagens.get(&("tarefa", "pessoal:u1".into(), "Dev/Apps".into())), Some(&8));
        assert_eq!(contagens.get(&("tarefa", "pessoal:u1".into(), "Dev/Apps/Ecos".into())), Some(&5));
        assert_eq!(contagens.get(&("nota", "pessoal:u1".into(), "Dev".into())), Some(&7));
        assert_eq!(contagens.get(&("tarefa", "equipe:e1".into(), "Dev".into())), Some(&11));
    }
}

fn nota_modo_str(modo: NotaModo) -> &'static str {
    match modo {
        NotaModo::Texto => "texto",
        NotaModo::Pagina => "pagina",
    }
}

fn tarefa_status_str(status: TarefaStatus) -> &'static str {
    match status {
        TarefaStatus::Pendente => "pendente",
        TarefaStatus::Concluida => "concluida",
    }
}

fn tarefa_prioridade_str(prioridade: TarefaPrioridade) -> &'static str {
    match prioridade {
        TarefaPrioridade::Baixa => "baixa",
        TarefaPrioridade::Media => "media",
        TarefaPrioridade::Alta => "alta",
    }
}

fn calendario_provider_str(provider: CalendarioProvider) -> &'static str {
    match provider {
        CalendarioProvider::Google => "google",
        CalendarioProvider::Microsoft => "microsoft",
    }
}

#[derive(Debug, Default, Clone, serde::Serialize)]
pub struct ResultadoReindex {
    pub notas: usize,
    pub tarefas: usize,
    pub eventos: usize,
    pub documentos: usize,
    pub erros: Vec<String>,
    /// `.md` soltos ainda sendo escritos/copiados: a adoção espera o arquivo estabilizar.
    pub adiados: usize,
}

struct NotaColetada {
    front_matter: NotaFrontMatter,
    body: String,
    caminho_relativo: String,
    pasta_id: Option<String>,
    hash_conteudo: String,
}

struct TarefaColetada {
    front_matter: TarefaFrontMatter,
    caminho_relativo: String,
    pasta_id: Option<String>,
    /// mtime do arquivo — reserva de `atualizado_em` para tarefas anteriores ao campo.
    modificado_em: Option<DateTime<Utc>>,
}

struct EventoColetado {
    front_matter: EventoFrontMatter,
    caminho_relativo: String,
}

struct DocumentoColetado {
    caminho_relativo: String,
    nome: String,
    tamanho_bytes: i64,
    hash_conteudo: String,
    pasta_id: Option<String>,
}

/// Exceções como o front as recebe (datas em RFC 3339, campos ausentes = herdados da série).
fn excecoes_json(excecoes: &[ecos_core::types::Excecao]) -> String {
    let itens: Vec<serde_json::Value> = excecoes
        .iter()
        .map(|x| {
            serde_json::json!({
                "original": x.original.to_rfc3339(), "cancelada": x.cancelada, "titulo": x.titulo,
                "inicio": x.inicio.map(|d| d.to_rfc3339()), "fim": x.fim.map(|d| d.to_rfc3339()),
                "local": x.local, "descricao": x.descricao, "sync_pendente": x.sync_pendente,
            })
        })
        .collect();
    serde_json::to_string(&itens).unwrap_or_else(|_| "[]".into())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Componente `_anexos` em qualquer nível — nunca conteúdo navegável em si
/// (seção 1.3: fotos/desenhos/páginas ficam ao lado do `.md`, não são
/// Nota/Documento/Pasta próprios).
fn dentro_de_anexos(path: &Path) -> bool {
    path.components().any(|c| c.as_os_str() == "_anexos")
}

/// Caminho da pasta-pai relativo à raiz da árvore (`Notas/` ou `Tarefas/`),
/// com `/` como separador sempre (independente do SO) — `None` = raiz. Ver
/// seção 1.3 ("Pasta não tem `id` persistido... é derivada, a cada reindex,
/// direto da árvore de diretórios").
fn pasta_relativa(raiz: &Path, arquivo: &Path) -> Option<String> {
    let pai = arquivo.parent()?;
    if pai == raiz {
        return None;
    }
    let relativo = pai.strip_prefix(raiz).ok()?;
    if relativo.as_os_str().is_empty() {
        return None;
    }
    Some(relativo.to_string_lossy().replace('\\', "/"))
}

fn caminho_relativo_str(vault_root: &Path, arquivo: &Path) -> String {
    arquivo
        .strip_prefix(vault_root)
        .unwrap_or(arquivo)
        .to_string_lossy()
        .replace('\\', "/")
}

/// Todo diretório sob `raiz_arvore` (recursivo), como caminho relativo a
/// ela — inclui pastas vazias, que também precisam aparecer em `GET
/// /pastas` (seção 11.5) mesmo sem nenhum item direto ainda.
fn enumerar_pastas(raiz_arvore: &Path) -> Vec<String> {
    let mut out = Vec::new();
    if !raiz_arvore.exists() {
        return out;
    }
    for entry in WalkDir::new(raiz_arvore).min_depth(1).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_dir() || dentro_de_anexos(entry.path()) {
            continue;
        }
        if let Ok(relativo) = entry.path().strip_prefix(raiz_arvore) {
            if !relativo.as_os_str().is_empty() {
                out.push(relativo.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    out
}

/// Tempo sem mexer no arquivo antes de adotá-lo (cópia/gravação em andamento).
const ESTABILIZAR: std::time::Duration = std::time::Duration::from_secs(2);

enum Adocao {
    Adotado(String),
    Adiado,
    Falhou(String),
}

/// `.md` solto em `Notas/` sem front-matter válido: completa o bloco (o corpo
/// nunca muda) e grava de forma atômica. Se a gravação falhar (somente leitura,
/// aberto em outro programa) a nota fica de fora e o erro é registrado — sem o
/// `id` gravado no arquivo ela mudaria de identidade a cada reindex.
fn adotar_arquivo(path: &Path, raw: &str) -> Adocao {
    let meta = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(err) => return Adocao::Falhou(format!("falha ao ler metadados ({err})")),
    };
    let modificado = meta.modified().unwrap_or_else(|_| std::time::SystemTime::now());
    if modificado.elapsed().map(|d| d < ESTABILIZAR).unwrap_or(false) {
        return Adocao::Adiado;
    }
    let atualizado: chrono::DateTime<chrono::Utc> = modificado.into();
    let criado: chrono::DateTime<chrono::Utc> = meta.created().map(Into::into).unwrap_or(atualizado);
    let criado = criado.min(atualizado);
    let nome = path.file_stem().and_then(|n| n.to_str()).unwrap_or("Sem título");

    let novo = match ecos_core::adotar::adotar(raw, nome, criado, atualizado) {
        Ok(Some(novo)) => novo,
        Ok(None) => return Adocao::Falhou("front-matter inválido".to_string()),
        Err(err) => return Adocao::Falhou(format!("front-matter inválido ({err})")),
    };
    let tmp = path.with_extension("md.ecos-tmp");
    let gravou = std::fs::write(&tmp, &novo).and_then(|_| std::fs::rename(&tmp, path));
    if let Err(err) = gravou {
        let _ = std::fs::remove_file(&tmp);
        tracing::warn!(arquivo = %path.display(), error = %err, "não foi possível gravar o front-matter da nota adotada");
        return Adocao::Falhou(format!("não foi possível gravar o front-matter ({err})"));
    }
    tracing::info!(arquivo = %path.display(), "nota adotada: front-matter criado");
    Adocao::Adotado(novo)
}

fn coletar_notas(vault_root: &Path, notas_dir: &Path, erros: &mut Vec<String>, adiados: &mut usize) -> Vec<NotaColetada> {
    let mut out = Vec::new();
    if !notas_dir.exists() {
        return out;
    }
    for entry in WalkDir::new(notas_dir).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|e| e.to_str()) != Some("md") || dentro_de_anexos(path) {
            continue;
        }
        let raw = match std::fs::read_to_string(path) {
            Ok(v) => v,
            Err(err) => {
                erros.push(format!("{}: falha ao ler ({err})", path.display()));
                continue;
            }
        };
        let mut raw = raw;
        if frontmatter::parse::<NotaFrontMatter>(&raw).is_err() {
            match adotar_arquivo(path, &raw) {
                Adocao::Adotado(novo) => raw = novo,
                Adocao::Adiado => {
                    *adiados += 1;
                    continue;
                }
                Adocao::Falhou(msg) => {
                    erros.push(format!("{}: {msg}", path.display()));
                    continue;
                }
            }
        }
        match frontmatter::parse::<NotaFrontMatter>(&raw) {
            Ok(doc) => {
                let hash_conteudo = hex(&Sha256::digest(raw.as_bytes()));
                out.push(NotaColetada {
                    pasta_id: pasta_relativa(notas_dir, path),
                    caminho_relativo: caminho_relativo_str(vault_root, path),
                    front_matter: doc.front_matter,
                    body: doc.body,
                    hash_conteudo,
                });
            }
            Err(err) => erros.push(format!("{}: front-matter inválido ({err})", path.display())),
        }
    }
    out
}

fn coletar_tarefas(vault_root: &Path, tarefas_dir: &Path, erros: &mut Vec<String>) -> Vec<TarefaColetada> {
    let mut out = Vec::new();
    if !tarefas_dir.exists() {
        return out;
    }
    for entry in WalkDir::new(tarefas_dir).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|e| e.to_str()) != Some("md") || dentro_de_anexos(path) {
            continue;
        }
        let raw = match std::fs::read_to_string(path) {
            Ok(v) => v,
            Err(err) => {
                erros.push(format!("{}: falha ao ler ({err})", path.display()));
                continue;
            }
        };
        match frontmatter::parse::<TarefaFrontMatter>(&raw) {
            Ok(doc) => out.push(TarefaColetada {
                pasta_id: pasta_relativa(tarefas_dir, path),
                caminho_relativo: caminho_relativo_str(vault_root, path),
                modificado_em: entry.metadata().ok().and_then(|m| m.modified().ok()).map(DateTime::<Utc>::from),
                front_matter: doc.front_matter,
            }),
            Err(err) => erros.push(format!("{}: front-matter inválido ({err})", path.display())),
        }
    }
    out
}

fn coletar_eventos(vault_root: &Path, eventos_dir: &Path, erros: &mut Vec<String>) -> Vec<EventoColetado> {
    let mut out = Vec::new();
    if !eventos_dir.exists() {
        return out;
    }
    for entry in WalkDir::new(eventos_dir).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let raw = match std::fs::read_to_string(path) {
            Ok(v) => v,
            Err(err) => {
                erros.push(format!("{}: falha ao ler ({err})", path.display()));
                continue;
            }
        };
        match frontmatter::parse::<EventoFrontMatter>(&raw) {
            Ok(doc) => out.push(EventoColetado { caminho_relativo: caminho_relativo_str(vault_root, path), front_matter: doc.front_matter }),
            Err(err) => erros.push(format!("{}: front-matter inválido ({err})", path.display())),
        }
    }
    out
}

/// Documento (PDF) — mesma árvore de `Notas/`, sem front-matter, identidade
/// por hash de conteúdo (seção 1.3).
fn coletar_documentos(vault_root: &Path, notas_dir: &Path, erros: &mut Vec<String>) -> Vec<DocumentoColetado> {
    let mut out = Vec::new();
    if !notas_dir.exists() {
        return out;
    }
    for entry in WalkDir::new(notas_dir).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        let e_pdf = path.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("pdf")).unwrap_or(false);
        if !path.is_file() || !e_pdf || dentro_de_anexos(path) {
            continue;
        }
        match std::fs::read(path) {
            Ok(bytes) => out.push(DocumentoColetado {
                caminho_relativo: caminho_relativo_str(vault_root, path),
                nome: path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
                tamanho_bytes: bytes.len() as i64,
                hash_conteudo: hex(&Sha256::digest(&bytes)),
                pasta_id: pasta_relativa(notas_dir, path),
            }),
            Err(err) => erros.push(format!("{}: falha ao ler ({err})", path.display())),
        }
    }
    out
}

/// Reindexa `Notas/` e `Tarefas/` do zero. Chamado no boot e sempre que o
/// watcher de arquivos (`notify`) detecta escrita relevante.
pub async fn reindexar_tudo(db: &IndexDb, notes_root: &Path) -> anyhow::Result<ResultadoReindex> {
    let notes_root = notes_root.to_path_buf();

    let mut erros = Vec::new();
    let mut adiados = 0;
    let mut notas: Vec<NotaColetada> = Vec::new();
    let mut tarefas: Vec<TarefaColetada> = Vec::new();
    let mut eventos: Vec<EventoColetado> = Vec::new();
    // (espaço, categoria)
    let mut categorias: Vec<(String, CategoriaEvento)> = Vec::new();
    let mut documentos = Vec::new();
    // (espaço, pasta) — pastas vazias também entram no índice.
    let mut pastas_notas: Vec<(String, String)> = Vec::new();
    let mut pastas_tarefas: Vec<(String, String)> = Vec::new();
    // O espaço de um item é o do diretório onde ele mora (o front-matter acompanha).
    // Em espaço pessoal, o dono é quem dá nome à pasta (marcador `pessoal:<id>`): o `criado_por` acompanha.
    for (espaco, dir) in crate::espacos::listar(&notes_root) {
        let Ok(valor) = crate::espacos::logica(&espaco).parse::<ecos_core::types::Espaco>() else { continue };
        let dono = crate::espacos::dono(&espaco).map(str::to_string);
        let notas_dir = dir.join("Notas");
        let tarefas_dir = dir.join("Tarefas");
        let mut n = coletar_notas(&notes_root, &notas_dir, &mut erros, &mut adiados);
        n.iter_mut().for_each(|x| {
            x.front_matter.espaco = valor.clone();
            if dono.is_some() { x.front_matter.criado_por = dono.clone(); }
        });
        notas.extend(n);
        let mut t = coletar_tarefas(&notes_root, &tarefas_dir, &mut erros);
        t.iter_mut().for_each(|x| {
            x.front_matter.espaco = valor.clone();
            if dono.is_some() { x.front_matter.criado_por = dono.clone(); }
        });
        tarefas.extend(t);
        let eventos_dir = dir.join(crate::eventos_fs::DIR);
        let mut ev = coletar_eventos(&notes_root, &eventos_dir, &mut erros);
        ev.iter_mut().for_each(|x| {
            x.front_matter.espaco = valor.clone();
            if dono.is_some() { x.front_matter.criado_por = dono.clone(); }
        });
        eventos.extend(ev);
        categorias.extend(crate::eventos_fs::ler_categorias(&eventos_dir).into_iter().map(|c| (espaco.clone(), c)));
        documentos.extend(coletar_documentos(&notes_root, &notas_dir, &mut erros).into_iter().map(|d| (espaco.clone(), d)));
        pastas_notas.extend(enumerar_pastas(&notas_dir).into_iter().map(|p| (espaco.clone(), p)));
        pastas_tarefas.extend(enumerar_pastas(&tarefas_dir).into_iter().map(|p| (espaco.clone(), p)));
    }

    let titulo_para_id: HashMap<String, String> = notas
        .iter()
        .map(|n| (n.front_matter.titulo.clone(), n.front_matter.id.clone()))
        .collect();

    let total_notas = notas.len();
    let total_tarefas = tarefas.len();
    let total_eventos = eventos.len();
    // Vínculos de evento para itens que não existem mais são descartados (sem erro).
    let ids_tarefas: std::collections::HashSet<String> = tarefas.iter().map(|t| t.front_matter.id.clone()).collect();
    let ids_notas: std::collections::HashSet<String> = notas.iter().map(|n| n.front_matter.id.clone()).collect();
    let total_documentos = documentos.len();

    db.with(move |conn| {
        let tx = conn.unchecked_transaction()?;
        tx.execute("DELETE FROM links_nota", [])?;
        tx.execute("DELETE FROM nota_tag", [])?;
        tx.execute("DELETE FROM nota", [])?;
        tx.execute("DELETE FROM evento", [])?; // evento_tarefa/evento_nota caem em cascata
        tx.execute("DELETE FROM categoria_evento", [])?;
        tx.execute("DELETE FROM tarefa_tag", [])?;
        tx.execute("DELETE FROM tarefa", [])?;
        tx.execute("DELETE FROM documento_cache", [])?;
        tx.execute("DELETE FROM pasta_cache", [])?;
        tx.execute("DELETE FROM nota_fts", [])?;
        tx.execute("DELETE FROM tarefa_fts", [])?;

        // (tipo, espaço, caminho) -> contagem direta durante a leitura;
        // antes de persistir ela vira o total da pasta e de toda a subárvore.
        let mut contagem_pastas: HashMap<(&'static str, String, String), i64> = HashMap::new();
        for (espaco, pasta) in &pastas_notas {
            contagem_pastas.entry(("nota", espaco.clone(), pasta.clone())).or_insert(0);
        }
        for (espaco, pasta) in &pastas_tarefas {
            contagem_pastas.entry(("tarefa", espaco.clone(), pasta.clone())).or_insert(0);
        }

        for item in &notas {
            let fm = &item.front_matter;
            tx.execute(
                "INSERT INTO nota (id, caminho_arquivo, titulo, modo, pasta_id, espaco, criado_em, \
                 atualizado_em, ultima_revisao_em, hash_conteudo, contagem_acessos_7d, ocr_texto_busca, criado_por) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0, NULL, (SELECT id FROM usuario WHERE id = ?11))",
                params![
                    fm.id,
                    item.caminho_relativo,
                    fm.titulo,
                    nota_modo_str(fm.modo),
                    item.pasta_id,
                    fm.espaco.to_string(),
                    fm.criado_em.to_rfc3339(),
                    fm.atualizado_em.to_rfc3339(),
                    fm.ultima_revisao_em.map(|d| d.to_rfc3339()),
                    item.hash_conteudo,
                    fm.criado_por,
                ],
            )?;

            for tag in &fm.tags {
                tx.execute("INSERT OR IGNORE INTO nota_tag (nota_id, tag) VALUES (?1, ?2)", params![fm.id, tag])?;
            }

            for titulo_destino in wikilink::extract_titles(&item.body) {
                if let Some(id_destino) = titulo_para_id.get(&titulo_destino) {
                    if id_destino != &fm.id {
                        tx.execute(
                            "INSERT OR IGNORE INTO links_nota (nota_id_origem, nota_id_destino) VALUES (?1, ?2)",
                            params![fm.id, id_destino],
                        )?;
                    }
                }
            }

            tx.execute(
                "INSERT INTO nota_fts (id, titulo, corpo, ocr_texto_busca) VALUES (?1, ?2, ?3, NULL)",
                params![fm.id, fm.titulo, item.body],
            )?;

            if let Some(pasta) = &item.pasta_id {
                let chave = crate::espacos::fisica(&fm.espaco.to_string(), fm.criado_por.as_deref().unwrap_or(""));
                *contagem_pastas.entry(("nota", chave, pasta.clone())).or_insert(0) += 1;
            }
        }

        for (espaco, item) in &documentos {
            tx.execute(
                "INSERT INTO documento_cache (caminho, nome, tipo, tamanho_bytes, hash_conteudo, pasta, espaco) \
                 VALUES (?1, ?2, 'pdf', ?3, ?4, ?5, ?6)",
                params![item.caminho_relativo, item.nome, item.tamanho_bytes, item.hash_conteudo, item.pasta_id, espaco],
            )?;
            if let Some(pasta) = &item.pasta_id {
                *contagem_pastas.entry(("nota", espaco.clone(), pasta.clone())).or_insert(0) += 1;
            }
        }

        for item in &tarefas {
            let fm = &item.front_matter;
            tx.execute(
                "INSERT INTO tarefa (id, caminho_arquivo, titulo, status, scheduled_at, duration_min, \
                 due_date, prioridade, pasta_id, espaco, evento_provider, evento_event_id, evento_synced_at, criado_em, criado_por, atualizado_em, concluida_em) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, (SELECT id FROM usuario WHERE id = ?15), ?16, ?17)",
                params![
                    fm.id,
                    item.caminho_relativo,
                    fm.titulo,
                    tarefa_status_str(fm.status),
                    fm.scheduled_at.map(|d| d.to_rfc3339()),
                    fm.duration_min,
                    fm.due_date.map(|d| d.to_string()),
                    tarefa_prioridade_str(fm.prioridade),
                    item.pasta_id,
                    fm.espaco.to_string(),
                    fm.evento_externo.provider.map(calendario_provider_str),
                    fm.evento_externo.event_id,
                    fm.evento_externo.synced_at.map(|d| d.to_rfc3339()),
                    fm.criado_em.to_rfc3339(),
                    fm.criado_por,
                    fm.atualizado_em.or(item.modificado_em).unwrap_or(fm.criado_em).to_rfc3339(),
                    // Concluída antes do campo existir: a última edição é a melhor aproximação até a próxima mudança de status.
                    (if fm.status == TarefaStatus::Concluida { fm.concluida_em.or(fm.atualizado_em).or(item.modificado_em) } else { None }).map(|d| d.to_rfc3339()),
                ],
            )?;

            for tag in &fm.tags {
                tx.execute("INSERT OR IGNORE INTO tarefa_tag (tarefa_id, tag) VALUES (?1, ?2)", params![fm.id, tag])?;
            }

            // Tempo alocado/trabalhado: a fonte é o front-matter; a tabela só o espelha (o `DELETE FROM tarefa` acima a esvazia em cascata).
            for t in &fm.tempo {
                tx.execute(
                    "INSERT OR REPLACE INTO tarefa_time_entry (id, tarefa_id, tipo, inicio_em, fim_em, duracao_min, foco, criado_em) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![t.id, fm.id, t.tipo.como_str(), t.inicio_em.to_rfc3339(), (t.inicio_em + chrono::Duration::minutes(t.duracao_min)).to_rfc3339(), t.duracao_min, t.foco, t.criado_em.to_rfc3339()],
                )?;
            }

            tx.execute("INSERT INTO tarefa_fts (id, titulo) VALUES (?1, ?2)", params![fm.id, fm.titulo])?;

            if let Some(pasta) = &item.pasta_id {
                let chave = crate::espacos::fisica(&fm.espaco.to_string(), fm.criado_por.as_deref().unwrap_or(""));
                *contagem_pastas.entry(("tarefa", chave, pasta.clone())).or_insert(0) += 1;
            }
        }

        for (espaco, c) in &categorias {
            tx.execute(
                "INSERT OR REPLACE INTO categoria_evento (id, espaco, nome, cor, icone) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![c.id, espaco, c.nome, c.cor, c.icone],
            )?;
        }

        for item in &eventos {
            let fm = &item.front_matter;
            tx.execute(
                "INSERT OR REPLACE INTO evento (id, caminho_arquivo, titulo, inicio, fim, dia_inteiro, fuso, local, categoria_id, \
                 visibilidade, rrule, espaco, google_calendar_id, google_event_id, google_etag, google_updated, sync_pendente, \
                 criado_em, atualizado_em, criado_por, excecoes, recorrencia_extra, excecoes_pendentes, cor) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24)",
                params![
                    fm.id,
                    item.caminho_relativo,
                    fm.titulo,
                    fm.inicio.to_rfc3339(),
                    fm.fim.to_rfc3339(),
                    fm.dia_inteiro,
                    fm.fuso,
                    fm.local,
                    fm.categoria_id,
                    fm.visibilidade.como_str(),
                    fm.rrule,
                    fm.espaco.to_string(),
                    fm.google.calendar_id,
                    fm.google.event_id,
                    fm.google.etag,
                    fm.google.updated.map(|d| d.to_rfc3339()),
                    fm.sync_pendente,
                    fm.criado_em.to_rfc3339(),
                    fm.atualizado_em.to_rfc3339(),
                    fm.criado_por,
                    excecoes_json(&fm.excecoes),
                    serde_json::to_string(&fm.recorrencia_extra).unwrap_or_else(|_| "[]".into()),
                    fm.excecoes.iter().filter(|x| x.sync_pendente).count() as i64,
                    fm.cor,
                ],
            )?;
            for tarefa_id in fm.tarefas.iter().filter(|t| ids_tarefas.contains(*t)) {
                tx.execute("INSERT OR IGNORE INTO evento_tarefa (evento_id, tarefa_id) VALUES (?1, ?2)", params![fm.id, tarefa_id])?;
            }
            for nota_id in fm.notas.iter().filter(|n| ids_notas.contains(*n)) {
                tx.execute("INSERT OR IGNORE INTO evento_nota (evento_id, nota_id) VALUES (?1, ?2)", params![fm.id, nota_id])?;
            }
        }

        acumular_contagens_pastas(&mut contagem_pastas);
        for ((tipo, espaco, caminho), contagem) in contagem_pastas {
            let nome = caminho.rsplit('/').next().unwrap_or(&caminho).to_string();
            tx.execute(
                "INSERT INTO pasta_cache (caminho, tipo, nome, espaco, contagem_itens) \
                 VALUES (?1, ?2, ?3, ?4, ?5) \
                 ON CONFLICT (tipo, caminho, espaco) DO UPDATE SET contagem_itens = excluded.contagem_itens",
                params![caminho, tipo, nome, espaco, contagem],
            )?;
        }

        tx.commit()
    })
    .await?;

    Ok(ResultadoReindex {
        notas: total_notas,
        tarefas: total_tarefas,
        eventos: total_eventos,
        documentos: total_documentos,
        erros,
        adiados,
    })
}

#[cfg(test)]
mod testes_concluida_em {
    use super::*;

    fn tarefa(id: &str, status: &str, extra: &str) -> String {
        format!("---\nid: {id}\ntitulo: T {id}\nstatus: {status}\nespaco: pessoal\ncriado_em: 2026-09-01T10:00:00Z\n{extra}---\ncorpo\n")
    }

    #[tokio::test]
    async fn indexa_concluida_em_com_fallback_pra_concluidas_antigas_e_null_pra_pendentes() {
        let raiz = std::env::temp_dir().join(format!("ecos-reindex-concluida-{}", ecos_core::new_id()));
        std::fs::create_dir_all(raiz.join("Pessoal").join("Tarefas")).unwrap();
        std::fs::create_dir_all(raiz.join("Pessoal").join("Notas")).unwrap();
        std::fs::write(raiz.join("Pessoal").join(".espaco"), "pessoal").unwrap();
        let escreve = |nome: &str, conteudo: String| std::fs::write(raiz.join("Pessoal").join("Tarefas").join(nome), conteudo).unwrap();
        escreve("a.md", tarefa("a", "concluida", "atualizado_em: 2026-09-19T12:00:00Z\nconcluida_em: 2026-09-19T10:00:00Z\n"));
        escreve("b.md", tarefa("b", "concluida", "atualizado_em: 2026-09-10T08:00:00Z\n"));
        escreve("c.md", tarefa("c", "pendente", "atualizado_em: 2026-09-11T08:00:00Z\nconcluida_em: 2026-09-11T09:00:00Z\n"));

        let db = IndexDb::open(&raiz.join("indice.db")).unwrap();
        reindexar_tudo(&db, &raiz).await.unwrap();

        let linhas: Vec<(String, Option<String>)> = db
            .with(|c| {
                let mut stmt = c.prepare("SELECT id, concluida_em FROM tarefa ORDER BY id")?;
                let l = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<Vec<_>, _>>()?;
                Ok(l)
            })
            .await
            .unwrap();
        let de = |s: &str| Some(chrono::DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&chrono::Utc).to_rfc3339());
        assert_eq!(linhas.len(), 3);
        assert_eq!(linhas[0], ("a".into(), de("2026-09-19T10:00:00Z"))); // valor exato do arquivo
        assert_eq!(linhas[1], ("b".into(), de("2026-09-10T08:00:00Z"))); // concluída antiga: cai pro atualizado_em
        assert_eq!(linhas[2], ("c".into(), None)); // pendente nunca indexa data de conclusão, mesmo com resíduo no arquivo

        let usa_indice: String = db
            .with(|c| c.query_row("EXPLAIN QUERY PLAN SELECT id FROM tarefa WHERE concluida_em >= '2026-09-01'", [], |r| r.get(3)))
            .await
            .unwrap();
        assert!(usa_indice.contains("idx_tarefa_concluida_em"), "plano: {usa_indice}");
        let _ = std::fs::remove_dir_all(&raiz);
    }
}
