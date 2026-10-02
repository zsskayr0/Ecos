//! Recepção segura de comprovantes: o tipo do arquivo é decidido pelo **conteúdo** (magic bytes), nunca pelo
//! `Content-Type` nem pela extensão que o cliente declarou — o que é gravado e devolvido depois é o tipo detectado.

use axum::extract::multipart::Multipart;
use ecos_core::types::ANEXO_TAMANHO_MAXIMO_BYTES;
use ecos_core::ErrorCode;
use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult};

/// Limite do corpo de um upload: o arquivo (8 MB) mais o envelope multipart. Sem isso o axum corta em 2 MB.
pub const LIMITE_CORPO_UPLOAD_BYTES: usize = 10 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TipoArquivo {
    pub mime: &'static str,
    pub extensao: &'static str,
}

/// Só estes tipos entram no Cofre. SVG e HTML ficam de fora de propósito: carregam script.
pub fn detectar_tipo(bytes: &[u8]) -> Option<TipoArquivo> {
    let tipo = |mime, extensao| Some(TipoArquivo { mime, extensao });
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        tipo("image/jpeg", "jpg")
    } else if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        tipo("image/png", "png")
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        tipo("image/webp", "webp")
    } else if bytes.starts_with(b"%PDF-") {
        tipo("application/pdf", "pdf")
    } else if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" && matches!(&bytes[8..12], b"heic" | b"heix" | b"heim" | b"heis" | b"mif1" | b"msf1") {
        tipo("image/heic", "heic")
    } else {
        None
    }
}

/// Só o nome, sem diretórios nem caracteres de controle; vazio vira `comprovante.<ext>`.
pub fn nome_seguro(declarado: &str, extensao: &str) -> String {
    let base = declarado.rsplit(['/', '\\']).next().unwrap_or("");
    let limpo: String = base.chars().filter(|c| !c.is_control()).collect::<String>().trim().trim_start_matches('.').chars().take(120).collect();
    if limpo.is_empty() { format!("comprovante.{extensao}") } else { limpo }
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

pub struct ArquivoRecebido {
    pub nome: String,
    pub tipo: TipoArquivo,
    pub bytes: Vec<u8>,
    pub checksum: String,
}

/// Lê o campo multipart `campo` e valida tamanho e tipo. Erro de validação se o campo faltar.
pub async fn ler_multipart(multipart: &mut Multipart, campo: &str) -> AppResult<ArquivoRecebido> {
    while let Some(parte) = multipart.next_field().await.map_err(|_| AppError::new(ErrorCode::ValidationError))? {
        if parte.name() != Some(campo) {
            continue;
        }
        let declarado = parte.file_name().unwrap_or("").to_string();
        let bytes = parte.bytes().await.map_err(|_| AppError::new(ErrorCode::AttachmentTooLarge))?;
        if bytes.is_empty() {
            return Err(AppError::new(ErrorCode::ValidationError).with_message("O arquivo está vazio."));
        }
        if bytes.len() as i64 > ANEXO_TAMANHO_MAXIMO_BYTES {
            return Err(AppError::new(ErrorCode::AttachmentTooLarge));
        }
        let tipo = detectar_tipo(&bytes).ok_or_else(|| {
            AppError::new(ErrorCode::ValidationError).with_message("Tipo de arquivo não aceito. Use JPEG, PNG, WebP, HEIC ou PDF.")
        })?;
        return Ok(ArquivoRecebido { nome: nome_seguro(&declarado, tipo.extensao), tipo, checksum: sha256_hex(&bytes), bytes: bytes.to_vec() });
    }
    Err(AppError::new(ErrorCode::ValidationError).with_message(format!("campo '{campo}' ausente no multipart")))
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn detecta_pelo_conteudo_e_ignora_o_que_o_cliente_diz() {
        assert_eq!(detectar_tipo(&[0xFF, 0xD8, 0xFF, 0xE0, 0, 0]).unwrap().mime, "image/jpeg");
        assert_eq!(detectar_tipo(b"%PDF-1.7\n").unwrap().mime, "application/pdf");
        assert_eq!(detectar_tipo(b"RIFF\x10\0\0\0WEBPVP8 ").unwrap().mime, "image/webp");
        assert_eq!(detectar_tipo(b"\0\0\0\x18ftypheic\0\0\0\0").unwrap().mime, "image/heic");
        assert!(detectar_tipo(b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>").is_none());
        assert!(detectar_tipo(b"<html><script>alert(1)</script></html>").is_none());
        assert!(detectar_tipo(b"MZ\x90\0 executavel").is_none());
        assert!(detectar_tipo(&[]).is_none());
    }

    #[test]
    fn nome_nao_carrega_caminho_nem_controle() {
        assert_eq!(nome_seguro("../../etc/passwd", "jpg"), "passwd");
        assert_eq!(nome_seguro("C:\\Users\\eu\\pix.pdf", "pdf"), "pix.pdf");
        assert_eq!(nome_seguro("..", "png"), "comprovante.png");
        assert_eq!(nome_seguro("a\nb\0.png", "png"), "ab.png");
        assert_eq!(nome_seguro("", "pdf"), "comprovante.pdf");
        assert_eq!(nome_seguro(&"x".repeat(500), "pdf").chars().count(), 120);
    }
}
