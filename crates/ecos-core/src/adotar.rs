//! Adoção de um `.md` solto em `Notas/` (ex.: arquivo do Obsidian jogado na
//! pasta). O arquivo ganha o bloco de front-matter que falta — `id`, `titulo`,
//! `criado_em`, `atualizado_em` e `espaco` — e o **corpo nunca é tocado**
//! (mesma regra de `frontmatter`). Campos que o arquivo já tem, inclusive os
//! desconhecidos (`aliases`, `cssclasses`…), são mantidos como estão.

use crate::frontmatter::{self, FrontMatterError};
use crate::types::NotaFrontMatter;
use chrono::{DateTime, SecondsFormat, Utc};
use serde_yaml::{Mapping, Value};

#[derive(Debug, thiserror::Error)]
pub enum AdotarError {
    #[error(transparent)]
    FrontMatter(#[from] FrontMatterError),
    #[error("front-matter não é um mapa YAML")]
    NaoEMapa,
    #[error("front-matter continua inválido após completar os campos: {0}")]
    Invalido(#[from] serde_yaml::Error),
}

/// Primeiro `# Título` do corpo (ignorando linhas em branco antes dele).
fn titulo_do_corpo(corpo: &str) -> Option<String> {
    let linha = corpo.lines().find(|l| !l.trim().is_empty())?;
    let texto = linha.trim_start().strip_prefix("# ")?.trim();
    (!texto.is_empty()).then(|| texto.to_string())
}

fn chave(nome: &str) -> Value {
    Value::String(nome.to_string())
}

fn texto_vazio(valor: Option<&Value>) -> bool {
    match valor {
        None | Some(Value::Null) => true,
        Some(Value::String(s)) => s.trim().is_empty(),
        _ => false,
    }
}

/// Devolve o conteúdo novo do arquivo, ou `None` se ele já tem tudo.
///
/// `nome_arquivo` é o nome sem extensão (fallback de título); `criado_em` e
/// `atualizado_em` vêm dos metadados do arquivo.
pub fn adotar(
    fonte: &str,
    nome_arquivo: &str,
    criado_em: DateTime<Utc>,
    atualizado_em: DateTime<Utc>,
) -> Result<Option<String>, AdotarError> {
    if frontmatter::parse::<NotaFrontMatter>(fonte).is_ok() {
        return Ok(None);
    }

    let (mut mapa, corpo) = match frontmatter::parse::<Value>(fonte) {
        Ok(doc) => match doc.front_matter {
            Value::Mapping(m) => (m, doc.body),
            Value::Null => (Mapping::new(), doc.body),
            _ => return Err(AdotarError::NaoEMapa),
        },
        Err(FrontMatterError::MissingOpeningDelimiter) => (Mapping::new(), fonte.to_string()),
        Err(outro) => return Err(outro.into()),
    };

    let mut completar = |nome: &str, valor: String| {
        if texto_vazio(mapa.get(nome)) {
            mapa.insert(chave(nome), Value::String(valor));
        }
    };
    completar("id", crate::ids::new_id());
    completar("titulo", titulo_do_corpo(&corpo).unwrap_or_else(|| nome_arquivo.trim().to_string()));
    completar("criado_em", criado_em.to_rfc3339_opts(SecondsFormat::Secs, true));
    completar("atualizado_em", atualizado_em.to_rfc3339_opts(SecondsFormat::Secs, true));
    completar("espaco", "pessoal".to_string());

    let novo = frontmatter::serialize(&Value::Mapping(mapa), &corpo)?;
    // Só grava se o resultado realmente vira uma Nota válida.
    frontmatter::parse::<NotaFrontMatter>(&novo)?;
    Ok(Some(novo))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(s: &str) -> DateTime<Utc> {
        s.parse().unwrap()
    }

    fn adotar_ok(fonte: &str) -> String {
        adotar(fonte, "arquivo", t("2024-01-02T03:04:05Z"), t("2025-06-07T08:09:10Z")).unwrap().unwrap()
    }

    #[test]
    fn md_puro_ganha_front_matter_e_corpo_intacto() {
        let corpo = "# Minha ideia\n\nTexto com [[link]] e - [ ] tarefa e #tag\n\n---\n\nfim";
        let novo = adotar_ok(corpo);
        let doc = frontmatter::parse::<NotaFrontMatter>(&novo).unwrap();
        assert_eq!(doc.body, corpo);
        assert_eq!(doc.front_matter.titulo, "Minha ideia");
        assert_eq!(doc.front_matter.id.len(), 26);
        assert_eq!(doc.front_matter.criado_em, t("2024-01-02T03:04:05Z"));
        assert_eq!(doc.front_matter.atualizado_em, t("2025-06-07T08:09:10Z"));
    }

    #[test]
    fn sem_h1_usa_o_nome_do_arquivo() {
        let novo = adotar_ok("só texto\n");
        let doc = frontmatter::parse::<NotaFrontMatter>(&novo).unwrap();
        assert_eq!(doc.front_matter.titulo, "arquivo");
    }

    #[test]
    fn front_matter_parcial_mantem_campos_existentes_e_desconhecidos() {
        let novo = adotar_ok("---\ntitulo: Do Obsidian\ntags: [a, b]\naliases: [x]\n---\nCorpo\n");
        let doc = frontmatter::parse::<NotaFrontMatter>(&novo).unwrap();
        assert_eq!(doc.front_matter.titulo, "Do Obsidian");
        assert_eq!(doc.front_matter.tags, vec!["a", "b"]);
        assert_eq!(doc.body, "Corpo\n");
        assert!(novo.contains("aliases"));
    }

    #[test]
    fn nota_completa_nao_muda() {
        let completa = adotar_ok("# X\n");
        assert!(adotar(&completa, "x", t("2024-01-02T03:04:05Z"), t("2024-01-02T03:04:05Z")).unwrap().is_none());
    }

    #[test]
    fn front_matter_sem_fechamento_ou_yaml_quebrado_continua_erro() {
        assert!(adotar("---\ntitulo: X\nsem fechar\n", "x", t("2024-01-02T03:04:05Z"), t("2024-01-02T03:04:05Z")).is_err());
        assert!(adotar("---\n: : [\n---\nc\n", "x", t("2024-01-02T03:04:05Z"), t("2024-01-02T03:04:05Z")).is_err());
    }
}
