//! Cifra dos tokens do Google em repouso (AES-256-GCM). A chave mora em `<notes_root>/.ecos/chave-calendario`,
//! gerada no primeiro uso (mesmo padrão do `segredo-sessao`): quem levar só o `index.db` não leva os tokens.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use rand::RngCore;
use std::path::Path;

const NONCE_LEN: usize = 12;

pub struct Cofre {
    cipher: Aes256Gcm,
}

impl Cofre {
    /// Lê a chave (criando-a se ainda não existe). Arquivo com tamanho errado é erro, nunca regenerado em
    /// silêncio: regenerar deixaria os tokens já gravados ilegíveis sem ninguém perceber.
    pub fn carregar(notes_root: &Path) -> anyhow::Result<Self> {
        let dir = notes_root.join(".ecos");
        std::fs::create_dir_all(&dir)?;
        let caminho = dir.join("chave-calendario");
        let chave = if caminho.exists() {
            std::fs::read(&caminho)?
        } else {
            let mut nova = vec![0u8; 32];
            rand::thread_rng().fill_bytes(&mut nova);
            std::fs::write(&caminho, &nova)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&caminho, std::fs::Permissions::from_mode(0o600))?;
            }
            tracing::info!(path = %caminho.display(), "chave de cifra do calendário gerada");
            nova
        };
        if chave.len() != 32 {
            anyhow::bail!("{} deve ter exatamente 32 bytes (tem {})", caminho.display(), chave.len());
        }
        Ok(Self { cipher: Aes256Gcm::new_from_slice(&chave).map_err(|e| anyhow::anyhow!("chave inválida: {e}"))? })
    }

    /// `nonce (12 bytes) || texto cifrado + tag`.
    pub fn cifrar(&self, claro: &[u8]) -> anyhow::Result<Vec<u8>> {
        let mut nonce = [0u8; NONCE_LEN];
        rand::thread_rng().fill_bytes(&mut nonce);
        let cifrado = self.cipher.encrypt(Nonce::from_slice(&nonce), claro).map_err(|_| anyhow::anyhow!("falha ao cifrar"))?;
        Ok([nonce.as_slice(), cifrado.as_slice()].concat())
    }

    pub fn decifrar(&self, blob: &[u8]) -> anyhow::Result<Vec<u8>> {
        if blob.len() <= NONCE_LEN {
            anyhow::bail!("blob cifrado curto demais");
        }
        let (nonce, cifrado) = blob.split_at(NONCE_LEN);
        self.cipher.decrypt(Nonce::from_slice(nonce), cifrado).map_err(|_| anyhow::anyhow!("falha ao decifrar (chave errada ou dado corrompido)"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir_temp() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("ecos-cofre-{}", ecos_core::new_id()))
    }

    #[test]
    fn faz_roundtrip_nao_deixa_o_texto_claro_e_usa_nonce_novo_a_cada_vez() {
        let dir = dir_temp();
        let cofre = Cofre::carregar(&dir).unwrap();
        let a = cofre.cifrar(b"refresh-token-secreto").unwrap();
        let b = cofre.cifrar(b"refresh-token-secreto").unwrap();
        assert!(!a.windows(21).any(|w| w == b"refresh-token-secreto"));
        assert_ne!(a, b, "nonce repetido quebraria o GCM");
        assert_eq!(cofre.decifrar(&a).unwrap(), b"refresh-token-secreto");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn a_chave_persiste_entre_cargas_e_dado_adulterado_ou_chave_errada_falham() {
        let dir = dir_temp();
        let blob = Cofre::carregar(&dir).unwrap().cifrar(b"x").unwrap();
        assert_eq!(Cofre::carregar(&dir).unwrap().decifrar(&blob).unwrap(), b"x");

        let mut adulterado = blob.clone();
        *adulterado.last_mut().unwrap() ^= 1;
        assert!(Cofre::carregar(&dir).unwrap().decifrar(&adulterado).is_err());

        let outro = dir_temp();
        assert!(Cofre::carregar(&outro).unwrap().decifrar(&blob).is_err());
        std::fs::remove_dir_all(dir).ok();
        std::fs::remove_dir_all(outro).ok();
    }

    #[test]
    fn chave_com_tamanho_errado_e_erro_e_nao_e_regenerada() {
        let dir = dir_temp();
        std::fs::create_dir_all(dir.join(".ecos")).unwrap();
        std::fs::write(dir.join(".ecos/chave-calendario"), b"curta").unwrap();
        assert!(Cofre::carregar(&dir).is_err());
        assert_eq!(std::fs::read(dir.join(".ecos/chave-calendario")).unwrap(), b"curta");
        std::fs::remove_dir_all(dir).ok();
    }
}
