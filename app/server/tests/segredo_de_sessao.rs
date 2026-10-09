//! O segredo de sessão fica fora da pasta de notas: copiar o backup das notas não leva o segredo junto.
//! Um único teste, de propósito: mexe em variáveis de ambiente, que são do processo inteiro.

use ecos_app::config::Config;
use std::path::PathBuf;

fn ler_tudo(raiz: &PathBuf) -> Vec<(PathBuf, Vec<u8>)> {
    walkdir::WalkDir::new(raiz).into_iter().filter_map(Result::ok).filter(|e| e.file_type().is_file()).map(|e| (e.path().to_path_buf(), std::fs::read(e.path()).unwrap())).collect()
}

#[test]
fn segredo_nao_mora_na_pasta_de_notas_e_o_antigo_e_migrado() {
    let base = std::env::temp_dir().join(format!("ecos-segredo-{}", ecos_core::new_id()));
    let (notas, indice) = (base.join("notes"), base.join("index"));
    std::fs::create_dir_all(&indice).unwrap();
    std::env::remove_var("ECOS_SESSION_SECRET");
    std::env::remove_var("ECOS_SECRETS_DIR");
    std::env::set_var("ECOS_NOTES_PATH", &notas);
    std::env::set_var("ECOS_INDEX_DB_PATH", indice.join("ecos-index.db"));

    // Primeiro boot (como no Docker: índice em volume próprio, fora das notas).
    let config = Config::from_env().unwrap();
    assert_eq!(config.session_secret.len(), 32);
    assert!(indice.join("segredo-sessao").is_file(), "o segredo nasce ao lado do índice");
    assert!(
        ler_tudo(&notas).iter().all(|(_, conteudo)| !conteudo.windows(32).any(|w| w == config.session_secret.as_slice())),
        "nada dentro da pasta de notas pode conter o segredo"
    );
    assert_eq!(Config::from_env().unwrap().session_secret, config.session_secret, "estável entre boots");

    // Instalação antiga: o segredo estava dentro das notas e é movido, com o mesmo valor (as sessões não caem).
    let antigo = b"segredo-antigo-que-estava-nas-notas!".to_vec();
    std::fs::remove_file(indice.join("segredo-sessao")).unwrap();
    std::fs::write(notas.join(".ecos/segredo-sessao"), &antigo).unwrap();
    let migrada = Config::from_env().unwrap();
    assert_eq!(migrada.session_secret, antigo);
    assert!(!notas.join(".ecos/segredo-sessao").exists(), "o backup das notas deixa de levar o segredo");
    assert_eq!(std::fs::read(indice.join("segredo-sessao")).unwrap(), antigo);

    // `ECOS_SECRETS_DIR` manda onde fica.
    let outro = base.join("segredos");
    std::env::set_var("ECOS_SECRETS_DIR", &outro);
    let c = Config::from_env().unwrap();
    assert!(outro.join("segredo-sessao").is_file());
    assert_eq!(c.dir_segredos(), outro);

    // Segredo vindo do ambiente tem precedência e não grava nada.
    std::env::set_var("ECOS_SESSION_SECRET", "vindo-do-ambiente");
    assert_eq!(Config::from_env().unwrap().session_secret, b"vindo-do-ambiente");

    std::fs::remove_dir_all(base).ok();
}
