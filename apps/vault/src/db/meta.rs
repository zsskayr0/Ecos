//! Metadados de ativação do Vault — arquivo pequeno, **não** criptografado
//! (só guarda o salt Argon2id, nunca senha nem chave; ver `crypto.rs`).

use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultMeta {
    pub salt_hex: String,
}

impl VaultMeta {
    pub fn carregar(caminho: &Path) -> anyhow::Result<Option<Self>> {
        if !caminho.exists() {
            return Ok(None);
        }
        let bruto = std::fs::read_to_string(caminho)?;
        Ok(Some(serde_json::from_str(&bruto)?))
    }

    pub fn salvar(&self, caminho: &Path) -> anyhow::Result<()> {
        if let Some(pai) = caminho.parent() {
            std::fs::create_dir_all(pai)?;
        }
        std::fs::write(caminho, serde_json::to_string_pretty(self)?)?;
        Ok(())
    }
}
