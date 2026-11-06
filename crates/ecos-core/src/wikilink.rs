//! Extração de wikilinks `[[Nota]]` (e `[[Nota|apelido]]`, mesma sintaxe do
//! Obsidian — seção 1.6, compatibilidade por coincidência de formato) do
//! corpo de uma Nota. O resultado alimenta a tabela `links_nota`
//! (`nota_id_origem -> nota_id_destino`) que, por sua vez, alimenta o
//! critério **Órfã** do ranking (seção 4.1).

use regex::Regex;
use std::sync::OnceLock;

fn wikilink_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        // "[[Título]]" ou "[[Título|Apelido]]" — título nunca contém "]" ou "|".
        Regex::new(r"\[\[([^\]|]+)(?:\|[^\]]*)?\]\]").expect("regex de wikilink é constante e válida")
    })
}

/// Trechos (em bytes) do corpo que são código: blocos cercados (``` ou ~~~) e código em linha (`x`).
/// Wikilink dentro deles é texto literal: não vira link e nunca é reescrito.
pub fn intervalos_de_codigo(body: &str) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    let mut cerca: Option<(char, usize, usize)> = None; // (caractere, tamanho, início do bloco)
    let mut pos = 0;
    for linha in body.split_inclusive('\n') {
        let ini = pos;
        pos += linha.len();
        let sem_quebra = linha.trim_end_matches(['\n', '\r']);
        let recuo = sem_quebra.len() - sem_quebra.trim_start_matches(' ').len();
        let txt = &sem_quebra[recuo..];
        let marca = txt.chars().next().filter(|c| (*c == '`' || *c == '~') && recuo <= 3);
        let tam = marca.map_or(0, |m| txt.chars().take_while(|c| *c == m).count());
        if let Some((c, n, comeco)) = cerca {
            // Fecha com a mesma marca, pelo menos do mesmo tamanho e nada além de espaços depois.
            if marca == Some(c) && tam >= n && txt[tam..].trim().is_empty() {
                out.push((comeco, pos));
                cerca = None;
            }
            continue;
        }
        if let (Some(m), true) = (marca, tam >= 3) {
            // Uma cerca de crases não pode ter crase na linha de abertura (aí é código em linha).
            if m == '~' || !txt[tam..].contains('`') {
                cerca = Some((m, tam, ini));
                continue;
            }
        }
        // Código em linha: sequência de N crases até a próxima sequência de exatamente N.
        let b = linha.as_bytes();
        let mut i = 0;
        while i < b.len() {
            if b[i] != b'`' {
                i += 1;
                continue;
            }
            let n = b[i..].iter().take_while(|c| **c == b'`').count();
            let mut j = i + n;
            let mut fim = None;
            while j < b.len() {
                if b[j] == b'`' {
                    let m = b[j..].iter().take_while(|c| **c == b'`').count();
                    if m == n {
                        fim = Some(j + m);
                        break;
                    }
                    j += m;
                } else {
                    j += 1;
                }
            }
            match fim {
                Some(f) => {
                    out.push((ini + i, ini + f));
                    i = f;
                }
                None => i += n,
            }
        }
    }
    if let Some((_, _, comeco)) = cerca {
        out.push((comeco, body.len())); // bloco sem fechamento vai até o fim
    }
    out
}

/// Ocorrências `[[...]]` fora de código: (início, fim, grupo 1 como (início, fim)).
fn wikilinks_fora_de_codigo(body: &str) -> Vec<(usize, usize, (usize, usize))> {
    let codigo = intervalos_de_codigo(body);
    wikilink_pattern()
        .captures_iter(body)
        .filter_map(|c| {
            let m = c.get(0)?;
            let g = c.get(1)?;
            let dentro = codigo.iter().any(|(a, b)| m.start() < *b && m.end() > *a);
            (!dentro).then_some((m.start(), m.end(), (g.start(), g.end())))
        })
        .collect()
}

/// Reescreve os wikilinks do corpo (fora de código) que `troca` aceita. `troca` recebe a referência como
/// escrita e devolve o título novo; o apelido (`|texto`), a caixa do prefixo e os espaços ao redor ficam como
/// estavam. Com `forcar_prefixo`, um link sem prefixo ganha `nota:`/`tarefa:` de `tipo_alvo`.
/// Devolve o corpo novo e quantos links mudaram.
pub fn reescrever(body: &str, tipo_alvo: TipoItem, mut troca: impl FnMut(&Referencia) -> Option<Troca>) -> (String, usize) {
    let mut out = String::with_capacity(body.len());
    let mut cursor = 0;
    let mut n = 0;
    for (_, _, (gi, gf)) in wikilinks_fora_de_codigo(body) {
        let inner = &body[gi..gf];
        let Some(r) = parse_referencia(inner) else { continue };
        let Some(t) = troca(&r) else { continue };
        let (cabeca, resto) = match (r.tipo, inner.split_once(':')) {
            (Some(_), Some((p, r))) => (&inner[..p.len() + 1], r),
            _ => ("", inner),
        };
        let lead = &resto[..resto.len() - resto.trim_start().len()];
        let trail = &resto[resto.trim_end().len()..];
        let prefixo = if cabeca.is_empty() && t.forcar_prefixo { format!("{}:", tipo_alvo.como_str()) } else { cabeca.to_string() };
        out.push_str(&body[cursor..gi]);
        out.push_str(&format!("{prefixo}{lead}{}{trail}", t.titulo));
        cursor = gf;
        n += 1;
    }
    out.push_str(&body[cursor..]);
    (out, n)
}

/// Resultado de `reescrever` para um link.
#[derive(Debug, Clone)]
pub struct Troca {
    pub titulo: String,
    pub forcar_prefixo: bool,
}

/// Títulos referenciados por wikilink no corpo, na ordem em que aparecem,
/// sem duplicatas (uma Nota que linka outra duas vezes gera uma aresta só).
pub fn extract_titles(body: &str) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for (_, _, (gi, gf)) in wikilinks_fora_de_codigo(body) {
        let title = body[gi..gf].trim().to_string();
        if !title.is_empty() && seen.insert(title.clone()) {
            out.push(title);
        }
    }
    out
}

/// Tipo de item que um wikilink pode apontar.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum TipoItem {
    Nota,
    Tarefa,
}

impl TipoItem {
    pub fn como_str(self) -> &'static str {
        match self {
            TipoItem::Nota => "nota",
            TipoItem::Tarefa => "tarefa",
        }
    }
}

/// Referência extraída de `[[...]]`: prefixo opcional `nota:`/`tarefa:` (sem caixa) e o título como escrito.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Referencia {
    pub tipo: Option<TipoItem>,
    pub titulo: String,
}

/// Separa o prefixo reservado (`nota:` / `tarefa:`, sem caixa) do título. Outros `x:` fazem parte do título.
pub fn parse_referencia(bruto: &str) -> Option<Referencia> {
    let bruto = bruto.trim();
    let (tipo, resto) = match bruto.split_once(':') {
        Some((p, r)) if p.trim().eq_ignore_ascii_case("nota") => (Some(TipoItem::Nota), r),
        Some((p, r)) if p.trim().eq_ignore_ascii_case("tarefa") => (Some(TipoItem::Tarefa), r),
        _ => (None, bruto),
    };
    let titulo = resto.trim();
    if titulo.is_empty() {
        return None;
    }
    Some(Referencia { tipo, titulo: titulo.to_string() })
}

/// Referências do corpo, na ordem em que aparecem, sem repetir a mesma (tipo, título normalizado).
pub fn extract_refs(body: &str) -> Vec<Referencia> {
    let mut vistos = std::collections::HashSet::new();
    let mut out = Vec::new();
    for (_, _, (gi, gf)) in wikilinks_fora_de_codigo(body) {
        if let Some(r) = parse_referencia(&body[gi..gf]) {
            if vistos.insert((r.tipo, normalizar_titulo(&r.titulo))) {
                out.push(r);
            }
        }
    }
    out
}

/// Comparação de títulos: sem espaços nas pontas e sem caixa (Unicode). Acentos NÃO são normalizados.
pub fn normalizar_titulo(t: &str) -> String {
    t.trim().to_lowercase()
}

/// Item que pode ser destino de um wikilink.
#[derive(Debug, Clone)]
pub struct Candidato {
    pub tipo: TipoItem,
    pub id: String,
    pub titulo: String,
    /// Chave do espaço (ex.: `pessoal:<usuario>` ou `equipe:<id>`); só é comparada por igualdade.
    pub espaco: String,
    /// RFC 3339 em UTC (comparável como texto).
    pub atualizado_em: String,
}

/// Resolve uma referência. Regras: prefixo fixa o tipo; sem prefixo a NOTA vence a tarefa; com `espaco_origem`
/// só candidatos desse espaço entram, sem ele o espaço `preferido` (se houver) vence; empate: o mais
/// recentemente atualizado e, por fim, o menor id. `ignorar` (a própria origem) nunca é devolvido (autolink).
pub fn resolver<'a>(r: &Referencia, espaco_origem: Option<&str>, preferido: Option<&str>, ignorar: Option<(TipoItem, &str)>, candidatos: &'a [Candidato]) -> Option<&'a Candidato> {
    let alvo = normalizar_titulo(&r.titulo);
    candidatos
        .iter()
        .filter(|c| r.tipo.map_or(true, |t| t == c.tipo))
        .filter(|c| espaco_origem.map_or(true, |e| e == c.espaco))
        .filter(|c| ignorar.map_or(true, |(t, id)| !(t == c.tipo && id == c.id)))
        .filter(|c| normalizar_titulo(&c.titulo) == alvo)
        .min_by(|a, b| {
            let fora = |c: &Candidato| preferido.map_or(false, |p| p != c.espaco);
            fora(a)
                .cmp(&fora(b))
                .then(a.tipo.cmp(&b.tipo))
                .then(b.atualizado_em.cmp(&a.atualizado_em))
                .then(a.id.cmp(&b.id))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cand(tipo: TipoItem, id: &str, titulo: &str, espaco: &str, at: &str) -> Candidato {
        Candidato { tipo, id: id.into(), titulo: titulo.into(), espaco: espaco.into(), atualizado_em: at.into() }
    }
    fn ref_(s: &str) -> Referencia {
        parse_referencia(s).unwrap()
    }

    #[test]
    fn prefixos_sao_reservados_e_sem_caixa() {
        assert_eq!(ref_("nota:A"), Referencia { tipo: Some(TipoItem::Nota), titulo: "A".into() });
        assert_eq!(ref_(" TAREFA : B "), Referencia { tipo: Some(TipoItem::Tarefa), titulo: "B".into() });
        assert_eq!(ref_("Reunião: pauta"), Referencia { tipo: None, titulo: "Reunião: pauta".into() });
        assert!(parse_referencia("nota:  ").is_none());
        assert_eq!(extract_refs("[[nota:X|ap]] [[x]] [[nota:x]]").len(), 2);
    }

    #[test]
    fn nota_vence_tarefa_sem_prefixo_e_prefixo_forca() {
        let c = vec![cand(TipoItem::Tarefa, "t", "Plano", "e", "2030"), cand(TipoItem::Nota, "n", " plano ", "e", "2020")];
        assert_eq!(resolver(&ref_("Plano"), Some("e"), None, None, &c).unwrap().id, "n");
        assert_eq!(resolver(&ref_("tarefa:Plano"), Some("e"), None, None, &c).unwrap().id, "t");
    }

    #[test]
    fn nunca_cruza_espaco_e_empate_e_deterministico() {
        let c = vec![
            cand(TipoItem::Nota, "b", "X", "pessoal:u1", "2026-01-01"),
            cand(TipoItem::Nota, "a", "X", "pessoal:u1", "2026-01-01"),
            cand(TipoItem::Nota, "c", "X", "pessoal:u2", "2030-01-01"),
            cand(TipoItem::Nota, "d", "Y", "pessoal:u2", "2030-01-01"),
        ];
        assert_eq!(resolver(&ref_("X"), Some("pessoal:u1"), None, None, &c).unwrap().id, "a");
        assert!(resolver(&ref_("Y"), Some("pessoal:u1"), None, None, &c).is_none());
        assert_eq!(resolver(&ref_("X"), None, Some("pessoal:u1"), None, &c).unwrap().id, "a");
        assert_eq!(resolver(&ref_("X"), None, None, None, &c).unwrap().id, "c");
        assert_eq!(resolver(&ref_("X"), Some("pessoal:u1"), None, Some((TipoItem::Nota, "a")), &c).unwrap().id, "b");
    }

    fn troca_hellforge(r: &Referencia) -> Option<Troca> {
        (normalizar_titulo(&r.titulo) == "hell forge").then(|| Troca { titulo: "Hellforge".into(), forcar_prefixo: false })
    }

    #[test]
    fn reescrever_preserva_apelido_prefixo_e_espacos() {
        let corpo = "[[Hell Forge]] [[hell forge|apelido]] [[ NOTA : Hell Forge ]] [[tarefa:Hell Forge]] [[Outra]]";
        let (novo, n) = reescrever(corpo, TipoItem::Nota, |r| (r.tipo != Some(TipoItem::Tarefa)).then(|| troca_hellforge(r)).flatten());
        assert_eq!(novo, "[[Hellforge]] [[Hellforge|apelido]] [[ NOTA : Hellforge ]] [[tarefa:Hell Forge]] [[Outra]]");
        assert_eq!(n, 3);
    }

    #[test]
    fn reescrever_forca_prefixo_so_quando_pedido() {
        let (novo, _) = reescrever("[[X]] [[nota:X]]", TipoItem::Tarefa, |_| Some(Troca { titulo: "Y".into(), forcar_prefixo: true }));
        assert_eq!(novo, "[[tarefa:Y]] [[nota:Y]]");
    }

    #[test]
    fn codigo_nao_e_link_nem_e_reescrito() {
        let corpo = "[[Hell Forge]] `[[Hell Forge]]` ``a [[Hell Forge]] ` b``\n```rust\nlet x = \"[[Hell Forge]]\";\n```\n~~~\n[[Hell Forge]]\n~~~\n[[Hell Forge]]\n";
        let (novo, n) = reescrever(corpo, TipoItem::Nota, troca_hellforge);
        assert_eq!(n, 2);
        assert_eq!(novo.matches("[[Hell Forge]]").count(), 4);
        assert_eq!(extract_titles(corpo), vec!["Hell Forge"]);
        assert_eq!(extract_titles("```\n[[A]]\n```\nfim `[[B]]`"), Vec::<String>::new());
        // Bloco sem fechamento vai até o fim; crase solta não esconde nada.
        assert!(extract_titles("```\n[[A]]").is_empty());
        assert_eq!(extract_titles("uma ` crase [[A]]"), vec!["A"]);
    }

    #[test]
    fn extrai_wikilinks_simples() {
        let body = "Veja também [[Projeto X]] e [[Ideias Soltas]].";
        assert_eq!(extract_titles(body), vec!["Projeto X", "Ideias Soltas"]);
    }

    #[test]
    fn extrai_wikilink_com_apelido_estilo_obsidian() {
        let body = "[[Projeto X|aqui]] tem detalhes.";
        assert_eq!(extract_titles(body), vec!["Projeto X"]);
    }

    #[test]
    fn ignora_link_markdown_comum_e_colchete_unico() {
        let body = "[link normal](https://exemplo.com) e [colchete solto] não contam.";
        assert!(extract_titles(body).is_empty());
    }

    #[test]
    fn dedup_preserva_primeira_ordem() {
        let body = "[[A]] depois [[B]] e de novo [[A]].";
        assert_eq!(extract_titles(body), vec!["A", "B"]);
    }

    #[test]
    fn corpo_sem_link_retorna_vazio() {
        assert!(extract_titles("texto qualquer sem link").is_empty());
    }
}
