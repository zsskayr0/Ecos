//! Reindexação completa: varre `Notas/`/`Tarefas/` e repovoa o índice local
//! do zero. Prova em código a regra da seção 1.1 — o índice é cache
//! reconstruível, nunca fonte de verdade: apagar `ecos-index.db` e rodar
//! isto de novo devolve o mesmo estado observável (menos contadores de
//! interação, que só existem no próprio índice).

use super::IndexDb;
use ecos_core::types::{CalendarioProvider, NotaFrontMatter, NotaModo, TarefaFrontMatter, TarefaPrioridade, TarefaStatus};
use ecos_core::{frontmatter, wikilink};
use rusqlite::params;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::Path;
use walkdir::WalkDir;

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
    pub documentos: usize,
    pub erros: Vec<String>,
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
}

struct DocumentoColetado {
    caminho_relativo: String,
    nome: String,
    tamanho_bytes: i64,
    hash_conteudo: String,
    pasta_id: Option<String>,
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

fn coletar_notas(vault_root: &Path, notas_dir: &Path, erros: &mut Vec<String>) -> Vec<NotaColetada> {
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
                front_matter: doc.front_matter,
            }),
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
    let notas_dir = notes_root.join("Notas");
    let tarefas_dir = notes_root.join("Tarefas");

    let mut erros = Vec::new();
    let notas = coletar_notas(&notes_root, &notas_dir, &mut erros);
    let tarefas = coletar_tarefas(&notes_root, &tarefas_dir, &mut erros);
    let documentos = coletar_documentos(&notes_root, &notas_dir, &mut erros);
    let pastas_notas = enumerar_pastas(&notas_dir);
    let pastas_tarefas = enumerar_pastas(&tarefas_dir);

    let titulo_para_id: HashMap<String, String> = notas
        .iter()
        .map(|n| (n.front_matter.titulo.clone(), n.front_matter.id.clone()))
        .collect();

    let total_notas = notas.len();
    let total_tarefas = tarefas.len();
    let total_documentos = documentos.len();

    db.with(move |conn| {
        let tx = conn.unchecked_transaction()?;
        tx.execute("DELETE FROM links_nota", [])?;
        tx.execute("DELETE FROM nota_tag", [])?;
        tx.execute("DELETE FROM nota", [])?;
        tx.execute("DELETE FROM tarefa_tag", [])?;
        tx.execute("DELETE FROM tarefa", [])?;
        tx.execute("DELETE FROM documento_cache", [])?;
        tx.execute("DELETE FROM pasta_cache", [])?;
        tx.execute("DELETE FROM nota_fts", [])?;
        tx.execute("DELETE FROM tarefa_fts", [])?;

        // (tipo, caminho) -> contagem de itens diretos.
        let mut contagem_pastas: HashMap<(&'static str, String), i64> = HashMap::new();
        for pasta in &pastas_notas {
            contagem_pastas.entry(("nota", pasta.clone())).or_insert(0);
        }
        for pasta in &pastas_tarefas {
            contagem_pastas.entry(("tarefa", pasta.clone())).or_insert(0);
        }

        for item in &notas {
            let fm = &item.front_matter;
            tx.execute(
                "INSERT INTO nota (id, caminho_arquivo, titulo, modo, pasta_id, espaco, criado_em, \
                 atualizado_em, ultima_revisao_em, hash_conteudo, contagem_acessos_7d, ocr_texto_busca, criado_por) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0, NULL, ?11)",
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
                *contagem_pastas.entry(("nota", pasta.clone())).or_insert(0) += 1;
            }
        }

        for item in &documentos {
            tx.execute(
                "INSERT INTO documento_cache (caminho, nome, tipo, tamanho_bytes, hash_conteudo, pasta, espaco) \
                 VALUES (?1, ?2, 'pdf', ?3, ?4, ?5, 'pessoal')",
                params![item.caminho_relativo, item.nome, item.tamanho_bytes, item.hash_conteudo, item.pasta_id],
            )?;
            if let Some(pasta) = &item.pasta_id {
                *contagem_pastas.entry(("nota", pasta.clone())).or_insert(0) += 1;
            }
        }

        for item in &tarefas {
            let fm = &item.front_matter;
            tx.execute(
                "INSERT INTO tarefa (id, caminho_arquivo, titulo, status, scheduled_at, duration_min, \
                 due_date, prioridade, pasta_id, espaco, evento_provider, evento_event_id, evento_synced_at, criado_em, criado_por) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
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
                ],
            )?;

            for tag in &fm.tags {
                tx.execute("INSERT OR IGNORE INTO tarefa_tag (tarefa_id, tag) VALUES (?1, ?2)", params![fm.id, tag])?;
            }

            tx.execute("INSERT INTO tarefa_fts (id, titulo) VALUES (?1, ?2)", params![fm.id, fm.titulo])?;

            if let Some(pasta) = &item.pasta_id {
                *contagem_pastas.entry(("tarefa", pasta.clone())).or_insert(0) += 1;
            }
        }

        for ((tipo, caminho), contagem) in contagem_pastas {
            let nome = caminho.rsplit('/').next().unwrap_or(&caminho).to_string();
            // `espaco` de uma pasta é aproximado como 'pessoal' — o dono real
            // de cada arquivo continua vindo da linha de nota/tarefa/documento;
            // isto só afeta o filtro de navegação (seção 11.5).
            tx.execute(
                "INSERT INTO pasta_cache (caminho, tipo, nome, espaco, contagem_itens) \
                 VALUES (?1, ?2, ?3, 'pessoal', ?4) \
                 ON CONFLICT (tipo, caminho) DO UPDATE SET contagem_itens = excluded.contagem_itens",
                params![caminho, tipo, nome, contagem],
            )?;
        }

        tx.commit()
    })
    .await?;

    Ok(ResultadoReindex {
        notas: total_notas,
        tarefas: total_tarefas,
        documentos: total_documentos,
        erros,
    })
}
