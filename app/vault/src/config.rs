//! Configuração do `ecos-vault-db` (seção 2/5.3). Bind só em rede interna
//! Docker — nunca lê `ECOS_PORT` pensando em exposição pública.

use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct Config {
    pub porta: u16,
    pub db_path: PathBuf,
    pub meta_path: PathBuf,
    pub backups_dir: PathBuf,
}

fn env_u16(key: &str, default: u16) -> u16 {
    std::env::var(key).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let db_path: PathBuf = std::env::var("ECOS_VAULT_DB_PATH").unwrap_or_else(|_| "./data/vault/ecos-vault.db".to_string()).into();
        let meta_path: PathBuf = std::env::var("ECOS_VAULT_META_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| db_path.with_extension("meta.json"));
        let backups_dir: PathBuf = std::env::var("ECOS_BACKUPS_DIR").unwrap_or_else(|_| "./data/backups".to_string()).into();

        if let Some(pai) = db_path.parent() {
            std::fs::create_dir_all(pai)?;
        }
        std::fs::create_dir_all(&backups_dir)?;

        Ok(Self {
            porta: env_u16("ECOS_PORT", 8090),
            db_path,
            meta_path,
            backups_dir,
        })
    }
}
