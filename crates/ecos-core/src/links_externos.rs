//! Links externos (`http`/`https`) no corpo de uma Nota ou Tarefa: `[texto](https://…)`, `<https://…>` e URL solta.
//! Blocos de código e imagens ficam de fora; o resultado vem sem repetição (por URL), na ordem em que aparecem.

use regex::Regex;
use std::sync::OnceLock;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkExterno {
    pub url: String,
    /// Texto escrito pela pessoa (`[texto](url)`); `None` para URL solta ou quando o texto é a própria URL.
    pub texto: Option<String>,
}

fn re_md() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r#"(!?)\[([^\]\n]*)\]\(\s*<?(https?://[^\s)>]+)>?(?:\s+"[^"]*")?\s*\)"#).unwrap())
}

fn re_solto() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r#"https?://[^\s<>()\[\]"'`]+"#).unwrap())
}

/// Tira o bloco de front-matter, os blocos cercados por ``` ou ~~~ e o código em linha.
fn sem_codigo(corpo: &str) -> String {
    let corpo = match corpo.strip_prefix("---") {
        Some(resto) if resto.starts_with('\n') || resto.starts_with("\r\n") => match resto.find("\n---") {
            Some(i) => &resto[i + 4..],
            None => corpo,
        },
        _ => corpo,
    };
    let mut saida = String::with_capacity(corpo.len());
    let mut cerca: Option<&str> = None;
    for linha in corpo.lines() {
        let t = linha.trim_start();
        let marca = if t.starts_with("```") { Some("```") } else if t.starts_with("~~~") { Some("~~~") } else { None };
        match (cerca, marca) {
            (None, Some(m)) => cerca = Some(m),
            (Some(a), Some(m)) if a == m => cerca = None,
            (None, None) => {
                let mut dentro = false;
                for c in linha.chars() {
                    if c == '`' { dentro = !dentro; saida.push(' '); } else if dentro { saida.push(' '); } else { saida.push(c); }
                }
                saida.push('\n');
            }
            _ => {}
        }
    }
    saida
}

fn limpar_fim(url: &str) -> &str {
    url.trim_end_matches(['.', ',', ';', ':', '!', '?', '*', '_'])
}

pub fn extrair(corpo: &str) -> Vec<LinkExterno> {
    let texto = sem_codigo(corpo);
    let mut achados: Vec<(usize, LinkExterno)> = Vec::new();
    // Intervalos já consumidos por `[texto](url)`: a URL solta dentro deles não conta de novo.
    let mut usados: Vec<(usize, usize)> = Vec::new();
    for c in re_md().captures_iter(&texto) {
        let todo = c.get(0).unwrap();
        usados.push((todo.start(), todo.end()));
        if &c[1] == "!" {
            continue;
        }
        let url = c[3].to_string();
        let rotulo = c[2].trim();
        let rotulo = (!rotulo.is_empty() && rotulo != url).then(|| rotulo.to_string());
        achados.push((todo.start(), LinkExterno { url, texto: rotulo }));
    }
    for m in re_solto().find_iter(&texto) {
        if usados.iter().any(|(a, b)| m.start() >= *a && m.start() < *b) {
            continue;
        }
        let url = limpar_fim(m.as_str());
        if url.len() > "https://".len() {
            achados.push((m.start(), LinkExterno { url: url.to_string(), texto: None }));
        }
    }
    achados.sort_by_key(|(i, _)| *i);
    let mut vistos = std::collections::HashSet::new();
    achados.into_iter().map(|(_, l)| l).filter(|l| vistos.insert(l.url.clone())).collect()
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn extrai_markdown_autolink_e_url_solta_sem_repetir() {
        let l = extrair("Veja [Docs](https://exemplo.com/a) e <https://b.org/x>, também https://c.net/y.\nDe novo [de novo](https://exemplo.com/a).");
        let urls: Vec<_> = l.iter().map(|x| x.url.as_str()).collect();
        assert_eq!(urls, ["https://exemplo.com/a", "https://b.org/x", "https://c.net/y"]);
        assert_eq!(l[0].texto.as_deref(), Some("Docs"));
        assert_eq!(l[1].texto, None);
    }

    #[test]
    fn ignora_codigo_imagem_e_frontmatter() {
        let corpo = "---\nid: 1\nfonte: https://front.com\n---\n![img](https://img.com/a.png)\n`https://inline.com`\n```\nhttps://bloco.com\n```\nok https://fora.com";
        let urls: Vec<_> = extrair(corpo).into_iter().map(|x| x.url).collect();
        assert_eq!(urls, ["https://fora.com"]);
    }

    #[test]
    fn rotulo_igual_a_url_vira_sem_texto() {
        let l = extrair("[https://a.com](https://a.com)");
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].texto, None);
    }
}
