//! Derivação da chave do Vault (seção 5.3): Argon2id sobre a senha do
//! Cofre + salt aleatório persistido em `ecos-vault.meta.json` (arquivo
//! **não** criptografado — só o salt mora ali, nunca a senha nem a chave
//! derivada; sem a senha certa, o salt sozinho não abre nada).
//!
//! **RISCO/limitação desta build** (ver plano de execução, seção "Camada de
//! dados", e `Cargo.toml` deste crate): SQLCipher de verdade
//! (`--features real-sqlcipher`) exige compilar OpenSSL a partir do fonte
//! via `perl`+`cc` — indisponível neste ambiente de desenvolvimento Windows
//! (a distribuição de Perl do Git não traz os módulos CPAN que o script
//! `Configure` da OpenSSL precisa). A build de produção (Dockerfile, Linux)
//! ativa essa feature com um Perl completo instalado. **Sem ela, o arquivo
//! do Vault não é criptografado** — a chave ainda é derivada e a
//! arquitetura de bloqueio/desbloqueio funciona igual, só a cifra em si
//! fica ausente; nunca rodar essa build com dado financeiro real.

use argon2::Argon2;
use rand::RngCore;

pub const TAMANHO_SALT: usize = 16;
pub const TAMANHO_CHAVE: usize = 32;

pub fn gerar_salt() -> [u8; TAMANHO_SALT] {
    let mut salt = [0u8; TAMANHO_SALT];
    rand::thread_rng().fill_bytes(&mut salt);
    salt
}

pub fn derivar_chave(senha: &str, salt: &[u8]) -> [u8; TAMANHO_CHAVE] {
    let mut saida = [0u8; TAMANHO_CHAVE];
    Argon2::default()
        .hash_password_into(senha.as_bytes(), salt, &mut saida)
        .expect("Argon2id com parâmetros padrão não falha para tamanhos de saída válidos");
    saida
}

pub fn para_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn de_hex(hex: &str) -> Option<Vec<u8>> {
    if hex.len() % 2 != 0 {
        return None;
    }
    (0..hex.len()).step_by(2).map(|i| u8::from_str_radix(&hex[i..i + 2], 16).ok()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_roundtrip() {
        let salt = gerar_salt();
        let hex = para_hex(&salt);
        assert_eq!(de_hex(&hex).unwrap(), salt.to_vec());
    }

    #[test]
    fn mesma_senha_e_salt_geram_a_mesma_chave() {
        let salt = gerar_salt();
        let a = derivar_chave("senha-do-cofre", &salt);
        let b = derivar_chave("senha-do-cofre", &salt);
        assert_eq!(a, b);
    }

    #[test]
    fn senhas_diferentes_geram_chaves_diferentes() {
        let salt = gerar_salt();
        let a = derivar_chave("senha-a", &salt);
        let b = derivar_chave("senha-b", &salt);
        assert_ne!(a, b);
    }
}
