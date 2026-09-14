//! Recovery key estilo BIP39, 24 palavras (seção 5.1) — único mecanismo de
//! reset de senha sem depender de e-mail externo garantido numa instância
//! self-hosted.

use bip39::Mnemonic;

/// Gera uma nova recovery key de 24 palavras (256 bits de entropia). Deve
/// ser exibida ao usuário **uma única vez**, no momento do registro — o
/// backend nunca a persiste em claro, só o hash Argon2id (seção 5.1).
pub fn gerar() -> String {
    Mnemonic::generate(24)
        .expect("24 palavras é uma contagem válida para bip39::Mnemonic::generate")
        .to_string()
}

/// Normaliza a frase digitada pelo usuário (espaços/caixa) antes de
/// comparar com o hash salvo — evita falso negativo por diferença cosmética.
pub fn normalizar(frase: &str) -> String {
    frase.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gera_24_palavras() {
        let frase = gerar();
        assert_eq!(frase.split_whitespace().count(), 24);
    }

    #[test]
    fn normalizar_ignora_espacos_extras_e_caixa() {
        assert_eq!(normalizar("  Abacate   Banana  "), "abacate banana");
    }
}
