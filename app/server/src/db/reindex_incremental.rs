//! Reindexação incremental: reaplica ao índice só os `.md` que uma rota acabou de escrever ou remover, em vez de
//! reconstruir tudo. O resultado precisa ser idêntico ao de `reindexar_tudo` sobre os mesmos arquivos (a suíte
//! `tests/indice_equivalente.rs` compara os dois a cada operação). Os pontos de contato entre itens são:
//!
//! - **pastas**: contagens recursivas em `pasta_cache`, ajustadas por delta na pasta e nos ancestrais;
//! - **links**: um item que muda de título/espaço/atualização altera como OUTROS itens resolvem seus wikilinks. As
//!   referências de cada origem ficam em `ref_item`, então só as origens que citam o título afetado são refeitas
//!   (sem reler corpos).
//!
//! Qualquer coisa fora do previsto (arquivo ilegível, front-matter inválido, evento fora de `Eventos/`, `.md` fora de `Notas/`/`Tarefas/`)
//! cai na reconstrução completa, que continua sendo a fonte da verdade.

use super::reindex::{dentro_de_anexos, gravar_nota, gravar_tarefa, hex, pasta_relativa, refs_do_corpo, reindexar_tudo, NotaColetada, TarefaColetada};
use super::IndexDb;
use chrono::{DateTime, Utc};
use ecos_core::types::{NotaFrontMatter, TarefaFrontMatter, TarefaStatus};
use ecos_core::wikilink::{self, Candidato, Referencia, TipoItem};
use ecos_core::classificar::TipoArquivo;
use ecos_core::frontmatter;
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use std::collections::{BTreeSet, HashSet};
use std::path::Path;

/// Mudança em disco, com o caminho relativo à raiz das notas (`Espaço/Pasta/x.md`, separador `/`).
#[derive(Debug, Clone)]
pub enum Mudanca {
    /// O arquivo existe e foi criado/alterado (inclui o destino de uma renomeação ou movimentação).
    Escrito(String),
    /// O arquivo deixou de existir naquele caminho (excluído, movido para a lixeira ou renomeado).
    Removido(String),
}

enum Item {
    Nota(NotaColetada, String),
    Tarefa(TarefaColetada, String),
}

#[derive(Default)]
struct Efeitos {
    /// (tipo, espaço, título normalizado) cujo conjunto de candidatos mudou.
    titulos: BTreeSet<(String, String)>,
    /// Origens a refazer incondicionalmente (os próprios itens alterados).
    refazer: BTreeSet<(&'static str, String)>,
    /// (tipo de árvore, espaço, pasta, delta)
    pastas: Vec<(&'static str, String, String, i64)>,
}

/// Diretório do espaço de um caminho `Espaço/Pasta/x.md`. Nada interno (`.ecos_app/`, ocultos, `_anexos/`) é item.
fn partes(rel: &str) -> Option<&str> {
    let mut it = rel.split('/');
    let dir = it.next()?;
    let resto: Vec<&str> = it.collect();
    if resto.is_empty() || resto.iter().any(|p| crate::espacos::nome_interno(p)) {
        return None;
    }
    Some(dir)
}

fn ler_item(notes_root: &Path, rel: &str, espacos: &[(String, std::path::PathBuf)]) -> Result<Option<Item>, ()> {
    let Some(dir_nome) = partes(rel) else { return Ok(None) };
    let abs = notes_root.join(rel);
    if abs.extension().and_then(|e| e.to_str()) != Some("md") || dentro_de_anexos(Path::new(rel)) {
        return Ok(None);
    }
    let Some((espaco, dir)) = espacos.iter().find(|(_, d)| d.file_name().is_some_and(|n| n == dir_nome)) else { return Err(()) };
    let valor = crate::espacos::logica(espaco).parse::<ecos_core::types::Espaco>().map_err(|_| ())?;
    let dono = crate::espacos::dono(espaco).map(str::to_string);
    let raw = std::fs::read_to_string(&abs).map_err(|_| ())?;
    // Árvore única: a pasta é relativa à raiz do espaço e o tipo vem só do conteúdo (como no reindex completo);
    // evento fora de `.ecos_app/Eventos/` fica com a reconstrução.
    let pasta_id = pasta_relativa(dir, &abs);
    let tipo = ecos_core::classificar::classificar_com_padrao(&raw, TipoArquivo::Nota);
    if tipo == TipoArquivo::Evento {
        return Err(());
    }
    if tipo == TipoArquivo::Nota {
        let doc = frontmatter::parse::<NotaFrontMatter>(&raw).map_err(|_| ())?;
        let mut fm = doc.front_matter;
        fm.espaco = valor;
        if dono.is_some() {
            fm.criado_por = dono;
        }
        let chave = crate::espacos::fisica(&fm.espaco.to_string(), fm.criado_por.as_deref().unwrap_or(""));
        Ok(Some(Item::Nota(NotaColetada { front_matter: fm, body: doc.body, caminho_relativo: rel.to_string(), pasta_id, hash_conteudo: hex(&Sha256::digest(raw.as_bytes())) }, chave)))
    } else {
        let doc = frontmatter::parse::<TarefaFrontMatter>(&raw).map_err(|_| ())?;
        let mut fm = doc.front_matter;
        fm.espaco = valor;
        if dono.is_some() {
            fm.criado_por = dono;
        }
        let chave = crate::espacos::fisica(&fm.espaco.to_string(), fm.criado_por.as_deref().unwrap_or(""));
        let modificado_em = std::fs::metadata(&abs).ok().and_then(|m| m.modified().ok()).map(DateTime::<Utc>::from);
        Ok(Some(Item::Tarefa(TarefaColetada { front_matter: fm, caminho_relativo: rel.to_string(), pasta_id, modificado_em, body: doc.body }, chave)))
    }
}

/// Estado do item no índice antes da mudança.
struct Anterior {
    chave: String,
    titulo_norm: String,
    pasta: Option<String>,
    conta_na_pasta: bool,
}

fn chave_do_banco(espaco: &str, criado_por: Option<&str>) -> String {
    crate::espacos::fisica(espaco, criado_por.unwrap_or(""))
}

fn anterior(conn: &Connection, tipo: &str, id: &str) -> rusqlite::Result<Option<Anterior>> {
    let sql = if tipo == "nota" { "SELECT espaco, criado_por, titulo, pasta_id, 1 FROM nota WHERE id = ?1" } else { "SELECT espaco, criado_por, titulo, pasta_id, status = 'pendente' FROM tarefa WHERE id = ?1" };
    conn.query_row(sql, [id], |r| {
        let espaco: String = r.get(0)?;
        let criado_por: Option<String> = r.get(1)?;
        let titulo: String = r.get(2)?;
        Ok(Anterior { chave: chave_do_banco(&espaco, criado_por.as_deref()), titulo_norm: wikilink::normalizar_titulo(&titulo), pasta: r.get(3)?, conta_na_pasta: r.get::<_, i64>(4)? != 0 })
    })
    .optional()
}

fn registrar_saida(ef: &mut Efeitos, tipo: &'static str, a: &Anterior) {
    ef.titulos.insert((a.chave.clone(), a.titulo_norm.clone()));
    if let (true, Some(p)) = (a.conta_na_pasta, &a.pasta) {
        ef.pastas.push((if tipo == "nota" { "nota" } else { "tarefa" }, a.chave.clone(), p.clone(), -1));
    }
}

fn remover(conn: &Connection, ef: &mut Efeitos, tipo: &'static str, id: &str) -> rusqlite::Result<()> {
    if let Some(a) = anterior(conn, tipo, id)? {
        registrar_saida(ef, tipo, &a);
    }
    conn.execute("DELETE FROM link_item WHERE (origem_tipo = ?1 AND origem_id = ?2) OR (destino_tipo = ?1 AND destino_id = ?2)", params![tipo, id])?;
    conn.execute("DELETE FROM link_pendente WHERE origem_tipo = ?1 AND origem_id = ?2", params![tipo, id])?;
    conn.execute("DELETE FROM ref_item WHERE origem_tipo = ?1 AND origem_id = ?2", params![tipo, id])?;
    if tipo == "nota" {
        conn.execute("DELETE FROM links_nota WHERE nota_id_origem = ?1 OR nota_id_destino = ?1", [id])?;
        conn.execute("DELETE FROM evento_nota WHERE nota_id = ?1", [id])?;
        conn.execute("DELETE FROM nota_tag WHERE nota_id = ?1", [id])?;
        conn.execute("DELETE FROM nota_fts WHERE id = ?1", [id])?;
        conn.execute("DELETE FROM nota WHERE id = ?1", [id])?;
    } else {
        conn.execute("DELETE FROM evento_tarefa WHERE tarefa_id = ?1", [id])?;
        conn.execute("DELETE FROM tarefa_tag WHERE tarefa_id = ?1", [id])?;
        conn.execute("DELETE FROM tarefa_time_entry WHERE tarefa_id = ?1", [id])?;
        conn.execute("DELETE FROM tarefa_fts WHERE id = ?1", [id])?;
        conn.execute("DELETE FROM tarefa WHERE id = ?1", [id])?;
    }
    ef.refazer.remove(&(tipo, id.to_string()));
    Ok(())
}

fn aplicar(conn: &Connection, ef: &mut Efeitos, item: &Item) -> rusqlite::Result<()> {
    let (tipo, id, chave, titulo, pasta, conta, corpo): (&'static str, &str, &str, &str, &Option<String>, bool, &str) = match item {
        Item::Nota(n, c) => ("nota", &n.front_matter.id, c, &n.front_matter.titulo, &n.pasta_id, true, &n.body),
        Item::Tarefa(t, c) => ("tarefa", &t.front_matter.id, c, &t.front_matter.titulo, &t.pasta_id, t.front_matter.status == TarefaStatus::Pendente, &t.body),
    };
    // O mesmo arquivo (ou o mesmo id) pode ter trocado de tipo: a linha da outra tabela sai antes.
    let outro = if tipo == "nota" { "tarefa" } else { "nota" };
    let caminho = match item { Item::Nota(n, _) => &n.caminho_relativo, Item::Tarefa(t, _) => &t.caminho_relativo };
    let ids_outro: Vec<String> = {
        let mut stmt = conn.prepare_cached(&format!("SELECT id FROM {outro} WHERE caminho_arquivo = ?1 OR id = ?2"))?;
        let v = stmt.query_map(params![caminho, id], |r| r.get(0))?.collect::<Result<_, _>>()?;
        v
    };
    for velho in ids_outro {
        remover(conn, ef, outro, &velho)?;
    }
    let antes = anterior(conn, tipo, id)?;
    if let Some(a) = &antes {
        registrar_saida(ef, tipo, a);
    }
    match item {
        Item::Nota(n, _) => {
            // O texto do OCR só existe no índice: sobrevive à regravação.
            let ocr: Option<String> = conn.query_row("SELECT ocr_texto_busca FROM nota WHERE id = ?1", [id], |r| r.get(0)).optional()?.flatten();
            gravar_nota(conn, n, antes.is_some(), ocr.as_deref())?;
        }
        Item::Tarefa(t, _) => gravar_tarefa(conn, t, antes.is_some())?,
    }
    ef.titulos.insert((chave.to_string(), wikilink::normalizar_titulo(titulo)));
    if let (true, Some(p)) = (conta, pasta) {
        ef.pastas.push((tipo, chave.to_string(), p.clone(), 1));
    } else if let Some(p) = pasta {
        ef.pastas.push((tipo, chave.to_string(), p.clone(), 0));
    }
    conn.execute("DELETE FROM ref_item WHERE origem_tipo = ?1 AND origem_id = ?2", params![tipo, id])?;
    for (rt, rn, rb) in refs_do_corpo(corpo) {
        conn.execute("INSERT OR IGNORE INTO ref_item (origem_tipo, origem_id, espaco_chave, ref_tipo, titulo_norm, titulo_bruto) VALUES (?1, ?2, ?3, ?4, ?5, ?6)", params![tipo, id, chave, rt, rn, rb])?;
    }
    ef.refazer.insert((tipo, id.to_string()));
    Ok(())
}

fn candidatos(conn: &Connection, chave: &str) -> rusqlite::Result<Vec<Candidato>> {
    let mut out = Vec::new();
    for (tabela, tipo) in [("nota", TipoItem::Nota), ("tarefa", TipoItem::Tarefa)] {
        let (sql, param): (String, Option<String>) = match crate::espacos::dono(chave) {
            Some(dono) => (format!("SELECT id, titulo, atualizado_em FROM {tabela} WHERE espaco = 'pessoal' AND criado_por IS ?1"), Some(dono.to_string()).filter(|d| !d.is_empty())),
            None => (format!("SELECT id, titulo, atualizado_em FROM {tabela} WHERE espaco = ?1"), Some(chave.to_string())),
        };
        let mut stmt = conn.prepare_cached(&sql)?;
        let linhas = stmt.query_map([param], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))?;
        for l in linhas {
            let (id, titulo, atualizado_em) = l?;
            out.push(Candidato { tipo, id, titulo, espaco: chave.to_string(), atualizado_em });
        }
    }
    Ok(out)
}

fn refazer_links(conn: &Connection, ef: &Efeitos) -> rusqlite::Result<()> {
    // Origens: os próprios itens + quem cita um dos títulos afetados no mesmo espaço.
    let mut origens: BTreeSet<(String, String)> = ef.refazer.iter().map(|(t, i)| (t.to_string(), i.clone())).collect();
    for (chave, titulo) in &ef.titulos {
        let mut stmt = conn.prepare_cached("SELECT origem_tipo, origem_id FROM ref_item WHERE espaco_chave = ?1 AND titulo_norm = ?2")?;
        for l in stmt.query_map(params![chave, titulo], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
            origens.insert(l?);
        }
    }
    let mut cache: std::collections::HashMap<String, Vec<Candidato>> = std::collections::HashMap::new();
    for (tipo, id) in origens {
        let refs: Vec<(String, String, String, String)> = {
            let mut stmt = conn.prepare_cached("SELECT espaco_chave, ref_tipo, titulo_norm, titulo_bruto FROM ref_item WHERE origem_tipo = ?1 AND origem_id = ?2")?;
            let v = stmt.query_map(params![tipo, id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?.collect::<Result<_, _>>()?;
            v
        };
        conn.execute("DELETE FROM link_item WHERE origem_tipo = ?1 AND origem_id = ?2", params![tipo, id])?;
        conn.execute("DELETE FROM link_pendente WHERE origem_tipo = ?1 AND origem_id = ?2", params![tipo, id])?;
        if tipo == "nota" {
            conn.execute("DELETE FROM links_nota WHERE nota_id_origem = ?1", [&id])?;
        }
        let Some(chave) = refs.first().map(|r| r.0.clone()) else { continue };
        if !cache.contains_key(&chave) {
            cache.insert(chave.clone(), candidatos(conn, &chave)?);
        }
        let cands = &cache[&chave];
        let tipo_origem = if tipo == "nota" { TipoItem::Nota } else { TipoItem::Tarefa };
        for (_, rt, rn, rb) in &refs {
            let ref_tipo = match rt.as_str() {
                "nota" => Some(TipoItem::Nota),
                "tarefa" => Some(TipoItem::Tarefa),
                _ => None,
            };
            let r = Referencia { tipo: ref_tipo, titulo: rn.clone() };
            match wikilink::resolver(&r, Some(&chave), None, Some((tipo_origem, id.as_str())), cands) {
                Some(d) => {
                    conn.execute("INSERT OR IGNORE INTO link_item (origem_tipo, origem_id, destino_tipo, destino_id) VALUES (?1, ?2, ?3, ?4)", params![tipo, id, d.tipo.como_str(), d.id])?;
                    if tipo == "nota" && d.tipo == TipoItem::Nota {
                        conn.execute("INSERT OR IGNORE INTO links_nota (nota_id_origem, nota_id_destino) VALUES (?1, ?2)", params![id, d.id])?;
                    }
                }
                None if cands.iter().any(|c| c.id == id && wikilink::normalizar_titulo(&c.titulo) == *rn) => {}
                None if ref_tipo != Some(TipoItem::Tarefa) => {
                    conn.execute("INSERT OR IGNORE INTO link_pendente (origem_tipo, origem_id, titulo_alvo) VALUES (?1, ?2, ?3)", params![tipo, id, rb])?;
                }
                None => {}
            }
        }
    }
    Ok(())
}

fn ajustar_pastas(conn: &Connection, ef: &Efeitos) -> rusqlite::Result<()> {
    for (tipo, chave, pasta, delta) in &ef.pastas {
        let mut atual = pasta.as_str();
        loop {
            let nome = atual.rsplit('/').next().unwrap_or(atual);
            conn.execute("INSERT OR IGNORE INTO pasta_cache (caminho, nome, espaco) VALUES (?1, ?2, ?3)", params![atual, nome, chave])?;
            if *delta != 0 {
                let coluna = if *tipo == "tarefa" { "contagem_tarefas" } else { "contagem_notas" };
                conn.execute(&format!("UPDATE pasta_cache SET {coluna} = {coluna} + ?1 WHERE caminho = ?2 AND espaco = ?3"), params![delta, atual, chave])?;
            }
            match atual.rsplit_once('/') {
                Some((pai, _)) => atual = pai,
                None => break,
            }
        }
    }
    Ok(())
}

/// Aplica ao índice as mudanças em disco. Cai na reconstrução completa quando algo foge do caso previsto.
pub async fn reindexar_itens(db: &IndexDb, notes_root: &Path, mudancas: &[Mudanca]) -> anyhow::Result<()> {
    let inicio = std::time::Instant::now();
    let raiz = notes_root.to_path_buf();
    let lista = mudancas.to_vec();
    let lidos = tokio::task::spawn_blocking(move || -> Result<(Vec<Item>, Vec<String>), ()> {
        let espacos = crate::espacos::listar(&raiz);
        let mut itens = Vec::new();
        let mut removidos = Vec::new();
        for m in &lista {
            match m {
                Mudanca::Escrito(rel) => {
                    if let Some(i) = ler_item(&raiz, rel, &espacos)? {
                        itens.push(i);
                    }
                }
                Mudanca::Removido(rel) => removidos.push(rel.clone()),
            }
        }
        Ok((itens, removidos))
    })
    .await?;
    let Ok((itens, removidos)) = lidos else {
        tracing::warn!("reindexação incremental não aplicável; reconstruindo o índice inteiro");
        reindexar_tudo(db, notes_root).await?;
        return Ok(());
    };

    db.digest_invalidar();
    db.with(move |conn| {
        let tx = conn.unchecked_transaction()?;
        let mut ef = Efeitos::default();
        let escritos: HashSet<String> = itens.iter().map(|i| match i { Item::Nota(n, _) => n.caminho_relativo.clone(), Item::Tarefa(t, _) => t.caminho_relativo.clone() }).collect();
        for item in &itens {
            aplicar(&tx, &mut ef, item)?;
        }
        for rel in removidos.iter().filter(|r| !escritos.contains(*r)) {
            // Só remove se o caminho ainda é de algum item (uma renomeação já moveu a linha para o caminho novo).
            for (tabela, tipo) in [("nota", "nota"), ("tarefa", "tarefa")] {
                let id: Option<String> = tx.query_row(&format!("SELECT id FROM {tabela} WHERE caminho_arquivo = ?1"), [rel], |r| r.get(0)).optional()?;
                if let Some(id) = id {
                    remover(&tx, &mut ef, tipo, &id)?;
                }
            }
        }
        refazer_links(&tx, &ef)?;
        ajustar_pastas(&tx, &ef)?;
        tx.commit()
    })
    .await?;

    for m in mudancas {
        db.registrar_escrita_propria(notes_root, match m { Mudanca::Escrito(r) | Mudanca::Removido(r) => r });
    }
    crate::observabilidade::registrar_reindex("incremental", inicio.elapsed());
    Ok(())
}

/// Caminho relativo à raiz das notas, com `/`, como `Mudanca` espera.
pub fn relativo(notes_root: &Path, absoluto: &Path) -> String {
    absoluto.strip_prefix(notes_root).unwrap_or(absoluto).to_string_lossy().replace('\\', "/")
}
