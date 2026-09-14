//! Parser/serializador do front-matter YAML dos arquivos `.md` de
//! Nota/Tarefa (seção 1.3). Regra dura do documento: **o backend nunca
//! reformata/sanitiza o corpo do `.md`** — só reescreve o bloco de
//! front-matter (id/timestamps). Este módulo preserva o corpo byte a byte,
//! recortando a `&str` original em vez de reconstruí-la.

use serde::{de::DeserializeOwned, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum FrontMatterError {
    #[error("arquivo não começa com o delimitador '---' de front-matter")]
    MissingOpeningDelimiter,
    #[error("front-matter aberto com '---' mas nunca fechado")]
    MissingClosingDelimiter,
    #[error("front-matter não é YAML válido para o tipo esperado: {0}")]
    InvalidYaml(#[from] serde_yaml::Error),
}

/// Um documento `.md` já separado em front-matter tipado + corpo cru.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedDocument<T> {
    pub front_matter: T,
    pub body: String,
}

struct LineSpan<'a> {
    content: &'a str,
    /// offset (em bytes) de início da linha, incluindo o próprio terminador anterior já consumido
    start: usize,
    /// offset (em bytes) logo após o terminador desta linha (ou fim da string, se não houver)
    end: usize,
}

struct LineSpans<'a> {
    source: &'a str,
    pos: usize,
    done: bool,
}

impl<'a> LineSpans<'a> {
    fn new(source: &'a str) -> Self {
        Self {
            source,
            pos: 0,
            done: false,
        }
    }
}

impl<'a> Iterator for LineSpans<'a> {
    type Item = LineSpan<'a>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.done || self.pos > self.source.len() {
            return None;
        }
        if self.pos == self.source.len() {
            self.done = true;
            return None;
        }
        let rest = &self.source[self.pos..];
        let start = self.pos;
        let (content, end) = match rest.find('\n') {
            Some(idx) => (&rest[..idx], start + idx + 1),
            None => (rest, self.source.len()),
        };
        self.pos = end;
        Some(LineSpan { content, start, end })
    }
}

/// Extrai front-matter tipado + corpo, sem tocar em um único byte do corpo.
pub fn parse<T>(source: &str) -> Result<ParsedDocument<T>, FrontMatterError>
where
    T: DeserializeOwned,
{
    let mut lines = LineSpans::new(source);

    let first = lines.next().ok_or(FrontMatterError::MissingOpeningDelimiter)?;
    if first.content.trim_end_matches('\r') != "---" {
        return Err(FrontMatterError::MissingOpeningDelimiter);
    }
    let yaml_start = first.end;

    for span in lines {
        if span.content.trim_end_matches('\r') == "---" {
            let yaml_block = &source[yaml_start..span.start];
            let front_matter: T = serde_yaml::from_str(yaml_block)?;
            let body = source[span.end..].to_string();
            return Ok(ParsedDocument { front_matter, body });
        }
    }

    Err(FrontMatterError::MissingClosingDelimiter)
}

/// Recompõe um `.md` a partir de front-matter tipado (recém-atualizado, ex.
/// timestamps) + corpo — o corpo é colado exatamente como recebido, nunca
/// reprocessado.
pub fn serialize<T>(front_matter: &T, body: &str) -> Result<String, FrontMatterError>
where
    T: Serialize,
{
    let mut yaml = serde_yaml::to_string(front_matter)?;
    if let Some(stripped) = yaml.strip_prefix("---\n") {
        yaml = stripped.to_string();
    }
    let yaml = yaml.trim_end_matches('\n');
    Ok(format!("---\n{yaml}\n---\n{body}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
    struct Exemplo {
        id: String,
        titulo: String,
    }

    #[test]
    fn parse_basico_preserva_corpo() {
        let src = "---\nid: 01J1\ntitulo: \"Teste\"\n---\nCorpo com [[wikilink]] e - [ ] checkbox\n";
        let doc = parse::<Exemplo>(src).unwrap();
        assert_eq!(doc.front_matter.id, "01J1");
        assert_eq!(doc.front_matter.titulo, "Teste");
        assert_eq!(doc.body, "Corpo com [[wikilink]] e - [ ] checkbox\n");
    }

    #[test]
    fn parse_tolera_crlf() {
        let src = "---\r\nid: 01J1\r\ntitulo: \"Teste\"\r\n---\r\nCorpo\r\n";
        let doc = parse::<Exemplo>(src).unwrap();
        assert_eq!(doc.front_matter.id, "01J1");
        assert_eq!(doc.body, "Corpo\r\n");
    }

    #[test]
    fn parse_corpo_vazio_e_sem_newline_final() {
        let src = "---\nid: 01J1\ntitulo: X\n---\n";
        let doc = parse::<Exemplo>(src).unwrap();
        assert_eq!(doc.body, "");
    }

    #[test]
    fn parse_falha_sem_delimitador_abertura() {
        let src = "id: 01J1\ntitulo: X\n";
        assert!(matches!(
            parse::<Exemplo>(src),
            Err(FrontMatterError::MissingOpeningDelimiter)
        ));
    }

    #[test]
    fn parse_falha_sem_delimitador_fechamento() {
        let src = "---\nid: 01J1\ntitulo: X\n";
        assert!(matches!(
            parse::<Exemplo>(src),
            Err(FrontMatterError::MissingClosingDelimiter)
        ));
    }

    #[test]
    fn serialize_e_parse_fazem_roundtrip() {
        let fm = Exemplo {
            id: "01J1".into(),
            titulo: "Projeto X".into(),
        };
        let body = "Corpo original, não deve mudar.\n\nSegundo parágrafo.\n";
        let rendered = serialize(&fm, body).unwrap();
        let doc = parse::<Exemplo>(&rendered).unwrap();
        assert_eq!(doc.front_matter, fm);
        assert_eq!(doc.body, body);
    }

    #[test]
    fn corpo_que_contem_linhas_com_tres_tracos_nao_confunde_o_parser() {
        // "---" solto no meio do corpo (ex. separador de seção em Markdown)
        // não pode ser confundido com um novo bloco de front-matter, porque
        // já paramos de procurar depois do primeiro fechamento.
        let src = "---\nid: 01J1\ntitulo: X\n---\nAntes\n\n---\n\nDepois\n";
        let doc = parse::<Exemplo>(src).unwrap();
        assert_eq!(doc.body, "Antes\n\n---\n\nDepois\n");
    }
}
