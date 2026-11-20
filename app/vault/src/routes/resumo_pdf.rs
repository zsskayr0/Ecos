//! Resumo do Fechamento em PDF: a mesma informação da tela, numa folha que a contabilidade pode arquivar ou imprimir, com
//! o visual do Ecos (Poppins, o ícone da marca, a paleta do tema claro, cartões, etiquetas e tabelas zebradas).
//! Os números vêm do JSON de `fechamento::fechamento`; nada é recalculado aqui, só apresentado.
//!
//! Sai de duas formas: dentro do pacote (`resumo-fechamento.pdf`) e sozinho em `GET /vault/fechamento/resumo.pdf`.

use axum::{
    extract::{Query, State},
    response::Response,
};
use chrono::NaiveDate;
use serde_json::Value;
use std::collections::HashMap;

use crate::{
    error::AppResult,
    pdf::{caber, medir, quebrar, Cor, Documento, Fonte, ALTURA, LARGURA},
    state::AppState,
};

/// Paleta do tema claro do Ecos (`app/client`, tokens de cor).
mod paleta {
    use crate::pdf::Cor;
    pub const TEXTO: Cor = Cor(15, 23, 41);
    pub const SECUNDARIO: Cor = Cor(61, 74, 99);
    pub const MUDO: Cor = Cor(82, 96, 124);
    pub const BORDA: Cor = Cor(184, 200, 221);
    pub const SUPERFICIE: Cor = Cor(246, 249, 253);
    pub const SUPERFICIE_2: Cor = Cor(226, 234, 245);
    pub const ACENTO: Cor = Cor(31, 92, 158);
    pub const ACENTO_CLARO: Cor = Cor(215, 229, 246);
    pub const OK: Cor = Cor(21, 106, 46);
    pub const OK_FUNDO: Cor = Cor(224, 243, 230);
    pub const OK_BORDA: Cor = Cor(164, 212, 180);
    pub const OK_BARRA: Cor = Cor(134, 215, 173);
    pub const ERRO: Cor = Cor(185, 28, 28);
    pub const ERRO_FUNDO: Cor = Cor(252, 230, 230);
    pub const ERRO_BARRA: Cor = Cor(242, 154, 159);
    pub const ALERTA: Cor = Cor(150, 67, 8);
    pub const ALERTA_FUNDO: Cor = Cor(253, 238, 222);
    pub const ALERTA_BORDA: Cor = Cor(232, 196, 160);
}
use paleta::*;

const MARGEM: f32 = 40.0;
const DIREITA: f32 = LARGURA - MARGEM;
const LARGURA_UTIL: f32 = DIREITA - MARGEM;
const TOPO: f32 = 34.0;
const TOPO_SEGUINTES: f32 = 56.0;
const BASE: f32 = ALTURA - 52.0;

/// "1.234,56" (negativo com sinal na frente).
pub fn milhar(centavos: i64) -> String {
    let sinal = if centavos < 0 { "-" } else { "" };
    let abs = centavos.unsigned_abs();
    let inteiro = (abs / 100).to_string();
    let mut com_pontos = String::new();
    for (i, c) in inteiro.chars().enumerate() {
        if i > 0 && (inteiro.len() - i).is_multiple_of(3) {
            com_pontos.push('.');
        }
        com_pontos.push(c);
    }
    format!("{sinal}{com_pontos},{:02}", abs % 100)
}

fn rs(centavos: i64) -> String {
    let m = milhar(centavos);
    match m.strip_prefix('-') {
        Some(resto) => format!("-R$ {resto}"),
        None => format!("R$ {m}"),
    }
}

fn br(iso: &str) -> String {
    NaiveDate::parse_from_str(iso, "%Y-%m-%d").map(|d| d.format("%d/%m/%Y").to_string()).unwrap_or_else(|_| iso.to_string())
}

fn n(v: &Value) -> i64 {
    v.as_i64().unwrap_or(0)
}

fn cor_do_valor(centavos: i64) -> Cor {
    if centavos < 0 {
        ERRO
    } else {
        OK
    }
}

/// "#rrggbb" do cadastro da conta; cinza se vier algo diferente.
fn cor_hex(s: &str) -> Cor {
    let h = s.trim_start_matches('#');
    if h.len() == 6 {
        if let (Ok(r), Ok(g), Ok(b)) = (u8::from_str_radix(&h[0..2], 16), u8::from_str_radix(&h[2..4], 16), u8::from_str_radix(&h[4..6], 16)) {
            return Cor(r, g, b);
        }
    }
    Cor(143, 143, 150)
}

/// Linha de base que centraliza verticalmente um texto numa faixa.
fn base_centrada(topo: f32, altura: f32, tamanho: f32) -> f32 {
    topo + altura / 2.0 + 0.34 * tamanho
}

// ---------------------------------------------------------------------------------------------------------------------
// O que a tela chama de "situação": pronto para enviar, ou o que falta. Mesma regra de `analise.ts`.
// ---------------------------------------------------------------------------------------------------------------------

/// Altura dos três cartões de totais (entradas, saídas, resultado).
const ALTURA_CARTAO: f32 = 48.0;
const BLOQUEIAM: [&str; 3] = ["pendentes", "sem_categoria", "sem_conta"];
const PEDEM_ATENCAO: [&str; 2] = ["sem_comprovante", "nao_conciliadas"];

#[derive(Debug, PartialEq, Eq)]
struct Situacao {
    bloqueios: i64,
    recibos_faltando: i64,
    a_conferir: i64,
    divergentes: i64,
    atencao: i64,
    pronto: bool,
    /// O período ainda não terminou: números parciais, sem conferência com o banco.
    em_andamento: bool,
}

fn situacao(f: &Value) -> Situacao {
    let p = &f["pendencias"];
    let quantos = |chaves: &[&str]| chaves.iter().filter(|k| n(&p[**k]["quantidade"]) > 0).count() as i64;
    let bloqueios = quantos(&BLOQUEIAM);
    let recibos_faltando = if f["lucros"]["configurada"].as_bool().unwrap_or(false) { n(&f["lucros"]["sem_recibo"]) } else { 0 };
    let sem_par = f["transferencias"]["configurada"].as_bool().unwrap_or(false) && !f["transferencias"]["equilibrada"].as_bool().unwrap_or(true);
    let atencao = quantos(&PEDEM_ATENCAO) + i64::from(n(&p["rascunhos"]) > 0) + i64::from(sem_par);
    let (mut a_conferir, mut divergentes) = (0, 0);
    let em_andamento = f["em_andamento"].as_bool().unwrap_or(false);
    if f["mes"].is_string() && !em_andamento {
        for c in f["contas"].as_array().into_iter().flatten() {
            let confere = c["conta_id"].is_string() && (n(&c["lancamentos"]) > 0 || n(&c["saldo_inicial"]) != 0 || n(&c["saldo_final"]) != 0);
            if !confere {
                continue;
            }
            if c["saldo_banco"].is_null() {
                a_conferir += 1;
            }
            if c["diferenca"].as_i64().is_some_and(|d| d != 0) {
                divergentes += 1;
            }
        }
    }
    Situacao { bloqueios, recibos_faltando, a_conferir, divergentes, atencao, pronto: !em_andamento && bloqueios == 0 && recibos_faltando == 0 && a_conferir == 0 && divergentes == 0, em_andamento }
}

// ---------------------------------------------------------------------------------------------------------------------
// Categorias: filhas embaixo da mãe, como na tela (`agruparCategorias`).
// ---------------------------------------------------------------------------------------------------------------------

struct Parcela {
    nome: String,
    valor: i64,
    lancamentos: i64,
}

struct Grupo {
    nome: String,
    valor: i64,
    lancamentos: i64,
    filhas: Vec<Parcela>,
}

fn agrupar(f: &Value, tipo: &str, nomes: &HashMap<String, String>) -> Vec<Grupo> {
    struct Bruto {
        id: Option<String>,
        nome: String,
        direto: Option<Parcela>,
        filhas: Vec<Parcela>,
    }
    fn achar(brutos: &mut Vec<Bruto>, id: Option<&str>, nome: String) -> usize {
        match brutos.iter().position(|b| b.id.as_deref() == id) {
            Some(i) => i,
            None => {
                brutos.push(Bruto { id: id.map(str::to_string), nome, direto: None, filhas: Vec::new() });
                brutos.len() - 1
            }
        }
    }
    let mut brutos: Vec<Bruto> = Vec::new();
    for l in f["categorias"].as_array().into_iter().flatten().filter(|l| l["tipo"] == tipo) {
        let (valor, lancamentos) = (n(&l["valor"]), n(&l["lancamentos"]));
        let id = l["categoria_id"].as_str();
        match l["pai_id"].as_str() {
            Some(pai) => {
                let i = achar(&mut brutos, Some(pai), nomes.get(pai).cloned().unwrap_or_else(|| "Categoria".into()));
                brutos[i].filhas.push(Parcela { nome: l["nome"].as_str().unwrap_or("Categoria").to_string(), valor, lancamentos });
            }
            None => {
                let nome = match id {
                    Some(id) => l["nome"].as_str().map(str::to_string).or_else(|| nomes.get(id).cloned()).unwrap_or_else(|| "Categoria".into()),
                    None => "Sem categoria".into(),
                };
                let i = achar(&mut brutos, id, nome);
                brutos[i].direto = Some(Parcela { nome: if id.is_some() { "Sem subcategoria".into() } else { "Sem categoria".into() }, valor, lancamentos });
            }
        }
    }
    let mut grupos: Vec<Grupo> = brutos
        .into_iter()
        .map(|mut b| {
            b.filhas.sort_by(|x, y| y.valor.cmp(&x.valor).then_with(|| x.nome.to_lowercase().cmp(&y.nome.to_lowercase())));
            let (mut valor, mut lancamentos) = (b.filhas.iter().map(|p| p.valor).sum::<i64>(), b.filhas.iter().map(|p| p.lancamentos).sum::<i64>());
            let mut filhas = b.filhas;
            if let Some(d) = b.direto {
                valor += d.valor;
                lancamentos += d.lancamentos;
                if !filhas.is_empty() {
                    filhas.push(d);
                }
            }
            Grupo { nome: b.nome, valor, lancamentos, filhas }
        })
        .collect();
    grupos.sort_by(|x, y| y.valor.cmp(&x.valor).then_with(|| x.nome.to_lowercase().cmp(&y.nome.to_lowercase())));
    grupos
}

// ---------------------------------------------------------------------------------------------------------------------
// Desenho
// ---------------------------------------------------------------------------------------------------------------------

struct Col {
    titulo: &'static str,
    largura: f32,
    direita: bool,
}

enum Cel {
    Vazio,
    Texto(String),
    Forte(String),
    Num(String, Cor),
    Conta(Cor, String, String),
    Pilula(String, Cor, Cor),
}

struct Folha {
    d: Documento,
    y: f32,
}

impl Folha {
    fn nova() -> Self {
        Self { d: Documento::new(), y: TOPO }
    }

    /// Abre página nova se `altura` não couber no que resta.
    fn garantir(&mut self, altura: f32) {
        if self.y + altura > BASE {
            self.d.nova_pagina();
            self.y = TOPO_SEGUINTES;
        }
    }

    /// Etiqueta arredondada; devolve a largura.
    fn pilula(&mut self, x: f32, y: f32, texto: &str, fundo: Cor, cor: Cor) -> f32 {
        let w = medir(texto, Fonte::SemiBold, 7.0) + 12.0;
        self.d.retangulo(x, y, w, 13.0, 6.5, Some(fundo), None);
        self.d.texto(x + 6.0, y + 9.1, Fonte::SemiBold, 7.0, cor, texto);
        w
    }

    fn secao(&mut self, titulo: &str, a_direita: Option<&str>) {
        self.garantir(64.0);
        self.y += 20.0;
        self.d.retangulo(MARGEM, self.y, 3.0, 13.0, 1.5, Some(ACENTO), None);
        self.d.texto(MARGEM + 10.0, self.y + 10.5, Fonte::Bold, 11.5, TEXTO, titulo);
        if let Some(t) = a_direita {
            self.d.texto_a_direita(DIREITA, self.y + 10.0, Fonte::Regular, 7.5, MUDO, t);
        }
        self.y += 24.0;
    }

    fn cabecalho_da_marca(&mut self, de: &str, ate: &str) {
        self.d.logo(MARGEM, self.y, 32.0);
        self.d.texto(MARGEM + 42.0, self.y + 15.0, Fonte::Bold, 19.0, TEXTO, "Ecos");
        self.d.texto_espacado(MARGEM + 42.0, self.y + 28.0, Fonte::SemiBold, 6.5, MUDO, 1.4, "COFRE  ·  FECHAMENTO");
        let gerado = format!("Gerado em {}", chrono::Local::now().format("%d/%m/%Y às %H:%M"));
        self.d.texto_a_direita(DIREITA, self.y + 14.0, Fonte::Regular, 7.5, MUDO, &gerado);
        self.d.texto_a_direita(DIREITA, self.y + 25.0, Fonte::Regular, 7.5, MUDO, "Regime de caixa · valores em reais");
        self.y += 46.0;
        self.d.linha(MARGEM, DIREITA, self.y, 0.8, BORDA);
        self.y += 30.0;
        self.d.texto(MARGEM, self.y, Fonte::Bold, 23.0, TEXTO, "Fechamento financeiro");
        self.y += 13.0;
        let periodo = format!("{} a {}", br(de), br(ate));
        let w = self.pilula(MARGEM, self.y, &periodo, ACENTO_CLARO, ACENTO);
        self.pilula(MARGEM + w + 6.0, self.y, "Só lançamentos efetivados", SUPERFICIE_2, SECUNDARIO);
        self.y += 28.0;
    }

    fn faixa_de_situacao(&mut self, s: &Situacao) {
        let mut linhas: Vec<String> = Vec::new();
        if s.em_andamento {
            linhas.push("O período ainda não terminou: os números são parciais.".to_string());
            linhas.push("A conferência com o extrato do banco e o fechamento ficam para depois do último dia.".to_string());
        }
        if s.bloqueios > 0 && !s.em_andamento {
            linhas.push(format!("{} tipo(s) de pendência a resolver: lançamentos pendentes, sem categoria ou sem conta.", s.bloqueios));
        }
        if s.recibos_faltando > 0 && !s.em_andamento {
            linhas.push(format!("{} distribuição(ões) de lucros sem recibo anexado.", s.recibos_faltando));
        }
        if s.a_conferir > 0 {
            linhas.push(format!("{} conta(s) sem o saldo do extrato do banco informado.", s.a_conferir));
        }
        if s.divergentes > 0 {
            linhas.push(format!("{} conta(s) com diferença entre o banco e o Cofre.", s.divergentes));
        }
        if s.pronto {
            linhas.insert(0, "Nenhuma pendência impede este fechamento.".to_string());
        }
        if s.atencao > 0 {
            linhas.push(format!("{} ponto(s) de atenção, que não impedem o envio (veja Pendências, no fim).", s.atencao));
        }
        let altura = 16.0 + 14.0 + linhas.len() as f32 * 12.0 + 8.0;
        self.garantir(altura + 8.0);
        let (fundo, borda, cor, titulo) = if s.em_andamento { (ACENTO_CLARO, BORDA, ACENTO, "Período em andamento") } else if s.pronto { (OK_FUNDO, OK_BORDA, OK, "Pronto para enviar à contabilidade") } else { (ALERTA_FUNDO, ALERTA_BORDA, ALERTA, "Ainda não está pronto para enviar") };
        self.d.retangulo(MARGEM, self.y, LARGURA_UTIL, altura, 8.0, Some(fundo), Some((borda, 0.6)));
        self.d.retangulo(MARGEM + 11.0, self.y + 11.0, 3.0, altura - 22.0, 1.5, Some(cor), None);
        self.d.texto(MARGEM + 24.0, self.y + 21.0, Fonte::SemiBold, 11.0, cor, titulo);
        for (i, l) in linhas.iter().enumerate() {
            let t = caber(l, LARGURA_UTIL - 40.0, Fonte::Regular, 8.0);
            self.d.texto(MARGEM + 24.0, self.y + 35.0 + i as f32 * 12.0, Fonte::Regular, 8.0, SECUNDARIO, &t);
        }
        self.y += altura + 14.0;
    }

    fn cartao_de_valor(&mut self, x: f32, largura: f32, rotulo: &str, valor: &str, cor: Cor) {
        self.d.retangulo(x, self.y, largura, ALTURA_CARTAO, 8.0, Some(SUPERFICIE), Some((BORDA, 0.6)));
        self.d.retangulo(x + 12.0, self.y + 12.0, 5.0, 5.0, 2.5, Some(cor), None);
        self.d.texto_espacado(x + 22.0, self.y + 18.0, Fonte::SemiBold, 6.8, MUDO, 0.9, rotulo);
        self.d.texto(x + 12.0, self.y + 38.0, Fonte::Bold, 14.5, cor, &caber(valor, largura - 24.0, Fonte::Bold, 14.5));
    }

    fn totais(&mut self, f: &Value) {
        let t = &f["totais"];
        let com_transferencias = f["transferencias"]["configurada"].as_bool().unwrap_or(false);
        self.garantir(ALTURA_CARTAO + 12.0 + 40.0);
        let w = (LARGURA_UTIL - 20.0) / 3.0;
        self.cartao_de_valor(MARGEM, w, "ENTRADAS", &rs(n(&t["entradas"])), OK);
        self.cartao_de_valor(MARGEM + w + 10.0, w, "SAÍDAS", &rs(n(&t["saidas"])), ERRO);
        let resultado = n(&t["resultado"]);
        self.cartao_de_valor(MARGEM + 2.0 * (w + 10.0), w, "RESULTADO", &rs(resultado), cor_do_valor(resultado));
        self.y += ALTURA_CARTAO + 10.0;

        let mut itens = vec![("SALDO INICIAL", rs(n(&t["saldo_inicial"])), TEXTO)];
        if com_transferencias {
            itens.push(("TRANSFERÊNCIAS (LÍQUIDO)", rs(n(&t["transferencias"])), SECUNDARIO));
        }
        itens.push(("SALDO FINAL", rs(n(&t["saldo_final"])), TEXTO));
        self.d.retangulo(MARGEM, self.y, LARGURA_UTIL, 36.0, 8.0, Some(SUPERFICIE_2), None);
        let coluna = LARGURA_UTIL / itens.len() as f32;
        for (i, (rotulo, valor, cor)) in itens.iter().enumerate() {
            let x = MARGEM + 14.0 + coluna * i as f32;
            self.d.texto_espacado(x, self.y + 14.0, Fonte::SemiBold, 6.5, MUDO, 0.9, rotulo);
            self.d.texto(x, self.y + 28.0, Fonte::SemiBold, 10.5, *cor, valor);
        }
        self.y += 36.0 + 4.0;
    }

    fn cabecalho_de_tabela(&mut self, cols: &[Col]) {
        self.d.retangulo(MARGEM, self.y, LARGURA_UTIL, 18.0, 5.0, Some(SUPERFICIE_2), None);
        let mut x = MARGEM;
        for c in cols {
            let base = base_centrada(self.y, 18.0, 6.8);
            if c.direita {
                self.d.texto_a_direita(x + c.largura - 7.0, base, Fonte::SemiBold, 6.8, SECUNDARIO, c.titulo);
            } else {
                self.d.texto(x + 8.0, base, Fonte::SemiBold, 6.8, SECUNDARIO, c.titulo);
            }
            x += c.largura;
        }
        self.y += 18.0;
    }

    fn linha_de_celulas(&mut self, cols: &[Col], cels: &[Cel], altura: f32, forte: bool) {
        let tam = 7.8;
        let mut x = MARGEM;
        for (col, cel) in cols.iter().zip(cels) {
            let (esq, dir) = (x + 8.0, x + col.largura - 7.0);
            let largura = dir - esq;
            let fonte = if forte { Fonte::SemiBold } else { Fonte::Regular };
            let base = base_centrada(self.y, altura, tam);
            let escrever = |d: &mut Documento, t: &str, f: Fonte, cor: Cor| {
                let t = caber(t, largura, f, tam);
                if col.direita {
                    d.texto_a_direita(dir, base, f, tam, cor, &t);
                } else {
                    d.texto(esq, base, f, tam, cor, &t);
                }
            };
            match cel {
                Cel::Vazio => {}
                Cel::Texto(t) => escrever(&mut self.d, t, fonte, TEXTO),
                Cel::Forte(t) => escrever(&mut self.d, t, Fonte::SemiBold, TEXTO),
                Cel::Num(t, cor) => escrever(&mut self.d, t, if forte { Fonte::Bold } else { Fonte::Regular }, *cor),
                Cel::Conta(cor, nome, sub) => {
                    self.d.retangulo(esq, self.y + altura / 2.0 - 3.0, 6.0, 6.0, 3.0, Some(*cor), None);
                    let tem_sub = !sub.is_empty();
                    let y_nome = if tem_sub { self.y + altura / 2.0 - 1.6 } else { base };
                    self.d.texto(esq + 11.0, y_nome, Fonte::SemiBold, tam, TEXTO, &caber(nome, largura - 11.0, Fonte::SemiBold, tam));
                    if tem_sub {
                        self.d.texto(esq + 11.0, self.y + altura / 2.0 + 7.4, Fonte::Regular, 6.3, MUDO, &caber(sub, largura - 11.0, Fonte::Regular, 6.3));
                    }
                }
                Cel::Pilula(t, fundo, cor) => {
                    let w = medir(t, Fonte::SemiBold, 7.0) + 12.0;
                    let x0 = if col.direita { dir - w } else { esq };
                    let topo = self.y + (altura - 13.0) / 2.0;
                    self.pilula(x0, topo, t, *fundo, *cor);
                }
            }
            x += col.largura;
        }
    }

    /// Tabela com cabeçalho que se repete a cada página, linhas zebradas e, se houver, uma linha de total.
    fn tabela(&mut self, cols: &[Col], linhas: Vec<Vec<Cel>>, total: Option<Vec<Cel>>, altura: f32) {
        self.garantir(18.0 + altura * 2.0);
        self.cabecalho_de_tabela(cols);
        for (i, l) in linhas.iter().enumerate() {
            if self.y + altura > BASE {
                self.d.nova_pagina();
                self.y = TOPO_SEGUINTES;
                self.cabecalho_de_tabela(cols);
            }
            if i % 2 == 1 {
                self.d.retangulo(MARGEM, self.y, LARGURA_UTIL, altura, 0.0, Some(SUPERFICIE), None);
            }
            self.linha_de_celulas(cols, l, altura, false);
            self.y += altura;
        }
        if let Some(t) = total {
            self.garantir(altura + 6.0);
            self.y += 4.0;
            self.d.retangulo(MARGEM, self.y, LARGURA_UTIL, altura, 5.0, Some(ACENTO_CLARO), None);
            self.linha_de_celulas(cols, &t, altura, true);
            self.y += altura;
        }
        self.y += 6.0;
    }

    fn extrato(&mut self, f: &Value) {
        let conferivel = f["mes"].is_string();
        let com_transf = f["transferencias"]["configurada"].as_bool().unwrap_or(false);
        let mut cols = vec![Col { titulo: "CONTA", largura: 0.0, direita: false }];
        let numerica = |titulo| Col { titulo, largura: 57.0, direita: true };
        cols.push(numerica("SALDO INICIAL"));
        cols.push(numerica("ENTRADAS"));
        cols.push(numerica("SAÍDAS"));
        if com_transf {
            cols.push(numerica("TRANSF."));
        }
        cols.push(numerica("SALDO FINAL"));
        if conferivel {
            cols.push(numerica("BANCO"));
            cols.push(numerica("DIFERENÇA"));
        }
        cols[0].largura = LARGURA_UTIL - cols[1..].iter().map(|c| c.largura).sum::<f32>();

        let mut linhas: Vec<Vec<Cel>> = Vec::new();
        for c in f["contas"].as_array().into_iter().flatten() {
            let mut sub: Vec<String> = Vec::new();
            if let Some(b) = c["banco"].as_str().filter(|b| !b.is_empty()) {
                sub.push(b.to_string());
            }
            if let Some(d) = c["abertura"]["data"].as_str() {
                sub.push(format!("saldo informado em {}", br(d)));
            }
            let mut cel = vec![
                Cel::Conta(cor_hex(c["cor"].as_str().unwrap_or("")), c["nome"].as_str().unwrap_or("").to_string(), sub.join(" · ")),
                Cel::Num(milhar(n(&c["saldo_inicial"])), TEXTO),
                Cel::Num(milhar(n(&c["entradas"])), OK),
                Cel::Num(milhar(n(&c["saidas"])), ERRO),
            ];
            if com_transf {
                cel.push(Cel::Num(milhar(n(&c["transferencias"])), SECUNDARIO));
            }
            cel.push(Cel::Num(milhar(n(&c["saldo_final"])), TEXTO));
            if conferivel {
                cel.push(c["saldo_banco"].as_i64().map(|b| Cel::Num(milhar(b), TEXTO)).unwrap_or(Cel::Num("—".into(), MUDO)));
                cel.push(match c["diferenca"].as_i64() {
                    Some(0) => Cel::Pilula("Bate".into(), OK_FUNDO, OK),
                    Some(d) => Cel::Pilula(milhar(d), ERRO_FUNDO, ERRO),
                    None => Cel::Num("—".into(), MUDO),
                });
            }
            linhas.push(cel);
        }
        let t = &f["totais"];
        let mut total = vec![Cel::Forte("Total".into()), Cel::Num(milhar(n(&t["saldo_inicial"])), TEXTO), Cel::Num(milhar(n(&t["entradas"])), OK), Cel::Num(milhar(n(&t["saidas"])), ERRO)];
        if com_transf {
            total.push(Cel::Num(milhar(n(&t["transferencias"])), SECUNDARIO));
        }
        total.push(Cel::Num(milhar(n(&t["saldo_final"])), TEXTO));
        if conferivel {
            total.push(Cel::Vazio);
            total.push(Cel::Vazio);
        }
        self.tabela(&cols, linhas, Some(total), 24.0);
    }

    /// Todos os lançamentos efetivados do período, um por linha, como na planilha.
    fn lancamentos(&mut self, f: &Value) {
        let lista = f["lancamentos"].as_array().map(Vec::as_slice).unwrap_or(&[]);
        self.secao("Lançamentos do período", Some(&format!("{} lançamento(s) efetivado(s)", lista.len())));
        if lista.is_empty() {
            self.d.texto(MARGEM, self.y + 8.0, Fonte::Regular, 8.5, MUDO, "Nenhum lançamento efetivado neste período.");
            self.y += 20.0;
            return;
        }
        let mut cols = vec![
            Col { titulo: "DATA", largura: 62.0, direita: false },
            Col { titulo: "CONTA", largura: 92.0, direita: false },
            Col { titulo: "DESCRIÇÃO", largura: 0.0, direita: false },
            Col { titulo: "CATEGORIA", largura: 128.0, direita: false },
            Col { titulo: "VALOR", largura: 62.0, direita: true },
        ];
        cols[2].largura = LARGURA_UTIL - cols.iter().map(|c| c.largura).sum::<f32>();
        let linhas: Vec<Vec<Cel>> = lista
            .iter()
            .map(|l| {
                let entrada = l["tipo"] == "entrada";
                let valor = n(&l["valor_centavos"]);
                let mut categoria = l["categoria"].as_str().unwrap_or("Sem categoria").to_string();
                if l["transferencia"].as_bool().unwrap_or(false) {
                    categoria.push_str(" (transf.)");
                }
                let descricao = match l["beneficiario"].as_str().filter(|b| !b.is_empty()) {
                    Some(b) => format!("{b} · {}", l["descricao"].as_str().unwrap_or("")),
                    None => l["descricao"].as_str().unwrap_or("").to_string(),
                };
                vec![
                    Cel::Texto(br(l["data"].as_str().unwrap_or(""))),
                    Cel::Texto(l["conta"].as_str().unwrap_or("").to_string()),
                    Cel::Texto(descricao),
                    Cel::Texto(categoria),
                    Cel::Num(milhar(if entrada { valor } else { -valor }), if entrada { OK } else { ERRO }),
                ]
            })
            .collect();
        self.tabela(&cols, linhas, None, 18.0);
    }

    fn lucros(&mut self, f: &Value) {
        let l = &f["lucros"];
        if !l["configurada"].as_bool().unwrap_or(false) {
            return;
        }
        self.secao("Distribuição de lucros", l["categoria_nome"].as_str().map(|c| format!("categoria: {c}")).as_deref());
        self.garantir(30.0);
        let resumo = format!("{} distribuição(ões) efetivada(s) · {}", n(&l["quantidade"]), rs(n(&l["valor_centavos"])));
        self.d.texto(MARGEM, self.y + 8.0, Fonte::SemiBold, 9.0, TEXTO, &resumo);
        let faltam = n(&l["sem_recibo"]);
        let x = MARGEM + medir(&resumo, Fonte::SemiBold, 9.0) + 10.0;
        if faltam > 0 {
            self.pilula(x, self.y - 1.0, &format!("{faltam} sem recibo"), ERRO_FUNDO, ERRO);
        } else if n(&l["quantidade"]) > 0 {
            self.pilula(x, self.y - 1.0, "todas com recibo", OK_FUNDO, OK);
        }
        self.y += 16.0;
        let itens = l["itens"].as_array().cloned().unwrap_or_default();
        if !itens.is_empty() {
            let cols = [Col { titulo: "DATA", largura: 62.0, direita: false }, Col { titulo: "DESCRIÇÃO", largura: LARGURA_UTIL - 62.0 - 90.0 - 96.0, direita: false }, Col { titulo: "VALOR", largura: 90.0, direita: true }, Col { titulo: "RECIBO", largura: 96.0, direita: true }];
            let linhas = itens
                .iter()
                .map(|i| {
                    let pendente = i["status"] == "pendente";
                    let recibo = if pendente {
                        Cel::Pilula("pendente".into(), SUPERFICIE_2, SECUNDARIO)
                    } else if n(&i["recibos"]) > 0 {
                        Cel::Pilula("anexado".into(), OK_FUNDO, OK)
                    } else {
                        Cel::Pilula("FALTA".into(), ERRO_FUNDO, ERRO)
                    };
                    vec![Cel::Texto(br(i["data"].as_str().unwrap_or(""))), Cel::Texto(i["descricao"].as_str().unwrap_or("").to_string()), Cel::Num(milhar(n(&i["valor_centavos"])), if pendente { MUDO } else { TEXTO }), recibo]
                })
                .collect();
            self.tabela(&cols, linhas, None, 20.0);
        }
    }

    fn transferencias(&mut self, f: &Value) {
        let tr = &f["transferencias"];
        if !tr["configurada"].as_bool().unwrap_or(false) {
            return;
        }
        self.secao("Transferências entre contas próprias", None);
        let nomes: Vec<&str> = tr["categorias"].as_array().into_iter().flatten().filter_map(|c| c["nome"].as_str()).collect();
        let texto = format!("Categorias: {}. Não são receita nem despesa: ficam fora de entradas, saídas, resultado e categorias, e aparecem à parte no extrato por conta.", nomes.join(", "));
        let linhas = quebrar(&texto, LARGURA_UTIL - 28.0, Fonte::Regular, 7.8);
        let altura = 16.0 + linhas.len() as f32 * 11.0 + 36.0;
        self.garantir(altura + 6.0);
        self.d.retangulo(MARGEM, self.y, LARGURA_UTIL, altura, 8.0, Some(SUPERFICIE), Some((BORDA, 0.6)));
        for (i, l) in linhas.iter().enumerate() {
            self.d.texto(MARGEM + 14.0, self.y + 18.0 + i as f32 * 11.0, Fonte::Regular, 7.8, SECUNDARIO, l);
        }
        let y_valores = self.y + 24.0 + linhas.len() as f32 * 11.0;
        let equilibrada = tr["equilibrada"].as_bool().unwrap_or(true);
        let itens = [("LANÇAMENTOS", n(&tr["quantidade"]).to_string()), ("ENTRANDO", rs(n(&tr["entradas"]))), ("SAINDO", rs(n(&tr["saidas"])))];
        for (i, (rotulo, valor)) in itens.iter().enumerate() {
            let x = MARGEM + 14.0 + i as f32 * 110.0;
            self.d.texto_espacado(x, y_valores + 4.0, Fonte::SemiBold, 6.3, MUDO, 0.8, rotulo);
            self.d.texto(x, y_valores + 15.0, Fonte::SemiBold, 9.0, TEXTO, valor);
        }
        let (rotulo, fundo, cor) = if equilibrada { ("se compensam".to_string(), OK_FUNDO, OK) } else { (format!("não se compensam: faltam {}", rs(n(&tr["liquido"]).abs())), ALERTA_FUNDO, ALERTA) };
        let w = medir(&rotulo, Fonte::SemiBold, 7.0) + 12.0;
        self.pilula(DIREITA - 14.0 - w, y_valores + 5.0, &rotulo, fundo, cor);
        self.y += altura + 6.0;
    }

    fn categorias(&mut self, f: &Value, nomes: &HashMap<String, String>) {
        self.secao("Resultado por categoria", None);
        for (tipo, titulo, cor, barra, campo) in [("entrada", "Entradas", OK, OK_BARRA, "entradas"), ("saida", "Saídas", ERRO, ERRO_BARRA, "saidas")] {
            let grupos = agrupar(f, tipo, nomes);
            let total = n(&f["totais"][campo]);
            self.garantir(18.0 + 20.0 + 18.0);
            self.d.retangulo(MARGEM, self.y + 3.0, 6.0, 6.0, 3.0, Some(cor), None);
            self.d.texto(MARGEM + 12.0, self.y + 10.0, Fonte::SemiBold, 9.0, TEXTO, titulo);
            self.d.texto_a_direita(DIREITA, self.y + 10.0, Fonte::SemiBold, 9.0, cor, &rs(total));
            self.y += 18.0;
            self.d.linha(MARGEM, DIREITA, self.y, 0.5, BORDA);
            self.y += 3.0;
            if grupos.is_empty() {
                self.garantir(18.0);
                self.d.texto(MARGEM + 12.0, self.y + 11.0, Fonte::Regular, 7.8, MUDO, "Nada efetivado neste período.");
                self.y += 20.0;
                continue;
            }
            let maior = grupos.iter().map(|g| g.valor).max().unwrap_or(1).max(1) as f32;
            let (x_barra, largura_barra) = (MARGEM + 230.0, 150.0);
            let desenhar = |p: &mut Folha, nome: &str, valor: i64, lancamentos: i64, filha: bool| {
                let altura = if filha { 15.0 } else { 19.0 };
                p.garantir(altura + 2.0);
                let recuo = if filha { 16.0 } else { 4.0 };
                let (fonte, tam, cor_texto) = if filha { (Fonte::Regular, 7.4, SECUNDARIO) } else { (Fonte::SemiBold, 8.2, TEXTO) };
                let base = base_centrada(p.y, altura, tam);
                p.d.texto(MARGEM + recuo, base, fonte, tam, cor_texto, &caber(nome, x_barra - MARGEM - recuo - 10.0, fonte, tam));
                let proporcao = (valor.max(0) as f32 / maior).clamp(0.0, 1.0);
                let espessura = if filha { 3.0 } else { 5.0 };
                p.d.retangulo(x_barra, p.y + altura / 2.0 - espessura / 2.0, largura_barra, espessura, espessura / 2.0, Some(SUPERFICIE_2), None);
                if proporcao > 0.0 {
                    p.d.retangulo(x_barra, p.y + altura / 2.0 - espessura / 2.0, (largura_barra * proporcao).max(espessura), espessura, espessura / 2.0, Some(barra), None);
                }
                let lanc = format!("{lancamentos} lanç.");
                p.d.texto_a_direita(DIREITA - 92.0, base, Fonte::Regular, 6.8, MUDO, &lanc);
                p.d.texto_a_direita(DIREITA - 4.0, base, if filha { Fonte::Regular } else { Fonte::SemiBold }, tam, cor_texto, &milhar(valor));
                p.y += altura;
            };
            for g in &grupos {
                desenhar(self, &g.nome, g.valor, g.lancamentos, false);
                for fi in &g.filhas {
                    desenhar(self, &fi.nome, fi.valor, fi.lancamentos, true);
                }
            }
            self.y += 8.0;
        }
    }

    fn pendencias(&mut self, f: &Value) {
        self.secao("Pendências no momento da geração", None);
        let p = &f["pendencias"];
        // (chave, título, dica, bloqueia?)
        let tipos = [
            ("pendentes", "Pendentes de efetivação", "Ainda não aconteceram de fato, então ficam fora dos números.", true),
            ("sem_categoria", "Sem categoria", "A contabilidade precisa saber de onde veio e para onde foi cada valor.", true),
            ("sem_conta", "Sem conta", "Não aparecem no extrato de nenhum banco.", true),
            ("sem_comprovante", "Sem comprovante", "Efetivados sem comprovante ou nota fiscal anexados.", false),
            ("nao_conciliadas", "Não conciliados", "Ainda não conferidos com o extrato do banco.", false),
        ];
        let mut alguma = false;
        for (chave, titulo, dica, bloqueia) in tipos {
            let q = n(&p[chave]["quantidade"]);
            if q == 0 {
                continue;
            }
            alguma = true;
            self.linha_de_pendencia(q, titulo, dica, Some(n(&p[chave]["valor_centavos"])), bloqueia);
        }
        if n(&p["rascunhos"]) > 0 {
            alguma = true;
            self.linha_de_pendencia(n(&p["rascunhos"]), "Comprovantes esperando revisão", "Enviados, mas ainda não viraram lançamento.", None, false);
        }
        if !alguma {
            self.garantir(30.0);
            self.d.retangulo(MARGEM, self.y, LARGURA_UTIL, 28.0, 8.0, Some(OK_FUNDO), Some((OK_BORDA, 0.6)));
            self.d.texto(MARGEM + 14.0, base_centrada(self.y, 28.0, 8.5), Fonte::SemiBold, 8.5, OK, "Nenhuma pendência: tudo o que entrou neste período está categorizado e efetivado.");
            self.y += 34.0;
        }
    }

    fn linha_de_pendencia(&mut self, quantidade: i64, titulo: &str, dica: &str, valor: Option<i64>, bloqueia: bool) {
        self.garantir(32.0);
        self.d.retangulo(MARGEM, self.y, LARGURA_UTIL, 28.0, 8.0, Some(SUPERFICIE), Some((BORDA, 0.6)));
        let (fundo, cor) = if bloqueia { (ERRO_FUNDO, ERRO) } else { (ALERTA_FUNDO, ALERTA) };
        let q = quantidade.to_string();
        let w = (medir(&q, Fonte::Bold, 8.5) + 12.0).max(24.0);
        self.d.retangulo(MARGEM + 10.0, self.y + 7.0, w, 14.0, 7.0, Some(fundo), None);
        self.d.texto_centralizado(MARGEM + 10.0 + w / 2.0, self.y + 17.0, Fonte::Bold, 8.5, cor, &q);
        let x = MARGEM + 10.0 + w + 10.0;
        self.d.texto(x, self.y + 12.0, Fonte::SemiBold, 8.2, TEXTO, titulo);
        self.d.texto(x, self.y + 22.0, Fonte::Regular, 6.8, MUDO, &caber(dica, LARGURA_UTIL - (x - MARGEM) - 110.0, Fonte::Regular, 6.8));
        if let Some(v) = valor {
            self.d.texto_a_direita(DIREITA - 12.0, base_centrada(self.y, 28.0, 8.2), Fonte::SemiBold, 8.2, TEXTO, &rs(v));
        }
        self.y += 33.0;
    }
}

/// O PDF do resumo, pronto para gravar. `categorias_por_id` dá o nome de cada categoria (para mostrar a mãe das filhas).
pub fn resumo(f: &Value, categorias_por_id: &HashMap<String, String>) -> Vec<u8> {
    let (de, ate) = (f["data_de"].as_str().unwrap_or(""), f["data_ate"].as_str().unwrap_or(""));
    let mut p = Folha::nova();
    p.cabecalho_da_marca(de, ate);
    p.faixa_de_situacao(&situacao(f));
    p.totais(f);
    p.secao("Extrato por conta", None);
    p.extrato(f);
    p.lucros(f);
    p.transferencias(f);
    p.categorias(f, categorias_por_id);
    p.pendencias(f);
    p.lancamentos(f);
    let gerado = chrono::Local::now().format("%d/%m/%Y %H:%M");
    p.d.finalizar(&format!("Ecos · Fechamento financeiro · {} a {}", br(de), br(ate)), &format!("Gerado pelo Ecos Cofre em {gerado} · regime de caixa · valores em reais"), MUDO, BORDA)
}

/// `GET /vault/fechamento/resumo.pdf?data_de&data_ate`: só o PDF, sem o resto do pacote.
pub async fn obter(State(state): State<AppState>, Query(q): Query<super::financeiro::Periodo>) -> AppResult<Response> {
    q.validar()?;
    let (de, ate) = (q.data_de, q.data_ate);
    // Uma leitura curta do banco; o PDF é desenhado depois, longe dele.
    let (f, nomes) = state.db.with(move |c| super::pacote::dados_do_resumo(c, de, ate)).await?;
    let pdf = resumo(&f, &nomes);
    let nome = match super::fechamento::mes_do_periodo(de, ate) {
        Some(mes) => format!("resumo-fechamento-{mes}.pdf"),
        None => format!("resumo-fechamento-{de}_a_{ate}.pdf"),
    };
    Ok(super::pacote::resposta_de_arquivo(pdf, "application/pdf", &nome))
}

#[cfg(test)]
mod testes {
    use super::*;
    use serde_json::json;

    fn contem(pdf: &[u8], texto: &str) -> bool {
        let latin1: Vec<u8> = texto.chars().map(|c| c as u32 as u8).collect();
        pdf.windows(latin1.len()).any(|j| j == latin1.as_slice())
    }

    fn vazio() -> Value {
        json!({
            "data_de": "2026-10-01", "data_ate": "2026-10-31", "mes": "2026-10", "contas": [],
            "totais": { "saldo_inicial": 0, "entradas": 0, "saidas": 0, "transferencias": 0, "resultado": 0, "saldo_final": 0 },
            "transferencias": { "configurada": false, "categorias": [], "quantidade": 0, "entradas": 0, "saidas": 0, "liquido": 0, "equilibrada": true },
            "lucros": { "configurada": false }, "categorias": [],
            "pendencias": { "pendentes": { "quantidade": 0 }, "sem_categoria": { "quantidade": 0 }, "sem_conta": { "quantidade": 0 }, "sem_comprovante": { "quantidade": 0 }, "nao_conciliadas": { "quantidade": 0 }, "rascunhos": 0 },
        })
    }

    #[test]
    fn milhar_separa_milhares_e_trata_negativos() {
        assert_eq!(milhar(0), "0,00");
        assert_eq!(milhar(5), "0,05");
        assert_eq!(milhar(123_456), "1.234,56");
        assert_eq!(milhar(-10_000_000_000), "-100.000.000,00");
        assert_eq!(milhar(99_999), "999,99");
        assert_eq!(rs(-150), "-R$ 1,50");
        assert_eq!(rs(150_000), "R$ 1.500,00");
    }

    #[test]
    fn cor_hex_le_o_cadastro_e_tolera_lixo() {
        assert_eq!(cor_hex("#1f5c9e"), Cor(31, 92, 158));
        assert_eq!(cor_hex("azul"), Cor(143, 143, 150));
        assert_eq!(cor_hex(""), Cor(143, 143, 150));
    }

    #[test]
    fn situacao_segue_a_mesma_regra_da_tela() {
        let mut f = vazio();
        assert_eq!(situacao(&f), Situacao { bloqueios: 0, recibos_faltando: 0, a_conferir: 0, divergentes: 0, atencao: 0, pronto: true, em_andamento: false });

        f["pendencias"]["sem_categoria"]["quantidade"] = json!(2);
        f["pendencias"]["sem_comprovante"]["quantidade"] = json!(4);
        f["pendencias"]["rascunhos"] = json!(1);
        let s = situacao(&f);
        assert_eq!((s.bloqueios, s.atencao, s.pronto), (1, 2, false));

        // Conta com movimento e sem saldo do banco: falta conferir; com diferença: diverge; "Sem conta" nunca se confere.
        f["pendencias"]["sem_categoria"]["quantidade"] = json!(0);
        f["contas"] = json!([
            { "conta_id": "a", "lancamentos": 3, "saldo_inicial": 0, "saldo_final": 10, "saldo_banco": null, "diferenca": null },
            { "conta_id": "b", "lancamentos": 1, "saldo_inicial": 0, "saldo_final": 10, "saldo_banco": 12, "diferenca": 2 },
            { "conta_id": "c", "lancamentos": 0, "saldo_inicial": 0, "saldo_final": 0, "saldo_banco": null, "diferenca": null },
            { "conta_id": null, "lancamentos": 1, "saldo_inicial": 0, "saldo_final": 5, "saldo_banco": null, "diferenca": null },
        ]);
        let s = situacao(&f);
        assert_eq!((s.a_conferir, s.divergentes, s.pronto), (1, 1, false));
        // Período que não é mês inteiro não se confere.
        f["mes"] = Value::Null;
        assert!(situacao(&f).pronto);

        f["lucros"] = json!({ "configurada": true, "sem_recibo": 2 });
        assert_eq!(situacao(&f).recibos_faltando, 2);

        // Período em andamento: nada a conferir com o banco e ainda não está "pronto".
        f["mes"] = json!("2026-11");
        f["em_andamento"] = json!(true);
        let s = situacao(&f);
        assert_eq!((s.a_conferir, s.divergentes, s.pronto, s.em_andamento), (0, 0, false, true));
    }

    #[test]
    fn categorias_filhas_ficam_sob_a_mae_e_o_valor_direto_vira_sem_subcategoria() {
        let mut f = vazio();
        f["categorias"] = json!([
            { "tipo": "saida", "categoria_id": "m1", "nome": "Folha", "pai_id": null, "valor": 1_000, "lancamentos": 1 },
            { "tipo": "saida", "categoria_id": "f1", "nome": "Salários", "pai_id": "m1", "valor": 8_000, "lancamentos": 4 },
            { "tipo": "saida", "categoria_id": "f2", "nome": "Encargos", "pai_id": "m1", "valor": 3_000, "lancamentos": 2 },
            { "tipo": "saida", "categoria_id": "s1", "nome": "Aluguel", "pai_id": null, "valor": 9_000, "lancamentos": 1 },
            { "tipo": "saida", "categoria_id": null, "nome": null, "pai_id": null, "valor": 500, "lancamentos": 1 },
            { "tipo": "entrada", "categoria_id": "e1", "nome": "Mensalidades", "pai_id": null, "valor": 50_000, "lancamentos": 9 },
        ]);
        let nomes: HashMap<String, String> = [("m1".to_string(), "Folha".to_string())].into();
        let g = agrupar(&f, "saida", &nomes);
        assert_eq!(g.iter().map(|x| (x.nome.as_str(), x.valor)).collect::<Vec<_>>(), [("Folha", 12_000), ("Aluguel", 9_000), ("Sem categoria", 500)]);
        assert_eq!(g[0].lancamentos, 7);
        assert_eq!(g[0].filhas.iter().map(|x| x.nome.as_str()).collect::<Vec<_>>(), ["Salários", "Encargos", "Sem subcategoria"]);
        assert!(g[1].filhas.is_empty(), "categoria sem filhas não repete a si mesma");
        assert_eq!(agrupar(&f, "entrada", &nomes).len(), 1);
    }

    #[test]
    fn pdf_tem_o_visual_do_ecos_e_os_numeros() {
        let mut f = vazio();
        f["contas"] = json!([{ "conta_id": "a", "nome": "Banco A", "banco": "Itaú", "cor": "#1f5c9e", "saldo_inicial": 10_000, "entradas": 500_000, "saidas": 230_000, "transferencias": -20_000, "saldo_final": 260_000, "lancamentos": 4, "saldo_banco": 258_001, "diferenca": -1_999, "abertura": { "data": "2026-10-01", "saldo": 10_000, "por": "ana" } }]);
        f["totais"] = json!({ "saldo_inicial": 10_000, "entradas": 500_000, "saidas": 230_000, "transferencias": -20_000, "resultado": 270_000, "saldo_final": 260_000 });
        f["pendencias"]["sem_comprovante"] = json!({ "quantidade": 3, "valor_centavos": 12_345 });
        let pdf = resumo(&f, &HashMap::new());
        assert!(pdf.starts_with(b"%PDF-1.4"));
        for trecho in ["Fechamento financeiro", "01/10/2026 a 31/10/2026", "COFRE", "Ainda n\u{e3}o est\u{e1} pronto", "R$ 2.700,00", "2.600,00", "Banco A", "saldo informado em 01/10/2026", "-19,99", "Sem comprovante", "R$ 123,45"] {
            assert!(contem(&pdf, trecho), "o PDF devia conter {trecho:?}");
        }
        assert!(contem(&pdf, "/BaseFont /Poppins-Bold"), "Poppins incorporada");
        assert!(contem(&pdf, "/Sh1 sh"), "ícone da marca");
    }

    #[test]
    fn pdf_traz_todos_os_lancamentos_do_periodo_em_ordem() {
        let mut f = vazio();
        f["lancamentos"] = json!([
            { "data": "2026-10-02", "conta": "Banco A", "tipo": "entrada", "valor_centavos": 900_000, "categoria": "Mensalidades", "beneficiario": "Maria", "descricao": "Mensalidade outubro", "transferencia": false },
            { "data": "2026-10-09", "conta": "Banco A", "tipo": "saida", "valor_centavos": 25_000, "categoria": null, "beneficiario": null, "descricao": "Compra de material", "transferencia": true },
        ]);
        let pdf = resumo(&f, &HashMap::new());
        for trecho in ["Lan\u{e7}amentos do per\u{ed}odo", "02/10/2026", "Maria", "Mensalidade outubro", "9.000,00", "-250,00", "Sem categoria", "transf."] {
            assert!(contem(&pdf, trecho), "o PDF devia conter {trecho:?}");
        }
        let texto = String::from_utf8_lossy(&pdf);
        assert!(texto.find("Mensalidade outubro") < texto.find("Compra de material"), "do mais antigo ao mais novo");
        // Sem lançamentos, a seção diz isso em vez de sumir.
        assert!(contem(&resumo(&vazio(), &HashMap::new()), "Nenhum lan"));

        f["lancamentos"] = json!((0..400).map(|i| json!({ "data": "2026-10-02", "conta": "Banco A", "tipo": "saida", "valor_centavos": i, "categoria": "X", "descricao": format!("Linha {i}"), "transferencia": false })).collect::<Vec<_>>());
        let grande = resumo(&f, &HashMap::new());
        assert!(String::from_utf8_lossy(&grande).matches("(DATA) Tj").count() >= 5, "cabeçalho repetido a cada página");
    }

    #[test]
    fn muito_conteudo_vira_varias_paginas_sem_estourar_a_margem() {
        let mut f = vazio();
        let contas: Vec<Value> = (0..120).map(|i| json!({ "conta_id": format!("c{i}"), "nome": format!("Conta {i} com um nome bem comprido para testar o corte da coluna"), "banco": "Banco", "cor": "#123456", "saldo_inicial": 1, "entradas": 2, "saidas": 3, "transferencias": 0, "saldo_final": 0, "lancamentos": 1, "saldo_banco": null, "diferenca": null })).collect();
        f["contas"] = json!(contas);
        let pdf = resumo(&f, &HashMap::new());
        let texto = String::from_utf8_lossy(&pdf);
        let paginas = texto.matches("/Type /Page ").count();
        assert!(paginas >= 3, "120 contas não cabem em uma página: {paginas}");
        assert!(texto.contains(&format!("de {paginas}")));
        assert!(contem(&pdf, "Nenhuma pend"));
        assert!(contem(&pdf, "CONTA"), "o cabeçalho da tabela se repete");
        assert!(texto.matches("(CONTA) Tj").count() >= 2, "cabeçalho repetido nas páginas seguintes");
    }
}
