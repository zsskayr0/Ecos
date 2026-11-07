//! Nome de arquivo = título da Nota/Tarefa, nunca o `id` (seção 1.5).
//! Sanitização de caracteres inválidos por SO e resolução de colisão de
//! nome ficam aqui — usadas tanto pelo cliente (Captura local instantânea)
//! quanto pelo servidor (hub de sync/acesso remoto), por isso moram em
//! `ecos-core` e não em `ecos-app`.

use std::path::{Path, PathBuf};

const CARACTERES_INVALIDOS: &[char] = &['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
/// Limite conservador que funciona nos três SOs alvo (Windows é o mais
/// restritivo, ~255 bytes de caminho completo por componente).
const TAMANHO_MAXIMO: usize = 150;

/// Converte um título livre num nome de arquivo válido no Windows/macOS/
/// Linux — substitui caracteres proibidos por `_`, remove espaços nas
/// pontas, e trunca nomes muito longos.
pub fn sanitizar_nome_arquivo(titulo: &str) -> String {
    let convertido: String = titulo
        .chars()
        .map(|c| if CARACTERES_INVALIDOS.contains(&c) || c.is_control() { '_' } else { c })
        .collect();
    let aparado = convertido.trim().trim_end_matches('.');
    let truncado: String = aparado.chars().take(TAMANHO_MAXIMO).collect();
    if truncado.trim().is_empty() {
        "Sem título".to_string()
    } else {
        truncado
    }
}

/// Resolve colisão de nome na mesma pasta com sufixo `(2)`, `(3)`, ... —
/// seção 1.5/1.6. Toca o filesystem (só `Path::exists`), por isso não
/// funciona em WASM puro, mas tanto o cliente Tauri quanto o servidor rodam
/// nativo.
pub fn caminho_sem_colisao(dir: &Path, nome_base: &str, extensao: &str) -> PathBuf {
    let direto = dir.join(format!("{nome_base}.{extensao}"));
    if !direto.exists() {
        return direto;
    }
    let mut contador = 2u32;
    loop {
        let candidato = dir.join(format!("{nome_base} ({contador}).{extensao}"));
        if !candidato.exists() {
            return candidato;
        }
        contador += 1;
    }
}

/// Padrão de nome dos `.md` do Ecos: `note-<Título>.md` e `task-<Título>.md`. O tipo é fixo desde a criação (uma
/// tarefa nunca vira nota): o prefixo só torna o tipo visível no explorador de arquivos.
pub const PREFIXO_NOTA: &str = "note-";
pub const PREFIXO_TAREFA: &str = "task-";

pub fn prefixo(tarefa: bool) -> &'static str {
    if tarefa { PREFIXO_TAREFA } else { PREFIXO_NOTA }
}

/// Nome (sem extensão) de um item novo ou de título alterado.
pub fn nome_padrao(tarefa: bool, titulo: &str) -> String {
    format!("{}{}", prefixo(tarefa), sanitizar_nome_arquivo(titulo))
}

/// O nome (sem extensão) segue o padrão do tipo? `task-` numa nota (ou o contrário) também é fora do padrão.
pub fn no_padrao(tarefa: bool, nome_sem_extensao: &str) -> bool {
    nome_sem_extensao.strip_prefix(prefixo(tarefa)).is_some_and(|resto| !resto.trim().is_empty())
}

/// Nome de destino ao editar/mover: um arquivo já no padrão mantém o nome (inclusive o sufixo ` (2)`) enquanto o
/// título não muda; qualquer outro caso — título novo ou nome fora do padrão — vai para o padrão, sem perguntar.
pub fn nome_ao_editar(tarefa: bool, nome_atual: Option<&str>, titulo_mudou: bool, titulo: &str) -> String {
    match nome_atual {
        Some(atual) if !titulo_mudou && no_padrao(tarefa, atual) => atual.to_string(),
        _ => nome_padrao(tarefa, titulo),
    }
}

/// Mantém o título atual em `aliases` (para `[[Título]]` achar `note-Título.md` em qualquer editor de Markdown que
/// resolva links pelo nome do arquivo) e tira o antigo. Aliases da própria pessoa ficam.
pub fn atualizar_aliases(aliases: &mut Vec<String>, titulo_antigo: Option<&str>, titulo: &str) {
    if let Some(antigo) = titulo_antigo.filter(|a| *a != titulo) {
        aliases.retain(|a| a != antigo);
    }
    if !titulo.trim().is_empty() && !aliases.iter().any(|a| a == titulo) {
        aliases.insert(0, titulo.to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn padrao_de_nome_por_tipo() {
        assert_eq!(nome_padrao(true, "Comprar: pão"), "task-Comprar_ pão");
        assert_eq!(nome_padrao(false, "Plano"), "note-Plano");
        assert!(no_padrao(true, "task-Comprar pão") && no_padrao(false, "note-Plano (2)"));
        assert!(!no_padrao(true, "Comprar pão") && !no_padrao(false, "task-Plano") && !no_padrao(true, "task-"));
    }

    #[test]
    fn editar_leva_o_nome_para_o_padrao() {
        assert_eq!(nome_ao_editar(false, Some("note-Plano (2)"), false, "Plano"), "note-Plano (2)");
        assert_eq!(nome_ao_editar(false, Some("Plano antigo"), false, "Plano antigo"), "note-Plano antigo");
        assert_eq!(nome_ao_editar(true, Some("note-Lavar"), false, "Lavar"), "task-Lavar");
        assert_eq!(nome_ao_editar(false, Some("Plano antigo"), true, "Plano novo"), "note-Plano novo");
        assert_eq!(nome_ao_editar(true, None, false, "X"), "task-X");
    }

    #[test]
    fn aliases_acompanham_o_titulo_sem_apagar_os_da_pessoa() {
        let mut a = vec!["apelido".to_string()];
        atualizar_aliases(&mut a, None, "Plano");
        assert_eq!(a, ["Plano", "apelido"]);
        atualizar_aliases(&mut a, Some("Plano"), "Plano B");
        assert_eq!(a, ["Plano B", "apelido"]);
        atualizar_aliases(&mut a, Some("Plano B"), "Plano B");
        assert_eq!(a, ["Plano B", "apelido"]);
    }

    #[test]
    fn substitui_caracteres_invalidos() {
        assert_eq!(sanitizar_nome_arquivo("Projeto: X / Y?"), "Projeto_ X _ Y_");
    }

    #[test]
    fn titulo_vazio_vira_nome_padrao() {
        assert_eq!(sanitizar_nome_arquivo("   "), "Sem título");
    }

    #[test]
    fn trunca_nome_muito_longo() {
        let titulo = "a".repeat(500);
        assert!(sanitizar_nome_arquivo(&titulo).chars().count() <= TAMANHO_MAXIMO);
    }

    #[test]
    fn colisao_ganha_sufixo_numerico() {
        let dir = std::env::temp_dir().join(format!("ecos-naming-test-{}", crate::new_id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("Nota.md"), "x").unwrap();
        std::fs::write(dir.join("Nota (2).md"), "x").unwrap();

        let resolvido = caminho_sem_colisao(&dir, "Nota", "md");
        assert_eq!(resolvido, dir.join("Nota (3).md"));

        std::fs::remove_dir_all(dir).ok();
    }
}
