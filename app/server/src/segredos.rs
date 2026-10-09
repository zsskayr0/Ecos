//! Segredos da instância (assinatura da sessão, chave de cifra do calendário) guardados **fora** da pasta de
//! notas: quem copia o backup das notas não leva o segredo junto, e quem copia só o segredo não leva as notas.
//!
//! Onde ficam: `ECOS_SECRETS_DIR` se definida; senão, ao lado do índice SQLite quando ele mora fora das notas
//! (Docker: `/data/index`, volume próprio); senão, `<notas>/.ecos` (desenvolvimento, onde o índice mora lá).

use rand::RngCore;
use std::path::{Path, PathBuf};

/// Pasta dos segredos para esta combinação de notas e índice. Pura: não cria nada.
pub fn resolver_dir(notes_root: &Path, index_db_path: &Path) -> PathBuf {
    if let Some(dir) = std::env::var("ECOS_SECRETS_DIR").ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty()) {
        return PathBuf::from(dir);
    }
    match index_db_path.parent() {
        Some(pai) if !pai.as_os_str().is_empty() && !pai.starts_with(notes_root) => pai.to_path_buf(),
        _ => notes_root.join(".ecos"),
    }
}

/// Pasta de segredos antiga (dentro das notas), de onde os arquivos são migrados.
pub fn dir_legado(notes_root: &Path) -> PathBuf {
    notes_root.join(".ecos")
}

#[cfg(unix)]
fn restringir(caminho: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(caminho, std::fs::Permissions::from_mode(0o600))
}
#[cfg(not(unix))]
fn restringir(_: &Path) -> std::io::Result<()> {
    Ok(())
}

/// Lê `<dir>/<nome>`. Se não existe mas há um no `legado`, move-o para `dir` (copia, confere e só então apaga o
/// antigo, para o segredo nunca ficar em zero lugares). Se não existe em lugar nenhum, gera `tamanho` bytes
/// aleatórios. O segundo valor diz se o segredo foi criado agora.
pub fn ler_ou_criar(dir: &Path, legado: &Path, nome: &str, tamanho: usize) -> anyhow::Result<(Vec<u8>, bool)> {
    std::fs::create_dir_all(dir)?;
    let caminho = dir.join(nome);
    if caminho.exists() {
        let atual = std::fs::read(&caminho)?;
        if !atual.is_empty() {
            return Ok((atual, false));
        }
    }
    let antigo = legado.join(nome);
    if antigo != caminho && antigo.is_file() {
        let conteudo = std::fs::read(&antigo)?;
        if !conteudo.is_empty() {
            std::fs::write(&caminho, &conteudo)?;
            restringir(&caminho)?;
            if std::fs::read(&caminho)? == conteudo {
                std::fs::remove_file(&antigo)?;
                tracing::warn!(de = %antigo.display(), para = %caminho.display(), "segredo movido para fora da pasta de notas");
            }
            return Ok((conteudo, false));
        }
    }
    let mut novo = vec![0u8; tamanho];
    rand::thread_rng().fill_bytes(&mut novo);
    std::fs::write(&caminho, &novo)?;
    restringir(&caminho)?;
    Ok((novo, true))
}

#[cfg(test)]
mod testes {
    use super::*;

    fn temp() -> PathBuf {
        std::env::temp_dir().join(format!("ecos-segredos-{}", ecos_core::new_id()))
    }

    #[test]
    fn indice_fora_das_notas_leva_os_segredos_junto_do_indice() {
        let r = temp();
        assert_eq!(resolver_dir(&r.join("notas"), &r.join("index/i.db")), r.join("index"));
        assert_eq!(resolver_dir(&r.join("notas"), &r.join("notas/.ecos/i.db")), r.join("notas/.ecos"));
        assert_eq!(resolver_dir(&r.join("notas"), &r.join("notas/i.db")), r.join("notas/.ecos"));
    }

    #[test]
    fn migra_o_segredo_antigo_sem_mudar_o_valor_e_remove_o_original() {
        let r = temp();
        let (novo, antigo) = (r.join("index"), r.join("notas/.ecos"));
        std::fs::create_dir_all(&antigo).unwrap();
        std::fs::write(antigo.join("segredo-sessao"), b"valor-antigo-32-bytes-valor-antigo").unwrap();
        let (v, criado) = ler_ou_criar(&novo, &antigo, "segredo-sessao", 32).unwrap();
        assert_eq!((v.as_slice(), criado), (&b"valor-antigo-32-bytes-valor-antigo"[..], false));
        assert!(!antigo.join("segredo-sessao").exists(), "o backup das notas não pode mais conter o segredo");
        assert_eq!(std::fs::read(novo.join("segredo-sessao")).unwrap(), v);
        assert_eq!(ler_ou_criar(&novo, &antigo, "segredo-sessao", 32).unwrap().0, v);
        std::fs::remove_dir_all(r).ok();
    }

    #[test]
    fn sem_nada_gera_e_persiste() {
        let r = temp();
        let (a, criado) = ler_ou_criar(&r.join("s"), &r.join("n/.ecos"), "x", 32).unwrap();
        assert!(criado && a.len() == 32);
        assert_eq!(ler_ou_criar(&r.join("s"), &r.join("n/.ecos"), "x", 32).unwrap(), (a, false));
        std::fs::remove_dir_all(r).ok();
    }
}
