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

#[cfg(test)]
mod tests {
    use super::*;

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
