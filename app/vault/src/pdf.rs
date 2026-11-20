//! Escritor de PDF para o resumo do Fechamento: A4 em pé, texto em Poppins (a fonte da interface do Ecos, incorporada ao
//! arquivo), retângulos arredondados, linhas, cores e o ícone do Ecos desenhado em vetor. Sem compressão: o arquivo é
//! pequeno e qualquer ferramenta consegue ler. Coordenadas em pontos, origem no canto superior esquerdo da página.

use crate::pdf_fontes::{FonteIncorporada, BOLD, REGULAR, SEMIBOLD};

pub const LARGURA: f32 = 595.28;
pub const ALTURA: f32 = 841.89;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Fonte {
    Regular,
    SemiBold,
    Bold,
}

impl Fonte {
    const TODAS: [Fonte; 3] = [Fonte::Regular, Fonte::SemiBold, Fonte::Bold];

    fn dados(self) -> &'static FonteIncorporada {
        match self {
            Fonte::Regular => &REGULAR,
            Fonte::SemiBold => &SEMIBOLD,
            Fonte::Bold => &BOLD,
        }
    }

    fn recurso(self) -> &'static str {
        match self {
            Fonte::Regular => "F1",
            Fonte::SemiBold => "F2",
            Fonte::Bold => "F3",
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Cor(pub u8, pub u8, pub u8);

impl Cor {
    fn rgb(self) -> String {
        format!("{:.3} {:.3} {:.3}", self.0 as f32 / 255.0, self.1 as f32 / 255.0, self.2 as f32 / 255.0)
    }
}

/// Byte do caractere na codificação WinAnsi (a do PDF para fontes simples); o que ela não tem vira `?`.
fn codigo(c: char) -> u8 {
    match c {
        '\u{20}'..='\u{7E}' | '\u{A0}'..='\u{FF}' => c as u32 as u8,
        '€' => 0x80,
        '…' => 0x85,
        '‘' => 0x91,
        '’' => 0x92,
        '“' => 0x93,
        '”' => 0x94,
        '•' => 0x95,
        '–' => 0x96,
        '—' => 0x97,
        '\t' => b' ',
        _ => b'?',
    }
}

/// Texto como a fonte o desenha: só o que ela tem.
fn limpo(t: &str) -> Vec<u8> {
    t.chars().filter(|c| !c.is_control() || *c == '\t').map(codigo).collect()
}

fn largura_do_byte(b: u8, fonte: Fonte) -> f32 {
    if b < 32 {
        return 0.0;
    }
    fonte.dados().larguras[(b - 32) as usize] as f32
}

/// Largura do texto em pontos.
pub fn medir(texto: &str, fonte: Fonte, tamanho: f32) -> f32 {
    limpo(texto).iter().map(|b| largura_do_byte(*b, fonte)).sum::<f32>() / 1000.0 * tamanho
}

/// Corta o texto (com "…") para caber em `largura` pontos.
pub fn caber(texto: &str, largura: f32, fonte: Fonte, tamanho: f32) -> String {
    if medir(texto, fonte, tamanho) <= largura {
        return texto.to_string();
    }
    let mut saida = String::new();
    for c in texto.chars() {
        let mut tentativa = saida.clone();
        tentativa.push(c);
        tentativa.push('…');
        if medir(&tentativa, fonte, tamanho) > largura {
            break;
        }
        saida.push(c);
    }
    saida.push('…');
    saida
}

/// Quebra o texto em linhas que cabem em `largura` (quebra só entre palavras; uma palavra maior que a linha é cortada).
pub fn quebrar(texto: &str, largura: f32, fonte: Fonte, tamanho: f32) -> Vec<String> {
    let mut linhas: Vec<String> = Vec::new();
    let mut atual = String::new();
    for palavra in texto.split_whitespace() {
        let candidata = if atual.is_empty() { palavra.to_string() } else { format!("{atual} {palavra}") };
        if medir(&candidata, fonte, tamanho) <= largura {
            atual = candidata;
        } else {
            if !atual.is_empty() {
                linhas.push(std::mem::take(&mut atual));
            }
            atual = caber(palavra, largura, fonte, tamanho);
        }
    }
    if !atual.is_empty() {
        linhas.push(atual);
    }
    linhas
}

fn escapar(bytes: &[u8]) -> Vec<u8> {
    let mut o = Vec::with_capacity(bytes.len() + 4);
    for &b in bytes {
        if matches!(b, b'\\' | b'(' | b')') {
            o.push(b'\\');
        }
        o.push(b);
    }
    o
}

/// Contorno de um retângulo com cantos arredondados, `y_base` já em coordenadas do PDF (de baixo para cima).
fn caminho_arredondado(x: f32, y_base: f32, w: f32, h: f32, raio: f32) -> String {
    let r = raio.min(w / 2.0).min(h / 2.0).max(0.0);
    if r <= 0.0 {
        return format!("{x:.2} {y_base:.2} {w:.2} {h:.2} re ");
    }
    let k = r * 0.552_284_7;
    let (x2, y2) = (x + w, y_base + h);
    format!(
        "{:.2} {:.2} m {:.2} {:.2} l {:.2} {:.2} {:.2} {:.2} {:.2} {:.2} c {:.2} {:.2} l {:.2} {:.2} {:.2} {:.2} {:.2} {:.2} c {:.2} {:.2} l {:.2} {:.2} {:.2} {:.2} {:.2} {:.2} c {:.2} {:.2} l {:.2} {:.2} {:.2} {:.2} {:.2} {:.2} c h ",
        x + r, y_base,
        x2 - r, y_base,
        x2 - r + k, y_base, x2, y_base + r - k, x2, y_base + r,
        x2, y2 - r,
        x2, y2 - r + k, x2 - r + k, y2, x2 - r, y2,
        x + r, y2,
        x + r - k, y2, x, y2 - r + k, x, y2 - r,
        x, y_base + r,
        x, y_base + r - k, x + r - k, y_base, x + r, y_base,
    )
}

/// Caminho do glifo do ícone (SVG 512×512, só `M`, `L` e `C`) convertido para operadores de PDF.
fn caminho_do_logo() -> String {
    fn esvaziar(comando: char, numeros: &mut Vec<f32>, saida: &mut String, aberto: &mut bool) {
        let (por_grupo, op) = match comando {
            'M' => (2, "m"),
            'L' => (2, "l"),
            _ => (6, "c"),
        };
        for g in numeros.chunks_exact(por_grupo) {
            if comando == 'M' && *aberto {
                saida.push_str("h ");
            }
            for v in g {
                saida.push_str(&format!("{v:.3} "));
            }
            saida.push_str(op);
            saida.push('\n');
            if comando == 'M' {
                *aberto = true;
            }
        }
        numeros.clear();
    }
    let dados = include_str!("../assets/logo-caminho.txt");
    let mut saida = String::new();
    let mut numeros: Vec<f32> = Vec::new();
    let mut comando = 'M';
    let mut aberto = false;
    for token in dados.split(|c: char| c.is_whitespace() || c == ',').filter(|t| !t.is_empty()) {
        if let Some(letra) = token.chars().next().filter(|c| c.is_ascii_alphabetic()) {
            esvaziar(comando, &mut numeros, &mut saida, &mut aberto);
            comando = letra;
            if let Ok(v) = token[1..].parse::<f32>() {
                numeros.push(v);
            }
        } else if let Ok(v) = token.parse::<f32>() {
            numeros.push(v);
        }
    }
    esvaziar(comando, &mut numeros, &mut saida, &mut aberto);
    saida.push_str("h\n");
    saida
}

#[derive(Default)]
pub struct Documento {
    paginas: Vec<Vec<u8>>,
}

impl Documento {
    pub fn new() -> Self {
        Self { paginas: vec![Vec::new()] }
    }

    pub fn nova_pagina(&mut self) {
        self.paginas.push(Vec::new());
    }

    fn atual(&mut self) -> &mut Vec<u8> {
        self.paginas.last_mut().expect("sempre há uma página")
    }

    /// Texto com a linha de base em `y` (distância do topo), começando em `x`.
    pub fn texto(&mut self, x: f32, y: f32, fonte: Fonte, tamanho: f32, cor: Cor, texto: &str) {
        escrever_texto(self.atual(), x, y, fonte, tamanho, cor, 0.0, texto);
    }

    /// Como `texto`, com `espaco` pontos a mais entre as letras (legendas em caixa alta).
    #[allow(clippy::too_many_arguments)]
    pub fn texto_espacado(&mut self, x: f32, y: f32, fonte: Fonte, tamanho: f32, cor: Cor, espaco: f32, texto: &str) {
        escrever_texto(self.atual(), x, y, fonte, tamanho, cor, espaco, texto);
    }

    /// Texto alinhado à direita em `x_direita`.
    pub fn texto_a_direita(&mut self, x_direita: f32, y: f32, fonte: Fonte, tamanho: f32, cor: Cor, texto: &str) {
        let x = x_direita - medir(texto, fonte, tamanho);
        self.texto(x, y, fonte, tamanho, cor, texto);
    }

    /// Texto centralizado em `x_centro`.
    pub fn texto_centralizado(&mut self, x_centro: f32, y: f32, fonte: Fonte, tamanho: f32, cor: Cor, texto: &str) {
        let x = x_centro - medir(texto, fonte, tamanho) / 2.0;
        self.texto(x, y, fonte, tamanho, cor, texto);
    }

    pub fn linha(&mut self, x1: f32, x2: f32, y: f32, espessura: f32, cor: Cor) {
        let ya = ALTURA - y;
        let s = format!("{} RG {espessura:.2} w {x1:.2} {ya:.2} m {x2:.2} {ya:.2} l S\n", cor.rgb());
        self.atual().extend_from_slice(s.as_bytes());
    }

    /// Retângulo (opcionalmente arredondado) com `y` no topo; preenchimento e/ou borda.
    #[allow(clippy::too_many_arguments)]
    pub fn retangulo(&mut self, x: f32, y: f32, largura: f32, altura: f32, raio: f32, preenchimento: Option<Cor>, borda: Option<(Cor, f32)>) {
        if preenchimento.is_none() && borda.is_none() {
            return;
        }
        let caminho = caminho_arredondado(x, ALTURA - y - altura, largura, altura, raio);
        let mut s = String::from("q ");
        if let Some(c) = preenchimento {
            s.push_str(&format!("{} rg ", c.rgb()));
        }
        if let Some((c, e)) = borda {
            s.push_str(&format!("{} RG {e:.2} w ", c.rgb()));
        }
        s.push_str(&caminho);
        s.push_str(match (preenchimento.is_some(), borda.is_some()) {
            (true, true) => "B\n",
            (true, false) => "f\n",
            _ => "S\n",
        });
        s.push_str("Q\n");
        self.atual().extend_from_slice(s.as_bytes());
    }

    /// O ícone do Ecos (quadrado arredondado em degradê com o glifo branco), `tamanho` pontos de lado.
    pub fn logo(&mut self, x: f32, y: f32, tamanho: f32) {
        let k = tamanho / 512.0;
        let ponto_de_origem = ALTURA - y;
        let mut s = format!("q {k:.5} 0 0 {:.5} {x:.2} {ponto_de_origem:.2} cm\n", -k);
        s.push_str("q ");
        s.push_str(&caminho_arredondado(0.0, 0.0, 512.0, 512.0, 99.0));
        s.push_str("W n /Sh1 sh Q\n");
        s.push_str("1 1 1 rg\nq 0.49516 0 0 0.49516 91.11 101.014 cm\n");
        s.push_str(&caminho_do_logo());
        s.push_str("f*\nQ\nQ\n");
        self.atual().extend_from_slice(s.as_bytes());
    }

    #[cfg(test)]
    pub fn total_de_paginas(&self) -> usize {
        self.paginas.len()
    }

    /// Fecha o arquivo: a partir da 2ª página um cabeçalho discreto (`cabecalho`), em todas o rodapé com a numeração,
    /// e então objetos, fontes incorporadas e tabela de referências cruzadas.
    pub fn finalizar(mut self, cabecalho: &str, rodape: &str, cor_do_texto: Cor, cor_da_linha: Cor) -> Vec<u8> {
        let total = self.paginas.len();
        for (i, conteudo) in self.paginas.iter_mut().enumerate() {
            let numeracao = format!("Página {} de {}", i + 1, total);
            let y = ALTURA - 30.0;
            let ya = ALTURA - (y - 12.0);
            let linha = format!("{} RG 0.60 w 40 {ya:.2} m {:.2} {ya:.2} l S\n", cor_da_linha.rgb(), LARGURA - 40.0);
            conteudo.extend_from_slice(linha.as_bytes());
            escrever_texto(conteudo, 40.0, y, Fonte::Regular, 7.5, cor_do_texto, 0.0, rodape);
            let x = LARGURA - 40.0 - medir(&numeracao, Fonte::Regular, 7.5);
            escrever_texto(conteudo, x, y, Fonte::Regular, 7.5, cor_do_texto, 0.0, &numeracao);
            if i > 0 {
                escrever_texto(conteudo, 40.0, 34.0, Fonte::SemiBold, 8.5, cor_do_texto, 0.0, cabecalho);
            }
        }

        // Objetos: 1 catálogo, 2 páginas, 3..=11 fontes (dicionário, descritor, arquivo), 12 função e 13 degradê;
        // depois, para cada página, o objeto da página e o do conteúdo.
        let primeiro_filho = 14;
        let filhos: Vec<String> = (0..total).map(|i| format!("{} 0 R", primeiro_filho + i * 2)).collect();
        let mut objetos: Vec<Vec<u8>> = vec![b"<< /Type /Catalog /Pages 2 0 R >>".to_vec(), format!("<< /Type /Pages /Kids [{}] /Count {total} >>", filhos.join(" ")).into_bytes()];
        for (k, fonte) in Fonte::TODAS.iter().enumerate() {
            let d = fonte.dados();
            let (id_desc, id_arquivo) = (4 + 3 * k, 5 + 3 * k);
            let larguras: Vec<String> = d.larguras.iter().map(|w| w.to_string()).collect();
            objetos.push(format!("<< /Type /Font /Subtype /TrueType /BaseFont /{} /FirstChar 32 /LastChar 255 /Widths [{}] /FontDescriptor {id_desc} 0 R /Encoding /WinAnsiEncoding >>", d.nome, larguras.join(" ")).into_bytes());
            objetos.push(
                format!(
                    "<< /Type /FontDescriptor /FontName /{} /Flags 32 /FontBBox [{} {} {} {}] /ItalicAngle 0 /Ascent {} /Descent {} /CapHeight {} /StemV {} /FontFile2 {id_arquivo} 0 R >>",
                    d.nome, d.caixa[0], d.caixa[1], d.caixa[2], d.caixa[3], d.ascendente, d.descendente, d.altura_das_maiusculas, d.espessura_da_haste
                )
                .into_bytes(),
            );
            let mut arquivo = format!("<< /Length {} /Length1 {} >>\nstream\n", d.ttf.len(), d.ttf.len()).into_bytes();
            arquivo.extend_from_slice(d.ttf);
            arquivo.extend_from_slice(b"\nendstream");
            objetos.push(arquivo);
        }
        // Degradê do ícone: do azul-claro (#9ce9fe) ao azul (#4b72f9), na diagonal.
        objetos.push(b"<< /FunctionType 2 /Domain [0 1] /C0 [0.612 0.914 0.996] /C1 [0.294 0.447 0.976] /N 1 >>".to_vec());
        objetos.push(b"<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 512 512] /Function 12 0 R /Extend [true true] >>".to_vec());
        for (i, conteudo) in self.paginas.iter().enumerate() {
            let id_conteudo = primeiro_filho + i * 2 + 1;
            objetos.push(
                format!(
                    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {LARGURA:.2} {ALTURA:.2}] /Resources << /Font << /F1 3 0 R /F2 6 0 R /F3 9 0 R >> /Shading << /Sh1 13 0 R >> >> /Contents {id_conteudo} 0 R >>"
                )
                .into_bytes(),
            );
            let mut fluxo = format!("<< /Length {} >>\nstream\n", conteudo.len()).into_bytes();
            fluxo.extend_from_slice(conteudo);
            fluxo.extend_from_slice(b"\nendstream");
            objetos.push(fluxo);
        }

        let mut pdf: Vec<u8> = b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n".to_vec();
        let mut posicoes = Vec::with_capacity(objetos.len());
        for (i, o) in objetos.iter().enumerate() {
            posicoes.push(pdf.len());
            pdf.extend_from_slice(format!("{} 0 obj\n", i + 1).as_bytes());
            pdf.extend_from_slice(o);
            pdf.extend_from_slice(b"\nendobj\n");
        }
        let inicio_xref = pdf.len();
        pdf.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", objetos.len() + 1).as_bytes());
        for p in &posicoes {
            pdf.extend_from_slice(format!("{p:010} 00000 n \n").as_bytes());
        }
        pdf.extend_from_slice(format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{inicio_xref}\n%%EOF\n", objetos.len() + 1).as_bytes());
        pdf
    }
}

#[allow(clippy::too_many_arguments)]
fn escrever_texto(conteudo: &mut Vec<u8>, x: f32, y: f32, fonte: Fonte, tamanho: f32, cor: Cor, espaco: f32, texto: &str) {
    let ya = ALTURA - y;
    conteudo.extend_from_slice(format!("BT /{} {tamanho:.2} Tf {} rg {espaco:.2} Tc {x:.2} {ya:.2} Td (", fonte.recurso(), cor.rgb()).as_bytes());
    conteudo.extend_from_slice(&escapar(&limpo(texto)));
    conteudo.extend_from_slice(b") Tj ET\n");
}

#[cfg(test)]
mod testes {
    use super::*;

    const PRETO: Cor = Cor(0, 0, 0);

    fn contem(pdf: &[u8], trecho: &[u8]) -> bool {
        pdf.windows(trecho.len()).any(|j| j == trecho)
    }

    #[test]
    fn pdf_tem_estrutura_valida_com_xref_apontando_para_os_objetos() {
        let mut d = Documento::new();
        d.logo(50.0, 40.0, 30.0);
        d.retangulo(50.0, 90.0, 200.0, 40.0, 8.0, Some(Cor(240, 245, 250)), Some((Cor(180, 200, 220), 0.6)));
        d.texto(50.0, 60.0, Fonte::Bold, 16.0, PRETO, "Fechamento financeiro");
        d.texto_a_direita(545.0, 80.0, Fonte::Regular, 9.0, PRETO, "R$ 1.234,56");
        d.linha(50.0, 545.0, 90.0, 0.5, Cor(150, 150, 150));
        d.nova_pagina();
        d.texto(50.0, 60.0, Fonte::SemiBold, 10.0, PRETO, "Segunda (página) com \\ barra e acentuação: ção é à ü");
        assert_eq!(d.total_de_paginas(), 2);
        let pdf = d.finalizar("Cabeçalho", "Rodapé", PRETO, Cor(150, 150, 150));

        assert!(pdf.starts_with(b"%PDF-1.4"));
        assert!(pdf.ends_with(b"%%EOF\n"));
        assert!(contem(&pdf, b"(Fechamento financeiro) Tj"));
        assert!(contem(&pdf, b"P\xE1gina 1 de 2"), "numeração em WinAnsi");
        assert!(contem(&pdf, b"\\(p\xE1gina\\)"), "parênteses escapados");
        assert!(contem(&pdf, b"\\\\ barra"), "barra escapada");
        assert!(contem(&pdf, b"/BaseFont /Poppins-SemiBold"), "fonte incorporada");
        assert!(contem(&pdf, b"/Sh1 sh"), "degradê do ícone");
        assert!(contem(&pdf, b"(Cabe\xE7alho) Tj"), "cabeçalho só a partir da 2ª página");

        // startxref aponta para "xref", e cada entrada aponta para "N 0 obj".
        let sx = pdf.windows(10).rposition(|j| j == b"startxref\n").unwrap();
        let fim = sx + 10 + pdf[sx + 10..].iter().position(|b| *b == b'\n').unwrap();
        let inicio: usize = std::str::from_utf8(&pdf[sx + 10..fim]).unwrap().parse().unwrap();
        assert_eq!(&pdf[inicio..inicio + 4], b"xref");
        let tabela = std::str::from_utf8(&pdf[inicio..]).unwrap();
        let entradas: Vec<usize> = tabela.lines().skip(3).take_while(|l| l.ends_with(" n ")).map(|l| l[..10].parse().unwrap()).collect();
        assert_eq!(entradas.len(), 13 + 2 * 2, "catálogo, páginas, 3 fontes (3 objetos cada), função, degradê e 2 páginas com conteúdo");
        for (i, p) in entradas.iter().enumerate() {
            assert!(pdf[*p..].starts_with(format!("{} 0 obj", i + 1).as_bytes()), "objeto {}", i + 1);
        }
        // O /Length de cada fluxo confere com o conteúdo (as fontes e as páginas).
        let mut resto = &pdf[..];
        let mut fluxos = 0;
        while let Some(i) = resto.windows(8).position(|j| j == b"/Length ") {
            resto = &resto[i + 8..];
            let fim = resto.iter().position(|b| *b == b' ').unwrap();
            let n: usize = std::str::from_utf8(&resto[..fim]).unwrap().parse().unwrap();
            let ini = resto.windows(7).position(|j| j == b"stream\n").unwrap() + 7;
            assert_eq!(&resto[ini + n..ini + n + 10], b"\nendstream");
            fluxos += 1;
        }
        assert_eq!(fluxos, 3 + 2);
    }

    #[test]
    fn caminho_do_logo_vira_operadores_validos() {
        let c = caminho_do_logo();
        assert!(c.matches(" m\n").count() >= 3, "o glifo tem três contornos");
        assert_eq!(c.matches(" c\n").count(), 45, "as 45 curvas do glifo");
        assert!(!c.contains("NaN") && !c.contains(','), "só números e operadores");
        assert_eq!(c.matches("h ").count() + c.matches("h\n").count(), c.matches(" m\n").count(), "cada contorno é fechado");
    }

    #[test]
    fn medir_caber_e_quebrar_respeitam_a_largura() {
        assert!(medir("WWW", Fonte::Regular, 10.0) > medir("iii", Fonte::Regular, 10.0));
        assert!(medir("Total", Fonte::Bold, 10.0) > medir("Total", Fonte::Regular, 10.0), "o negrito é mais largo");
        assert_eq!(caber("curto", 100.0, Fonte::Regular, 10.0), "curto");
        let cortado = caber("um nome de conta bem comprido demais", 60.0, Fonte::Regular, 10.0);
        assert!(cortado.ends_with('…') && medir(&cortado, Fonte::Regular, 10.0) <= 60.0, "{cortado}");
        let linhas = quebrar("Esta é uma frase longa que precisa ser quebrada em várias linhas para caber", 120.0, Fonte::Regular, 9.0);
        assert!(linhas.len() >= 3 && linhas.iter().all(|l| medir(l, Fonte::Regular, 9.0) <= 120.0), "{linhas:?}");
        assert_eq!(linhas.join(" "), "Esta é uma frase longa que precisa ser quebrada em várias linhas para caber");
    }

    #[test]
    fn caractere_fora_da_fonte_vira_interrogacao() {
        assert_eq!(limpo("a→b😀"), b"a?b?".to_vec());
        assert_eq!(limpo("€ “x”"), vec![0x80, b' ', 0x93, b'x', 0x94]);
    }
}
