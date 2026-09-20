//! Escritor de `.zip` mínimo (método "stored", sem compressão) para a exportação
//! da conta: as notas são texto pequeno e os anexos já são PDF/imagem
//! comprimidos, então comprimir de novo custaria CPU sem ganho. Sem ZIP64: se
//! algum limite do formato clássico for ultrapassado, a exportação falha em vez
//! de gerar um arquivo que o Explorador não abre.

use std::io::{self, Read, Write};
use std::path::Path;

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

fn crc32_atualizar(crc: u32, bytes: &[u8]) -> u32 {
    bytes.iter().fold(crc, |c, b| CRC_TABELA[((c ^ *b as u32) & 0xFF) as usize] ^ (c >> 8))
}

#[cfg(test)]
pub fn crc32(dados: &[u8]) -> u32 { crc32_atualizar(!0, dados) ^ !0 }

struct Entrada {
    nome: String,
    crc: u32,
    tamanho: u32,
    deslocamento: u32,
}

pub struct ZipWriter<W: Write> {
    saida: W,
    posicao: u64,
    entradas: Vec<Entrada>,
    dos_hora: u16,
    dos_data: u16,
}

fn limite_excedido() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, "a exportação excede o limite de 4 GB / 65 535 arquivos do formato .zip")
}

impl<W: Write> ZipWriter<W> {
    pub fn new(saida: W) -> Self {
        use chrono::{Datelike, Timelike};
        let agora = chrono::Utc::now();
        let dos_hora = ((agora.hour() << 11) | (agora.minute() << 5) | (agora.second() / 2)) as u16;
        let dos_data = (((agora.year().max(1980) - 1980) as u32) << 9 | (agora.month() << 5) | agora.day()) as u16;
        Self { saida, posicao: 0, entradas: Vec::new(), dos_hora, dos_data }
    }

    fn escrever(&mut self, bytes: &[u8]) -> io::Result<()> {
        self.saida.write_all(bytes)?;
        self.posicao += bytes.len() as u64;
        Ok(())
    }

    fn cabecalho_local(&mut self, nome: &str, crc: u32, tamanho: u32) -> io::Result<()> {
        if self.entradas.len() >= u16::MAX as usize || self.posicao >= u32::MAX as u64 || nome.len() > u16::MAX as usize {
            return Err(limite_excedido());
        }
        let mut c = Vec::with_capacity(30 + nome.len());
        c.extend_from_slice(&0x0403_4B50u32.to_le_bytes());
        c.extend_from_slice(&20u16.to_le_bytes()); // versão mínima
        c.extend_from_slice(&0x0800u16.to_le_bytes()); // bit 11: nome em UTF-8
        c.extend_from_slice(&0u16.to_le_bytes()); // stored
        c.extend_from_slice(&self.dos_hora.to_le_bytes());
        c.extend_from_slice(&self.dos_data.to_le_bytes());
        c.extend_from_slice(&crc.to_le_bytes());
        c.extend_from_slice(&tamanho.to_le_bytes());
        c.extend_from_slice(&tamanho.to_le_bytes());
        c.extend_from_slice(&(nome.len() as u16).to_le_bytes());
        c.extend_from_slice(&0u16.to_le_bytes());
        c.extend_from_slice(nome.as_bytes());
        let deslocamento = self.posicao as u32;
        self.escrever(&c)?;
        self.entradas.push(Entrada { nome: nome.to_string(), crc, tamanho, deslocamento });
        Ok(())
    }

    pub fn adicionar_bytes(&mut self, nome: &str, dados: &[u8]) -> io::Result<()> {
        let tamanho = u32::try_from(dados.len()).map_err(|_| limite_excedido())?;
        self.cabecalho_local(nome, crc32_atualizar(!0, dados) ^ !0, tamanho)?;
        self.escrever(dados)
    }

    /// Copia um arquivo do disco em duas passadas (CRC e tamanho vão no cabeçalho, sem precisar de `Seek`).
    /// Se o arquivo mudar entre as passadas, falha — um zip com CRC errado seria pior que nenhum.
    pub fn adicionar_arquivo(&mut self, nome: &str, caminho: &Path) -> io::Result<()> {
        let mut buffer = vec![0u8; 64 * 1024];
        let (mut crc, mut total) = (!0u32, 0u64);
        let mut arquivo = std::fs::File::open(caminho)?;
        loop {
            let n = arquivo.read(&mut buffer)?;
            if n == 0 { break; }
            crc = crc32_atualizar(crc, &buffer[..n]);
            total += n as u64;
        }
        let tamanho = u32::try_from(total).map_err(|_| limite_excedido())?;
        self.cabecalho_local(nome, crc ^ !0, tamanho)?;
        let mut arquivo = std::fs::File::open(caminho)?;
        let mut copiado = 0u64;
        loop {
            let n = arquivo.read(&mut buffer)?;
            if n == 0 { break; }
            self.escrever(&buffer[..n])?;
            copiado += n as u64;
        }
        if copiado != total {
            return Err(io::Error::new(io::ErrorKind::Other, format!("{} mudou durante a exportação", caminho.display())));
        }
        Ok(())
    }

    pub fn finalizar(mut self) -> io::Result<W> {
        let inicio_diretorio = self.posicao;
        let entradas = std::mem::take(&mut self.entradas);
        for e in &entradas {
            let mut c = Vec::with_capacity(46 + e.nome.len());
            c.extend_from_slice(&0x0201_4B50u32.to_le_bytes());
            c.extend_from_slice(&20u16.to_le_bytes()); // versão criada
            c.extend_from_slice(&20u16.to_le_bytes()); // versão mínima
            c.extend_from_slice(&0x0800u16.to_le_bytes());
            c.extend_from_slice(&0u16.to_le_bytes());
            c.extend_from_slice(&self.dos_hora.to_le_bytes());
            c.extend_from_slice(&self.dos_data.to_le_bytes());
            c.extend_from_slice(&e.crc.to_le_bytes());
            c.extend_from_slice(&e.tamanho.to_le_bytes());
            c.extend_from_slice(&e.tamanho.to_le_bytes());
            c.extend_from_slice(&(e.nome.len() as u16).to_le_bytes());
            c.extend_from_slice(&[0u8; 8]); // extra, comentário, disco, atributos internos
            c.extend_from_slice(&0u32.to_le_bytes()); // atributos externos
            c.extend_from_slice(&e.deslocamento.to_le_bytes());
            c.extend_from_slice(e.nome.as_bytes());
            self.escrever(&c)?;
        }
        let tamanho_diretorio = self.posicao - inicio_diretorio;
        if self.posicao >= u32::MAX as u64 { return Err(limite_excedido()); }
        let mut fim = Vec::with_capacity(22);
        fim.extend_from_slice(&0x0605_4B50u32.to_le_bytes());
        fim.extend_from_slice(&[0u8; 4]);
        fim.extend_from_slice(&(entradas.len() as u16).to_le_bytes());
        fim.extend_from_slice(&(entradas.len() as u16).to_le_bytes());
        fim.extend_from_slice(&(tamanho_diretorio as u32).to_le_bytes());
        fim.extend_from_slice(&(inicio_diretorio as u32).to_le_bytes());
        fim.extend_from_slice(&0u16.to_le_bytes());
        self.escrever(&fim)?;
        self.saida.flush()?;
        Ok(self.saida)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crc32_confere_com_valor_conhecido() {
        assert_eq!(crc32_atualizar(!0, b"123456789") ^ !0, 0xCBF4_3926);
    }

    #[test]
    fn zip_tem_diretorio_central_consistente() {
        let mut z = ZipWriter::new(Vec::new());
        z.adicionar_bytes("a/nota.md", b"ola").unwrap();
        z.adicionar_bytes("b/tarefa.md", "acentuação".as_bytes()).unwrap();
        let bytes = z.finalizar().unwrap();
        let eocd = bytes.len() - 22;
        assert_eq!(&bytes[eocd..eocd + 4], &0x0605_4B50u32.to_le_bytes());
        assert_eq!(u16::from_le_bytes([bytes[eocd + 10], bytes[eocd + 11]]), 2);
        let inicio = u32::from_le_bytes(bytes[eocd + 16..eocd + 20].try_into().unwrap()) as usize;
        assert_eq!(&bytes[inicio..inicio + 4], &0x0201_4B50u32.to_le_bytes());
        assert_eq!(&bytes[0..4], &0x0403_4B50u32.to_le_bytes());
    }
}
