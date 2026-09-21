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
    /// Pasta do cofre de um usuário: `<pasta do banco legado>/usuarios/<id>/`.
    pub fn dir_do_usuario(&self, usuario_id: &str) -> PathBuf {
        self.db_path.parent().map(PathBuf::from).unwrap_or_default().join("usuarios").join(usuario_id)
    }

    pub fn db_de(&self, usuario_id: &str) -> PathBuf {
        self.dir_do_usuario(usuario_id).join("ecos-vault.db")
    }

    pub fn meta_de(&self, usuario_id: &str) -> PathBuf {
        self.dir_do_usuario(usuario_id).join("ecos-vault.meta.json")
    }

    pub fn backups_de(&self, usuario_id: &str) -> PathBuf {
        self.backups_dir.join(usuario_id)
    }

    /// O cofre único das versões anteriores (`db_path`/`meta_path` e os `.enc` soltos em `backups_dir`) passa a
    /// ser do usuário informado — o `ecos-app` só pede isso para o primeiro usuário cadastrado. Só age se o
    /// usuário ainda não tem cofre; nunca sobrescreve. Cifra e salt seguem intactos: a senha continua a mesma.
    pub fn adotar_cofre_legado(&self, usuario_id: &str) -> anyhow::Result<bool> {
        if !self.db_path.is_file() || self.db_de(usuario_id).exists() {
            return Ok(false);
        }
        let dir = self.dir_do_usuario(usuario_id);
        std::fs::create_dir_all(&dir)?;
        let mover = |de: &std::path::Path, para: &std::path::Path| -> std::io::Result<()> {
            std::fs::rename(de, para).or_else(|_| std::fs::copy(de, para).and_then(|_| std::fs::remove_file(de)))
        };
        mover(&self.db_path, &self.db_de(usuario_id))?;
        if self.meta_path.is_file() {
            mover(&self.meta_path, &self.meta_de(usuario_id))?;
        }
        let backups = self.backups_de(usuario_id);
        std::fs::create_dir_all(&backups)?;
        for entrada in std::fs::read_dir(&self.backups_dir)?.flatten() {
            if entrada.path().is_file() {
                mover(&entrada.path(), &backups.join(entrada.file_name()))?;
            }
        }
        tracing::info!(usuario = %usuario_id, "cofre único anterior atribuído ao primeiro usuário");
        Ok(true)
    }

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
