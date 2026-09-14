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

#[cfg(test)]
mod tests {
    use super::*;

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
