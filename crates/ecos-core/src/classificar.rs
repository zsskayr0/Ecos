//! O que um `.md` é — Nota, Tarefa ou Evento — decidido pelo **conteúdo**, não pela pasta onde ele mora (ADR
//! "árvore única"). Ordem de decisão:
//!
//! 1. `tipo:` explícito no front-matter (`nota | tarefa | evento`) vence sempre;
//! 2. sem `tipo` (legado e `.md` vindos de outros editores): um front-matter que é uma Tarefa válida é tarefa; um que é um
//!    Evento válido é evento; o resto é nota — inclusive `.md` sem front-matter, que segue pelo caminho de adoção.
//!
//! A inferência exige o front-matter **completo** do tipo, não só a presença de `status`: um `.md` de outro editor
//! com `status: rascunho` continua sendo nota.

use crate::frontmatter;
use crate::types::{EventoFrontMatter, TarefaFrontMatter};
use serde::de::{self, Deserializer};
use serde::ser::Serializer;
use serde::{Deserialize, Serialize};
use serde_yaml::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TipoArquivo {
    Nota,
    Tarefa,
    Evento,
}

impl TipoArquivo {
    pub fn como_str(self) -> &'static str {
        match self {
            TipoArquivo::Nota => "nota",
            TipoArquivo::Tarefa => "tarefa",
            TipoArquivo::Evento => "evento",
        }
    }

    fn de_str(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "nota" => Some(TipoArquivo::Nota),
            "tarefa" => Some(TipoArquivo::Tarefa),
            "evento" => Some(TipoArquivo::Evento),
            _ => None,
        }
    }
}

/// Classifica o conteúdo bruto de um `.md`. Nunca falha: o que não dá para entender é nota (e a nota decide, depois,
/// se adota ou registra erro).
pub fn classificar(fonte: &str) -> TipoArquivo {
    classificar_com_padrao(fonte, TipoArquivo::Nota)
}

/// Igual a `classificar`, mas dentro da antiga árvore `Tarefas/` (`padrao = Tarefa`) um arquivo sem `tipo` que tem
/// `status` continua tarefa mesmo inválido — vira erro de front-matter visível, em vez de reaparecer como nota.
pub fn classificar_com_padrao(fonte: &str, padrao: TipoArquivo) -> TipoArquivo {
    let Ok(doc) = frontmatter::parse::<Value>(fonte) else { return TipoArquivo::Nota };
    if let Some(t) = doc.front_matter.get("tipo").and_then(Value::as_str).and_then(TipoArquivo::de_str) {
        return t;
    }
    if frontmatter::parse::<TarefaFrontMatter>(fonte).is_ok() {
        return TipoArquivo::Tarefa;
    }
    if frontmatter::parse::<EventoFrontMatter>(fonte).is_ok() {
        return TipoArquivo::Evento;
    }
    if padrao == TipoArquivo::Tarefa && doc.front_matter.get("status").is_some() {
        return TipoArquivo::Tarefa;
    }
    TipoArquivo::Nota
}

/// Campo `tipo` do front-matter, gravado sempre com o valor fixo do struct que o carrega. Na leitura o valor é
/// ignorado (quem decide o tipo é `classificar`); assim todo arquivo regravado pelo Ecos passa a ter `tipo`, sem
/// migração em lote.
macro_rules! marca {
    ($nome:ident, $valor:literal) => {
        #[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
        pub struct $nome;

        impl Serialize for $nome {
            fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
                s.serialize_str($valor)
            }
        }

        impl<'de> Deserialize<'de> for $nome {
            fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
                de::IgnoredAny::deserialize(d).map(|_| $nome)
            }
        }
    };
}

marca!(MarcaNota, "nota");
marca!(MarcaTarefa, "tarefa");

#[cfg(test)]
mod tests {
    use super::*;

    const TAREFA: &str = "---\nid: T1\ntitulo: Comprar\nstatus: pendente\nespaco: pessoal\ncriado_em: 2026-01-01T00:00:00Z\n---\n";
    const NOTA: &str = "---\nid: N1\ntitulo: Ideia\nespaco: pessoal\ncriado_em: 2026-01-01T00:00:00Z\natualizado_em: 2026-01-01T00:00:00Z\n---\ncorpo\n";

    #[test]
    fn infere_legado_sem_tipo() {
        assert_eq!(classificar(TAREFA), TipoArquivo::Tarefa);
        assert_eq!(classificar(NOTA), TipoArquivo::Nota);
        let evento = "---\nid: E1\ntitulo: Reunião\ninicio: 2026-01-01T10:00:00Z\nfim: 2026-01-01T11:00:00Z\nespaco: pessoal\ncriado_em: 2026-01-01T00:00:00Z\natualizado_em: 2026-01-01T00:00:00Z\n---\n";
        assert_eq!(classificar(evento), TipoArquivo::Evento);
    }

    #[test]
    fn tipo_explicito_vence_a_inferencia() {
        let nota_com_cara_de_tarefa = TAREFA.replacen("---\n", "---\ntipo: nota\n", 1);
        assert_eq!(classificar(&nota_com_cara_de_tarefa), TipoArquivo::Nota);
        let tarefa = NOTA.replacen("---\n", "---\ntipo: Tarefa\n", 1);
        assert_eq!(classificar(&tarefa), TipoArquivo::Tarefa);
    }

    #[test]
    fn md_externo_com_status_proprio_ou_sem_front_matter_e_nota() {
        assert_eq!(classificar("---\nstatus: rascunho\nprioridade: alta\n---\ntexto\n"), TipoArquivo::Nota);
        assert_eq!(classificar("# Só markdown\n"), TipoArquivo::Nota);
        assert_eq!(classificar("---\nquebrado: [\n---\n"), TipoArquivo::Nota);
        assert_eq!(classificar("---\ntipo: outra-coisa\n---\n"), TipoArquivo::Nota);
    }

    #[test]
    fn na_arvore_de_tarefas_status_invalido_continua_tarefa() {
        let quebrada = "---
id: T1
titulo: X
status: em_andamento
espaco: pessoal
criado_em: 2026-01-01T00:00:00Z
atualizado_em: 2026-01-01T00:00:00Z
---
";
        assert_eq!(classificar(quebrada), TipoArquivo::Nota);
        assert_eq!(classificar_com_padrao(quebrada, TipoArquivo::Tarefa), TipoArquivo::Tarefa);
        assert_eq!(classificar_com_padrao(NOTA, TipoArquivo::Tarefa), TipoArquivo::Nota);
    }

    #[test]
    fn marca_grava_valor_fixo_e_aceita_qualquer_coisa() {
        assert_eq!(serde_yaml::to_string(&MarcaTarefa).unwrap().trim(), "tarefa");
        assert_eq!(serde_yaml::from_str::<MarcaNota>("[1, 2]").unwrap(), MarcaNota);
    }
}

#[cfg(test)]
mod testes_propriedades_externas {
    use crate::frontmatter;
    use crate::types::{NotaFrontMatter, TarefaFrontMatter};

    #[test]
    fn regravar_preserva_propriedades_desconhecidas() {
        let fonte = "---\nid: N1\ntitulo: Plano\nespaco: pessoal\ncriado_em: 2026-01-01T00:00:00Z\natualizado_em: 2026-01-01T00:00:00Z\naliases: [Plano, PV]\ncssclasses: [larga]\npublicar: true\nplugin:\n  config: {nivel: 2}\n---\ncorpo\n";
        let doc = frontmatter::parse::<NotaFrontMatter>(fonte).unwrap();
        assert_eq!(doc.front_matter.aliases, ["Plano", "PV"]);
        let regravado = frontmatter::serialize(&doc.front_matter, &doc.body).unwrap();
        let de_novo = frontmatter::parse::<serde_yaml::Value>(&regravado).unwrap().front_matter;
        assert_eq!(de_novo["cssclasses"][0], "larga");
        assert_eq!(de_novo["publicar"], true);
        assert_eq!(de_novo["plugin"]["config"]["nivel"], 2);
        assert_eq!(de_novo["tipo"], "nota");
        assert_eq!(super::classificar(&regravado), super::TipoArquivo::Nota);
    }

    #[test]
    fn tarefa_com_campos_aninhados_e_extras_faz_ida_e_volta() {
        let fonte = "---\nid: T1\ntitulo: X\nstatus: concluida\nespaco: pessoal\ncriado_em: 2026-01-01T00:00:00Z\nconcluida_em: 2026-01-02T00:00:00Z\nevento_externo: {provider: google, event_id: abc}\ntempo:\n  - {id: a, tipo: real, inicio_em: 2026-01-01T10:00:00Z, duracao_min: 30, criado_em: 2026-01-01T10:30:00Z}\nprojeto: \"[[Casa]]\"\n---\n";
        let doc = frontmatter::parse::<TarefaFrontMatter>(fonte).unwrap();
        assert_eq!(doc.front_matter.tempo.len(), 1);
        assert_eq!(doc.front_matter.evento_externo.event_id.as_deref(), Some("abc"));
        let regravado = frontmatter::serialize(&doc.front_matter, &doc.body).unwrap();
        let volta = frontmatter::parse::<TarefaFrontMatter>(&regravado).unwrap().front_matter;
        assert_eq!(volta.extras.get("projeto").and_then(|v| v.as_str()), Some("[[Casa]]"));
        assert_eq!(volta.tempo, doc.front_matter.tempo);
        assert_eq!(super::classificar(&regravado), super::TipoArquivo::Tarefa);
    }
}
