//! Nome canônico das tags, compartilhado por Notas e Tarefas.
//!
//! O arquivo Markdown guarda a tag como foi escrita; o índice, a busca, os filtros e o
//! catálogo comparam sempre pela forma canônica daqui. Os arquivos só mudam quando a
//! pessoa renomeia, mescla ou remove uma tag (nunca num reindex).

/// Limite de caracteres de uma tag canônica.
pub const TAMANHO_MAXIMO: usize = 48;

/// Forma canônica: sem `#` inicial, minúscula, espaços internos viram `-`.
/// `None` quando sobra nada (ou passa do limite).
pub fn canonica(bruta: &str) -> Option<String> {
    let sem_marca = bruta.trim().trim_start_matches('#');
    let juntada = sem_marca.split_whitespace().collect::<Vec<_>>().join("-");
    let tag = juntada.to_lowercase();
    if tag.is_empty() || tag.chars().count() > TAMANHO_MAXIMO || tag.chars().any(|c| c.is_control() || c == ',') {
        None
    } else {
        Some(tag)
    }
}

/// Lista vinda de uma entrada nova: canoniza, descarta o inválido e remove duplicatas mantendo a ordem.
pub fn normalizar_lista<I, S>(tags: I) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut saida: Vec<String> = Vec::new();
    for tag in tags {
        if let Some(t) = canonica(tag.as_ref()) {
            if !saida.contains(&t) {
                saida.push(t);
            }
        }
    }
    saida
}

/// Edição de um item que já tem tags: o resultado é a lista canônica de `novas`, mas a tag cujo nome
/// canônico não mudou mantém a grafia que já estava no arquivo (editar um item nunca reescreve hashtags antigas).
pub fn atualizar_preservando(existentes: &[String], novas: &[String]) -> Vec<String> {
    normalizar_lista(novas)
        .into_iter()
        .map(|c| existentes.iter().find(|e| canonica(e).as_deref() == Some(c.as_str())).cloned().unwrap_or(c))
        .collect()
}

/// Troca as tags `origens` (comparadas pela forma canônica) por `destino` (ou só as remove, com `None`).
/// Tags sem relação com a operação ficam exatamente como estavam. `None` quando nada mudou.
pub fn reescrever(atuais: &[String], origens: &[String], destino: Option<&str>) -> Option<Vec<String>> {
    let mut tocou = false;
    let mut saida: Vec<String> = Vec::new();
    for tag in atuais {
        let afetada = canonica(tag).is_some_and(|c| origens.contains(&c));
        if !afetada {
            saida.push(tag.clone());
            continue;
        }
        tocou = true;
        if let Some(d) = destino {
            if !saida.iter().any(|t| canonica(t).as_deref() == Some(d)) {
                saida.push(d.to_string());
            }
        }
    }
    // Se o destino já existia antes de uma origem na lista, o laço acima já o deduplicou.
    tocou.then_some(saida)
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn canoniza_caixa_espacos_e_marca() {
        assert_eq!(canonica("  #Projeto  Ecos "), Some("projeto-ecos".into()));
        assert_eq!(canonica("##"), None);
        assert_eq!(canonica("a,b"), None);
    }

    #[test]
    fn normaliza_sem_duplicatas() {
        assert_eq!(normalizar_lista(["Casa", "#casa", "casa ", "Obra"]), vec!["casa", "obra"]);
    }

    #[test]
    fn edicao_preserva_grafia_antiga() {
        let antes = vec!["Casa".to_string(), "Velha".to_string()];
        assert_eq!(atualizar_preservando(&antes, &["casa".into(), "Nova".into()]), vec!["Casa", "nova"]);
    }

    #[test]
    fn reescreve_so_o_afetado() {
        let atuais = vec!["Casa".to_string(), "Outra Coisa".to_string(), "obra".to_string()];
        let r = reescrever(&atuais, &["casa".into(), "obra".into()], Some("reforma")).unwrap();
        assert_eq!(r, vec!["reforma", "Outra Coisa"]);
        assert_eq!(reescrever(&atuais, &["x".into()], Some("y")), None);
        assert_eq!(reescrever(&atuais, &["casa".into()], None).unwrap(), vec!["Outra Coisa", "obra"]);
    }
}
