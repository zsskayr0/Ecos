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

/// Títulos referenciados por wikilink no corpo, na ordem em que aparecem,
/// sem duplicatas (uma Nota que linka outra duas vezes gera uma aresta só).
pub fn extract_titles(body: &str) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for caps in wikilink_pattern().captures_iter(body) {
        let title = caps[1].trim().to_string();
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
    for caps in wikilink_pattern().captures_iter(body) {
        if let Some(r) = parse_referencia(&caps[1]) {
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
