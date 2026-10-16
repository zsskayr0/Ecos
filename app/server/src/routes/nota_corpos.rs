//! Leitura de título e corpo de notas no índice FTS por lote de ids.
//!
//! `nota_fts.id` é `UNINDEXED`: `JOIN nota_fts ON nf.id = n.id` varre o FTS inteiro a cada linha (custo
//! quadrático). Aqui o FTS é varrido UMA vez por lote, filtrando por um conjunto de ids em memória.

use std::collections::{HashMap, HashSet};

/// `id -> corpo` das notas pedidas (ids sem linha no FTS não aparecem no mapa).
pub fn ler<'a>(conn: &rusqlite::Connection, ids: impl Iterator<Item = &'a str>) -> rusqlite::Result<HashMap<String, String>> {
    Ok(ler_titulo_corpo(conn, ids)?.into_iter().map(|(id, (_, corpo))| (id, corpo)).collect())
}

/// `id -> (titulo, corpo)` das notas pedidas.
pub fn ler_titulo_corpo<'a>(conn: &rusqlite::Connection, ids: impl Iterator<Item = &'a str>) -> rusqlite::Result<HashMap<String, (String, String)>> {
    let alvo: HashSet<&str> = ids.collect();
    let mut mapa = HashMap::with_capacity(alvo.len());
    if alvo.is_empty() {
        return Ok(mapa);
    }
    let mut stmt = conn.prepare_cached("SELECT id, titulo, corpo FROM nota_fts")?;
    let mut linhas = stmt.query([])?;
    while let Some(r) = linhas.next()? {
        let id: String = r.get(0)?;
        if alvo.contains(id.as_str()) {
            mapa.insert(id, (r.get::<_, String>(1)?, r.get::<_, String>(2)?));
            if mapa.len() == alvo.len() {
                break;
            }
        }
    }
    Ok(mapa)
}
