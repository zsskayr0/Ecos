//! Leitura automática de comprovantes. Roda o Tesseract (imagens) e o Poppler (PDF) como processos filhos:
//! sem rede (o container do Cofre já não tem rota para fora), com tempo limite e no máximo dois ao mesmo tempo.
//! O arquivo entra pela entrada padrão, então não toca o disco — exceto PDF escaneado, que precisa ser rasterizado
//! e passa por uma pasta em memória (`/dev/shm`) apagada logo depois.
//!
//! Se os programas não existirem (build de desenvolvimento no Windows), o resultado é `Indisponivel` e o
//! comprovante segue o fluxo manual normalmente.

pub mod imagem;
pub mod parser;

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::OnceLock;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::sync::Semaphore;

const TEMPO_LIMITE: Duration = Duration::from_secs(45);
const SAIDA_MAXIMA: usize = 256 * 1024;

#[derive(Debug, Clone, PartialEq)]
pub enum Leitura {
    Texto(String),
    /// Leu, mas não havia texto aproveitável (foto escura, imagem sem escrita).
    SemTexto,
    /// Sem Tesseract/Poppler instalado, ou formato que o motor não lê (HEIC).
    Indisponivel,
    Falhou,
}

impl Leitura {
    pub fn status(&self) -> &'static str {
        match self {
            Leitura::Texto(_) => "pronto",
            Leitura::SemTexto => "sem_texto",
            Leitura::Indisponivel => "indisponivel",
            Leitura::Falhou => "falhou",
        }
    }
}

pub struct Processado {
    pub miniatura: Option<Vec<u8>>,
    pub leitura: Leitura,
}

enum Falha {
    Ausente,
    Erro,
}

fn programa(variavel: &str, padrao: &str) -> String {
    std::env::var(variavel).ok().filter(|v| !v.is_empty()).unwrap_or_else(|| padrao.to_string())
}

/// Nomes dos programas externos. Injetáveis para o teste de "programa ausente" não precisar mexer no ambiente do processo.
#[derive(Clone)]
pub struct Binarios {
    tesseract: String,
    pdftotext: String,
    pdftoppm: String,
}

impl Binarios {
    pub fn do_ambiente() -> Self {
        Self { tesseract: programa("ECOS_TESSERACT_BIN", "tesseract"), pdftotext: programa("ECOS_PDFTOTEXT_BIN", "pdftotext"), pdftoppm: programa("ECOS_PDFTOPPM_BIN", "pdftoppm") }
    }
}

async fn executar(programa: &str, args: &[&str], entrada: Option<Vec<u8>>) -> Result<Vec<u8>, Falha> {
    let mut cmd = Command::new(programa);
    cmd.args(args).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
    cmd.stdin(if entrada.is_some() { Stdio::piped() } else { Stdio::null() });
    let mut filho = cmd.spawn().map_err(|e| if e.kind() == std::io::ErrorKind::NotFound { Falha::Ausente } else { Falha::Erro })?;
    if let (Some(dados), Some(mut stdin)) = (entrada, filho.stdin.take()) {
        // Em tarefa própria: se o programa encerrar antes de ler tudo, a escrita só falha (e é ignorada).
        tokio::spawn(async move { let _ = stdin.write_all(&dados).await; });
    }
    match tokio::time::timeout(TEMPO_LIMITE, filho.wait_with_output()).await {
        Ok(Ok(saida)) if saida.status.success() => {
            let mut dados = saida.stdout;
            dados.truncate(SAIDA_MAXIMA);
            Ok(dados)
        }
        _ => Err(Falha::Erro), // erro, saída diferente de zero ou tempo esgotado (o filho é encerrado ao sair do escopo)
    }
}

fn limite() -> &'static Semaphore {
    static L: OnceLock<Semaphore> = OnceLock::new();
    L.get_or_init(|| Semaphore::new(2))
}

fn texto_util(bytes: Vec<u8>) -> Leitura {
    let texto = String::from_utf8_lossy(&bytes).to_string();
    if texto.chars().filter(|c| c.is_alphanumeric()).count() < 10 { Leitura::SemTexto } else { Leitura::Texto(texto) }
}

async fn ocr_de_png(bin: &Binarios, png: Vec<u8>) -> Leitura {
    let lingua = programa("ECOS_OCR_LANG", "por");
    let psm = programa("ECOS_OCR_PSM", "3");
    match executar(&bin.tesseract, &["stdin", "stdout", "-l", &lingua, "--psm", &psm], Some(png)).await {
        Ok(saida) => texto_util(saida),
        Err(Falha::Ausente) => Leitura::Indisponivel,
        Err(Falha::Erro) => Leitura::Falhou,
    }
}

fn pasta_temporaria() -> PathBuf {
    let shm = PathBuf::from("/dev/shm");
    let base = std::env::var("ECOS_OCR_TMP").ok().map(PathBuf::from).unwrap_or_else(|| if shm.is_dir() { shm } else { std::env::temp_dir() });
    base.join(format!("ecos-ocr-{}", ecos_core::new_id()))
}

async fn ler_pdf(bin: &Binarios, pdf: Vec<u8>) -> Leitura {
    // 1) PDF digital (extrato, comprovante gerado pelo banco) tem camada de texto: é exata e instantânea.
    match executar(&bin.pdftotext, &["-layout", "-enc", "UTF-8", "-", "-"], Some(pdf.clone())).await {
        Ok(saida) => {
            if let Leitura::Texto(t) = texto_util(saida) { return Leitura::Texto(t); }
        }
        Err(Falha::Ausente) => return Leitura::Indisponivel,
        Err(Falha::Erro) => return Leitura::Falhou,
    }
    // 2) PDF escaneado: rasteriza a primeira página e lê como imagem.
    let pasta = pasta_temporaria();
    if tokio::fs::create_dir_all(&pasta).await.is_err() { return Leitura::Falhou; }
    let resultado = async {
        let origem = pasta.join("in.pdf");
        tokio::fs::write(&origem, &pdf).await.ok()?;
        let prefixo = pasta.join("pagina");
        executar(&bin.pdftoppm, &["-r", "150", "-f", "1", "-l", "1", "-png", origem.to_str()?, prefixo.to_str()?], None).await.ok()?;
        let mut entradas = tokio::fs::read_dir(&pasta).await.ok()?;
        while let Ok(Some(e)) = entradas.next_entry().await {
            if e.path().extension().is_some_and(|x| x == "png") {
                return tokio::fs::read(e.path()).await.ok();
            }
        }
        None
    }
    .await;
    let _ = tokio::fs::remove_dir_all(&pasta).await;
    match resultado {
        Some(png) => ocr_de_png(bin, png).await,
        None => Leitura::Falhou,
    }
}

/// Gera a miniatura e lê o texto. Nunca falha: o pior resultado é `Indisponivel`/`Falhou` e o fluxo manual segue.
pub async fn processar(bytes: Vec<u8>, mime: String) -> Processado {
    processar_com(&Binarios::do_ambiente(), bytes, mime).await
}

pub async fn processar_com(bin: &Binarios, bytes: Vec<u8>, mime: String) -> Processado {
    let _vaga = limite().acquire().await.ok();
    if mime == "application/pdf" {
        return Processado { miniatura: None, leitura: ler_pdf(bin, bytes).await };
    }
    if mime == "image/heic" {
        // Nem o Tesseract nem o decodificador do servidor leem HEIC. O arquivo é guardado normalmente.
        return Processado { miniatura: None, leitura: Leitura::Indisponivel };
    }
    let preparado = tokio::task::spawn_blocking(move || {
        let img = imagem::decodificar(&bytes)?;
        Some((imagem::miniatura_jpeg(&img), imagem::png_para_ocr(&img)))
    })
    .await
    .ok()
    .flatten();
    match preparado {
        Some((miniatura, Some(png))) => Processado { miniatura, leitura: ocr_de_png(bin, png).await },
        Some((miniatura, None)) => Processado { miniatura, leitura: Leitura::Falhou },
        None => Processado { miniatura: None, leitura: Leitura::Falhou },
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[tokio::test]
    async fn sem_os_programas_o_resultado_e_indisponivel_e_a_miniatura_sai_mesmo_assim() {
        let ausentes = Binarios { tesseract: "ecos-programa-que-nao-existe".into(), pdftotext: "ecos-programa-que-nao-existe".into(), pdftoppm: "ecos-programa-que-nao-existe".into() };
        let img = image::DynamicImage::ImageRgb8(image::RgbImage::new(64, 64));
        let mut png = std::io::Cursor::new(Vec::new());
        img.write_to(&mut png, image::ImageFormat::Png).unwrap();
        let r = processar_com(&ausentes, png.into_inner(), "image/png".into()).await;
        assert_eq!(r.leitura, Leitura::Indisponivel);
        assert!(r.miniatura.is_some());
        assert_eq!(processar_com(&ausentes, b"%PDF-1.7".to_vec(), "application/pdf".into()).await.leitura, Leitura::Indisponivel);
        assert_eq!(processar_com(&ausentes, vec![1, 2, 3], "image/heic".into()).await.leitura, Leitura::Indisponivel);
        assert_eq!(processar_com(&ausentes, b"nao e png".to_vec(), "image/png".into()).await.leitura, Leitura::Falhou);
    }

    /// Fim a fim com o Tesseract de verdade. Só roda com `ECOS_OCR_E2E_IMAGE=<png com texto>` (ver Dockerfile de teste).
    #[tokio::test]
    #[ignore]
    async fn tesseract_real_le_um_comprovante_gerado() {
        let caminho = std::env::var("ECOS_OCR_E2E_IMAGE").expect("defina ECOS_OCR_E2E_IMAGE");
        let bytes = std::fs::read(caminho).unwrap();
        let r = processar(bytes, "image/png".into()).await;
        let Leitura::Texto(texto) = r.leitura else { panic!("esperava texto, veio {:?}", r.leitura) };
        eprintln!("--- texto lido ---\n{texto}\n------------------");
        let s = parser::analisar(&texto);
        assert_eq!(s.valor_centavos, Some(123_456), "{s:?}");
        assert_eq!(s.data, chrono::NaiveDate::from_ymd_opt(2026, 9, 30), "{s:?}");
        assert!(r.miniatura.is_some());
    }

    /// PDF escaneado (só imagem, sem camada de texto): passa pelo Poppler, é rasterizado e lido pelo Tesseract.
    #[tokio::test]
    #[ignore]
    async fn pdf_escaneado_e_rasterizado_e_lido() {
        let caminho = std::env::var("ECOS_OCR_E2E_PDF").expect("defina ECOS_OCR_E2E_PDF");
        let r = processar(std::fs::read(caminho).unwrap(), "application/pdf".into()).await;
        let Leitura::Texto(texto) = r.leitura else { panic!("esperava texto, veio {:?}", r.leitura) };
        assert_eq!(parser::analisar(&texto).valor_centavos, Some(123_456), "{texto}");
    }
}
