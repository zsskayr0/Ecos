//! `GET /busca` (seção 11.8) — full-text via FTS5, resultado agrupado por
//! tipo.
//!
//! O texto digitado nunca vai cru para o `MATCH`: [`montar_match`] quebra em
//! palavras, põe cada uma entre aspas (operadores e pontuação viram texto) e
//! só o último termo ganha `*` (prefixo). Frase entre aspas continua frase.
//! Se o FTS5 ainda assim recusar a expressão, a resposta é lista vazia.
//!
//! Quando a busca normal traz poucos resultados entra o fallback
//! [`aproximados`]: trecho do meio da palavra (`quux` acha `zzquux`) e um erro
//! simples de digitação (distância de edição 1, ex.: `zzquuxx` → `zzquux`).
//! Ele varre o texto já indexado em memória, então não precisa de tabela nova
//! nem de migração/reindexação.

use std::collections::{HashMap, HashSet};

use axum::extract::{Query, State};
use axum::{Extension, Json};
use rusqlite::Connection;
use serde::Deserialize;

use crate::error::AppResult;
use crate::middleware::auth_guard::UsuarioAutenticado;
use crate::state::AppState;

const LIMITE: usize = 30;
/// Abaixo disso a busca exata é completada pelo fallback aproximado.
const POUCOS: usize = 5;

#[derive(Debug, Deserialize)]
pub struct BuscaQuery {
    pub q: String,
    /// `nota` | `tarefa` — ausente = os dois.
    pub tipo: Option<String>,
    pub espaco: Option<String>,
}

pub async fn buscar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Query(q): Query<BuscaQuery>) -> AppResult<Json<serde_json::Value>> {
    let visivel_nota = crate::espacos::visivel_item_sql("n", &usuario.0);
    let visivel_tarefa = crate::espacos::visivel_item_sql("t", &usuario.0);
    let incluir_notas = q.tipo.as_deref().map(|t| t == "nota").unwrap_or(true);
    let incluir_tarefas = q.tipo.as_deref().map(|t| t == "tarefa").unwrap_or(true);
    let resultado = state
        .db
        .with_read(move |conn| {
            Ok(buscar_conn(conn, &q.q, q.espaco.as_deref(), incluir_notas, incluir_tarefas, &visivel_nota, &visivel_tarefa))
        })
        .await?;
    Ok(Json(resultado))
}

/// Núcleo da busca, síncrono e sem estado (testável com banco em memória).
/// Nunca devolve erro: falha do FTS5 vira lista vazia.
pub(crate) fn buscar_conn(conn: &Connection, q: &str, espaco: Option<&str>, notas: bool, tarefas: bool, visivel_nota: &str, visivel_tarefa: &str) -> serde_json::Value {
    let expr = montar_match(q);
    let palavras = palavras_aproximadas(q);
    let notas = if notas {
        let mut v = expr.as_deref().map(|e| notas_fts(conn, e, espaco, visivel_nota).unwrap_or_default()).unwrap_or_default();
        if v.len() < POUCOS && !palavras.is_empty() {
            completar(&mut v, notas_aproximadas(conn, &palavras, espaco, visivel_nota).unwrap_or_default());
        }
        v
    } else {
        Vec::new()
    };
    let tarefas = if tarefas {
        let mut v = expr.as_deref().map(|e| tarefas_fts(conn, e, espaco, visivel_tarefa).unwrap_or_default()).unwrap_or_default();
        if v.len() < POUCOS && !palavras.is_empty() {
            completar(&mut v, tarefas_aproximadas(conn, &palavras, espaco, visivel_tarefa).unwrap_or_default());
        }
        v
    } else {
        Vec::new()
    };
    serde_json::json!({ "notas": notas, "tarefas": tarefas })
}

fn completar(v: &mut Vec<serde_json::Value>, extras: Vec<serde_json::Value>) {
    let vistos: HashSet<String> = v.iter().filter_map(|x| x["id"].as_str().map(str::to_string)).collect();
    for e in extras {
        if v.len() >= LIMITE {
            break;
        }
        if e["id"].as_str().map(|id| !vistos.contains(id)).unwrap_or(false) {
            v.push(e);
        }
    }
}

/// Converte o texto digitado numa expressão FTS5 segura. `None` = nada
/// pesquisável (vazio, só espaços ou só pontuação).
pub(crate) fn montar_match(q: &str) -> Option<String> {
    // (texto, é_frase)
    let mut termos: Vec<(String, bool)> = Vec::new();
    let mut resto = q;
    while let Some(ini) = resto.find('"') {
        termos.extend(resto[..ini].split_whitespace().map(|p| (p.to_string(), false)));
        let depois = &resto[ini + 1..];
        match depois.find('"') {
            Some(fim) => {
                termos.push((depois[..fim].to_string(), true));
                resto = &depois[fim + 1..];
            }
            None => {
                // Aspa sem par: o resto é palavra solta.
                resto = depois;
                break;
            }
        }
    }
    termos.extend(resto.split_whitespace().map(|p| (p.to_string(), false)));
    // Termo sem letra/dígito vira frase vazia, que o FTS5 trata mal: descarta.
    termos.retain(|(t, _)| t.chars().any(char::is_alphanumeric));
    if termos.is_empty() {
        return None;
    }
    let n = termos.len();
    let partes: Vec<String> = termos
        .iter()
        .enumerate()
        .map(|(i, (t, frase))| {
            let s = format!("\"{}\"", t.replace('"', "\"\""));
            if i + 1 == n && !frase { format!("{s}*") } else { s }
        })
        .collect();
    Some(partes.join(" AND "))
}

fn notas_fts(conn: &Connection, expr: &str, espaco: Option<&str>, visivel: &str) -> rusqlite::Result<Vec<serde_json::Value>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT n.id, n.titulo, n.espaco, snippet(nota_fts, 2, '[', ']', '…', 12) \
         FROM nota_fts JOIN nota n ON n.id = nota_fts.id \
         WHERE nota_fts MATCH ?1 AND (?2 IS NULL OR n.espaco = ?2) AND {visivel} \
         ORDER BY rank LIMIT {LIMITE}",
    ))?;
    let linhas = stmt
        .query_map(rusqlite::params![expr, espaco], |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, String>(0)?, "titulo": r.get::<_, String>(1)?,
                "espaco": r.get::<_, String>(2)?, "trecho": r.get::<_, String>(3)?,
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(linhas)
}

fn tarefas_fts(conn: &Connection, expr: &str, espaco: Option<&str>, visivel: &str) -> rusqlite::Result<Vec<serde_json::Value>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT t.id, t.titulo, t.espaco, t.status, t.prioridade FROM tarefa_fts \
         JOIN tarefa t ON t.id = tarefa_fts.id \
         WHERE tarefa_fts MATCH ?1 AND (?2 IS NULL OR t.espaco = ?2) AND {visivel} \
         ORDER BY rank LIMIT {LIMITE}",
    ))?;
    let linhas = stmt
        .query_map(rusqlite::params![expr, espaco], |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, String>(0)?, "titulo": r.get::<_, String>(1)?,
                "espaco": r.get::<_, String>(2)?, "status": r.get::<_, String>(3)?, "prioridade": r.get::<_, String>(4)?,
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(linhas)
}

// ---------- fallback aproximado ----------

/// Minúsculas e sem acento (cobre o português e o Latin-1 comum).
fn dobrar(s: &str) -> String {
    s.chars()
        .flat_map(|c| c.to_lowercase())
        .map(|c| match c {
            'á' | 'à' | 'â' | 'ã' | 'ä' | 'å' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            'ñ' => 'n',
            'ý' | 'ÿ' => 'y',
            c => c,
        })
        .collect()
}

fn palavras_de(s: &str) -> Vec<String> {
    dobrar(s).split(|c: char| !c.is_alphanumeric()).filter(|p| !p.is_empty()).map(str::to_string).collect()
}

/// Palavras da busca que valem para o fallback (3+ letras; o resto é ruído).
fn palavras_aproximadas(q: &str) -> Vec<String> {
    palavras_de(q).into_iter().filter(|p| p.chars().count() >= 3).collect()
}

/// Distância de edição ≤ 1 (inserção, remoção, troca ou transposição vizinha).
fn quase_igual(a: &[char], b: &[char]) -> bool {
    let (la, lb) = (a.len(), b.len());
    if la.abs_diff(lb) > 1 {
        return false;
    }
    let ini = a.iter().zip(b).take_while(|(x, y)| x == y).count();
    if ini == la && ini == lb {
        return true;
    }
    let (ra, rb) = (&a[ini..], &b[ini..]);
    if la == lb {
        ra[1..] == rb[1..] || (ra.len() >= 2 && ra[0] == rb[1] && ra[1] == rb[0] && ra[2..] == rb[2..])
    } else if la > lb {
        ra[1..] == *rb
    } else {
        *ra == rb[1..]
    }
}

/// A palavra da busca casa com alguma palavra do texto: trecho dela, ou (com
/// 4+ letras) um erro de digitação na palavra inteira ou no seu começo.
fn casa(busca: &str, texto: &[String]) -> bool {
    let b: Vec<char> = busca.chars().collect();
    texto.iter().any(|t| {
        if t.contains(busca) {
            return true;
        }
        if b.len() < 4 {
            return false;
        }
        let tc: Vec<char> = t.chars().collect();
        quase_igual(&b, &tc) || (tc.len() > b.len() && (quase_igual(&b, &tc[..b.len()]) || quase_igual(&b, &tc[..b.len() + 1])))
    })
}

fn todas_casam(palavras: &[String], texto: &[String]) -> bool {
    palavras.iter().all(|p| casa(p, texto))
}

fn trecho(corpo: &str, palavras: &[String]) -> String {
    let chars: Vec<char> = corpo.chars().collect();
    let dobrado: Vec<char> = dobrar(corpo).chars().collect();
    // `dobrar` preserva a contagem de caracteres, exceto minúsculas que se expandem (raro); se divergir, começa do início.
    let pos = if dobrado.len() == chars.len() {
        let d: String = dobrado.iter().collect();
        palavras.iter().filter_map(|p| d.find(p.as_str()).map(|b| d[..b].chars().count())).min().unwrap_or(0)
    } else {
        0
    };
    let ini = pos.saturating_sub(40);
    let fim = (pos + 80).min(chars.len());
    let mut s: String = chars[ini..fim].iter().collect::<String>().split_whitespace().collect::<Vec<_>>().join(" ");
    if ini > 0 {
        s.insert(0, '…');
    }
    if fim < chars.len() {
        s.push('…');
    }
    s
}

fn notas_aproximadas(conn: &Connection, palavras: &[String], espaco: Option<&str>, visivel: &str) -> rusqlite::Result<Vec<serde_json::Value>> {
    // `nota_fts.id` é UNINDEXED: lê o índice de texto uma vez em vez de juntar por linha.
    let mut corpos: HashMap<String, (String, String)> = HashMap::new();
    {
        let mut stmt = conn.prepare("SELECT id, titulo, corpo, ocr_texto_busca FROM nota_fts")?;
        let mut rows = stmt.query([])?;
        while let Some(r) = rows.next()? {
            let id: String = r.get(0)?;
            let titulo: String = r.get::<_, Option<String>>(1)?.unwrap_or_default();
            let corpo: String = r.get::<_, Option<String>>(2)?.unwrap_or_default();
            let ocr: String = r.get::<_, Option<String>>(3)?.unwrap_or_default();
            let mut palavras_txt = palavras_de(&titulo);
            palavras_txt.extend(palavras_de(&corpo));
            palavras_txt.extend(palavras_de(&ocr));
            if todas_casam(palavras, &palavras_txt) {
                corpos.insert(id, (titulo, corpo));
            }
        }
    }
    if corpos.is_empty() {
        return Ok(Vec::new());
    }
    let mut stmt = conn.prepare(&format!("SELECT n.id, n.titulo, n.espaco FROM nota n WHERE (?1 IS NULL OR n.espaco = ?1) AND {visivel} ORDER BY n.titulo"))?;
    let mut rows = stmt.query(rusqlite::params![espaco])?;
    let mut out = Vec::new();
    while let Some(r) = rows.next()? {
        let id: String = r.get(0)?;
        if let Some((_, corpo)) = corpos.get(&id) {
            out.push(serde_json::json!({
                "id": id, "titulo": r.get::<_, String>(1)?, "espaco": r.get::<_, String>(2)?,
                "trecho": trecho(corpo, palavras),
            }));
            if out.len() >= LIMITE {
                break;
            }
        }
    }
    Ok(out)
}

fn tarefas_aproximadas(conn: &Connection, palavras: &[String], espaco: Option<&str>, visivel: &str) -> rusqlite::Result<Vec<serde_json::Value>> {
    let mut stmt = conn.prepare(&format!("SELECT t.id, t.titulo, t.espaco, t.status, t.prioridade FROM tarefa t WHERE (?1 IS NULL OR t.espaco = ?1) AND {visivel} ORDER BY t.titulo"))?;
    let mut rows = stmt.query(rusqlite::params![espaco])?;
    let mut out = Vec::new();
    while let Some(r) = rows.next()? {
        let titulo: String = r.get(1)?;
        if todas_casam(palavras, &palavras_de(&titulo)) {
            out.push(serde_json::json!({
                "id": r.get::<_, String>(0)?, "titulo": titulo,
                "espaco": r.get::<_, String>(2)?, "status": r.get::<_, String>(3)?, "prioridade": r.get::<_, String>(4)?,
            }));
            if out.len() >= LIMITE {
                break;
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn banco() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TABLE nota (id TEXT PRIMARY KEY, titulo TEXT NOT NULL, espaco TEXT NOT NULL);
             CREATE TABLE tarefa (id TEXT PRIMARY KEY, titulo TEXT NOT NULL, espaco TEXT NOT NULL, status TEXT NOT NULL);
             CREATE VIRTUAL TABLE nota_fts USING fts5(id UNINDEXED, titulo, corpo, ocr_texto_busca);
             CREATE VIRTUAL TABLE tarefa_fts USING fts5(id UNINDEXED, titulo);",
        )
        .unwrap();
        let notas = [
            ("n1", "Compra de ração", "ração do cachorro acabou, comprar na segunda"),
            ("n2", "Nota fiscal", "guardar a nota-fiscal da loja; ver a:b e c++"),
            ("n3", "Teste", "palavra zzquux perdida no meio"),
            ("n4", "Frase", "lista de compras do mês"),
        ];
        for (id, t, corpo) in notas {
            c.execute("INSERT INTO nota VALUES (?1, ?2, 'p')", [id, t]).unwrap();
            c.execute("INSERT INTO nota_fts VALUES (?1, ?2, ?3, '')", [id, t, corpo]).unwrap();
        }
        for (id, t) in [("t1", "Pagar conta de luz"), ("t2", "Revisar zzquux")] {
            c.execute("INSERT INTO tarefa VALUES (?1, ?2, 'p', 'aberta')", [id, t]).unwrap();
            c.execute("INSERT INTO tarefa_fts VALUES (?1, ?2)", [id, t]).unwrap();
        }
        c
    }

    fn ids(c: &Connection, q: &str) -> (Vec<String>, Vec<String>) {
        let v = buscar_conn(c, q, None, true, true, "1", "1");
        let pega = |k: &str| v[k].as_array().unwrap().iter().map(|x| x["id"].as_str().unwrap().to_string()).collect();
        (pega("notas"), pega("tarefas"))
    }

    #[test]
    fn montar_match_escapa_tudo() {
        assert_eq!(montar_match("ração AND").as_deref(), Some("\"ração\" AND \"AND\"*"));
        assert_eq!(montar_match("zz*").as_deref(), Some("\"zz*\"*"));
        assert_eq!(montar_match("\"lista de\" compras").as_deref(), Some("\"lista de\" AND \"compras\"*"));
        assert_eq!(montar_match("a\"b").as_deref(), Some("\"a\" AND \"b\"*"));
        assert_eq!(montar_match(""), None);
        assert_eq!(montar_match("   "), None);
        assert_eq!(montar_match("- : ( ) ^ * \""), None);
    }

    #[test]
    fn nenhuma_entrada_especial_quebra() {
        let c = banco();
        for q in [
            "-", ":", "(", ")", "^", "*", "\"", "\"\"", "AND", "OR", "NOT", "NEAR", "NEAR(a b)", "ração AND", "zz*", "c++", "nota-fiscal",
            "a:b", "", "   ", "titulo:ração", "-ração", "(ração", "ração)", "^ração", "a OR b NOT c", "\"aberta", "{titulo}: x", "ração\"",
        ] {
            // Só não pode entrar em pânico nem cair no erro; o retorno é sempre o JSON com as duas listas.
            let v = buscar_conn(&c, q, None, true, true, "1", "1");
            assert!(v["notas"].is_array() && v["tarefas"].is_array(), "q={q:?}");
        }
    }

    #[test]
    fn mantem_prefixo_acento_e_frase() {
        let c = banco();
        assert_eq!(ids(&c, "raç").0, vec!["n1"]);
        assert_eq!(ids(&c, "racao").0, vec!["n1"]);
        assert_eq!(ids(&c, "\"lista de compras\"").0, vec!["n4"]);
        assert_eq!(ids(&c, "nota-fiscal").0, vec!["n2"]);
        // `c++` vira o prefixo `c*` (o tokenizador descarta `+`): acha n2 e também "cachorro".
        assert!(ids(&c, "c++").0.contains(&"n2".to_string()));
        assert_eq!(ids(&c, "pagar luz").1, vec!["t1"]);
    }

    #[test]
    fn fallback_meio_da_palavra_e_erro_de_digitacao() {
        let c = banco();
        assert_eq!(ids(&c, "quux"), (vec!["n3".to_string()], vec!["t2".to_string()]));
        assert_eq!(ids(&c, "zzquuxx"), (vec!["n3".to_string()], vec!["t2".to_string()]));
        assert_eq!(ids(&c, "zzqux").0, vec!["n3"]);
        assert_eq!(ids(&c, "cahcorro").0, vec!["n1"]);
        assert!(ids(&c, "xyzwvk").0.is_empty());
    }

    #[test]
    fn quase_igual_basico() {
        let f = |a: &str, b: &str| quase_igual(&a.chars().collect::<Vec<_>>(), &b.chars().collect::<Vec<_>>());
        assert!(f("zzquuxx", "zzquux") && f("abcd", "abdc") && f("abcd", "abxd") && f("abc", "abcd"));
        assert!(!f("abcd", "badc") && !f("abcdef", "abc"));
    }
}
