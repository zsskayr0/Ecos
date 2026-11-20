//! Escritor de `.zip` mínimo (método "stored", sem compressão) para o pacote do Fechamento. Os comprovantes já são PDF ou
//! imagem comprimidos e o resto é texto pequeno, então comprimir de novo custaria CPU sem ganho.
//!
//! Tem ZIP64: arquivos de 4 GB ou mais, deslocamentos além de 4 GB e mais de 65 535 arquivos são gravados com os campos
//! estendidos do formato (versão 4.5), que o Explorador do Windows, o macOS e o 7-Zip abrem. Abaixo desses limites o
//! arquivo sai no formato clássico, que qualquer leitor entende. O pacote do Fechamento tem teto de tamanho por causa da
//! memória (ele é montado em RAM), não por causa do formato.

use std::io::{self, Write};

const CRC_TABELA: [u32; 256] = {
    let mut tabela = [0u32; 256];
    let mut i = 0;
    while i < 256 {
        let mut c = i as u32;
        let mut k = 0;
        while k < 8 {
            c = if c & 1 != 0 { 0xEDB8_8320 ^ (c >> 1) } else { c >> 1 };
            k += 1;
        }
        tabela[i] = c;
        i += 1;
    }
    tabela
};

/// CRC-32 (o do formato zip) de um bloco de bytes.
pub fn crc32(dados: &[u8]) -> u32 {
    dados.iter().fold(!0u32, |c, b| CRC_TABELA[((c ^ *b as u32) & 0xFF) as usize] ^ (c >> 8)) ^ !0
}

const MAIS_DE_32_BITS: u32 = 0xFFFF_FFFF;
const MAIS_DE_16_BITS: u16 = 0xFFFF;

struct Entrada {
    nome: String,
    crc: u32,
    tamanho: u64,
    deslocamento: u64,
}

pub struct ZipWriter<W: Write> {
    saida: W,
    posicao: u64,
    entradas: Vec<Entrada>,
    dos_hora: u16,
    dos_data: u16,
    /// A partir de que valor um tamanho ou deslocamento passa a exigir ZIP64 (0xFFFFFFFF no formato; menor só em teste).
    limite_32: u64,
    /// A partir de quantos arquivos o diretório passa a exigir ZIP64 (0xFFFF no formato; menor só em teste).
    limite_16: usize,
}

impl<W: Write> ZipWriter<W> {
    pub fn new(saida: W) -> Self {
        use chrono::{Datelike, Timelike};
        let agora = chrono::Utc::now();
        let dos_hora = ((agora.hour() << 11) | (agora.minute() << 5) | (agora.second() / 2)) as u16;
        let dos_data = (((agora.year().max(1980) - 1980) as u32) << 9 | (agora.month() << 5) | agora.day()) as u16;
        Self { saida, posicao: 0, entradas: Vec::new(), dos_hora, dos_data, limite_32: MAIS_DE_32_BITS as u64, limite_16: MAIS_DE_16_BITS as usize }
    }

    /// Só para teste: baixa os limites para exercitar o ZIP64 sem gravar 4 GB.
    #[cfg(test)]
    pub(crate) fn com_limites(mut self, limite_32: u64, limite_16: usize) -> Self {
        self.limite_32 = limite_32;
        self.limite_16 = limite_16;
        self
    }

    fn escrever(&mut self, bytes: &[u8]) -> io::Result<()> {
        self.saida.write_all(bytes)?;
        self.posicao += bytes.len() as u64;
        Ok(())
    }

    /// Acrescenta um arquivo. `nome` usa `/` como separador e é gravado em UTF-8.
    pub fn adicionar_bytes(&mut self, nome: &str, dados: &[u8]) -> io::Result<()> {
        if nome.len() > u16::MAX as usize {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "nome de arquivo longo demais para o formato .zip"));
        }
        let tamanho = dados.len() as u64;
        let crc = crc32(dados);
        let zip64 = tamanho >= self.limite_32;
        let mut c = Vec::with_capacity(30 + nome.len() + 20);
        c.extend_from_slice(&0x0403_4B50u32.to_le_bytes());
        c.extend_from_slice(&(if zip64 { 45u16 } else { 20u16 }).to_le_bytes()); // versão mínima
        c.extend_from_slice(&0x0800u16.to_le_bytes()); // bit 11: nome em UTF-8
        c.extend_from_slice(&0u16.to_le_bytes()); // stored
        c.extend_from_slice(&self.dos_hora.to_le_bytes());
        c.extend_from_slice(&self.dos_data.to_le_bytes());
        c.extend_from_slice(&crc.to_le_bytes());
        if zip64 {
            c.extend_from_slice(&MAIS_DE_32_BITS.to_le_bytes());
            c.extend_from_slice(&MAIS_DE_32_BITS.to_le_bytes());
        } else {
            c.extend_from_slice(&(tamanho as u32).to_le_bytes());
            c.extend_from_slice(&(tamanho as u32).to_le_bytes());
        }
        c.extend_from_slice(&(nome.len() as u16).to_le_bytes());
        c.extend_from_slice(&(if zip64 { 20u16 } else { 0u16 }).to_le_bytes());
        c.extend_from_slice(nome.as_bytes());
        if zip64 {
            // Campo extra 0x0001 do cabeçalho local: tamanho original e tamanho gravado, os dois.
            c.extend_from_slice(&1u16.to_le_bytes());
            c.extend_from_slice(&16u16.to_le_bytes());
            c.extend_from_slice(&tamanho.to_le_bytes());
            c.extend_from_slice(&tamanho.to_le_bytes());
        }
        let deslocamento = self.posicao;
        self.escrever(&c)?;
        self.entradas.push(Entrada { nome: nome.to_string(), crc, tamanho, deslocamento });
        self.escrever(dados)
    }

    /// Escreve o diretório central (e os registros ZIP64 quando precisa) e devolve a saída.
    pub fn finalizar(mut self) -> io::Result<W> {
        let inicio_diretorio = self.posicao;
        let entradas = std::mem::take(&mut self.entradas);
        for e in &entradas {
            let tamanho_grande = e.tamanho >= self.limite_32;
            let deslocamento_grande = e.deslocamento >= self.limite_32;
            // Campo extra 0x0001 do diretório: só os campos que estouraram, nesta ordem (tamanho, gravado, deslocamento).
            let mut extra = Vec::new();
            if tamanho_grande || deslocamento_grande {
                let mut corpo = Vec::new();
                if tamanho_grande {
                    corpo.extend_from_slice(&e.tamanho.to_le_bytes());
                    corpo.extend_from_slice(&e.tamanho.to_le_bytes());
                }
                if deslocamento_grande {
                    corpo.extend_from_slice(&e.deslocamento.to_le_bytes());
                }
                extra.extend_from_slice(&1u16.to_le_bytes());
                extra.extend_from_slice(&(corpo.len() as u16).to_le_bytes());
                extra.extend_from_slice(&corpo);
            }
            let versao: u16 = if extra.is_empty() { 20 } else { 45 };
            let mut c = Vec::with_capacity(46 + e.nome.len() + extra.len());
            c.extend_from_slice(&0x0201_4B50u32.to_le_bytes());
            c.extend_from_slice(&versao.to_le_bytes()); // versão criada
            c.extend_from_slice(&versao.to_le_bytes()); // versão mínima
            c.extend_from_slice(&0x0800u16.to_le_bytes());
            c.extend_from_slice(&0u16.to_le_bytes());
            c.extend_from_slice(&self.dos_hora.to_le_bytes());
            c.extend_from_slice(&self.dos_data.to_le_bytes());
            c.extend_from_slice(&e.crc.to_le_bytes());
            let tamanho_32 = if tamanho_grande { MAIS_DE_32_BITS } else { e.tamanho as u32 };
            c.extend_from_slice(&tamanho_32.to_le_bytes());
            c.extend_from_slice(&tamanho_32.to_le_bytes());
            c.extend_from_slice(&(e.nome.len() as u16).to_le_bytes());
            c.extend_from_slice(&(extra.len() as u16).to_le_bytes());
            c.extend_from_slice(&[0u8; 6]); // comentário, disco, atributos internos
            c.extend_from_slice(&0u32.to_le_bytes()); // atributos externos
            let deslocamento_32 = if deslocamento_grande { MAIS_DE_32_BITS } else { e.deslocamento as u32 };
            c.extend_from_slice(&deslocamento_32.to_le_bytes());
            c.extend_from_slice(e.nome.as_bytes());
            c.extend_from_slice(&extra);
            self.escrever(&c)?;
        }
        let tamanho_diretorio = self.posicao - inicio_diretorio;
        let total = entradas.len();
        let precisa_zip64 = total >= self.limite_16 || inicio_diretorio >= self.limite_32 || tamanho_diretorio >= self.limite_32;
        if precisa_zip64 {
            let inicio_registro = self.posicao;
            let mut z = Vec::with_capacity(56 + 20);
            z.extend_from_slice(&0x0606_4B50u32.to_le_bytes()); // registro de fim do diretório ZIP64
            z.extend_from_slice(&44u64.to_le_bytes());
            z.extend_from_slice(&45u16.to_le_bytes());
            z.extend_from_slice(&45u16.to_le_bytes());
            z.extend_from_slice(&0u32.to_le_bytes()); // este disco
            z.extend_from_slice(&0u32.to_le_bytes()); // disco do diretório
            z.extend_from_slice(&(total as u64).to_le_bytes());
            z.extend_from_slice(&(total as u64).to_le_bytes());
            z.extend_from_slice(&tamanho_diretorio.to_le_bytes());
            z.extend_from_slice(&inicio_diretorio.to_le_bytes());
            z.extend_from_slice(&0x0706_4B50u32.to_le_bytes()); // localizador do registro ZIP64
            z.extend_from_slice(&0u32.to_le_bytes());
            z.extend_from_slice(&inicio_registro.to_le_bytes());
            z.extend_from_slice(&1u32.to_le_bytes()); // total de discos
            self.escrever(&z)?;
        }
        let mut fim = Vec::with_capacity(22);
        fim.extend_from_slice(&0x0605_4B50u32.to_le_bytes());
        fim.extend_from_slice(&[0u8; 4]);
        let total_16 = if precisa_zip64 { MAIS_DE_16_BITS } else { total as u16 };
        fim.extend_from_slice(&total_16.to_le_bytes());
        fim.extend_from_slice(&total_16.to_le_bytes());
        fim.extend_from_slice(&(if precisa_zip64 { MAIS_DE_32_BITS } else { tamanho_diretorio as u32 }).to_le_bytes());
        fim.extend_from_slice(&(if precisa_zip64 { MAIS_DE_32_BITS } else { inicio_diretorio as u32 }).to_le_bytes());
        fim.extend_from_slice(&0u16.to_le_bytes());
        self.escrever(&fim)?;
        self.saida.flush()?;
        Ok(self.saida)
    }
}

#[cfg(test)]
pub(crate) mod testes {
    use super::*;

    #[test]
    fn crc32_confere_com_o_valor_conhecido() {
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
        assert_eq!(crc32(b""), 0);
    }

    fn u16_em(b: &[u8], p: usize) -> u16 {
        u16::from_le_bytes(b[p..p + 2].try_into().unwrap())
    }
    fn u32_em(b: &[u8], p: usize) -> u32 {
        u32::from_le_bytes(b[p..p + 4].try_into().unwrap())
    }
    fn u64_em(b: &[u8], p: usize) -> u64 {
        u64::from_le_bytes(b[p..p + 8].try_into().unwrap())
    }

    /// Lê de volta o diretório central do que foi escrito (clássico ou ZIP64): nomes, CRC (conferido) e o conteúdo de cada arquivo.
    pub fn ler_de_volta(bytes: &[u8]) -> Vec<(String, Vec<u8>)> {
        let fim = bytes.len() - 22;
        assert_eq!(&bytes[fim..fim + 4], &0x0605_4B50u32.to_le_bytes());
        let mut total = u16_em(bytes, fim + 10) as u64;
        let mut inicio = u32_em(bytes, fim + 16) as u64;
        if total == MAIS_DE_16_BITS as u64 || inicio == MAIS_DE_32_BITS as u64 {
            // Localizador (20 bytes) logo antes do fim clássico, apontando para o registro ZIP64.
            let loc = fim - 20;
            assert_eq!(&bytes[loc..loc + 4], &0x0706_4B50u32.to_le_bytes(), "localizador ZIP64");
            let reg = u64_em(bytes, loc + 8) as usize;
            assert_eq!(&bytes[reg..reg + 4], &0x0606_4B50u32.to_le_bytes(), "registro ZIP64");
            total = u64_em(bytes, reg + 32);
            inicio = u64_em(bytes, reg + 48);
        }
        let mut lidos = Vec::new();
        let mut p = inicio as usize;
        for _ in 0..total {
            assert_eq!(&bytes[p..p + 4], &0x0201_4B50u32.to_le_bytes());
            let crc = u32_em(bytes, p + 16);
            let mut tam = u32_em(bytes, p + 24) as u64;
            let nome_len = u16_em(bytes, p + 28) as usize;
            let extra_len = u16_em(bytes, p + 30) as usize;
            let mut local = u32_em(bytes, p + 42) as u64;
            let nome = std::str::from_utf8(&bytes[p + 46..p + 46 + nome_len]).unwrap().to_string();
            let extra = &bytes[p + 46 + nome_len..p + 46 + nome_len + extra_len];
            if tam == MAIS_DE_32_BITS as u64 || local == MAIS_DE_32_BITS as u64 {
                assert_eq!(u16_em(extra, 0), 1, "campo extra ZIP64 de {nome}");
                let mut q = 4;
                if tam == MAIS_DE_32_BITS as u64 {
                    tam = u64_em(extra, q);
                    assert_eq!(u64_em(extra, q + 8), tam, "tamanho gravado de {nome}");
                    q += 16;
                }
                if local == MAIS_DE_32_BITS as u64 {
                    local = u64_em(extra, q);
                }
            }
            let local = local as usize;
            assert_eq!(&bytes[local..local + 4], &0x0403_4B50u32.to_le_bytes());
            let dados_ini = local + 30 + u16_em(bytes, local + 26) as usize + u16_em(bytes, local + 28) as usize;
            let dados = bytes[dados_ini..dados_ini + tam as usize].to_vec();
            assert_eq!(crc32(&dados), crc, "CRC de {nome}");
            lidos.push((nome, dados));
            p += 46 + nome_len + extra_len;
        }
        lidos
    }

    #[test]
    fn zip_escrito_e_lido_de_volta_com_nomes_em_utf8() {
        let mut z = ZipWriter::new(Vec::new());
        z.adicionar_bytes("LEIA-ME.txt", "olá, contabilidade".as_bytes()).unwrap();
        z.adicionar_bytes("comprovantes/2026-10-05_café_100,00.pdf", &[1, 2, 3, 4]).unwrap();
        z.adicionar_bytes("vazio.csv", b"").unwrap();
        let bytes = z.finalizar().unwrap();
        // Pequeno assim, sai no formato clássico: sem registro nem localizador ZIP64.
        assert!(!bytes.windows(4).any(|w| w == 0x0606_4B50u32.to_le_bytes()));
        let lidos = ler_de_volta(&bytes);
        assert_eq!(lidos.len(), 3);
        assert_eq!(lidos[0], ("LEIA-ME.txt".to_string(), "olá, contabilidade".as_bytes().to_vec()));
        assert_eq!(lidos[1], ("comprovantes/2026-10-05_café_100,00.pdf".to_string(), vec![1, 2, 3, 4]));
        assert_eq!(lidos[2], ("vazio.csv".to_string(), vec![]));
    }

    #[test]
    fn zip64_por_tamanho_e_deslocamento_e_por_quantidade() {
        // Limites baixos: arquivo de 10 bytes "estoura" o campo de 32 bits, e a partir do 4º arquivo o deslocamento também.
        let mut z = ZipWriter::new(Vec::new()).com_limites(10, 3);
        z.adicionar_bytes("pequeno.txt", b"abc").unwrap();
        z.adicionar_bytes("grande.bin", &[7u8; 10]).unwrap();
        z.adicionar_bytes("outro.txt", b"xyz").unwrap();
        z.adicionar_bytes("depois-do-limite.txt", b"fim").unwrap();
        let bytes = z.finalizar().unwrap();
        assert!(bytes.windows(4).any(|w| w == 0x0606_4B50u32.to_le_bytes()), "registro ZIP64 presente");
        let lidos = ler_de_volta(&bytes);
        assert_eq!(lidos.len(), 4);
        assert_eq!(lidos[1], ("grande.bin".to_string(), vec![7u8; 10]));
        assert_eq!(lidos[3], ("depois-do-limite.txt".to_string(), b"fim".to_vec()));
        if let Ok(destino) = std::env::var("ECOS_ZIP_AMOSTRA") {
            std::fs::write(destino, &bytes).unwrap();
        }
    }

    #[test]
    fn nome_longo_demais_e_recusado() {
        let mut z = ZipWriter::new(Vec::new());
        assert!(z.adicionar_bytes(&"a".repeat(70_000), b"x").is_err());
    }
}
