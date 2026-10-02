//! Decodificação segura de imagem: limites de dimensão e memória (contra "decompression bomb"), orientação EXIF
//! aplicada (foto de celular costuma vir "deitada"), miniatura JPEG e versão em tons de cinza para o OCR.

use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader, Limits};
use std::io::Cursor;

/// 48 megapixels cabem numa foto de celular; acima disso é abuso ou erro.
const LADO_MAXIMO: u32 = 10_000;
const MEMORIA_MAXIMA: u64 = 512 * 1024 * 1024;

pub fn decodificar(bytes: &[u8]) -> Option<DynamicImage> {
    let leitor = ImageReader::new(Cursor::new(bytes)).with_guessed_format().ok()?;
    let mut limites = Limits::default();
    limites.max_image_width = Some(LADO_MAXIMO);
    limites.max_image_height = Some(LADO_MAXIMO);
    limites.max_alloc = Some(MEMORIA_MAXIMA);
    let mut decodificador = leitor.into_decoder().ok()?;
    decodificador.set_limits(limites).ok()?;
    let orientacao = decodificador.orientation().ok();
    let mut imagem = DynamicImage::from_decoder(decodificador).ok()?;
    if let Some(o) = orientacao {
        imagem.apply_orientation(o);
    }
    Some(imagem)
}

/// JPEG de até 320 px no maior lado. Reencodar descarta os metadados (EXIF, GPS) da miniatura.
pub fn miniatura_jpeg(imagem: &DynamicImage) -> Option<Vec<u8>> {
    let pequena = imagem.thumbnail(320, 320).to_rgb8();
    let mut saida = Cursor::new(Vec::new());
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut saida, 75).encode_image(&pequena).ok()?;
    Some(saida.into_inner())
}

/// PNG em tons de cinza, com o maior lado entre 1.200 e 3.000 px: pequeno demais o Tesseract erra, grande demais demora.
pub fn png_para_ocr(imagem: &DynamicImage) -> Option<Vec<u8>> {
    let cinza = imagem.grayscale();
    let maior = cinza.width().max(cinza.height());
    let ajustada = if maior < 1200 {
        cinza.resize(cinza.width() * 2, cinza.height() * 2, image::imageops::FilterType::Lanczos3)
    } else if maior > 3000 {
        cinza.resize(3000, 3000, image::imageops::FilterType::Triangle)
    } else {
        cinza
    };
    let mut saida = Cursor::new(Vec::new());
    ajustada.write_to(&mut saida, ImageFormat::Png).ok()?;
    Some(saida.into_inner())
}

#[cfg(test)]
mod testes {
    use super::*;

    fn png_de(largura: u32, altura: u32) -> Vec<u8> {
        let img = DynamicImage::ImageRgb8(image::RgbImage::from_fn(largura, altura, |x, y| image::Rgb([(x % 256) as u8, (y % 256) as u8, 128])));
        let mut s = Cursor::new(Vec::new());
        img.write_to(&mut s, ImageFormat::Png).unwrap();
        s.into_inner()
    }

    #[test]
    fn miniatura_e_jpeg_pequeno_e_o_png_do_ocr_cresce_imagem_pequena() {
        let original = png_de(800, 600);
        let img = decodificar(&original).unwrap();
        let mini = miniatura_jpeg(&img).unwrap();
        assert!(mini.starts_with(&[0xFF, 0xD8, 0xFF]));
        let m = decodificar(&mini).unwrap();
        assert!(m.width().max(m.height()) <= 320);
        let ocr = decodificar(&png_para_ocr(&decodificar(&png_de(400, 300)).unwrap()).unwrap()).unwrap();
        assert_eq!((ocr.width(), ocr.height()), (800, 600));
    }

    /// PNG que *declara* 60.000 × 60.000 px: tem de ser recusado lendo só o cabeçalho, sem alocar memória.
    #[test]
    fn imagem_que_declara_dimensao_absurda_e_recusada() {
        fn crc32(dados: &[u8]) -> u32 {
            let mut c = 0xFFFF_FFFFu32;
            for b in dados {
                c ^= *b as u32;
                for _ in 0..8 { c = if c & 1 == 1 { (c >> 1) ^ 0xEDB8_8320 } else { c >> 1 }; }
            }
            !c
        }
        let mut ihdr = b"IHDR".to_vec();
        ihdr.extend_from_slice(&60_000u32.to_be_bytes());
        ihdr.extend_from_slice(&60_000u32.to_be_bytes());
        ihdr.extend_from_slice(&[8, 2, 0, 0, 0]);
        let mut png = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
        png.extend_from_slice(&13u32.to_be_bytes());
        png.extend_from_slice(&ihdr);
        png.extend_from_slice(&crc32(&ihdr).to_be_bytes());
        assert!(decodificar(&png).is_none());
    }

    #[test]
    fn lixo_nao_decodifica() {
        assert!(decodificar(b"isto nao e imagem").is_none());
        assert!(decodificar(&[]).is_none());
    }
}
