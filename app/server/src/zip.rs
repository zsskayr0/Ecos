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

/// CRC-32 de um arquivo em disco (leitura em blocos).
pub fn crc32_arquivo(caminho: &Path) -> io::Result<(u32, u64)> {
    let mut arquivo = std::fs::File::open(caminho)?;
    let mut buffer = vec![0u8; 64 * 1024];
    let (mut crc, mut total) = (!0u32, 0u64);
    loop {
        let n = arquivo.read(&mut buffer)?;
        if n == 0 { break; }
        crc = crc32_atualizar(crc, &buffer[..n]);
        total += n as u64;
    }
    Ok((crc ^ !0, total))
}

/// Uma entrada (arquivo) do diretório central.
#[derive(Debug, Clone)]
pub struct EntradaZip {
    pub nome: String,
    pub crc: u32,
    pub tamanho: u64,
    deslocamento_local: u64,
}

/// Leitor do mesmo subconjunto que o `ZipWriter` produz: método "stored", sem criptografia, sem ZIP64. Qualquer coisa
/// fora disso é recusada com mensagem clara — a restauração só aceita pacotes gerados pelo próprio Ecos.
pub struct LeitorZip {
    arquivo: std::fs::File,
    tamanho_arquivo: u64,
    pub entradas: Vec<EntradaZip>,
}

fn invalido(msg: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, msg.into())
}

fn u16_em(b: &[u8], o: usize) -> usize {
    u16::from_le_bytes([b[o], b[o + 1]]) as usize
}

fn u32_em(b: &[u8], o: usize) -> u64 {
    u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]]) as u64
}

const MAX_ENTRADAS: usize = 100_000;

impl LeitorZip {
    pub fn abrir(caminho: &Path) -> io::Result<Self> {
        use std::io::{Seek, SeekFrom};
        let mut arquivo = std::fs::File::open(caminho)?;
        let tamanho_arquivo = arquivo.metadata()?.len();
        if tamanho_arquivo < 22 {
            return Err(invalido("o arquivo não é um .zip válido"));
        }
        // O registro de fim do diretório está nos últimos 22 bytes + comentário (até 64 KiB).
        let janela = tamanho_arquivo.min(22 + 65_535);
        arquivo.seek(SeekFrom::Start(tamanho_arquivo - janela))?;
        let mut cauda = vec![0u8; janela as usize];
        arquivo.read_exact(&mut cauda)?;
        let eocd = (0..=cauda.len() - 22).rev().find(|&i| cauda[i..i + 4] == 0x0605_4B50u32.to_le_bytes()).ok_or_else(|| invalido("o arquivo não é um .zip válido"))?;
        let disco = u16_em(&cauda, eocd + 4);
        let total = u16_em(&cauda, eocd + 10);
        let tam_dir = u32_em(&cauda, eocd + 12);
        let ini_dir = u32_em(&cauda, eocd + 16);
        if disco != 0 || total == 0xFFFF || tam_dir == 0xFFFF_FFFF || ini_dir == 0xFFFF_FFFF {
            return Err(invalido("pacote .zip em partes ou ZIP64 não é aceito"));
        }
        if total > MAX_ENTRADAS || ini_dir.checked_add(tam_dir).is_none_or(|fim| fim > tamanho_arquivo) {
            return Err(invalido("diretório do .zip inconsistente"));
        }
        arquivo.seek(SeekFrom::Start(ini_dir))?;
        let mut dir = vec![0u8; tam_dir as usize];
        arquivo.read_exact(&mut dir)?;
        let mut entradas = Vec::with_capacity(total);
        let mut o = 0usize;
        for _ in 0..total {
            if o + 46 > dir.len() || dir[o..o + 4] != 0x0201_4B50u32.to_le_bytes() {
                return Err(invalido("diretório do .zip inconsistente"));
            }
            let flags = u16_em(&dir, o + 8);
            let metodo = u16_em(&dir, o + 10);
            let (crc, comp, tamanho) = (u32_em(&dir, o + 16) as u32, u32_em(&dir, o + 20), u32_em(&dir, o + 24));
            let (n_nome, n_extra, n_comentario) = (u16_em(&dir, o + 28), u16_em(&dir, o + 30), u16_em(&dir, o + 32));
            let local = u32_em(&dir, o + 42);
            if o + 46 + n_nome + n_extra + n_comentario > dir.len() {
                return Err(invalido("diretório do .zip inconsistente"));
            }
            let nome = String::from_utf8(dir[o + 46..o + 46 + n_nome].to_vec()).map_err(|_| invalido("nome de arquivo inválido no .zip"))?;
            if flags & 1 != 0 {
                return Err(invalido("pacote .zip criptografado não é aceito"));
            }
            if metodo != 0 || comp != tamanho {
                return Err(invalido("o pacote não foi gerado pelo Ecos (compressão não suportada)"));
            }
            if tamanho == 0xFFFF_FFFF || local == 0xFFFF_FFFF {
                return Err(invalido("pacote ZIP64 não é aceito"));
            }
            if !nome.ends_with('/') {
                entradas.push(EntradaZip { nome, crc, tamanho, deslocamento_local: local });
            }
            o += 46 + n_nome + n_extra + n_comentario;
        }
        Ok(Self { arquivo, tamanho_arquivo, entradas })
    }

    /// Posiciona no início dos dados da entrada, conferindo o cabeçalho local, e devolve o tamanho.
    fn posicionar(&mut self, i: usize) -> io::Result<u64> {
        use std::io::{Seek, SeekFrom};
        let e = self.entradas.get(i).ok_or_else(|| invalido("entrada inexistente"))?.clone();
        self.arquivo.seek(SeekFrom::Start(e.deslocamento_local))?;
        let mut c = [0u8; 30];
        self.arquivo.read_exact(&mut c).map_err(|_| invalido("cabeçalho do .zip truncado"))?;
        if c[0..4] != 0x0403_4B50u32.to_le_bytes() {
            return Err(invalido("cabeçalho do .zip inconsistente"));
        }
        let dados = e.deslocamento_local + 30 + u16_em(&c, 26) as u64 + u16_em(&c, 28) as u64;
        if dados.checked_add(e.tamanho).is_none_or(|fim| fim > self.tamanho_arquivo) {
            return Err(invalido("o .zip está truncado"));
        }
        self.arquivo.seek(SeekFrom::Start(dados))?;
        Ok(e.tamanho)
    }

    /// Lê a entrada inteira (para arquivos pequenos: manifesto, Markdown) conferindo o CRC.
    pub fn ler(&mut self, i: usize, limite: u64) -> io::Result<Vec<u8>> {
        let tamanho = self.posicionar(i)?;
        if tamanho > limite {
            return Err(invalido("arquivo grande demais para leitura em memória"));
        }
        let mut dados = vec![0u8; tamanho as usize];
        self.arquivo.read_exact(&mut dados)?;
        if crc32_atualizar(!0, &dados) ^ !0 != self.entradas[i].crc {
            return Err(invalido(format!("{} está corrompido (CRC não confere)", self.entradas[i].nome)));
        }
        Ok(dados)
    }

    /// Copia a entrada para `destino` em blocos, conferindo o CRC; em caso de erro o destino parcial é apagado.
    pub fn copiar_para(&mut self, i: usize, destino: &Path) -> io::Result<()> {
        let tamanho = self.posicionar(i)?;
        let esperado = self.entradas[i].crc;
        let nome = self.entradas[i].nome.clone();
        let resultado = (|| {
            let mut saida = std::fs::File::create(destino)?;
            let mut buffer = vec![0u8; 64 * 1024];
            let (mut restante, mut crc) = (tamanho, !0u32);
            while restante > 0 {
                let n = buffer.len().min(restante as usize);
                self.arquivo.read_exact(&mut buffer[..n])?;
                crc = crc32_atualizar(crc, &buffer[..n]);
                saida.write_all(&buffer[..n])?;
                restante -= n as u64;
            }
            saida.sync_all()?;
            if crc ^ !0 != esperado {
                return Err(invalido(format!("{nome} está corrompido (CRC não confere)")));
            }
            Ok(())
        })();
        if resultado.is_err() {
            let _ = std::fs::remove_file(destino);
        }
        resultado
    }

    /// Confere o CRC de todas as entradas sem gravar nada (validação prévia da restauração).
    pub fn verificar_tudo(&mut self) -> io::Result<()> {
        let mut buffer = vec![0u8; 64 * 1024];
        for i in 0..self.entradas.len() {
            let mut restante = self.posicionar(i)?;
            let mut crc = !0u32;
            while restante > 0 {
                let n = buffer.len().min(restante as usize);
                self.arquivo.read_exact(&mut buffer[..n])?;
                crc = crc32_atualizar(crc, &buffer[..n]);
                restante -= n as u64;
            }
            if crc ^ !0 != self.entradas[i].crc {
                return Err(invalido(format!("{} está corrompido (CRC não confere)", self.entradas[i].nome)));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leitor_le_o_que_o_escritor_gerou_e_rejeita_corrupcao() {
        let dir = std::env::temp_dir().join(format!("ecos-zip-{}", ecos_core::new_id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut z = ZipWriter::new(Vec::new());
        z.adicionar_bytes("a/nota.md", b"ola").unwrap();
        z.adicionar_bytes("b/tarefa.md", "acentuação".as_bytes()).unwrap();
        let mut bytes = z.finalizar().unwrap();
        let caminho = dir.join("p.zip");
        std::fs::write(&caminho, &bytes).unwrap();
        let mut leitor = LeitorZip::abrir(&caminho).unwrap();
        assert_eq!(leitor.entradas.len(), 2);
        assert_eq!(leitor.ler(0, 1024).unwrap(), b"ola");
        assert_eq!(leitor.ler(1, 1024).unwrap(), "acentuação".as_bytes());
        leitor.verificar_tudo().unwrap();
        drop(leitor);

        // Um byte alterado nos dados quebra o CRC.
        let pos = bytes.windows(3).position(|w| w == b"ola").unwrap();
        bytes[pos] = b'X';
        std::fs::write(&caminho, &bytes).unwrap();
        let mut leitor = LeitorZip::abrir(&caminho).unwrap();
        assert!(leitor.verificar_tudo().is_err());
        // Lixo não é um .zip.
        std::fs::write(&caminho, b"isto nao e um zip, mas tem mais de vinte e dois bytes").unwrap();
        assert!(LeitorZip::abrir(&caminho).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

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
