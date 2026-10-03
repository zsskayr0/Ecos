//! Busca de texto do Cofre: ignora maiúsculas e acentos, aceita erro de digitação e perdoa as confusões típicas
//! do OCR (0/O, 1/l/I, 5/S, 8/B, rn/m). Roda sempre dentro do processo, sobre dados já lidos do arquivo cifrado:
//! o texto dos comprovantes nunca vai para um índice fora dele.

/// Minúsculas, sem acento, só letras e dígitos separados por um espaço.
pub fn normalizar(texto: &str) -> String {
    let mut saida = String::with_capacity(texto.len());
    let mut separou = true;
    for c in texto.chars().flat_map(char::to_lowercase) {
        let c = sem_acento(c);
        for c in c.chars() {
            if c.is_alphanumeric() {
                saida.push(c);
                separou = false;
            } else if !separou {
                saida.push(' ');
                separou = true;
            }
        }
    }
    saida.truncate(saida.trim_end().len());
    saida
}

fn sem_acento(c: char) -> String {
    match c {
        'á' | 'à' | 'â' | 'ã' | 'ä' | 'å' | 'ā' => "a".into(),
        'ç' | 'ć' | 'č' => "c".into(),
        'é' | 'è' | 'ê' | 'ë' | 'ē' => "e".into(),
        'í' | 'ì' | 'î' | 'ï' | 'ī' => "i".into(),
        'ñ' => "n".into(),
        'ó' | 'ò' | 'ô' | 'õ' | 'ö' | 'ō' => "o".into(),
        'ú' | 'ù' | 'û' | 'ü' | 'ū' => "u".into(),
        'ý' | 'ÿ' => "y".into(),
        'ß' => "ss".into(),
        'æ' => "ae".into(),
        'œ' => "oe".into(),
        outro => outro.to_string(),
    }
}

/// Aproxima letras que o OCR costuma trocar entre si, para comparar o texto lido com o que a pessoa digitou.
fn dobrar_ocr(normalizado: &str) -> String {
    normalizado
        .replace("rn", "m")
        .replace("vv", "w")
        .chars()
        .map(|c| match c {
            '0' => 'o',
            '1' | 'i' => 'l',
            '5' => 's',
            '8' => 'b',
            outro => outro,
        })
        .collect()
}

fn palavras(normalizado: &str) -> Vec<Vec<char>> {
    normalizado.split(' ').filter(|p| !p.is_empty()).map(|p| p.chars().take(48).collect()).collect()
}

/// Distância de edição entre `a` e `b`, ou `None` se passar de `maximo` (sai cedo: textos de OCR são longos).
fn distancia(a: &[char], b: &[char], maximo: usize) -> Option<usize> {
    if a.len().abs_diff(b.len()) > maximo {
        return None;
    }
    let mut anterior: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.iter().enumerate() {
        let mut atual = vec![i + 1];
        let mut menor = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let custo = usize::from(ca != cb);
            let v = (anterior[j] + custo).min(anterior[j + 1] + 1).min(atual[j] + 1);
            menor = menor.min(v);
            atual.push(v);
        }
        if menor > maximo {
            return None;
        }
        anterior = atual;
    }
    Some(anterior[b.len()]).filter(|d| *d <= maximo)
}

/// Quantos erros de digitação cada tamanho de palavra tolera. Números e palavras curtas pedem acerto exato.
fn tolerancia(token: &[char]) -> usize {
    if token.iter().all(|c| c.is_ascii_digit()) {
        return 0;
    }
    match token.len() {
        0..=3 => 0,
        4..=6 => 1,
        _ => 2,
    }
}

/// Melhor nota do `token` contra as palavras do texto (0 = não achou).
fn nota_do_token(token: &[char], texto: &[Vec<char>]) -> f32 {
    let tol = tolerancia(token);
    let mut melhor = 0f32;
    for palavra in texto {
        let nota = if palavra == token {
            4.0
        } else if palavra.len() > token.len() && palavra.starts_with(token) {
            3.0
        } else if token.len() >= 3 && palavra.len() > token.len() && palavra.windows(token.len()).any(|w| w == token) {
            2.0
        } else if tol > 0 {
            let inteira = distancia(token, palavra, tol);
            let prefixo = (palavra.len() > token.len()).then(|| distancia(token, &palavra[..token.len()], tol)).flatten();
            match inteira.or(prefixo) {
                Some(d) => 1.5 - 0.4 * d as f32,
                None => 0.0,
            }
        } else {
            0.0
        };
        if nota > melhor {
            melhor = nota;
        }
    }
    melhor
}

/// Resultado de avaliar um lançamento contra a consulta.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Acerto {
    pub pontuacao: f32,
    /// Alguma palavra só foi encontrada no texto lido do comprovante (e não nos campos do lançamento).
    pub so_no_anexo: bool,
}

pub struct Consulta {
    tokens: Vec<Vec<char>>,
    tokens_ocr: Vec<Vec<char>>,
}

impl Consulta {
    pub fn nova(q: &str) -> Option<Self> {
        let normal = normalizar(q);
        let tokens = palavras(&normal);
        if tokens.is_empty() {
            return None;
        }
        let tokens_ocr = palavras(&dobrar_ocr(&normal));
        Some(Self { tokens, tokens_ocr })
    }

    /// Todas as palavras da consulta precisam aparecer (nos campos ou no texto dos anexos). `None` = não bate.
    pub fn avaliar(&self, campos: &[&str], anexos: &[&str]) -> Option<Acerto> {
        let principal = palavras(&normalizar(&campos.join(" ")));
        let ocr = palavras(&dobrar_ocr(&normalizar(&anexos.join(" "))));
        let mut total = 0f32;
        let mut so_no_anexo = false;
        for (token, token_ocr) in self.tokens.iter().zip(&self.tokens_ocr) {
            let nos_campos = nota_do_token(token, &principal);
            let no_anexo = if ocr.is_empty() { 0.0 } else { nota_do_token(token_ocr, &ocr) * 0.9 };
            if nos_campos <= 0.0 && no_anexo <= 0.0 {
                return None;
            }
            if no_anexo > nos_campos {
                so_no_anexo = true;
            }
            total += nos_campos.max(no_anexo);
        }
        Some(Acerto { pontuacao: total, so_no_anexo })
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    fn bate(q: &str, campos: &[&str], anexos: &[&str]) -> Option<Acerto> {
        Consulta::nova(q).and_then(|c| c.avaliar(campos, anexos))
    }

    #[test]
    fn ignora_acento_maiuscula_e_pontuacao() {
        assert_eq!(normalizar("  Açaí-do  João, S/A! "), "acai do joao s a");
        assert!(bate("acai", &["Açaí da esquina"], &[]).is_some());
        assert!(bate("ACAÍ", &["acai da esquina"], &[]).is_some());
        assert!(bate("joao", &["Pagamento João"], &[]).is_some());
        assert!(bate("pagamento joão", &["João", "pagamento"], &[]).is_some());
    }

    #[test]
    fn todas_as_palavras_precisam_aparecer() {
        assert!(bate("mercado luz", &["Mercado"], &[]).is_none());
        assert!(bate("zzz", &["Mercado"], &[]).is_none());
        assert!(Consulta::nova("   !!  ").is_none());
    }

    #[test]
    fn aceita_erro_de_digitacao_proporcional_ao_tamanho() {
        assert!(bate("supermecado", &["Supermercado Pague Menos"], &[]).is_some());
        assert!(bate("farmacai", &["Farmácia"], &[]).is_some());
        // Palavra curta e número pedem acerto exato: senão tudo bateria com tudo.
        assert!(bate("gas", &["Gás"], &[]).is_some());
        assert!(bate("gos", &["Gás"], &[]).is_none());
        assert!(bate("1500", &["Parcela 1050"], &[]).is_none());
    }

    #[test]
    fn prefixo_e_trecho_batem_e_pontuam_menos_que_a_palavra_inteira() {
        let inteira = bate("luz", &["Conta de luz"], &[]).unwrap().pontuacao;
        let prefixo = bate("lu", &["Conta de luz"], &[]).unwrap().pontuacao;
        assert!(inteira > prefixo, "o começo da palavra serve para pesquisar enquanto digita");
        assert!(bate("uz", &["Conta de luz"], &[]).is_none(), "dois caracteres no meio da palavra não casam");
        let parte = bate("merc", &["Mercado"], &[]).unwrap().pontuacao;
        assert!(inteira > parte);
    }

    #[test]
    fn texto_do_ocr_perdoa_confusao_de_letras() {
        // O OCR leu "MERCAD0 L1VRE" e "PAGAMENT0".
        let a = bate("mercado livre", &["Compra"], &["MERCAD0 L1VRE ltda"]).unwrap();
        assert!(a.so_no_anexo);
        assert!(bate("pagamento", &[], &["PAGAMENT0 DE BOLET0"]).is_some());
        // "rn" lido no lugar de "m".
        assert!(bate("farmacia", &[], &["farrnacia popular"]).is_some());
    }

    #[test]
    fn achar_nos_campos_nao_marca_como_so_no_anexo() {
        let a = bate("luz", &["Conta de luz"], &["comprovante de luz"]).unwrap();
        assert!(!a.so_no_anexo);
    }

    #[test]
    fn valor_e_data_sao_pesquisaveis() {
        assert!(bate("150,00", &["Aluguel", "150,00 150.00"], &[]).is_some());
        assert!(bate("02/10/2026", &["x", "2026-10-02 02/10/2026"], &[]).is_some());
    }
}
