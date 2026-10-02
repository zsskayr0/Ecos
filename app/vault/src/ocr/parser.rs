//! Transforma o texto lido de um comprovante (Pix, boleto, cartão, cupom) numa sugestão de lançamento.
//!
//! É heurístico e **só sugere**: o usuário revisa tudo antes de salvar. Cada campo traz uma confiança (0 = não
//! encontrado) para a tela destacar o que precisa de atenção. Decisões de privacidade: o CPF de terceiros nunca é
//! extraído; só CNPJ (pessoa jurídica) vira `documento`.

use chrono::{Datelike, NaiveDate};
use regex::Regex;
use serde::Serialize;
use std::sync::OnceLock;

#[derive(Debug, Default, Clone, Serialize, PartialEq)]
pub struct Confianca {
    pub valor: f32,
    pub data: f32,
    pub tipo: f32,
    pub beneficiario: f32,
    /// Quanto confiar no conjunto: o pior entre valor e data (os dois campos que não podem errar calados).
    pub geral: f32,
}

#[derive(Debug, Default, Clone, Serialize, PartialEq)]
pub struct Sugestao {
    pub descricao: Option<String>,
    pub valor_centavos: Option<i64>,
    pub data: Option<NaiveDate>,
    pub tipo: Option<&'static str>,
    pub forma_pagamento: Option<&'static str>,
    pub beneficiario_nome: Option<String>,
    pub documento: Option<String>,
    pub confianca: Confianca,
}

fn re(cell: &'static OnceLock<Regex>, padrao: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(padrao).expect("regex do parser é constante e válida"))
}

/// Minúsculas e sem acento, para comparar rótulos sem se importar com a grafia do banco.
fn normalizar(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'á' | 'à' | 'â' | 'ã' | 'ä' | 'Á' | 'À' | 'Â' | 'Ã' | 'Ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' | 'É' | 'È' | 'Ê' | 'Ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' | 'Í' | 'Ì' | 'Î' | 'Ï' => 'i',
            'ó' | 'ò' | 'ô' | 'õ' | 'ö' | 'Ó' | 'Ò' | 'Ô' | 'Õ' | 'Ö' => 'o',
            'ú' | 'ù' | 'û' | 'ü' | 'Ú' | 'Ù' | 'Û' | 'Ü' => 'u',
            'ç' | 'Ç' => 'c',
            c => c.to_ascii_lowercase(),
        })
        .collect()
}

// ---------------------------------------------------------------- valor

fn valores_na_linha(linha: &str) -> Vec<i64> {
    static R: OnceLock<Regex> = OnceLock::new();
    re(&R, r"(\d{1,3}(?:\.\d{3})+|\d+),(\d{2})\b")
        .captures_iter(linha)
        .filter_map(|c| {
            let reais: i64 = c[1].replace('.', "").parse().ok()?;
            let centavos: i64 = c[2].parse().ok()?;
            let total = reais.checked_mul(100)?.checked_add(centavos)?;
            (total > 0 && total < 100_000_000_00).then_some(total)
        })
        .collect()
}

const ROTULOS_VALOR: &[&str] = &["valor total", "valor pago", "valor do pix", "valor da transferencia", "valor do pagamento", "valor da compra", "total a pagar", "valor", "total"];
const IGNORAR_VALOR: &[&str] = &["tarifa", "juros", "multa", "desconto", "saldo", "limite", "taxa", "iof", "abatimento", "troco", "parcela"];

fn extrair_valor(linhas: &[String], normais: &[String]) -> (Option<i64>, f32) {
    // 1) Valor ao lado de um rótulo conhecido (o mais específico vence).
    let mut melhor: Option<(usize, i64)> = None;
    for (i, n) in normais.iter().enumerate() {
        if IGNORAR_VALOR.iter().any(|p| n.contains(p)) {
            continue;
        }
        let Some(prioridade) = ROTULOS_VALOR.iter().position(|r| n.starts_with(r) || n.contains(&format!(" {r}")) || n.contains(&format!("{r}:"))) else { continue };
        let candidato = valores_na_linha(&linhas[i]).first().copied().or_else(|| linhas.get(i + 1).and_then(|l| valores_na_linha(l).first().copied()));
        if let Some(v) = candidato {
            if melhor.map_or(true, |(p, _)| prioridade < p) {
                melhor = Some((prioridade, v));
            }
        }
    }
    if let Some((p, v)) = melhor {
        // Rótulos específicos ("valor total", "valor pago"…) valem mais que o genérico "valor"; "total" solto, menos.
        return (Some(v), match p { 0..=4 => 0.9, 5..=7 => 0.85, _ => 0.8 });
    }
    // 2) Sem rótulo: o maior valor precedido de "R$" (confiança menor); depois qualquer valor decimal.
    static RS: OnceLock<Regex> = OnceLock::new();
    let com_rs = linhas.iter().zip(normais).filter(|(_, n)| !IGNORAR_VALOR.iter().any(|p| n.contains(p))).flat_map(|(l, _)| {
        re(&RS, r"R\s?\$\s*(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})").captures_iter(l).flat_map(|c| valores_na_linha(&c[1])).collect::<Vec<_>>()
    });
    if let Some(v) = com_rs.max() {
        return (Some(v), 0.5);
    }
    if let Some(v) = linhas.iter().flat_map(|l| valores_na_linha(l)).max() {
        return (Some(v), 0.35);
    }
    (None, 0.0)
}

// ---------------------------------------------------------------- data

const MESES: &[(&str, u32)] = &[("jan", 1), ("fev", 2), ("mar", 3), ("abr", 4), ("mai", 5), ("jun", 6), ("jul", 7), ("ago", 8), ("set", 9), ("out", 10), ("nov", 11), ("dez", 12)];

fn datas_na_linha(linha: &str) -> Vec<NaiveDate> {
    static NUM: OnceLock<Regex> = OnceLock::new();
    static ISO: OnceLock<Regex> = OnceLock::new();
    static EXT: OnceLock<Regex> = OnceLock::new();
    let valida = |d: u32, m: u32, a: i32| NaiveDate::from_ymd_opt(a, m, d).filter(|x| (2000..=2100).contains(&x.year()));
    let mut achadas = Vec::new();
    for c in re(&NUM, r"\b(\d{2})/(\d{2})/(\d{4}|\d{2})\b").captures_iter(linha) {
        let a: i32 = c[3].parse().unwrap_or(0);
        let a = if c[3].len() == 2 { 2000 + a } else { a };
        if let Some(d) = valida(c[1].parse().unwrap_or(0), c[2].parse().unwrap_or(0), a) { achadas.push(d); }
    }
    for c in re(&ISO, r"\b(\d{4})-(\d{2})-(\d{2})\b").captures_iter(linha) {
        if let Some(d) = valida(c[3].parse().unwrap_or(0), c[2].parse().unwrap_or(0), c[1].parse().unwrap_or(0)) { achadas.push(d); }
    }
    let n = normalizar(linha);
    for c in re(&EXT, r"\b(\d{1,2})\s*(?:de\s+)?([a-z]{3})[a-z]*\.?\s*(?:de\s+)?(\d{4})\b").captures_iter(&n) {
        if let Some((_, m)) = MESES.iter().find(|(abrev, _)| *abrev == &c[2]) {
            if let Some(d) = valida(c[1].parse().unwrap_or(0), *m, c[3].parse().unwrap_or(0)) { achadas.push(d); }
        }
    }
    achadas
}

fn extrair_data(linhas: &[String], normais: &[String]) -> (Option<NaiveDate>, f32) {
    const ROTULOS: &[&str] = &["data do pagamento", "data de pagamento", "pagamento", "efetivacao", "realizado", "transferencia", "data da transacao", "data da compra", "data"];
    for r in ROTULOS {
        for (i, n) in normais.iter().enumerate() {
            if n.contains("vencimento") || !n.contains(r) {
                continue;
            }
            if let Some(d) = datas_na_linha(&linhas[i]).first() {
                return (Some(*d), 0.9);
            }
            if let Some(d) = linhas.get(i + 1).and_then(|l| datas_na_linha(l).first().copied()) {
                return (Some(d), 0.85);
            }
        }
    }
    for (l, n) in linhas.iter().zip(normais) {
        if !n.contains("vencimento") {
            if let Some(d) = datas_na_linha(l).first() {
                return (Some(*d), 0.6);
            }
        }
    }
    for l in linhas {
        if let Some(d) = datas_na_linha(l).first() {
            return (Some(*d), 0.4); // só havia vencimento
        }
    }
    (None, 0.0)
}

// ---------------------------------------------------------------- tipo e forma

fn extrair_tipo(texto: &str) -> (Option<&'static str>, f32) {
    const SAIDA: &[&str] = &["pix enviado", "transferencia enviada", "pagamento realizado", "pagamento efetuado", "voce pagou", "comprovante de pagamento", "compra aprovada", "pagamento de boleto", "transferencia realizada", "pix realizado"];
    const ENTRADA: &[&str] = &["pix recebido", "voce recebeu", "transferencia recebida", "recebido com sucesso", "deposito recebido"];
    let (s, e) = (SAIDA.iter().any(|p| texto.contains(p)), ENTRADA.iter().any(|p| texto.contains(p)));
    match (s, e) {
        (true, false) => (Some("saida"), 0.85),
        (false, true) => (Some("entrada"), 0.85),
        // Sem pista (ou pistas contraditórias): a maioria dos comprovantes guardados é de gasto, mas a tela avisa.
        _ => (Some("saida"), 0.3),
    }
}

fn extrair_forma(texto: &str) -> Option<&'static str> {
    if texto.contains("pix") {
        Some("pix")
    } else if texto.contains("boleto") || texto.contains("codigo de barras") || texto.contains("linha digitavel") {
        Some("boleto")
    } else if texto.contains(" ted ") || texto.contains("ted ") && texto.contains("transferencia") {
        Some("ted")
    } else if texto.contains("cartao") || texto.contains("credito") || texto.contains("debito") {
        Some("cartao")
    } else {
        None
    }
}

// ---------------------------------------------------------------- nomes

#[derive(Clone, Copy, PartialEq)]
enum Lado {
    Origem,
    Destino,
}

const SECAO_ORIGEM: &[&str] = &["origem", "pagador", "remetente", "quem pagou", "quem enviou", "dados de quem pagou", "dados do pagador", "de"];
const SECAO_DESTINO: &[&str] = &["destino", "recebedor", "favorecido", "beneficiario", "quem recebeu", "dados de quem recebeu", "dados do recebedor", "para", "estabelecimento"];

fn rotulo_puro(n: &str) -> &str {
    n.trim().trim_end_matches(':').trim()
}

fn parece_rotulo(n: &str) -> bool {
    let r = rotulo_puro(n);
    n.trim_end().ends_with(':')
        || ["nome", "cpf", "cnpj", "cpf/cnpj", "instituicao", "agencia", "conta", "banco", "chave", "tipo de conta", "documento", "id", "data", "valor"].contains(&r)
        || SECAO_ORIGEM.contains(&r)
        || SECAO_DESTINO.contains(&r)
}

/// Aceita só o que parece nome de pessoa/empresa e o devolve com capitalização legível.
fn limpar_nome(bruto: &str) -> Option<String> {
    static DOC: OnceLock<Regex> = OnceLock::new();
    let sem_doc = re(&DOC, r"[\d•*Xx.\-/]{6,}").replace_all(bruto, " ");
    let compacto = sem_doc.split_whitespace().collect::<Vec<_>>().join(" ");
    let compacto = compacto.trim_matches(|c: char| !c.is_alphanumeric()).to_string();
    let letras = compacto.chars().filter(|c| c.is_alphabetic()).count();
    let digitos = compacto.chars().filter(|c| c.is_ascii_digit()).count();
    if compacto.chars().count() < 3 || compacto.chars().count() > 80 || letras < 3 || digitos > 4 {
        return None;
    }
    let maiusculo = compacto.chars().filter(|c| c.is_alphabetic()).all(|c| c.is_uppercase());
    if !maiusculo {
        return Some(compacto);
    }
    const LIGACOES: &[&str] = &["de", "da", "do", "das", "dos", "e"];
    let palavras: Vec<String> = compacto
        .split(' ')
        .enumerate()
        .map(|(i, p)| {
            let minusc = p.to_lowercase();
            if i > 0 && LIGACOES.contains(&minusc.as_str()) {
                return minusc;
            }
            let mut cs = minusc.chars();
            cs.next().map(|c| c.to_uppercase().collect::<String>() + cs.as_str()).unwrap_or_default()
        })
        .collect();
    Some(palavras.join(" "))
}

/// Linha que é valor, data ou dinheiro não pode ser nome — evita pegar "Valor R$ 5,00" como favorecido.
fn parece_dado(linha: &str, normal: &str) -> bool {
    normal.contains("r$") || !valores_na_linha(linha).is_empty() || !datas_na_linha(linha).is_empty()
}

fn valor_apos_rotulo(linhas: &[String], normais: &[String], i: usize) -> Option<String> {
    // "Rótulo: valor" — se há conteúdo depois dos dois pontos, é ele ou nada (não se procura na linha de baixo).
    if let Some((_, resto)) = linhas[i].split_once(':') {
        if !resto.trim().is_empty() {
            return limpar_nome(resto);
        }
    }
    let proxima = i + 1;
    (proxima < linhas.len() && !parece_rotulo(&normais[proxima]) && !parece_dado(&linhas[proxima], &normais[proxima])).then(|| limpar_nome(&linhas[proxima])).flatten()
}

struct Nomes {
    origem: Option<String>,
    destino: Option<String>,
    cnpj_origem: Option<String>,
    cnpj_destino: Option<String>,
}

fn extrair_nomes(linhas: &[String], normais: &[String]) -> Nomes {
    static CNPJ: OnceLock<Regex> = OnceLock::new();
    let mut n = Nomes { origem: None, destino: None, cnpj_origem: None, cnpj_destino: None };
    let mut secao: Option<Lado> = None;
    let cnpj_perto = |i: usize| (i..(i + 4).min(linhas.len())).find_map(|j| re(&CNPJ, r"\b\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}\b").find(&linhas[j]).map(|m| m.as_str().to_string()));
    for i in 0..linhas.len() {
        let r = rotulo_puro(&normais[i]);
        // Cabeçalho de seção ("Destino", "Quem recebeu"…), com ou sem o nome na mesma linha.
        let rot = r.split_once(':').map_or(r, |(a, _)| a.trim());
        let lado = if SECAO_ORIGEM.contains(&rot) { Some(Lado::Origem) } else if SECAO_DESTINO.contains(&rot) { Some(Lado::Destino) } else { None };
        if let Some(l) = lado {
            secao = Some(l);
            // O nome vem na mesma linha ("Favorecido: Fulano"), na linha seguinte ("Beneficiário" / "Fulano")
            // ou, em layouts com seções, num "Nome" logo abaixo (tratado adiante).
            if let Some(nome) = valor_apos_rotulo(linhas, normais, i) {
                let (alvo, doc) = if l == Lado::Origem { (&mut n.origem, &mut n.cnpj_origem) } else { (&mut n.destino, &mut n.cnpj_destino) };
                if alvo.is_none() { *alvo = Some(nome); *doc = cnpj_perto(i); }
            }
            continue;
        }
        // "Nome do recebedor", "Nome do pagador", "Nome" solto dentro de uma seção.
        let explicito = if rot.starts_with("nome do recebedor") || rot.starts_with("nome do favorecido") || rot.starts_with("nome do beneficiario") { Some(Lado::Destino) } else if rot.starts_with("nome do pagador") || rot.starts_with("nome do remetente") { Some(Lado::Origem) } else if rot == "nome" || rot == "nome completo" || rot == "razao social" { secao } else { None };
        if let Some(l) = explicito {
            if let Some(nome) = valor_apos_rotulo(linhas, normais, i) {
                let (alvo, doc) = if l == Lado::Origem { (&mut n.origem, &mut n.cnpj_origem) } else { (&mut n.destino, &mut n.cnpj_destino) };
                if alvo.is_none() { *alvo = Some(nome); *doc = cnpj_perto(i); }
            }
        }
    }
    n
}

// ---------------------------------------------------------------- junção

pub fn analisar(texto: &str) -> Sugestao {
    let linhas: Vec<String> = texto.lines().map(|l| l.split_whitespace().collect::<Vec<_>>().join(" ")).filter(|l| !l.is_empty()).collect();
    if linhas.is_empty() {
        return Sugestao::default();
    }
    let normais: Vec<String> = linhas.iter().map(|l| normalizar(l)).collect();
    let tudo = format!(" {} ", normais.join("\n"));

    let (valor, c_valor) = extrair_valor(&linhas, &normais);
    let (data, c_data) = extrair_data(&linhas, &normais);
    let (tipo, c_tipo) = extrair_tipo(&tudo);
    let forma = extrair_forma(&tudo);
    let nomes = extrair_nomes(&linhas, &normais);
    let (nome, documento) = if tipo == Some("entrada") { (nomes.origem, nomes.cnpj_origem) } else { (nomes.destino, nomes.cnpj_destino) };
    let c_benef = if nome.is_some() { 0.8 } else { 0.0 };

    let descricao = match (&nome, forma, tipo) {
        (Some(n), Some("pix"), Some("entrada")) => Some(format!("Pix de {n}")),
        (Some(n), Some("pix"), _) => Some(format!("Pix para {n}")),
        (Some(n), Some("boleto"), _) => Some(format!("Boleto {n}")),
        (Some(n), _, _) => Some(n.clone()),
        (None, Some("pix"), _) => Some("Pix".to_string()),
        (None, Some("boleto"), _) => Some("Boleto".to_string()),
        _ => None,
    };
    let geral = if valor.is_some() && data.is_some() { c_valor.min(c_data) } else { 0.0 };
    Sugestao { descricao, valor_centavos: valor, data, tipo, forma_pagamento: forma, beneficiario_nome: nome, documento, confianca: Confianca { valor: c_valor, data: c_data, tipo: c_tipo, beneficiario: c_benef, geral } }
}

#[cfg(test)]
mod testes {
    //! Textos **sintéticos**, escritos à mão no estilo de cada tipo de comprovante — não são comprovantes reais.
    //! A calibração com comprovantes de verdade ainda está pendente.
    use super::*;

    fn d(a: i32, m: u32, dia: u32) -> NaiveDate { NaiveDate::from_ymd_opt(a, m, dia).unwrap() }

    #[test]
    fn pix_enviado_com_secoes_origem_e_destino() {
        let s = analisar("Comprovante de transferência\nPix enviado\nValor\nR$ 1.234,56\nData do pagamento\n30/09/2026 - 14:32:10\nDestino\nNome\nMARIA APARECIDA DA SILVA\nCPF\n•••.123.456-••\nInstituição\nBanco Exemplo\nOrigem\nNome\nDiogo Roque\n");
        assert_eq!(s.valor_centavos, Some(123_456));
        assert_eq!(s.data, Some(d(2026, 9, 30)));
        assert_eq!(s.tipo, Some("saida"));
        assert_eq!(s.forma_pagamento, Some("pix"));
        assert_eq!(s.beneficiario_nome.as_deref(), Some("Maria Aparecida da Silva"));
        assert_eq!(s.descricao.as_deref(), Some("Pix para Maria Aparecida da Silva"));
        assert!(s.documento.is_none(), "CPF de terceiro nunca é extraído");
        assert!(s.confianca.geral >= 0.85);
    }

    #[test]
    fn pix_recebido_usa_a_origem_como_quem_pagou() {
        let s = analisar("Pix recebido\nVocê recebeu R$ 80,00\n02/10/2026\nOrigem\nNome\nJoão Pereira\nDestino\nNome\nDiogo Roque");
        assert_eq!(s.tipo, Some("entrada"));
        assert_eq!(s.valor_centavos, Some(8000));
        assert_eq!(s.beneficiario_nome.as_deref(), Some("João Pereira"));
        assert_eq!(s.descricao.as_deref(), Some("Pix de João Pereira"));
    }

    #[test]
    fn rotulos_com_dois_pontos_na_mesma_linha_e_cnpj_de_empresa() {
        let s = analisar("COMPROVANTE DE PAGAMENTO\nFavorecido: PADARIA PÃO QUENTE LTDA\nCNPJ: 12.345.678/0001-95\nValor pago: R$ 45,90\nPagamento: 15 de agosto de 2026\nPix");
        assert_eq!(s.valor_centavos, Some(4590));
        assert_eq!(s.data, Some(d(2026, 8, 15)));
        assert_eq!(s.beneficiario_nome.as_deref(), Some("Padaria Pão Quente Ltda"));
        assert_eq!(s.documento.as_deref(), Some("12.345.678/0001-95"));
    }

    #[test]
    fn boleto_prefere_a_data_do_pagamento_ao_vencimento_e_ignora_juros_e_multa() {
        let s = analisar("Pagamento de boleto realizado\nBeneficiário\nCONDOMINIO RESIDENCIAL ALFA\nVencimento 10/09/2026\nJuros R$ 1,20\nMulta R$ 3,00\nValor total R$ 612,40\nData do pagamento 12/09/2026");
        assert_eq!(s.valor_centavos, Some(61_240));
        assert_eq!(s.data, Some(d(2026, 9, 12)));
        assert_eq!(s.forma_pagamento, Some("boleto"));
        assert_eq!(s.descricao.as_deref(), Some("Boleto Condominio Residencial Alfa"));
    }

    #[test]
    fn cupom_sem_rotulos_cai_no_maior_valor_com_confianca_baixa() {
        let s = analisar("MERCADO BOM PRECO\n01/10/2026 18:20\nARROZ 5KG R$ 28,90\nFEIJAO R$ 9,50\nTOTAL R$ 38,40\nCARTAO DEBITO");
        assert_eq!(s.valor_centavos, Some(3840));
        assert_eq!(s.forma_pagamento, Some("cartao"));
        let sem = analisar("ARROZ R$ 28,90\nFEIJAO R$ 9,50\n20/09/2026");
        assert_eq!(sem.valor_centavos, Some(2890));
        assert!(sem.confianca.valor <= 0.5, "sem rótulo, a tela deve pedir conferência");
        assert!(sem.confianca.geral <= 0.5);
    }

    #[test]
    fn data_de_dois_digitos_abreviacao_e_datas_impossiveis() {
        assert_eq!(analisar("Valor R$ 10,00\nData 05/03/26").data, Some(d(2026, 3, 5)));
        assert_eq!(analisar("Valor R$ 10,00\nData 5 set 2026").data, Some(d(2026, 9, 5)));
        assert_eq!(analisar("Valor R$ 10,00\nData 31/02/2026").data, None, "31/02 não existe");
        assert_eq!(analisar("Valor R$ 10,00\nData 10/10/1850").data, None);
    }

    #[test]
    fn texto_vazio_ou_sem_nada_util_nao_inventa_campos() {
        assert_eq!(analisar(""), Sugestao::default());
        let s = analisar("lorem ipsum dolor sit amet");
        assert!(s.valor_centavos.is_none() && s.data.is_none() && s.beneficiario_nome.is_none());
        assert_eq!(s.confianca.geral, 0.0);
    }

    #[test]
    fn valores_absurdos_e_ruido_de_ocr_sao_descartados() {
        assert_eq!(analisar("Valor R$ 0,00").valor_centavos, None);
        assert_eq!(analisar("Valor R$ 9.999.999.999,99").valor_centavos, None);
        // Nome que é só número/ruído não vira beneficiário.
        assert!(analisar("Favorecido: 123456 789012\nValor R$ 5,00").beneficiario_nome.is_none());
    }
}
