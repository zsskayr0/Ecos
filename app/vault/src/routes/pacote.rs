//! `GET /vault/fechamento/pacote` — o pacote que vai para a contabilidade: um `.zip` com o resumo do período (extrato por
//! conta, resultado por categoria, lucros distribuídos, lista de lançamentos) em planilhas `.csv` e, ao lado, os arquivos
//! em si: comprovantes, notas fiscais e recibos de distribuição de lucros, nomeados por data, beneficiário e valor.
//!
//! Os números vêm do mesmo cálculo da tela (`fechamento::fechamento`), então o que a contabilidade recebe é exatamente o
//! que a pessoa viu. Só lançamentos efetivados entram (regime de caixa); transferências entre contas próprias aparecem na
//! lista, marcadas, mas ficam fora de entradas, saídas e resultado.
//!
//! O banco do Cofre é um só para todas as telas e atende um pedido por vez. Por isso o pacote não é montado "dentro" dele:
//! `preparar` lê, de uma vez e depressa, só os números e os metadados (consultas pequenas); cada arquivo é buscado em
//! seguida num acesso próprio, curto, e o `.zip`, as planilhas e o PDF são montados fora do banco. Enquanto o pacote
//! monta, o resto do Cofre continua respondendo entre um arquivo e outro.

use std::collections::HashMap;

use axum::{
    extract::{Query, State},
    http::{header, HeaderValue},
    response::{IntoResponse, Response},
};
use chrono::NaiveDate;
use ecos_core::ErrorCode;
use rusqlite::{Connection, OptionalExtension};
use serde_json::Value;

use super::fechamento::{categorias_de_transferencia, contas_fora, fechamento, ids_de_transferencia, sql_conta_fora, sql_eh_transferencia};
use crate::{
    error::{AppError, AppResult},
    state::AppState,
    zip::ZipWriter,
};

/// Teto do que vai dentro do pacote (soma dos arquivos). O pacote é montado na memória e sai numa resposta só.
const LIMITE_DE_ARQUIVOS_BYTES: i64 = 256 * 1024 * 1024;

/// Valor em reais para planilha brasileira: sem separador de milhar e com vírgula decimal.
fn reais(centavos: i64) -> String {
    let sinal = if centavos < 0 { "-" } else { "" };
    let abs = centavos.unsigned_abs();
    format!("{sinal}{},{:02}", abs / 100, abs % 100)
}

/// Uma célula de CSV (separador `;`). Texto que começaria com `=`, `+`, `-`, `@` ou tabulação é lido como fórmula pelas
/// planilhas, então ganha um apóstrofo na frente; o resto só é aspado quando precisa.
fn celula(texto: &str) -> String {
    let mut t = texto.replace(['\r', '\n'], " ");
    if t.starts_with(['=', '+', '-', '@', '\t']) {
        t.insert(0, '\'');
    }
    if t.contains([';', '"']) {
        format!("\"{}\"", t.replace('"', "\"\""))
    } else {
        t
    }
}

/// Planilha em UTF-8 com BOM (o Excel em português só acerta os acentos assim), linhas terminadas em CRLF.
struct Csv(String);
impl Csv {
    fn nova(cabecalho: &[&str]) -> Self {
        let mut c = Csv("\u{FEFF}".to_string());
        c.linha(cabecalho.iter().map(|s| s.to_string()).collect());
        c
    }
    /// Cada item já vem formatado; texto livre passa por `celula` na hora de montar a linha.
    fn linha(&mut self, itens: Vec<String>) {
        self.0.push_str(&itens.join(";"));
        self.0.push_str("\r\n");
    }
    fn bytes(self) -> Vec<u8> {
        self.0.into_bytes()
    }
}

fn texto(v: &Value) -> String {
    celula(v.as_str().unwrap_or(""))
}
fn num(v: &Value) -> String {
    reais(v.as_i64().unwrap_or(0))
}
fn opcional(v: &Value) -> String {
    v.as_i64().map(reais).unwrap_or_default()
}

/// Nome seguro para dentro do `.zip`: sem separadores de pasta, sem caracteres que o Windows recusa, sem controle.
fn nome_de_arquivo(base: &str) -> String {
    let limpo: String = base.chars().map(|c| if c.is_control() || "/\\:*?\"<>|".contains(c) { ' ' } else { c }).collect();
    let limpo = limpo.split_whitespace().collect::<Vec<_>>().join(" ");
    let limpo: String = limpo.chars().take(70).collect();
    limpo.trim_matches(|c: char| c == '.' || c == ' ').to_string()
}

fn extensao(nome_arquivo: &str, mime: &str) -> &'static str {
    let do_nome = nome_arquivo.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase());
    match (do_nome.as_deref(), mime) {
        (Some("pdf"), _) | (_, "application/pdf") => "pdf",
        (Some("png"), _) | (_, "image/png") => "png",
        (Some("webp"), _) | (_, "image/webp") => "webp",
        (Some("heic"), _) | (_, "image/heic") => "heic",
        (Some("jpeg"), _) => "jpeg",
        _ => "jpg",
    }
}

fn pasta_do_tipo(tipo: &str) -> &'static str {
    match tipo {
        "nota_fiscal" => "notas-fiscais",
        "recibo_lucros" => "recibos-lucros",
        _ => "comprovantes",
    }
}

fn rotulo_da_forma(forma: &str) -> &str {
    match forma {
        "pix" => "Pix",
        "pix_automatico" => "Pix automático",
        "ted" => "TED",
        "cartao" => "Cartão",
        "dinheiro" => "Dinheiro",
        "boleto" => "Boleto",
        "outro" => "Outro",
        outra => outra,
    }
}

struct Arquivo {
    id: String,
    transacao_id: String,
    caminho: String,
}

/// Metadados dos arquivos do período, com o caminho que cada um terá no `.zip`. Dois arquivos nunca ficam com o mesmo
/// caminho: o início do id do anexo entra no nome e uma colisão rara ganha número.
fn arquivos_do_periodo(c: &Connection, de: &str, ate: &str) -> rusqlite::Result<(Vec<Arquivo>, i64)> {
    let fora = sql_conta_fora("t.conta_id", &contas_fora(c)?);
    let mut stmt = c.prepare(&format!(
        "SELECT a.id, a.transacao_id, a.nome_arquivo, a.mime_type, a.tipo, a.tamanho_bytes, t.data, t.valor_centavos, COALESCE(b.nome, t.descricao) \
         FROM anexo a JOIN transacao t ON t.id = a.transacao_id LEFT JOIN beneficiario b ON b.id = t.beneficiario_id \
         WHERE t.status = 'efetivada' AND t.data BETWEEN ?1 AND ?2 AND NOT {fora} ORDER BY t.data, t.id, a.criado_em, a.id"
    ))?;
    let mut usados: HashMap<String, u32> = HashMap::new();
    let mut total = 0i64;
    let mut out = Vec::new();
    let linhas = stmt.query_map([de, ate], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, String>(4)?, r.get::<_, i64>(5)?, r.get::<_, String>(6)?, r.get::<_, i64>(7)?, r.get::<_, String>(8)?))
    })?;
    for l in linhas {
        let (id, transacao_id, nome_arquivo, mime, tipo, tamanho, data, valor, quem) = l?;
        total += tamanho;
        let curto: String = id.chars().filter(|c| c.is_ascii_alphanumeric()).take(6).collect();
        let base = nome_de_arquivo(&format!("{data}_{quem}_{}_{curto}", reais(valor)));
        let mut caminho = format!("{}/{base}.{}", pasta_do_tipo(&tipo), extensao(&nome_arquivo, &mime));
        let n = usados.entry(caminho.clone()).or_insert(0);
        *n += 1;
        if *n > 1 {
            caminho = format!("{}/{base}_{n}.{}", pasta_do_tipo(&tipo), extensao(&nome_arquivo, &mime));
        }
        out.push(Arquivo { id, transacao_id, caminho });
    }
    Ok((out, total))
}

fn leia_me(f: &Value, de: &str, ate: &str, arquivos: usize, ausentes: &[String]) -> String {
    let p = &f["pendencias"];
    let q = |k: &str| p[k]["quantidade"].as_i64().unwrap_or(0);
    let mut t = String::new();
    t.push_str("FECHAMENTO FINANCEIRO\r\n");
    t.push_str(&format!("Período: {} a {}\r\n", br(de), br(ate)));
    t.push_str(&format!("Gerado em: {}\r\n\r\n", chrono::Local::now().format("%d/%m/%Y %H:%M")));
    t.push_str("Regime de caixa: só entram lançamentos efetivados (pagos ou recebidos) no período.\r\n");
    t.push_str("Valores em reais. As planilhas usam ponto e vírgula como separador e abrem direto no Excel.\r\n\r\n");
    t.push_str("O QUE TEM AQUI\r\n");
    t.push_str("- resumo-fechamento.pdf: o resumo do período numa folha só para arquivar ou imprimir (totais, extrato por conta, lucros, transferências, categorias e pendências).\r\n");
    t.push_str("- extrato-por-conta.csv: saldo inicial, entradas, saídas, transferências e saldo final de cada conta");
    if f["mes"].is_string() {
        t.push_str(", com o saldo do extrato do banco e a diferença quando foi conferido");
    }
    t.push_str(".\r\n");
    t.push_str("- resultado-por-categoria.csv: entradas e saídas somadas por categoria.\r\n");
    t.push_str("- lucros.csv: as distribuições de lucros do período, com o nome do arquivo do recibo de cada uma.\r\n");
    t.push_str("- lancamentos.csv: todos os lançamentos efetivados do período e os arquivos de cada um.\r\n");
    t.push_str(&format!("- comprovantes/, notas-fiscais/ e recibos-lucros/: {arquivos} arquivo(s), nomeados por data, beneficiário e valor.\r\n\r\n"));
    let tr = &f["transferencias"];
    if tr["configurada"].as_bool().unwrap_or(false) {
        t.push_str("TRANSFERÊNCIAS ENTRE CONTAS PRÓPRIAS\r\n");
        t.push_str("Não são receita nem despesa: ficam fora de entradas, saídas, resultado e categorias, e aparecem à parte no extrato por conta.\r\n");
        t.push_str(&format!("No período: {} lançamento(s), {} entrando e {} saindo.\r\n\r\n", tr["quantidade"].as_i64().unwrap_or(0), num(&tr["entradas"]), num(&tr["saidas"])));
    }
    let mut avisos: Vec<String> = Vec::new();
    for (k, rotulo) in [
        ("pendentes", "lançamento(s) ainda pendente(s), fora dos números"),
        ("sem_categoria", "lançamento(s) sem categoria"),
        ("sem_conta", "lançamento(s) sem conta"),
        ("sem_comprovante", "lançamento(s) sem comprovante"),
    ] {
        if q(k) > 0 {
            avisos.push(format!("{} {rotulo}", q(k)));
        }
    }
    if f["lucros"]["sem_recibo"].as_i64().unwrap_or(0) > 0 {
        avisos.push(format!("{} distribuição(ões) de lucros sem recibo", f["lucros"]["sem_recibo"]));
    }
    if !tr["equilibrada"].as_bool().unwrap_or(true) {
        avisos.push("transferências entre contas que não se compensam (falta o outro lado)".to_string());
    }
    if !avisos.is_empty() {
        t.push_str("PENDÊNCIAS NO MOMENTO DA GERAÇÃO\r\n");
        for a in avisos {
            t.push_str(&format!("- {a}\r\n"));
        }
    }
    if !ausentes.is_empty() {
        t.push_str("\r\nARQUIVOS QUE NÃO ENTRARAM\r\n");
        t.push_str("Estes anexos foram apagados do Cofre enquanto o pacote era montado. Gere o pacote de novo para a lista ficar completa.\r\n");
        for a in ausentes {
            t.push_str(&format!("- {a}\r\n"));
        }
    }
    t
}

fn br(iso: &str) -> String {
    NaiveDate::parse_from_str(iso, "%Y-%m-%d").map(|d| d.format("%d/%m/%Y").to_string()).unwrap_or_else(|_| iso.to_string())
}

/// Tudo o que o pacote precisa do banco, já lido: os números do Fechamento, as planilhas prontas e a lista de arquivos
/// (sem o conteúdo deles).
struct Preparo {
    de: String,
    ate: String,
    f: Value,
    nomes_das_maes: HashMap<String, String>,
    extrato: Vec<u8>,
    categorias: Vec<u8>,
    lucros: Vec<u8>,
    lancamentos: Vec<u8>,
    arquivos: Vec<Arquivo>,
}

/// Os números do Fechamento e o nome de cada categoria (para o PDF mostrar "Mãe > filha"), numa leitura só.
pub(super) fn dados_do_resumo(c: &Connection, data_de: NaiveDate, data_ate: NaiveDate) -> rusqlite::Result<(Value, HashMap<String, String>)> {
    let mut f = fechamento(c, data_de, data_ate)?;
    // A lista completa vai só para o PDF e o pacote; a tela a pede à parte, para o resumo continuar leve.
    f["lancamentos"] = Value::Array(super::fechamento::lancamentos(c, data_de, data_ate)?);
    let mut stmt = c.prepare("SELECT id, nome FROM categoria")?;
    let nomes = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?.collect::<Result<_, _>>()?;
    Ok((f, nomes))
}

/// Lê do banco o que o pacote precisa, sem tocar no conteúdo dos arquivos. `Ok(Err(_))` é recusa de regra (arquivos demais).
fn preparar(c: &Connection, data_de: NaiveDate, data_ate: NaiveDate) -> rusqlite::Result<Result<Preparo, AppError>> {
    let (de, ate) = (data_de.to_string(), data_ate.to_string());
    let (f, nomes_das_maes) = dados_do_resumo(c, data_de, data_ate)?;
    let (arquivos, total) = arquivos_do_periodo(c, &de, &ate)?;
    if total > LIMITE_DE_ARQUIVOS_BYTES {
        return Ok(Err(AppError::new(ErrorCode::ValidationError).with_message("Os arquivos do período somam mais de 256 MB (o pacote é montado na memória do servidor). Gere o pacote de um intervalo menor, por exemplo mês a mês.")));
    }
    let mut por_transacao: HashMap<&str, Vec<&str>> = HashMap::new();
    for a in &arquivos {
        por_transacao.entry(a.transacao_id.as_str()).or_default().push(a.caminho.as_str());
    }
    let nome_do_recibo: HashMap<&str, &str> = arquivos.iter().filter(|a| a.caminho.starts_with("recibos-lucros/")).map(|a| (a.transacao_id.as_str(), a.caminho.as_str())).collect();

    // Extrato por conta.
    let mut extrato = Csv::nova(&["Conta", "Banco", "Saldo inicial", "Entradas", "Saídas", "Transferências (líquido)", "Saldo final", "Saldo no extrato do banco", "Diferença (banco - Cofre)", "Conferido por", "Origem do saldo inicial"]);
    for l in f["contas"].as_array().into_iter().flatten() {
        let origem = match (l["conta_id"].is_string(), l["abertura"]["data"].as_str()) {
            (false, _) => String::new(),
            (true, Some(d)) => format!("Informado para {}", br(d)),
            (true, None) => "Cadastro da conta".to_string(),
        };
        extrato.linha(vec![texto(&l["nome"]), texto(&l["banco"]), num(&l["saldo_inicial"]), num(&l["entradas"]), num(&l["saidas"]), num(&l["transferencias"]), num(&l["saldo_final"]), opcional(&l["saldo_banco"]), opcional(&l["diferenca"]), texto(&l["conferido_por"]), origem]);
    }
    let t = &f["totais"];
    extrato.linha(vec!["TOTAL".into(), String::new(), num(&t["saldo_inicial"]), num(&t["entradas"]), num(&t["saidas"]), num(&t["transferencias"]), num(&t["saldo_final"]), String::new(), String::new(), String::new(), String::new()]);

    // Resultado por categoria.
    let mut categorias = Csv::nova(&["Tipo", "Categoria", "Valor", "Lançamentos"]);
    for l in f["categorias"].as_array().into_iter().flatten() {
        let nome = match (l["nome"].as_str(), l["pai_id"].as_str().and_then(|p| nomes_das_maes.get(p))) {
            (Some(n), Some(pai)) => celula(&format!("{pai} > {n}")),
            (Some(n), None) => celula(n),
            (None, _) => "Sem categoria".to_string(),
        };
        categorias.linha(vec![if l["tipo"] == "entrada" { "Entrada".into() } else { "Saída".into() }, nome, num(&l["valor"]), l["lancamentos"].as_i64().unwrap_or(0).to_string()]);
    }
    categorias.linha(vec!["Resultado (entradas - saídas)".into(), String::new(), num(&t["resultado"]), String::new()]);

    // Lucros.
    let mut lucros = Csv::nova(&["Data", "Descrição", "Valor", "Situação", "Recibo"]);
    for i in f["lucros"]["itens"].as_array().into_iter().flatten() {
        let recibo = i["id"].as_str().and_then(|id| nome_do_recibo.get(id)).map(|r| celula(r)).unwrap_or_else(|| if i["status"] == "efetivada" { "SEM RECIBO".into() } else { String::new() });
        lucros.linha(vec![br(i["data"].as_str().unwrap_or("")), texto(&i["descricao"]), num(&i["valor_centavos"]), if i["status"] == "efetivada" { "Efetivada".into() } else { "Pendente (fora dos totais)".into() }, recibo]);
    }
    if f["lucros"]["itens"].as_array().is_some_and(|i| !i.is_empty()) {
        lucros.linha(vec!["TOTAL".into(), String::new(), num(&f["lucros"]["valor_centavos"]), String::new(), String::new()]);
    }

    // Lançamentos efetivados do período.
    let escolhidas = categorias_de_transferencia(c)?;
    let transf = sql_eh_transferencia(&ids_de_transferencia(c, &escolhidas)?);
    let fora = sql_conta_fora("t.conta_id", &contas_fora(c)?);
    let mut lancamentos = Csv::nova(&["Data", "Conta", "Tipo", "Valor", "Categoria", "Beneficiário", "Descrição", "Forma de pagamento", "Transferência entre contas", "Arquivos"]);
    {
        let mut stmt = c.prepare(&format!(
            "SELECT t.id, t.data, COALESCE(c.nome, 'Sem conta'), t.tipo, t.valor_centavos, cat.nome, b.nome, t.descricao, t.forma_pagamento, {transf} \
             FROM transacao t LEFT JOIN conta c ON c.id = t.conta_id LEFT JOIN categoria cat ON cat.id = t.categoria_id LEFT JOIN beneficiario b ON b.id = t.beneficiario_id \
             WHERE t.status = 'efetivada' AND t.data BETWEEN ?1 AND ?2 AND NOT {fora} ORDER BY t.data, t.id"
        ))?;
        let linhas = stmt.query_map([&de, &ate], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, i64>(4)?, r.get::<_, Option<String>>(5)?, r.get::<_, Option<String>>(6)?, r.get::<_, String>(7)?, r.get::<_, Option<String>>(8)?, r.get::<_, i64>(9)?))
        })?;
        for l in linhas {
            let (id, data, conta, tipo, valor, categoria, beneficiario, descricao, forma, eh_transf) = l?;
            let arquivos_da_linha = por_transacao.get(id.as_str()).map(|v| v.join(" | ")).unwrap_or_default();
            lancamentos.linha(vec![
                br(&data),
                celula(&conta),
                if tipo == "entrada" { "Entrada".into() } else { "Saída".into() },
                reais(if tipo == "entrada" { valor } else { -valor }),
                celula(categoria.as_deref().unwrap_or("")),
                celula(beneficiario.as_deref().unwrap_or("")),
                celula(&descricao),
                celula(forma.as_deref().map(rotulo_da_forma).unwrap_or("")),
                if eh_transf == 1 { "Sim".into() } else { String::new() },
                celula(&arquivos_da_linha),
            ]);
        }
    }

    Ok(Ok(Preparo { de, ate, f, nomes_das_maes, extrato: extrato.bytes(), categorias: categorias.bytes(), lucros: lucros.bytes(), lancamentos: lancamentos.bytes(), arquivos }))
}

fn erro_de_io(e: std::io::Error) -> AppError {
    AppError::from(e)
}

/// Monta o `.zip` aos poucos, fora do banco: cada arquivo entra assim que é lido.
struct Construtor {
    zip: ZipWriter<Vec<u8>>,
    ausentes: Vec<String>,
}

impl Construtor {
    fn novo() -> Self {
        Self { zip: ZipWriter::new(Vec::new()), ausentes: Vec::new() }
    }

    /// `None`: o anexo sumiu do banco entre a preparação e a leitura (alguém o apagou). Fica de fora e o LEIA-ME avisa.
    fn arquivo(&mut self, caminho: &str, conteudo: Option<Vec<u8>>) -> Result<(), AppError> {
        match conteudo {
            Some(c) => self.zip.adicionar_bytes(caminho, &c).map_err(erro_de_io),
            None => {
                self.ausentes.push(caminho.to_string());
                Ok(())
            }
        }
    }

    /// Acrescenta o LEIA-ME, o PDF e as planilhas (por último, para o LEIA-ME saber o que de fato entrou) e fecha o `.zip`.
    fn concluir(mut self, p: Preparo) -> Result<Vec<u8>, AppError> {
        let resumo = super::resumo_pdf::resumo(&p.f, &p.nomes_das_maes);
        let incluidos = p.arquivos.len() - self.ausentes.len();
        let leia = leia_me(&p.f, &p.de, &p.ate, incluidos, &self.ausentes);
        for (nome, bytes) in [
            ("LEIA-ME.txt", leia.as_bytes()),
            ("resumo-fechamento.pdf", resumo.as_slice()),
            ("extrato-por-conta.csv", p.extrato.as_slice()),
            ("resultado-por-categoria.csv", p.categorias.as_slice()),
            ("lucros.csv", p.lucros.as_slice()),
            ("lancamentos.csv", p.lancamentos.as_slice()),
        ] {
            self.zip.adicionar_bytes(nome, bytes).map_err(erro_de_io)?;
        }
        self.zip.finalizar().map_err(erro_de_io)
    }
}

/// Para os testes: o mesmo caminho do pedido real, mas com o arquivo lido na mesma conexão.
#[cfg(test)]
fn montar(c: &Connection, data_de: NaiveDate, data_ate: NaiveDate) -> rusqlite::Result<AppResultado> {
    let preparo = match preparar(c, data_de, data_ate)? {
        Ok(p) => p,
        Err(e) => return Ok(Err(e)),
    };
    let mut obra = Construtor::novo();
    let mut stmt = c.prepare("SELECT conteudo FROM anexo WHERE id = ?1")?;
    for a in &preparo.arquivos {
        let conteudo = stmt.query_row([&a.id], |r| r.get::<_, Vec<u8>>(0)).optional()?;
        if let Err(e) = obra.arquivo(&a.caminho, conteudo) {
            return Ok(Err(e));
        }
    }
    Ok(obra.concluir(preparo))
}

#[cfg(test)]
type AppResultado = Result<Vec<u8>, AppError>;

fn nome_do_pacote(f_mes: Option<&str>, de: NaiveDate, ate: NaiveDate) -> String {
    match f_mes {
        Some(mes) => format!("fechamento-{mes}.zip"),
        None => format!("fechamento-{de}_a_{ate}.zip"),
    }
}

/// Resposta de download: tipo fixo, sem farejamento, sem cache e com política que impede o navegador de executar o arquivo.
pub(super) fn resposta_de_arquivo(bytes: Vec<u8>, tipo: &'static str, nome: &str) -> Response {
    let mut r = bytes.into_response();
    let h = r.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_static(tipo));
    h.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    h.insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static("default-src 'none'; sandbox"));
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    if let Ok(v) = HeaderValue::from_str(&format!("attachment; filename=\"{nome}\"")) {
        h.insert(header::CONTENT_DISPOSITION, v);
    }
    r
}

pub async fn obter(State(state): State<AppState>, Query(q): Query<super::financeiro::Periodo>) -> AppResult<Response> {
    q.validar()?;
    let (de, ate) = (q.data_de, q.data_ate);
    // 1) uma leitura curta com os números e a lista de arquivos; 2) cada arquivo num acesso próprio, que solta o banco logo
    // em seguida; 3) o `.zip` e o PDF montados longe do banco.
    let preparo = state.db.with(move |c| preparar(c, de, ate)).await??;
    let mut obra = Construtor::novo();
    for a in &preparo.arquivos {
        let id = a.id.clone();
        let conteudo = state.db.with(move |c| c.query_row("SELECT conteudo FROM anexo WHERE id = ?1", [&id], |r| r.get::<_, Vec<u8>>(0)).optional()).await?;
        obra.arquivo(&a.caminho, conteudo)?;
    }
    let bytes = obra.concluir(preparo)?;
    let nome = nome_do_pacote(super::fechamento::mes_do_periodo(de, ate).as_deref(), de, ate);
    Ok(resposta_de_arquivo(bytes, "application/zip", &nome))
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn valores_em_reais_e_celulas_seguras_para_planilha() {
        assert_eq!(reais(0), "0,00");
        assert_eq!(reais(150_000), "1500,00");
        assert_eq!(reais(-5), "-0,05");
        assert_eq!(reais(-12_345), "-123,45");
        assert_eq!(celula("Mercado"), "Mercado");
        assert_eq!(celula("a;b"), "\"a;b\"");
        assert_eq!(celula("diz \"oi\""), "\"diz \"\"oi\"\"\"");
        assert_eq!(celula("=HIPERLINK(\"x\")"), "\"'=HIPERLINK(\"\"x\"\")\"");
        assert_eq!(celula("-1+2"), "'-1+2");
        assert_eq!(celula("linha1\nlinha2"), "linha1 linha2");
    }

    fn banco() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        crate::db::migrar_para_teste(&mut c);
        c.execute_batch("PRAGMA foreign_keys = OFF").unwrap();
        for (id, nome, tipo) in [("cl", "Distribuição de lucros", "saida"), ("tr", "Transferência", "ambos"), ("al", "Aluguel", "saida"), ("me", "Mensalidades", "entrada")] {
            c.execute("INSERT INTO categoria (id, nome, tipo, cor, espaco) VALUES (?1, ?2, ?3, '#fff', 'pessoal')", rusqlite::params![id, nome, tipo]).unwrap();
        }
        c.execute("INSERT INTO conta (id, nome, banco, cor, espaco, saldo_inicial_centavos) VALUES ('c1', 'Banco A', 'Itaú', '#fff', 'pessoal', 10000), ('c2', 'Banco B', NULL, '#fff', 'pessoal', 0)", []).unwrap();
        c.execute("INSERT INTO beneficiario (id, nome) VALUES ('b1', 'Ana/Souza'), ('b2', '=Golpe')", []).unwrap();
        let tx = |id: &str, conta: &str, tipo: &str, valor: i64, data: &str, status: &str, cat: &str, ben: Option<&str>, desc: &str| {
            c.execute(
                "INSERT INTO transacao (id, tipo, valor_centavos, data, descricao, categoria_id, conta_id, beneficiario_id, status, espaco, criado_por) VALUES (?1, ?2, ?3, ?4, ?9, ?5, ?6, ?7, ?8, 'pessoal', 'ana')",
                rusqlite::params![id, tipo, valor, data, cat, conta, ben, status, desc],
            )
            .unwrap();
        };
        tx("t1", "c1", "saida", 150_000, "2026-10-05", "efetivada", "cl", Some("b1"), "Lucros outubro");
        tx("t2", "c1", "saida", 80_000, "2026-10-06", "efetivada", "al", Some("b2"), "=SOMA(A1)");
        tx("t3", "c1", "entrada", 500_000, "2026-10-07", "efetivada", "me", None, "Mensalidades; casa \"1\"");
        tx("t4", "c1", "saida", 20_000, "2026-10-08", "efetivada", "tr", None, "Para Banco B");
        tx("t5", "c2", "entrada", 20_000, "2026-10-08", "efetivada", "tr", None, "De Banco A");
        tx("t6", "c1", "saida", 9_999, "2026-10-09", "pendente", "al", None, "Pendente fica fora");
        tx("t7", "c1", "saida", 1_000, "2026-11-02", "efetivada", "al", None, "Novembro fica fora");
        let anexo = |id: &str, t: &str, nome: &str, tipo: &str, bytes: &[u8]| {
            c.execute(
                "INSERT INTO anexo (id, transacao_id, nome_arquivo, mime_type, tamanho_bytes, checksum_sha256, conteudo, tipo) VALUES (?1, ?2, ?3, 'application/pdf', ?4, ?1, ?5, ?6)",
                rusqlite::params![id, t, nome, bytes.len() as i64, bytes, tipo],
            )
            .unwrap();
        };
        anexo("aaaaaa111", "t1", "recibo.pdf", "recibo_lucros", b"RECIBO-1");
        anexo("bbbbbb222", "t2", "boleto.pdf", "comprovante", b"BOLETO-2");
        anexo("cccccc333", "t2", "nf.pdf", "nota_fiscal", b"NF-2");
        anexo("dddddd444", "t6", "pendente.pdf", "comprovante", b"PENDENTE");
        c.execute("INSERT INTO fechamento_config (chave, valor) VALUES ('categoria_lucros', 'cl'), ('categorias_transferencia', '[\"tr\"]')", []).unwrap();
        c.execute("INSERT INTO fechamento_conferencia (mes, conta_id, saldo_banco_centavos, por, atualizado_em) VALUES ('2026-10', 'c1', 258001, 'ana', '2026-11-01')", []).unwrap();
        c
    }

    fn pacote(c: &Connection, de: &str, ate: &str) -> HashMap<String, Vec<u8>> {
        let bytes = montar(c, de.parse().unwrap(), ate.parse().unwrap()).unwrap().unwrap();
        crate::zip::testes::ler_de_volta(&bytes).into_iter().collect()
    }

    fn csv(p: &HashMap<String, Vec<u8>>, nome: &str) -> Vec<String> {
        let t = String::from_utf8(p[nome].clone()).unwrap();
        assert!(t.starts_with('\u{FEFF}'), "{nome} precisa do BOM para o Excel");
        t.trim_start_matches('\u{FEFF}').split("\r\n").filter(|l| !l.is_empty()).map(str::to_string).collect()
    }

    #[test]
    fn pacote_traz_planilhas_e_arquivos_do_periodo_com_nomes_seguros() {
        let c = banco();
        let p = pacote(&c, "2026-10-01", "2026-10-31");
        let mut nomes: Vec<&str> = p.keys().map(String::as_str).collect();
        nomes.sort();
        assert_eq!(
            nomes,
            [
                "LEIA-ME.txt",
                "comprovantes/2026-10-06_=Golpe_800,00_bbbbbb.pdf",
                "extrato-por-conta.csv",
                "lancamentos.csv",
                "lucros.csv",
                "notas-fiscais/2026-10-06_=Golpe_800,00_cccccc.pdf",
                "recibos-lucros/2026-10-05_Ana Souza_1500,00_aaaaaa.pdf",
                "resultado-por-categoria.csv",
                "resumo-fechamento.pdf",
            ]
        );
        assert_eq!(p["recibos-lucros/2026-10-05_Ana Souza_1500,00_aaaaaa.pdf"], b"RECIBO-1");
        assert_eq!(p["notas-fiscais/2026-10-06_=Golpe_800,00_cccccc.pdf"], b"NF-2");

        // Extrato: a transferência não entra em entradas/saídas, fecha o saldo, e a conferência com o banco aparece.
        let e = csv(&p, "extrato-por-conta.csv");
        assert_eq!(e[1], "Banco A;Itaú;100,00;5000,00;2300,00;-200,00;2600,00;2580,01;-19,99;ana;Cadastro da conta");
        assert_eq!(e[2], "Banco B;;0,00;0,00;0,00;200,00;200,00;;;;Cadastro da conta");
        assert_eq!(e.last().unwrap(), "TOTAL;;100,00;5000,00;2300,00;0,00;2800,00;;;;");

        // Resultado por categoria, sem a transferência.
        let r = csv(&p, "resultado-por-categoria.csv");
        assert!(r.iter().any(|l| l == "Entrada;Mensalidades;5000,00;1"));
        assert!(r.iter().any(|l| l == "Saída;Aluguel;800,00;1"));
        assert!(!r.iter().any(|l| l.contains("Transferência")));
        assert_eq!(r.last().unwrap(), "Resultado (entradas - saídas);;2700,00;");

        // Lucros com o nome do arquivo do recibo e o total.
        let l = csv(&p, "lucros.csv");
        assert_eq!(l[1], "05/10/2026;Lucros outubro;1500,00;Efetivada;recibos-lucros/2026-10-05_Ana Souza_1500,00_aaaaaa.pdf");
        assert_eq!(l[2], "TOTAL;;1500,00;;");

        // Lançamentos: só efetivados do período, transferência marcada, texto perigoso neutralizado, aspas preservadas.
        let lan = csv(&p, "lancamentos.csv");
        assert_eq!(lan.len(), 1 + 5, "cabeçalho + 5 efetivados de outubro");
        assert!(lan.iter().any(|x| x.starts_with("08/10/2026;Banco A;Saída;-200,00;Transferência;;Para Banco B;;Sim;")));
        assert!(lan.iter().any(|x| x.contains(";'=Golpe;'=SOMA(A1);") && x.contains("comprovantes/2026-10-06_=Golpe_800,00_bbbbbb.pdf | notas-fiscais/2026-10-06_=Golpe_800,00_cccccc.pdf")));
        assert!(lan.iter().any(|x| x.contains("\"Mensalidades; casa \"\"1\"\"\"")));
        assert!(!lan.iter().any(|x| x.contains("Pendente fica fora") || x.contains("Novembro")));

        // O resumo em PDF traz os mesmos números (texto sem compressão, em WinAnsi).
        if let Ok(destino) = std::env::var("ECOS_PDF_AMOSTRA") {
            std::fs::write(destino, &p["resumo-fechamento.pdf"]).unwrap();
        }
        let pdf = String::from_utf8_lossy(&p["resumo-fechamento.pdf"]).to_string();
        assert!(pdf.starts_with("%PDF-1.4"));
        for trecho in ["Fechamento financeiro", "01/10/2026 a 31/10/2026", "2.600,00", "2.800,00", "2.700,00", "Transferências entre contas próprias", "Lucros outubro", "anexado"] {
            let latin1: Vec<u8> = trecho.chars().map(|c| c as u32 as u8).collect();
            assert!(p["resumo-fechamento.pdf"].windows(latin1.len()).any(|j| j == latin1.as_slice()), "o PDF devia conter {trecho:?}");
        }

        let leia = String::from_utf8(p["LEIA-ME.txt"].clone()).unwrap();
        assert!(leia.contains("resumo-fechamento.pdf"));
        assert!(leia.contains("Período: 01/10/2026 a 31/10/2026"));
        assert!(leia.contains("3 arquivo(s)"));
        assert!(leia.contains("1 lançamento(s) ainda pendente(s)"));
    }

    #[test]
    fn arquivo_que_some_no_meio_da_montagem_fica_de_fora_e_o_leia_me_avisa() {
        let c = banco();
        let preparo = preparar(&c, "2026-10-01".parse().unwrap(), "2026-10-31".parse().unwrap()).unwrap().unwrap();
        let mut obra = Construtor::novo();
        for a in &preparo.arquivos {
            // O anexo do boleto foi apagado depois da preparação.
            let conteudo = if a.caminho.starts_with("comprovantes/") { None } else { Some(b"x".to_vec()) };
            obra.arquivo(&a.caminho, conteudo).unwrap();
        }
        let bytes = obra.concluir(preparo).unwrap();
        let p: HashMap<String, Vec<u8>> = crate::zip::testes::ler_de_volta(&bytes).into_iter().collect();
        assert!(!p.keys().any(|k| k.starts_with("comprovantes/")));
        let leia = String::from_utf8(p["LEIA-ME.txt"].clone()).unwrap();
        assert!(leia.contains("2 arquivo(s)"), "{leia}");
        assert!(leia.contains("ARQUIVOS QUE NÃO ENTRARAM"));
        assert!(leia.contains("- comprovantes/2026-10-06_=Golpe_800,00_bbbbbb.pdf"));
    }

    #[test]
    fn pacote_de_periodo_vazio_ainda_traz_as_planilhas() {
        let c = banco();
        let p = pacote(&c, "2025-01-01", "2025-01-31");
        assert_eq!(p.len(), 6);
        assert_eq!(csv(&p, "lancamentos.csv").len(), 1);
        assert_eq!(csv(&p, "lucros.csv").len(), 1);
        assert!(String::from_utf8(p["LEIA-ME.txt"].clone()).unwrap().contains("0 arquivo(s)"));
    }

    #[test]
    fn pacote_recusa_quando_os_arquivos_passam_do_limite() {
        let c = banco();
        c.execute("UPDATE anexo SET tamanho_bytes = ?1 WHERE id = 'aaaaaa111'", [LIMITE_DE_ARQUIVOS_BYTES + 1]).unwrap();
        let r = montar(&c, "2026-10-01".parse().unwrap(), "2026-10-31".parse().unwrap()).unwrap();
        assert!(r.is_err());
    }

    #[test]
    fn nomes_de_arquivo_sem_pasta_nem_caractere_proibido() {
        assert_eq!(nome_de_arquivo("2026-10-05_Ana/Souza: R$ 1,00_a1b2c3"), "2026-10-05_Ana Souza R$ 1,00_a1b2c3");
        assert_eq!(nome_de_arquivo("..\\..\\segredo"), "segredo");
        assert!(nome_de_arquivo(&"x".repeat(200)).chars().count() <= 70);
        assert_eq!(extensao("foto.PNG", "image/png"), "png");
        assert_eq!(extensao("sem-extensao", "application/pdf"), "pdf");
        assert_eq!(extensao("x.exe", "image/jpeg"), "jpg");
    }
}
