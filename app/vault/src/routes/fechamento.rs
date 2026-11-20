//! `/vault/fechamento` — o que a contabilidade pede no fim do mês: extrato por conta (saldo inicial, entradas, saídas e
//! saldo final), resultado por categoria e a lista do que ainda impede de fechar o período.
//!
//! Tudo aqui é regime de caixa: só entram lançamentos **efetivados** nos números. Pendentes aparecem como pendência.
//! O saldo inicial de uma conta no período é o saldo inicial cadastrado mais tudo o que foi efetivado antes do período,
//! então o saldo final bate com o saldo da conta (`/vault/config`) quando o período termina hoje.
//!
//! O saldo que o banco mostra no fim do mês é digitado pela pessoa e fica em `fechamento_conferencia` (vale para o Cofre
//! inteiro). A categoria que representa a distribuição de lucros fica em `fechamento_config`; os lançamentos dela, com o
//! recibo (anexo do tipo `recibo_lucros`) de cada um, formam o bloco "Lucros do mês".

use crate::{
    error::{AppError, AppResult},
    state::AppState,
};
use axum::{
    extract::{Query, State},
    Json,
};
use chrono::{Datelike, Months, NaiveDate};
use ecos_core::ErrorCode;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashMap;
use serde::Deserialize;
use serde_json::{json, Value};

const CHAVE_LUCROS: &str = "categoria_lucros";
/// Categorias (lista JSON de ids) cujos lançamentos são transferência entre contas próprias.
const CHAVE_TRANSFERENCIAS: &str = "categorias_transferencia";
/// Contas (lista JSON de ids) que a pessoa tirou do Fechamento: os lançamentos delas não entram em nenhum número,
/// pendência, planilha ou arquivo do pacote. Conta nova entra sozinha; só sai quem for escolhido.
const CHAVE_CONTAS_FORA: &str = "contas_fora";
const MAX_CATEGORIAS_DE_TRANSFERENCIA: usize = 20;
const MAX_CONTAS_FORA: usize = 500;
/// Teto de lançamentos listados no Fechamento (um período de anos de movimento de uma empresa pequena cabe folgado).
const LIMITE_DE_LANCAMENTOS: i64 = 50_000;
const ITENS_DE_LUCROS: i64 = 5000;
/// Quantos lançamentos de cada pendência vêm de amostra; a quantidade total vem à parte.
const ITENS_POR_PENDENCIA: i64 = 25;
const LIMITE_SALDO: i64 = 999_999_999_999_999;

/// "2026-10" quando o período é exatamente um mês do calendário; é só nesse caso que cabe conferir com o extrato do banco.
pub(crate) fn mes_do_periodo(de: NaiveDate, ate: NaiveDate) -> Option<String> {
    let ultimo = de.with_day(1)?.checked_add_months(Months::new(1))?.pred_opt()?;
    (de.day() == 1 && ate == ultimo).then(|| format!("{:04}-{:02}", de.year(), de.month()))
}

/// Categoria de lucros escolhida, se ainda existir: `(id, nome)`.
fn categoria_de_lucros(c: &Connection) -> rusqlite::Result<Option<(String, String)>> {
    c.query_row("SELECT cat.id, cat.nome FROM fechamento_config f JOIN categoria cat ON cat.id = f.valor WHERE f.chave = ?1", [CHAVE_LUCROS], |r| Ok((r.get(0)?, r.get(1)?))).optional()
}

/// Categorias escolhidas como transferência entre contas próprias, `(id, nome)`, só as que ainda existem.
pub(crate) fn categorias_de_transferencia(c: &Connection) -> rusqlite::Result<Vec<(String, String)>> {
    let valor: Option<String> = c.query_row("SELECT valor FROM fechamento_config WHERE chave = ?1", [CHAVE_TRANSFERENCIAS], |r| r.get(0)).optional()?;
    let ids: Vec<String> = valor.and_then(|v| serde_json::from_str(&v).ok()).unwrap_or_default();
    let mut out = Vec::new();
    for id in ids {
        if let Some(nome) = c.query_row("SELECT nome FROM categoria WHERE id = ?1", [&id], |r| r.get::<_, String>(0)).optional()? {
            out.push((id, nome));
        }
    }
    Ok(out)
}

/// Ids que valem como transferência: as categorias escolhidas e as subcategorias delas.
pub(crate) fn ids_de_transferencia(c: &Connection, escolhidas: &[(String, String)]) -> rusqlite::Result<Vec<String>> {
    let mut ids: Vec<String> = Vec::new();
    let mut stmt = c.prepare("SELECT id FROM categoria WHERE pai_id = ?1")?;
    for (id, _) in escolhidas {
        ids.push(id.clone());
        for filha in stmt.query_map([id], |r| r.get::<_, String>(0))? {
            ids.push(filha?);
        }
    }
    ids.sort();
    ids.dedup();
    Ok(ids)
}

/// Condição SQL (0/1, nunca nula) de que o lançamento `t` é transferência. Os ids vêm da tabela de categorias e ainda
/// assim entram escapados.
pub(crate) fn sql_eh_transferencia(ids: &[String]) -> String {
    if ids.is_empty() {
        return "0".to_string();
    }
    let lista: Vec<String> = ids.iter().map(|i| format!("'{}'", i.replace('\'', "''"))).collect();
    format!("COALESCE(t.categoria_id IN ({}), 0)", lista.join(", "))
}

/// Ids das contas que ficam fora do Fechamento, só as que ainda existem.
pub(crate) fn contas_fora(c: &Connection) -> rusqlite::Result<Vec<String>> {
    let valor: Option<String> = c.query_row("SELECT valor FROM fechamento_config WHERE chave = ?1", [CHAVE_CONTAS_FORA], |r| r.get(0)).optional()?;
    let ids: Vec<String> = valor.and_then(|v| serde_json::from_str(&v).ok()).unwrap_or_default();
    if ids.is_empty() {
        return Ok(ids);
    }
    let mut stmt = c.prepare("SELECT id FROM conta")?;
    let existentes: Vec<String> = stmt.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?;
    Ok(ids.into_iter().filter(|i| existentes.contains(i)).collect())
}

/// Condição SQL (0/1, nunca nula) de que `coluna` (o id de uma conta) está entre as contas fora do Fechamento. Os ids
/// vêm da tabela de contas e ainda assim entram escapados. Lançamento sem conta nunca está "fora".
pub(crate) fn sql_conta_fora(coluna: &str, ids: &[String]) -> String {
    if ids.is_empty() {
        return "0".to_string();
    }
    let lista: Vec<String> = ids.iter().map(|i| format!("'{}'", i.replace('\'', "''"))).collect();
    format!("COALESCE({coluna} IN ({}), 0)", lista.join(", "))
}

/// Uma linha de extrato (conta ou "sem conta") com os números do período já somados.
#[allow(clippy::too_many_arguments)]
fn linha_de_conta(
    id: Option<String>,
    nome: String,
    extra: Value,
    saldo_inicial_cadastrado: i64,
    antes: i64,
    entradas: i64,
    saidas: i64,
    transferencias: i64,
    lancamentos: i64,
) -> Value {
    let saldo_inicial = saldo_inicial_cadastrado + antes;
    let mut v = json!({
        "conta_id": id, "nome": nome,
        "saldo_inicial": saldo_inicial, "entradas": entradas, "saidas": saidas, "transferencias": transferencias,
        "saldo_final": saldo_inicial + entradas - saidas + transferencias, "lancamentos": lancamentos,
        "saldo_banco": Value::Null, "diferenca": Value::Null, "conferido_por": Value::Null, "conferido_em": Value::Null,
    });
    if let (Some(obj), Some(ext)) = (v.as_object_mut(), extra.as_object()) {
        for (k, val) in ext {
            obj.insert(k.clone(), val.clone());
        }
    }
    v
}

type AberturaVigente = (String, i64, Option<String>);

/// A abertura mais recente de cada conta que vale para um período que começa em `de`: `conta_id -> (data, saldo, por)`.
fn aberturas_ate(c: &Connection, de: &str) -> rusqlite::Result<HashMap<String, AberturaVigente>> {
    let mut stmt = c.prepare(
        "SELECT a.conta_id, a.data, a.saldo_centavos, a.por FROM fechamento_abertura a \
         WHERE a.data <= ?1 AND a.data = (SELECT MAX(b.data) FROM fechamento_abertura b WHERE b.conta_id = a.conta_id AND b.data <= ?1)",
    )?;
    let v = stmt.query_map([de], |r| Ok((r.get::<_, String>(0)?, (r.get::<_, String>(1)?, r.get::<_, i64>(2)?, r.get::<_, Option<String>>(3)?))))?.collect::<Result<_, _>>()?;
    Ok(v)
}

/// "AAAA-MM" do mês anterior a `de`, quando `de` é o dia 1 (só então o saldo do banco do mês anterior serve de abertura).
fn mes_anterior(de: &str) -> Option<String> {
    let d = NaiveDate::parse_from_str(de, "%Y-%m-%d").ok()?;
    (d.day() == 1).then(|| d.pred_opt().map(|u| format!("{:04}-{:02}", u.year(), u.month()))).flatten()
}

/// `conta_fora`: condição (sobre `c.id`) das contas que a pessoa tirou do Fechamento; elas não viram linha.
fn contas_do_periodo(c: &Connection, de: &str, ate: &str, mes: Option<&str>, transf: &str, conta_fora: &str) -> rusqlite::Result<Vec<Value>> {
    let aberturas = aberturas_ate(c, de)?;
    let anterior = mes_anterior(de);
    let conferidas_antes: HashMap<String, i64> = match &anterior {
        Some(m) => {
            let mut stmt = c.prepare("SELECT conta_id, saldo_banco_centavos FROM fechamento_conferencia WHERE mes = ?1")?;
            let v = stmt.query_map([m], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?.collect::<Result<_, _>>()?;
            v
        }
        None => HashMap::new(),
    };
    let mut stmt = c.prepare(&format!(
        "SELECT c.id, c.nome, c.banco, c.tipo, c.cor, c.codigo_banco, c.sigla, c.saldo_inicial_centavos, \
                COALESCE(SUM(CASE WHEN t.data < ?1 THEN (CASE WHEN t.tipo = 'entrada' THEN t.valor_centavos ELSE -t.valor_centavos END) ELSE 0 END), 0), \
                COALESCE(SUM(CASE WHEN t.data BETWEEN ?1 AND ?2 AND t.tipo = 'entrada' AND NOT {transf} THEN t.valor_centavos ELSE 0 END), 0), \
                COALESCE(SUM(CASE WHEN t.data BETWEEN ?1 AND ?2 AND t.tipo = 'saida' AND NOT {transf} THEN t.valor_centavos ELSE 0 END), 0), \
                COALESCE(SUM(CASE WHEN t.data BETWEEN ?1 AND ?2 AND {transf} THEN (CASE WHEN t.tipo = 'entrada' THEN t.valor_centavos ELSE -t.valor_centavos END) ELSE 0 END), 0), \
                COUNT(CASE WHEN t.data BETWEEN ?1 AND ?2 THEN 1 END) \
         FROM conta c LEFT JOIN transacao t ON t.conta_id = c.id AND t.status = 'efetivada' \
         WHERE NOT {conta_fora} \
         GROUP BY c.id ORDER BY c.nome COLLATE NOCASE, c.id"
    ))?;
    let mut linhas: Vec<Value> = stmt
        .query_map([de, ate], |r| {
            let id: String = r.get(0)?;
            // Com uma abertura (saldo informado numa data), parte dela e soma só o que veio depois; sem, parte do cadastro.
            let (base, antes) = match aberturas.get(&id) {
                Some((data, saldo, _)) => {
                    let depois: i64 = c.query_row(
                        "SELECT COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN valor_centavos ELSE -valor_centavos END), 0) FROM transacao WHERE conta_id = ?1 AND status = 'efetivada' AND data >= ?2 AND data < ?3",
                        params![id, data, de],
                        |x| x.get(0),
                    )?;
                    (*saldo, depois)
                }
                None => (r.get::<_, i64>(7)?, r.get::<_, i64>(8)?),
            };
            let abertura = aberturas.get(&id).map(|(data, saldo, por)| json!({ "data": data, "saldo": saldo, "por": por }));
            let extra = json!({
                "banco": r.get::<_, Option<String>>(2)?, "tipo": r.get::<_, String>(3)?, "cor": r.get::<_, String>(4)?, "codigo_banco": r.get::<_, Option<String>>(5)?, "sigla": r.get::<_, Option<String>>(6)?,
                "saldo_inicial_cadastrado": r.get::<_, i64>(7)?,
                "abertura": abertura,
                "abertura_neste_periodo": aberturas.get(&id).is_some_and(|a| a.0 == de),
                "saldo_banco_anterior": conferidas_antes.get(&id),
                "mes_anterior": anterior,
            });
            Ok(linha_de_conta(Some(id), r.get(1)?, extra, base, antes, r.get(9)?, r.get(10)?, r.get(11)?, r.get(12)?))
        })?
        .collect::<Result<_, _>>()?;

    // Lançamentos sem conta ficam de fora do extrato de qualquer banco: aparecem numa linha própria, só se existirem.
    let (existe, antes, entradas, saidas, transferencias, lancamentos): (i64, i64, i64, i64, i64, i64) = c.query_row(
        &format!(
            "SELECT COUNT(*), \
                COALESCE(SUM(CASE WHEN t.data < ?1 THEN (CASE WHEN t.tipo = 'entrada' THEN t.valor_centavos ELSE -t.valor_centavos END) ELSE 0 END), 0), \
                COALESCE(SUM(CASE WHEN t.data BETWEEN ?1 AND ?2 AND t.tipo = 'entrada' AND NOT {transf} THEN t.valor_centavos ELSE 0 END), 0), \
                COALESCE(SUM(CASE WHEN t.data BETWEEN ?1 AND ?2 AND t.tipo = 'saida' AND NOT {transf} THEN t.valor_centavos ELSE 0 END), 0), \
                COALESCE(SUM(CASE WHEN t.data BETWEEN ?1 AND ?2 AND {transf} THEN (CASE WHEN t.tipo = 'entrada' THEN t.valor_centavos ELSE -t.valor_centavos END) ELSE 0 END), 0), \
                COUNT(CASE WHEN t.data BETWEEN ?1 AND ?2 THEN 1 END) \
         FROM transacao t WHERE t.conta_id IS NULL AND t.status = 'efetivada'"
        ),
        [de, ate],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
    )?;
    if existe > 0 {
        linhas.push(linha_de_conta(None, "Sem conta".into(), json!({ "banco": null, "tipo": "outro", "cor": "#8f8f96", "codigo_banco": null, "sigla": null }), 0, antes, entradas, saidas, transferencias, lancamentos));
    }

    if let Some(mes) = mes {
        let mut stmt = c.prepare("SELECT conta_id, saldo_banco_centavos, por, atualizado_em FROM fechamento_conferencia WHERE mes = ?1")?;
        let conferidas: Vec<(String, i64, Option<String>, String)> = stmt.query_map([mes], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?.collect::<Result<_, _>>()?;
        for l in linhas.iter_mut() {
            let Some(id) = l["conta_id"].as_str().map(str::to_string) else { continue };
            if let Some((_, banco, por, em)) = conferidas.iter().find(|x| x.0 == id) {
                l["saldo_banco"] = json!(banco);
                l["diferenca"] = json!(banco - l["saldo_final"].as_i64().unwrap_or(0));
                l["conferido_por"] = json!(por);
                l["conferido_em"] = json!(em);
            }
        }
    }
    Ok(linhas)
}

fn por_categoria(c: &Connection, de: &str, ate: &str, transf: &str, fora: &str) -> rusqlite::Result<Vec<Value>> {
    let mut stmt = c.prepare(&format!(
        "SELECT t.tipo, t.categoria_id, c.nome, c.pai_id, SUM(t.valor_centavos), COUNT(*) \
         FROM transacao t LEFT JOIN categoria c ON c.id = t.categoria_id \
         WHERE t.status = 'efetivada' AND t.data BETWEEN ?1 AND ?2 AND NOT {transf} AND NOT {fora} \
         GROUP BY t.tipo, t.categoria_id ORDER BY t.tipo, 5 DESC, c.nome"
    ))?;
    let linhas = stmt
        .query_map([de, ate], |r| {
            Ok(json!({ "tipo": r.get::<_, String>(0)?, "categoria_id": r.get::<_, Option<String>>(1)?, "nome": r.get::<_, Option<String>>(2)?, "pai_id": r.get::<_, Option<String>>(3)?, "valor": r.get::<_, i64>(4)?, "lancamentos": r.get::<_, i64>(5)? }))
        })?
        .collect::<Result<_, _>>()?;
    Ok(linhas)
}

/// Um tipo de pendência: quantos lançamentos do período se encaixam em `onde` (texto fixo, nunca dado de fora),
/// quanto somam e uma amostra dos mais antigos.
fn pendencia(c: &Connection, onde: &str, de: &str, ate: &str) -> rusqlite::Result<Value> {
    let (quantidade, valor): (i64, i64) =
        c.query_row(&format!("SELECT COUNT(*), COALESCE(SUM(t.valor_centavos), 0) FROM transacao t WHERE t.data BETWEEN ?1 AND ?2 AND {onde}"), [de, ate], |r| Ok((r.get(0)?, r.get(1)?)))?;
    let mut stmt = c.prepare(&format!("SELECT t.id, t.descricao, t.tipo, t.valor_centavos, t.data FROM transacao t WHERE t.data BETWEEN ?1 AND ?2 AND {onde} ORDER BY t.data, t.id LIMIT ?3"))?;
    let itens = stmt
        .query_map(params![de, ate, ITENS_POR_PENDENCIA], |r| Ok(json!({ "id": r.get::<_, String>(0)?, "descricao": r.get::<_, String>(1)?, "tipo": r.get::<_, String>(2)?, "valor_centavos": r.get::<_, i64>(3)?, "data": r.get::<_, String>(4)? })))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(json!({ "quantidade": quantidade, "valor_centavos": valor, "itens": itens }))
}

/// Bloco "Lucros do mês": lançamentos de saída da categoria de lucros (e das subcategorias dela) e o recibo de cada um.
/// Os totais contam só efetivados; pendentes aparecem na lista, marcados.
fn lucros(c: &Connection, de: &str, ate: &str, fora: &str) -> rusqlite::Result<Value> {
    let Some((id, nome)) = categoria_de_lucros(c)? else {
        return Ok(json!({ "configurada": false, "categoria_id": null, "categoria_nome": null, "quantidade": 0, "valor_centavos": 0, "sem_recibo": 0, "pendentes": 0, "itens": [] }));
    };
    let onde = format!("t.tipo = 'saida' AND t.data BETWEEN ?1 AND ?2 AND (t.categoria_id = ?3 OR t.categoria_id IN (SELECT id FROM categoria WHERE pai_id = ?3)) AND NOT {fora}");
    let onde = onde.as_str();
    const SEM_RECIBO: &str = "NOT EXISTS (SELECT 1 FROM anexo a WHERE a.transacao_id = t.id AND a.tipo = 'recibo_lucros')";
    let (quantidade, valor, sem_recibo): (i64, i64, i64) = c.query_row(
        &format!("SELECT COUNT(*), COALESCE(SUM(t.valor_centavos), 0), COUNT(CASE WHEN {SEM_RECIBO} THEN 1 END) FROM transacao t WHERE {onde} AND t.status = 'efetivada'"),
        params![de, ate, id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    let pendentes: i64 = c.query_row(&format!("SELECT COUNT(*) FROM transacao t WHERE {onde} AND t.status = 'pendente'"), params![de, ate, id], |r| r.get(0))?;
    let mut stmt = c.prepare(&format!(
        "SELECT t.id, t.descricao, t.data, t.valor_centavos, t.status, \
                (SELECT COUNT(*) FROM anexo a WHERE a.transacao_id = t.id AND a.tipo = 'recibo_lucros'), \
                (SELECT COUNT(*) FROM anexo a WHERE a.transacao_id = t.id AND a.tipo <> 'recibo_lucros') \
         FROM transacao t WHERE {onde} ORDER BY t.data, t.id LIMIT ?4"
    ))?;
    let itens = stmt
        .query_map(params![de, ate, id, ITENS_DE_LUCROS], |r| {
            Ok(json!({ "id": r.get::<_, String>(0)?, "descricao": r.get::<_, String>(1)?, "data": r.get::<_, String>(2)?, "valor_centavos": r.get::<_, i64>(3)?, "status": r.get::<_, String>(4)?, "recibos": r.get::<_, i64>(5)?, "outros_anexos": r.get::<_, i64>(6)? }))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(json!({ "configurada": true, "categoria_id": id, "categoria_nome": nome, "quantidade": quantidade, "valor_centavos": valor, "sem_recibo": sem_recibo, "pendentes": pendentes, "itens": itens }))
}

/// Bloco "Transferências entre contas": o que saiu de uma conta própria e entrou em outra não é receita nem despesa.
/// Os lançamentos das categorias escolhidas ficam fora das entradas, das saídas e do resultado; o líquido por conta
/// aparece à parte e fecha o saldo. Se entradas e saídas de transferência não empatam, falta o outro lado.
fn transferencias(c: &Connection, escolhidas: &[(String, String)], transf: &str, fora: &str, de: &str, ate: &str) -> rusqlite::Result<Value> {
    let (quantidade, entradas, saidas): (i64, i64, i64) = c.query_row(
        &format!(
            "SELECT COUNT(*), COALESCE(SUM(CASE WHEN t.tipo = 'entrada' THEN t.valor_centavos ELSE 0 END), 0), COALESCE(SUM(CASE WHEN t.tipo = 'saida' THEN t.valor_centavos ELSE 0 END), 0) \
             FROM transacao t WHERE t.status = 'efetivada' AND t.data BETWEEN ?1 AND ?2 AND {transf} AND NOT {fora}"
        ),
        [de, ate],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    let categorias: Vec<Value> = escolhidas.iter().map(|(id, nome)| json!({ "id": id, "nome": nome })).collect();
    Ok(json!({ "configurada": !escolhidas.is_empty(), "categorias": categorias, "quantidade": quantidade, "entradas": entradas, "saidas": saidas, "liquido": entradas - saidas, "equilibrada": entradas == saidas }))
}

/// Todos os lançamentos efetivados do período (menos os de contas fora do Fechamento), do mais antigo ao mais novo: é a
/// lista que a contabilidade confere contra o extrato. `transferencia` marca os que não contam como entrada nem saída.
pub(crate) fn lancamentos(c: &Connection, data_de: NaiveDate, data_ate: NaiveDate) -> rusqlite::Result<Vec<Value>> {
    let (de, ate) = (data_de.to_string(), data_ate.to_string());
    let escolhidas = categorias_de_transferencia(c)?;
    let transf = sql_eh_transferencia(&ids_de_transferencia(c, &escolhidas)?);
    let fora = sql_conta_fora("t.conta_id", &contas_fora(c)?);
    let mut stmt = c.prepare(&format!(
        "SELECT t.id, t.data, t.conta_id, COALESCE(c.nome, 'Sem conta'), t.tipo, t.valor_centavos, cat.nome, b.nome, t.descricao, t.forma_pagamento, {transf},                 (SELECT COUNT(*) FROM anexo a WHERE a.transacao_id = t.id)          FROM transacao t LEFT JOIN conta c ON c.id = t.conta_id LEFT JOIN categoria cat ON cat.id = t.categoria_id LEFT JOIN beneficiario b ON b.id = t.beneficiario_id          WHERE t.status = 'efetivada' AND t.data BETWEEN ?1 AND ?2 AND NOT {fora} ORDER BY t.data, t.id LIMIT ?3"
    ))?;
    let linhas = stmt
        .query_map(params![de, ate, LIMITE_DE_LANCAMENTOS], |r| {
            Ok(json!({
                "id": r.get::<_, String>(0)?, "data": r.get::<_, String>(1)?, "conta_id": r.get::<_, Option<String>>(2)?, "conta": r.get::<_, String>(3)?,
                "tipo": r.get::<_, String>(4)?, "valor_centavos": r.get::<_, i64>(5)?, "categoria": r.get::<_, Option<String>>(6)?, "beneficiario": r.get::<_, Option<String>>(7)?,
                "descricao": r.get::<_, String>(8)?, "forma_pagamento": r.get::<_, Option<String>>(9)?, "transferencia": r.get::<_, i64>(10)? == 1, "arquivos": r.get::<_, i64>(11)?,
            }))
        })?
        .collect::<Result<_, _>>()?;
    Ok(linhas)
}

/// `GET /vault/fechamento/lancamentos?data_de&data_ate`.
pub async fn obter_lancamentos(State(state): State<AppState>, Query(q): Query<super::financeiro::Periodo>) -> AppResult<Json<Value>> {
    q.validar()?;
    let lista = state.db.with(move |c| lancamentos(c, q.data_de, q.data_ate)).await?;
    Ok(Json(json!({ "lancamentos": lista, "limite": LIMITE_DE_LANCAMENTOS, "cortado": lista.len() as i64 >= LIMITE_DE_LANCAMENTOS })))
}

pub(crate) fn fechamento(c: &Connection, data_de: NaiveDate, data_ate: NaiveDate) -> rusqlite::Result<Value> {
    let (de, ate) = (data_de.to_string(), data_ate.to_string());
    let mes = mes_do_periodo(data_de, data_ate);
    let escolhidas = categorias_de_transferencia(c)?;
    let transf = sql_eh_transferencia(&ids_de_transferencia(c, &escolhidas)?);
    // Período que ainda não terminou: os números são parciais e não há saldo final de banco para conferir.
    let em_andamento = data_ate >= chrono::Utc::now().date_naive();
    let fora_ids = contas_fora(c)?;
    let fora = sql_conta_fora("t.conta_id", &fora_ids);
    let contas = contas_do_periodo(c, &de, &ate, mes.as_deref(), &transf, &sql_conta_fora("c.id", &fora_ids))?;
    // Todas as contas do Cofre, para a pessoa escolher quais entram; as de fora não aparecem no extrato.
    let todas_as_contas: Vec<Value> = {
        let mut stmt = c.prepare("SELECT id, nome, banco, cor, codigo_banco, sigla FROM conta ORDER BY nome COLLATE NOCASE, id")?;
        let v = stmt
            .query_map([], |r| {
                let id: String = r.get(0)?;
                Ok(json!({ "id": id, "nome": r.get::<_, String>(1)?, "banco": r.get::<_, Option<String>>(2)?, "cor": r.get::<_, String>(3)?, "codigo_banco": r.get::<_, Option<String>>(4)?, "sigla": r.get::<_, Option<String>>(5)?, "fora": fora_ids.contains(&id) }))
            })?
            .collect::<Result<_, _>>()?;
        v
    };
    let soma = |campo: &str| -> i64 { contas.iter().map(|l| l[campo].as_i64().unwrap_or(0)).sum() };
    let (saldo_inicial, entradas, saidas, liquido_transferencias) = (soma("saldo_inicial"), soma("entradas"), soma("saidas"), soma("transferencias"));
    let rascunhos: i64 = c.query_row("SELECT COUNT(*) FROM comprovante_rascunho", [], |r| r.get(0))?;
    Ok(json!({
        "data_de": de, "data_ate": ate, "mes": mes, "em_andamento": em_andamento,
        "contas": contas,
        "todas_as_contas": todas_as_contas,
        "totais": { "saldo_inicial": saldo_inicial, "entradas": entradas, "saidas": saidas, "transferencias": liquido_transferencias, "resultado": entradas - saidas, "saldo_final": saldo_inicial + entradas - saidas + liquido_transferencias },
        "transferencias": transferencias(c, &escolhidas, &transf, &fora, &de, &ate)?,
        "categorias": por_categoria(c, &de, &ate, &transf, &fora)?,
        "lucros": lucros(c, &de, &ate, &fora)?,
        "pendencias": {
            "pendentes": pendencia(c, &format!("t.status = 'pendente' AND NOT {fora}"), &de, &ate)?,
            "sem_categoria": pendencia(c, &format!("t.status = 'efetivada' AND t.categoria_id IS NULL AND NOT {fora}"), &de, &ate)?,
            "sem_conta": pendencia(c, "t.status = 'efetivada' AND t.conta_id IS NULL", &de, &ate)?,
            "sem_comprovante": pendencia(c, &format!("t.status = 'efetivada' AND NOT {transf} AND NOT {fora} AND NOT EXISTS (SELECT 1 FROM anexo a WHERE a.transacao_id = t.id)"), &de, &ate)?,
            "nao_conciliadas": pendencia(c, &format!("t.status = 'efetivada' AND t.conciliada = 0 AND NOT {fora}"), &de, &ate)?,
            // Rascunhos não têm data de lançamento: contam todos os que esperam revisão, em qualquer período.
            "rascunhos": rascunhos,
        },
    }))
}

pub async fn obter(State(state): State<AppState>, Query(q): Query<super::financeiro::Periodo>) -> AppResult<Json<Value>> {
    q.validar()?;
    Ok(Json(state.db.with(move |c| fechamento(c, q.data_de, q.data_ate)).await?))
}

#[derive(Deserialize)]
pub struct Conferencia {
    /// Mês conferido, "AAAA-MM".
    pub mes: String,
    pub conta_id: String,
    /// Saldo que o extrato do banco mostra no último dia do mês, em centavos; nulo apaga a conferência.
    pub saldo_banco_centavos: Option<i64>,
}

pub async fn conferir(State(state): State<AppState>, Json(p): Json<Conferencia>) -> AppResult<Json<Value>> {
    if p.mes.len() != 7 || NaiveDate::parse_from_str(&format!("{}-01", p.mes), "%Y-%m-%d").is_err() {
        return Err(AppError::new(ErrorCode::ValidationError).with_message("Informe o mês como AAAA-MM."));
    }
    if p.saldo_banco_centavos.is_some_and(|s| s.abs() > LIMITE_SALDO) {
        return Err(AppError::new(ErrorCode::ValidationError).with_message("Saldo fora do limite."));
    }
    let autor = crate::db::autor_atual();
    let existe = state
        .db
        .with(move |c| {
            if !c.query_row("SELECT EXISTS(SELECT 1 FROM conta WHERE id = ?1)", [&p.conta_id], |r| r.get::<_, bool>(0))? {
                return Ok(false);
            }
            match p.saldo_banco_centavos {
                Some(saldo) => {
                    c.execute(
                        "INSERT INTO fechamento_conferencia (mes, conta_id, saldo_banco_centavos, por, atualizado_em) VALUES (?1, ?2, ?3, ?4, datetime('now')) \
                         ON CONFLICT (mes, conta_id) DO UPDATE SET saldo_banco_centavos = excluded.saldo_banco_centavos, por = excluded.por, atualizado_em = datetime('now')",
                        params![p.mes, p.conta_id, saldo, autor],
                    )?;
                }
                None => {
                    c.execute("DELETE FROM fechamento_conferencia WHERE mes = ?1 AND conta_id = ?2", params![p.mes, p.conta_id])?;
                }
            }
            Ok(true)
        })
        .await?;
    if !existe {
        return Err(AppError::new(ErrorCode::AccountNotFound));
    }
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct Abertura {
    pub conta_id: String,
    /// Dia a partir do qual o saldo vale (o saldo é o do começo desse dia), "AAAA-MM-DD".
    pub data: String,
    /// Saldo da conta nesse dia, em centavos; nulo apaga a abertura daquele dia.
    pub saldo_centavos: Option<i64>,
}

/// Informa (ou remove) o saldo de uma conta no começo de um dia. O extrato parte dele em vez do saldo inicial do cadastro.
pub async fn definir_abertura(State(state): State<AppState>, Json(p): Json<Abertura>) -> AppResult<Json<Value>> {
    if NaiveDate::parse_from_str(&p.data, "%Y-%m-%d").is_err() {
        return Err(AppError::new(ErrorCode::ValidationError).with_message("Informe a data como AAAA-MM-DD."));
    }
    if p.saldo_centavos.is_some_and(|s| s.abs() > LIMITE_SALDO) {
        return Err(AppError::new(ErrorCode::ValidationError).with_message("Saldo fora do limite."));
    }
    let autor = crate::db::autor_atual();
    let existe = state
        .db
        .with(move |c| {
            if !c.query_row("SELECT EXISTS(SELECT 1 FROM conta WHERE id = ?1)", [&p.conta_id], |r| r.get::<_, bool>(0))? {
                return Ok(false);
            }
            match p.saldo_centavos {
                Some(saldo) => {
                    c.execute(
                        "INSERT INTO fechamento_abertura (conta_id, data, saldo_centavos, por, atualizado_em) VALUES (?1, ?2, ?3, ?4, datetime('now')) \
                         ON CONFLICT (conta_id, data) DO UPDATE SET saldo_centavos = excluded.saldo_centavos, por = excluded.por, atualizado_em = datetime('now')",
                        params![p.conta_id, p.data, saldo, autor],
                    )?;
                }
                None => {
                    c.execute("DELETE FROM fechamento_abertura WHERE conta_id = ?1 AND data = ?2", params![p.conta_id, p.data])?;
                }
            }
            Ok(true)
        })
        .await?;
    if !existe {
        return Err(AppError::new(ErrorCode::NotFound).with_message("Conta não encontrada."));
    }
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct DefinirLucros {
    /// Categoria que representa a distribuição de lucros; nulo desfaz a escolha.
    pub categoria_id: Option<String>,
}

pub async fn definir_lucros(State(state): State<AppState>, Json(p): Json<DefinirLucros>) -> AppResult<Json<Value>> {
    let resultado = state
        .db
        .with(move |c| {
            let Some(id) = p.categoria_id else {
                c.execute("DELETE FROM fechamento_config WHERE chave = ?1", [CHAVE_LUCROS])?;
                return Ok(Ok(()));
            };
            let tipo: Option<String> = c.query_row("SELECT tipo FROM categoria WHERE id = ?1", [&id], |r| r.get(0)).optional()?;
            match tipo.as_deref() {
                None => return Ok(Err(AppError::new(ErrorCode::CategoryNotFound))),
                Some("entrada") => return Ok(Err(AppError::new(ErrorCode::ValidationError).with_message("A categoria de lucros precisa aceitar saídas."))),
                Some(_) => {}
            }
            let escolhidas = categorias_de_transferencia(c)?;
            if ids_de_transferencia(c, &escolhidas)?.contains(&id) {
                return Ok(Err(AppError::new(ErrorCode::ValidationError).with_message("Essa categoria já está marcada como transferência.")));
            }
            c.execute("INSERT INTO fechamento_config (chave, valor) VALUES (?1, ?2) ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor", params![CHAVE_LUCROS, id])?;
            Ok(Ok(()))
        })
        .await?;
    resultado?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct DefinirTransferencias {
    /// Categorias cujos lançamentos são transferência entre contas próprias; lista vazia desfaz a escolha.
    pub categoria_ids: Vec<String>,
}

pub async fn definir_transferencias(State(state): State<AppState>, Json(p): Json<DefinirTransferencias>) -> AppResult<Json<Value>> {
    let mut ids: Vec<String> = Vec::new();
    for id in p.categoria_ids {
        if !ids.contains(&id) {
            ids.push(id);
        }
    }
    if ids.len() > MAX_CATEGORIAS_DE_TRANSFERENCIA {
        return Err(AppError::new(ErrorCode::ValidationError).with_message("Categorias demais para transferência."));
    }
    let resultado = state
        .db
        .with(move |c| {
            if ids.is_empty() {
                c.execute("DELETE FROM fechamento_config WHERE chave = ?1", [CHAVE_TRANSFERENCIAS])?;
                return Ok(Ok(()));
            }
            for id in &ids {
                if !c.query_row("SELECT EXISTS(SELECT 1 FROM categoria WHERE id = ?1)", [id], |r| r.get::<_, bool>(0))? {
                    return Ok(Err(AppError::new(ErrorCode::CategoryNotFound)));
                }
            }
            // A mesma categoria não pode ser, ao mesmo tempo, distribuição de lucros e transferência.
            if let Some((lucros, _)) = categoria_de_lucros(c)? {
                let escolhidas: Vec<(String, String)> = ids.iter().map(|i| (i.clone(), String::new())).collect();
                if ids_de_transferencia(c, &escolhidas)?.contains(&lucros) {
                    return Ok(Err(AppError::new(ErrorCode::ValidationError).with_message("A categoria de lucros não pode ser transferência.")));
                }
            }
            let valor = serde_json::to_string(&ids).unwrap_or_else(|_| "[]".into());
            c.execute("INSERT INTO fechamento_config (chave, valor) VALUES (?1, ?2) ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor", params![CHAVE_TRANSFERENCIAS, valor])?;
            Ok(Ok(()))
        })
        .await?;
    resultado?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct DefinirContas {
    /// Contas que ficam de fora do Fechamento; lista vazia traz todas de volta.
    pub fora: Vec<String>,
}

pub async fn definir_contas(State(state): State<AppState>, Json(p): Json<DefinirContas>) -> AppResult<Json<Value>> {
    let mut ids: Vec<String> = Vec::new();
    for id in p.fora {
        if !ids.contains(&id) {
            ids.push(id);
        }
    }
    if ids.len() > MAX_CONTAS_FORA {
        return Err(AppError::new(ErrorCode::ValidationError).with_message("Contas demais."));
    }
    let resultado = state
        .db
        .with(move |c| {
            if ids.is_empty() {
                c.execute("DELETE FROM fechamento_config WHERE chave = ?1", [CHAVE_CONTAS_FORA])?;
                return Ok(Ok(()));
            }
            for id in &ids {
                if !c.query_row("SELECT EXISTS(SELECT 1 FROM conta WHERE id = ?1)", [id], |r| r.get::<_, bool>(0))? {
                    return Ok(Err(AppError::new(ErrorCode::NotFound).with_message("Conta não encontrada.")));
                }
            }
            let valor = serde_json::to_string(&ids).unwrap_or_else(|_| "[]".into());
            c.execute("INSERT INTO fechamento_config (chave, valor) VALUES (?1, ?2) ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor", params![CHAVE_CONTAS_FORA, valor])?;
            Ok(Ok(()))
        })
        .await?;
    resultado?;
    Ok(Json(json!({ "ok": true })))
}

/// Configuração do Fechamento, para quem só precisa saber qual é a categoria de lucros (o editor do lançamento):
/// o id escolhido e todos os que valem como lucros (ele e as subcategorias dele).
pub async fn configuracao(State(state): State<AppState>) -> AppResult<Json<Value>> {
    let (id, todas, transferencias) = state
        .db
        .with(|c| {
            let transferencias: Vec<String> = categorias_de_transferencia(c)?.into_iter().map(|(id, _)| id).collect();
            let Some((id, _)) = categoria_de_lucros(c)? else { return Ok((None, Vec::new(), transferencias)) };
            let mut stmt = c.prepare("SELECT id FROM categoria WHERE id = ?1 OR pai_id = ?1")?;
            let todas: Vec<String> = stmt.query_map([&id], |r| r.get(0))?.collect::<Result<_, _>>()?;
            Ok((Some(id), todas, transferencias))
        })
        .await?;
    Ok(Json(json!({ "categoria_lucros_id": id, "categorias_lucros": todas, "categorias_transferencia": transferencias })))
}

#[cfg(test)]
mod testes {
    use crate::{config::Config, db::VaultDb, routes, state::AppState};
    use axum::{
        body::{to_bytes, Body},
        http::{Request, StatusCode},
        Router,
    };
    use ecos_core::new_id;
    use serde_json::{json, Value};
    use std::sync::Arc;
    use tower::Service;

    fn app() -> Router {
        let raiz = std::env::temp_dir().join(format!("ecos-fechamento-{}", new_id()));
        let config = Arc::new(Config { porta: 0, db_path: raiz.join("vault/ecos-vault.db"), meta_path: raiz.join("vault/ecos-vault.meta.json"), backups_dir: raiz.join("backups") });
        std::fs::create_dir_all(raiz.join("vault")).unwrap();
        std::fs::create_dir_all(raiz.join("backups")).unwrap();
        routes::montar(AppState { db: VaultDb::trancado(), config })
    }

    async fn chamar(app: &Router, metodo: &str, uri: &str, corpo: Option<Value>) -> (StatusCode, Value) {
        let mut p = Request::builder().method(metodo).uri(uri).header("x-ecos-usuario", "ana");
        let body = match corpo {
            Some(c) => {
                p = p.header("content-type", "application/json");
                Body::from(c.to_string())
            }
            None => Body::empty(),
        };
        let r = app.clone().call(p.body(body).unwrap()).await.unwrap();
        let s = r.status();
        let b = to_bytes(r.into_body(), 1 << 20).await.unwrap();
        (s, serde_json::from_slice(&b).unwrap_or(Value::Null))
    }

    async fn ativar(app: &Router) {
        assert_eq!(chamar(app, "POST", "/vault/ativar", Some(json!({ "senha": "senha-financeiro-123" }))).await.0, StatusCode::OK);
    }

    async fn conta(app: &Router, nome: &str, saldo_inicial: i64) -> String {
        let (s, c) = chamar(app, "POST", "/vault/contas", Some(json!({ "nome": nome, "tipo": "corrente", "saldo_inicial_centavos": saldo_inicial }))).await;
        assert_eq!(s, StatusCode::OK, "{c}");
        c["id"].as_str().unwrap().to_string()
    }

    async fn lancar(app: &Router, conta_id: Option<&str>, tipo: &str, valor: i64, data: &str, status: &str, categoria: Option<&str>) -> String {
        let (s, t) = chamar(app, "POST", "/vault/transacoes", Some(json!({ "tipo": tipo, "valor_centavos": valor, "data": data, "descricao": format!("{tipo} {data}"), "conta_id": conta_id, "status": status, "categoria_id": categoria }))).await;
        assert_eq!(s, StatusCode::OK, "{t}");
        t["id"].as_str().unwrap().to_string()
    }

    async fn fechar(app: &Router, de: &str, ate: &str) -> Value {
        let (s, v) = chamar(app, "GET", &format!("/vault/fechamento?data_de={de}&data_ate={ate}"), None).await;
        assert_eq!(s, StatusCode::OK, "{v}");
        v
    }

    fn linha<'a>(v: &'a Value, id: &str) -> &'a Value {
        v["contas"].as_array().unwrap().iter().find(|c| c["conta_id"] == id).unwrap()
    }

    #[test]
    fn so_um_mes_inteiro_do_calendario_pode_ser_conferido() {
        let d = |s: &str| s.parse().unwrap();
        assert_eq!(super::mes_do_periodo(d("2026-10-01"), d("2026-10-31")).as_deref(), Some("2026-10"));
        assert_eq!(super::mes_do_periodo(d("2024-02-01"), d("2024-02-29")).as_deref(), Some("2024-02"));
        assert_eq!(super::mes_do_periodo(d("2026-12-01"), d("2026-12-31")).as_deref(), Some("2026-12"));
        assert_eq!(super::mes_do_periodo(d("2026-10-02"), d("2026-10-31")), None);
        assert_eq!(super::mes_do_periodo(d("2026-10-01"), d("2026-10-30")), None);
        assert_eq!(super::mes_do_periodo(d("2026-01-01"), d("2026-12-31")), None);
    }

    #[tokio::test]
    async fn extrato_por_conta_soma_so_efetivadas_e_parte_do_saldo_anterior() {
        let app = app();
        ativar(&app).await;
        let a = conta(&app, "Banco A", 100_000).await;
        let b = conta(&app, "Banco B", 0).await;
        lancar(&app, Some(&a), "entrada", 20_000, "2026-09-30", "efetivada", None).await; // antes do mês: vai para o saldo inicial
        lancar(&app, Some(&a), "entrada", 50_000, "2026-10-05", "efetivada", None).await;
        lancar(&app, Some(&a), "saida", 10_000, "2026-10-10", "efetivada", None).await;
        lancar(&app, Some(&a), "saida", 5_000, "2026-10-15", "pendente", None).await; // pendente: fora dos números
        lancar(&app, Some(&a), "entrada", 7_000, "2026-11-02", "efetivada", None).await; // depois do mês: fora
        lancar(&app, Some(&b), "saida", 3_000, "2026-10-20", "efetivada", None).await;

        let v = fechar(&app, "2026-10-01", "2026-10-31").await;
        assert_eq!(v["mes"], "2026-10");
        let la = linha(&v, &a);
        assert_eq!((la["saldo_inicial"].as_i64(), la["entradas"].as_i64(), la["saidas"].as_i64(), la["saldo_final"].as_i64(), la["lancamentos"].as_i64()), (Some(120_000), Some(50_000), Some(10_000), Some(160_000), Some(2)));
        let lb = linha(&v, &b);
        assert_eq!((lb["saldo_inicial"].as_i64(), lb["saldo_final"].as_i64()), (Some(0), Some(-3_000)));
        assert_eq!(v["totais"], json!({ "saldo_inicial": 120_000, "entradas": 50_000, "saidas": 13_000, "transferencias": 0, "resultado": 37_000, "saldo_final": 157_000 }));
        assert_eq!(v["pendencias"]["pendentes"]["quantidade"], 1);
        assert_eq!(v["pendencias"]["pendentes"]["valor_centavos"], 5_000);

        // Sem lançamento sem conta, não há linha "Sem conta".
        assert_eq!(v["contas"].as_array().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn lancamento_sem_conta_ganha_linha_propria_e_vira_pendencia() {
        let app = app();
        ativar(&app).await;
        let a = conta(&app, "Banco A", 0).await;
        lancar(&app, Some(&a), "entrada", 1_000, "2026-10-02", "efetivada", None).await;
        lancar(&app, None, "saida", 400, "2026-10-03", "efetivada", None).await;

        let v = fechar(&app, "2026-10-01", "2026-10-31").await;
        let sem = v["contas"].as_array().unwrap().iter().find(|c| c["conta_id"].is_null()).unwrap();
        assert_eq!((sem["nome"].as_str(), sem["saidas"].as_i64(), sem["saldo_final"].as_i64()), (Some("Sem conta"), Some(400), Some(-400)));
        assert_eq!(v["pendencias"]["sem_conta"]["quantidade"], 1);
        assert_eq!(v["pendencias"]["sem_categoria"]["quantidade"], 2);
        assert_eq!(v["pendencias"]["sem_comprovante"]["quantidade"], 2);
        assert_eq!(v["pendencias"]["nao_conciliadas"]["quantidade"], 2);
        assert_eq!(v["pendencias"]["sem_conta"]["itens"].as_array().unwrap().len(), 1);
        assert_eq!(v["pendencias"]["rascunhos"], 0);
    }

    #[tokio::test]
    async fn categorias_somam_entradas_e_saidas_separadas() {
        let app = app();
        ativar(&app).await;
        let a = conta(&app, "Banco A", 0).await;
        let (_, cats) = chamar(&app, "POST", "/vault/categorias", Some(json!({ "nome": "Mensalidades", "tipo": "entrada", "cor": "#00ff00" }))).await;
        let cat = cats["id"].as_str().unwrap().to_string();
        lancar(&app, Some(&a), "entrada", 300_000, "2026-10-05", "efetivada", Some(&cat)).await;
        lancar(&app, Some(&a), "entrada", 350_000, "2026-10-06", "efetivada", Some(&cat)).await;
        lancar(&app, Some(&a), "saida", 90_000, "2026-10-07", "efetivada", None).await;

        let v = fechar(&app, "2026-10-01", "2026-10-31").await;
        let cs = v["categorias"].as_array().unwrap();
        let mens = cs.iter().find(|c| c["categoria_id"] == cat.as_str()).unwrap();
        assert_eq!((mens["tipo"].as_str(), mens["nome"].as_str(), mens["valor"].as_i64(), mens["lancamentos"].as_i64()), (Some("entrada"), Some("Mensalidades"), Some(650_000), Some(2)));
        let sem = cs.iter().find(|c| c["categoria_id"].is_null()).unwrap();
        assert_eq!((sem["tipo"].as_str(), sem["valor"].as_i64()), (Some("saida"), Some(90_000)));
        assert_eq!(v["pendencias"]["sem_categoria"]["quantidade"], 1);
    }

    #[tokio::test]
    async fn conferencia_com_o_banco_guarda_o_saldo_e_mostra_a_diferenca() {
        let app = app();
        ativar(&app).await;
        let a = conta(&app, "Banco A", 100_000).await;
        lancar(&app, Some(&a), "entrada", 50_000, "2026-10-05", "efetivada", None).await;

        // Banco diz 150.000 e o Cofre calcula 150.000: sem diferença.
        let (s, _) = chamar(&app, "PUT", "/vault/fechamento/conferencia", Some(json!({ "mes": "2026-10", "conta_id": a, "saldo_banco_centavos": 150_000 }))).await;
        assert_eq!(s, StatusCode::OK);
        let v = fechar(&app, "2026-10-01", "2026-10-31").await;
        let l = linha(&v, &a);
        assert_eq!((l["saldo_banco"].as_i64(), l["diferenca"].as_i64(), l["conferido_por"].as_str()), (Some(150_000), Some(0), Some("ana")));

        // Corrigir o valor mostra a diferença (banco − Cofre).
        chamar(&app, "PUT", "/vault/fechamento/conferencia", Some(json!({ "mes": "2026-10", "conta_id": a, "saldo_banco_centavos": 149_000 }))).await;
        let v = fechar(&app, "2026-10-01", "2026-10-31").await;
        assert_eq!(linha(&v, &a)["diferenca"].as_i64(), Some(-1_000));

        // Outro mês não herda a conferência, e um período que não é um mês não tem conferência.
        let nov = fechar(&app, "2026-11-01", "2026-11-30").await;
        assert!(linha(&nov, &a)["saldo_banco"].is_null());
        let ano = fechar(&app, "2026-01-01", "2026-12-31").await;
        assert!(ano["mes"].is_null() && linha(&ano, &a)["saldo_banco"].is_null());

        // Nulo apaga.
        chamar(&app, "PUT", "/vault/fechamento/conferencia", Some(json!({ "mes": "2026-10", "conta_id": a, "saldo_banco_centavos": null }))).await;
        let v = fechar(&app, "2026-10-01", "2026-10-31").await;
        assert!(linha(&v, &a)["saldo_banco"].is_null() && linha(&v, &a)["diferenca"].is_null());
    }

    #[tokio::test]
    async fn conferencia_recusa_mes_invalido_conta_inexistente_e_saldo_absurdo() {
        let app = app();
        ativar(&app).await;
        let a = conta(&app, "Banco A", 0).await;
        let put = |corpo: Value| {
            let app = app.clone();
            async move { chamar(&app, "PUT", "/vault/fechamento/conferencia", Some(corpo)).await.0 }
        };
        assert_eq!(put(json!({ "mes": "2026-13", "conta_id": a, "saldo_banco_centavos": 1 })).await, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(put(json!({ "mes": "outubro", "conta_id": a, "saldo_banco_centavos": 1 })).await, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(put(json!({ "mes": "2026-10", "conta_id": a, "saldo_banco_centavos": 1_000_000_000_000_000_i64 })).await, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(put(json!({ "mes": "2026-10", "conta_id": "nao-existe", "saldo_banco_centavos": 1 })).await, StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn periodo_invertido_e_recusado() {
        let app = app();
        ativar(&app).await;
        let (s, _) = chamar(&app, "GET", "/vault/fechamento?data_de=2026-10-31&data_ate=2026-10-01", None).await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    }

    fn banco_de_lucros() -> rusqlite::Connection {
        let mut c = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::migrar_para_teste(&mut c);
        for (id, nome, pai) in [("cl", "Distribuição de lucros", None), ("cs", "Lucros - Ana", Some("cl")), ("outra", "Aluguel", None)] {
            c.execute("INSERT INTO categoria (id, nome, tipo, cor, espaco, pai_id) VALUES (?1, ?2, 'saida', '#fff', 'pessoal', ?3)", rusqlite::params![id, nome, pai]).unwrap();
        }
        c.execute("INSERT INTO categoria (id, nome, tipo, cor, espaco) VALUES ('ent', 'Mensalidades', 'entrada', '#fff', 'pessoal')", []).unwrap();
        c.execute("INSERT INTO beneficiario (id, nome) VALUES ('b1', 'Ana Souza'), ('b2', 'Bruno Lima')", []).unwrap();
        let tx = |id: &str, tipo: &str, valor: i64, data: &str, status: &str, cat: &str, ben: Option<&str>| {
            c.execute("INSERT INTO transacao (id, tipo, valor_centavos, data, descricao, categoria_id, beneficiario_id, status, espaco, criado_por) VALUES (?1, ?2, ?3, ?4, ?1, ?5, ?6, ?7, 'pessoal', 'ana')", rusqlite::params![id, tipo, valor, data, cat, ben, status]).unwrap();
        };
        tx("t1", "saida", 100_000, "2026-10-05", "efetivada", "cl", Some("b1")); // com recibo
        tx("t2", "saida", 50_000, "2026-10-10", "efetivada", "cs", Some("b2")); // subcategoria, sem recibo (só comprovante)
        tx("t3", "saida", 20_000, "2026-10-12", "pendente", "cl", Some("b1")); // pendente: na lista, fora dos totais
        tx("t4", "saida", 70_000, "2026-11-05", "efetivada", "cl", Some("b1")); // outro mês
        tx("t5", "saida", 9_000, "2026-10-06", "efetivada", "outra", Some("b1")); // outra categoria
        tx("t6", "entrada", 5_000, "2026-10-07", "efetivada", "cl", Some("b1")); // entrada não é distribuição
        let anexo = |id: &str, t: &str, tipo: &str| {
            c.execute("INSERT INTO anexo (id, transacao_id, nome_arquivo, mime_type, tamanho_bytes, checksum_sha256, conteudo, tipo) VALUES (?1, ?2, 'a.pdf', 'application/pdf', 1, ?1, x'00', ?3)", rusqlite::params![id, t, tipo]).unwrap();
        };
        anexo("a1", "t1", "recibo_lucros");
        anexo("a2", "t2", "comprovante");
        anexo("a3", "t3", "recibo_lucros");
        c.execute("INSERT INTO fechamento_config (chave, valor) VALUES ('categoria_lucros', 'cl')", []).unwrap();
        c
    }

    #[test]
    fn lucros_do_mes_contam_so_saidas_efetivadas_da_categoria_e_das_filhas() {
        let c = banco_de_lucros();
        let v = super::fechamento(&c, "2026-10-01".parse().unwrap(), "2026-10-31".parse().unwrap()).unwrap();
        let l = &v["lucros"];
        assert_eq!((l["configurada"].as_bool(), l["categoria_nome"].as_str()), (Some(true), Some("Distribuição de lucros")));
        assert_eq!((l["quantidade"].as_i64(), l["valor_centavos"].as_i64(), l["sem_recibo"].as_i64(), l["pendentes"].as_i64()), (Some(2), Some(150_000), Some(1), Some(1)));
        let itens = l["itens"].as_array().unwrap();
        let ids: Vec<&str> = itens.iter().map(|i| i["id"].as_str().unwrap()).collect();
        assert_eq!(ids, ["t1", "t2", "t3"], "ordem por data; fora do mês, de outra categoria e entradas não entram");
        assert_eq!(itens[0]["recibos"].as_i64(), Some(1));
        assert_eq!((itens[1]["recibos"].as_i64(), itens[1]["outros_anexos"].as_i64()), (Some(0), Some(1)), "comprovante de pagamento não vale como recibo");
        assert_eq!(itens[2]["status"], "pendente");
        // O mês seguinte só tem o lançamento de novembro, sem recibo.
        let nov = super::fechamento(&c, "2026-11-01".parse().unwrap(), "2026-11-30".parse().unwrap()).unwrap();
        assert_eq!((nov["lucros"]["quantidade"].as_i64(), nov["lucros"]["sem_recibo"].as_i64()), (Some(1), Some(1)));
    }

    #[test]
    fn categoria_de_lucros_apagada_volta_a_nao_configurada() {
        let c = banco_de_lucros();
        c.execute_batch("PRAGMA foreign_keys = OFF; DELETE FROM categoria WHERE id = 'cl'").unwrap(); // o Cofre real não liga foreign_keys
        let v = super::fechamento(&c, "2026-10-01".parse().unwrap(), "2026-10-31".parse().unwrap()).unwrap();
        assert_eq!(v["lucros"]["configurada"], false);
        assert_eq!(v["lucros"]["itens"].as_array().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn escolha_da_categoria_de_lucros_pela_rota() {
        let app = app();
        ativar(&app).await;
        let v = fechar(&app, "2026-10-01", "2026-10-31").await;
        assert_eq!(v["lucros"]["configurada"], false);
        assert!(chamar(&app, "GET", "/vault/fechamento/config", None).await.1["categoria_lucros_id"].is_null());

        let (_, saida) = chamar(&app, "POST", "/vault/categorias", Some(json!({ "nome": "Distribuição de lucros", "tipo": "saida", "cor": "#aa00aa" }))).await;
        let (_, entrada) = chamar(&app, "POST", "/vault/categorias", Some(json!({ "nome": "Mensalidades", "tipo": "entrada", "cor": "#00aa00" }))).await;
        let (saida, entrada) = (saida["id"].as_str().unwrap().to_string(), entrada["id"].as_str().unwrap().to_string());
        let put = |corpo: Value| {
            let app = app.clone();
            async move { chamar(&app, "PUT", "/vault/fechamento/lucros", Some(corpo)).await.0 }
        };
        assert_eq!(put(json!({ "categoria_id": entrada })).await, StatusCode::UNPROCESSABLE_ENTITY, "categoria só de entrada não serve");
        assert_eq!(put(json!({ "categoria_id": "nao-existe" })).await, StatusCode::NOT_FOUND);
        assert_eq!(put(json!({ "categoria_id": saida })).await, StatusCode::OK);
        let (_, filha) = chamar(&app, "POST", "/vault/categorias", Some(json!({ "nome": "Lucros - Ana", "tipo": "saida", "cor": "#aa00aa", "pai_id": saida }))).await;
        let config = chamar(&app, "GET", "/vault/fechamento/config", None).await.1;
        assert_eq!(config["categoria_lucros_id"], saida.as_str());
        let mut todas: Vec<String> = config["categorias_lucros"].as_array().unwrap().iter().map(|x| x.as_str().unwrap().to_string()).collect();
        todas.sort();
        let mut esperado = vec![saida.clone(), filha["id"].as_str().unwrap().to_string()];
        esperado.sort();
        assert_eq!(todas, esperado, "a categoria e as subcategorias dela");
        let v = fechar(&app, "2026-10-01", "2026-10-31").await;
        assert_eq!((v["lucros"]["configurada"].as_bool(), v["lucros"]["categoria_nome"].as_str()), (Some(true), Some("Distribuição de lucros")));

        assert_eq!(put(json!({ "categoria_id": null })).await, StatusCode::OK);
        assert!(chamar(&app, "GET", "/vault/fechamento/config", None).await.1["categoria_lucros_id"].is_null());
    }

    async fn categoria(app: &Router, nome: &str, tipo: &str, pai: Option<&str>) -> String {
        let (s, c) = chamar(app, "POST", "/vault/categorias", Some(json!({ "nome": nome, "tipo": tipo, "cor": "#336699", "pai_id": pai }))).await;
        assert_eq!(s, StatusCode::OK, "{c}");
        c["id"].as_str().unwrap().to_string()
    }

    #[tokio::test]
    async fn transferencia_entre_contas_proprias_nao_infla_entradas_nem_saidas_e_fecha_o_saldo() {
        let app = app();
        ativar(&app).await;
        let a = conta(&app, "Banco A", 100_000).await;
        let b = conta(&app, "Banco B", 0).await;
        let transf = categoria(&app, "Transferência entre contas", "ambos", None).await;
        let filha = categoria(&app, "Transferência - aplicação", "ambos", Some(&transf)).await;
        let mens = categoria(&app, "Mensalidades", "entrada", None).await;
        lancar(&app, Some(&a), "entrada", 50_000, "2026-10-05", "efetivada", Some(&mens)).await;
        lancar(&app, Some(&a), "saida", 30_000, "2026-10-10", "efetivada", Some(&transf)).await; // A → B
        lancar(&app, Some(&b), "entrada", 30_000, "2026-10-10", "efetivada", Some(&filha)).await; // chegou em B (subcategoria)
        lancar(&app, Some(&a), "saida", 1_000, "2026-10-11", "efetivada", None).await;

        // Sem escolher a categoria, a transferência conta como entrada e saída comuns.
        let antes = fechar(&app, "2026-10-01", "2026-10-31").await;
        assert_eq!((antes["totais"]["entradas"].as_i64(), antes["totais"]["saidas"].as_i64()), (Some(80_000), Some(31_000)));
        assert_eq!(antes["transferencias"]["configurada"], false);

        let (s, _) = chamar(&app, "PUT", "/vault/fechamento/transferencias", Some(json!({ "categoria_ids": [transf] }))).await;
        assert_eq!(s, StatusCode::OK);
        let v = fechar(&app, "2026-10-01", "2026-10-31").await;
        assert_eq!((v["totais"]["entradas"].as_i64(), v["totais"]["saidas"].as_i64(), v["totais"]["resultado"].as_i64()), (Some(50_000), Some(1_000), Some(49_000)));
        assert_eq!((v["totais"]["transferencias"].as_i64(), v["totais"]["saldo_final"].as_i64()), (Some(0), Some(149_000)));
        let la = linha(&v, &a);
        assert_eq!((la["entradas"].as_i64(), la["saidas"].as_i64(), la["transferencias"].as_i64(), la["saldo_final"].as_i64()), (Some(50_000), Some(1_000), Some(-30_000), Some(119_000)));
        let lb = linha(&v, &b);
        assert_eq!((lb["entradas"].as_i64(), lb["transferencias"].as_i64(), lb["saldo_final"].as_i64()), (Some(0), Some(30_000), Some(30_000)));
        let t = &v["transferencias"];
        assert_eq!((t["configurada"].as_bool(), t["quantidade"].as_i64(), t["entradas"].as_i64(), t["saidas"].as_i64(), t["equilibrada"].as_bool()), (Some(true), Some(2), Some(30_000), Some(30_000), Some(true)));
        // Fora do resultado por categoria, e sem cobrar comprovante.
        assert!(v["categorias"].as_array().unwrap().iter().all(|c| c["categoria_id"] != transf.as_str() && c["categoria_id"] != filha.as_str()));
        assert_eq!(v["pendencias"]["sem_comprovante"]["quantidade"], 2);

        // Só um lado lançado: o bloco avisa que não fecha.
        lancar(&app, Some(&a), "saida", 700, "2026-10-20", "efetivada", Some(&transf)).await;
        let v = fechar(&app, "2026-10-01", "2026-10-31").await;
        assert_eq!((v["transferencias"]["liquido"].as_i64(), v["transferencias"]["equilibrada"].as_bool()), (Some(-700), Some(false)));
        assert_eq!(v["totais"]["saldo_final"].as_i64(), Some(148_300));

        // O saldo do mês seguinte parte do que a transferência já moveu.
        let nov = fechar(&app, "2026-11-01", "2026-11-30").await;
        assert_eq!(linha(&nov, &a)["saldo_inicial"].as_i64(), Some(118_300));
        assert_eq!(linha(&nov, &b)["saldo_inicial"].as_i64(), Some(30_000));
    }

    #[tokio::test]
    async fn escolha_das_categorias_de_transferencia_valida_e_nao_colide_com_lucros() {
        let app = app();
        ativar(&app).await;
        let transf = categoria(&app, "Transferência", "ambos", None).await;
        let lucros = categoria(&app, "Distribuição de lucros", "saida", None).await;
        let put = |corpo: Value| {
            let app = app.clone();
            async move { chamar(&app, "PUT", "/vault/fechamento/transferencias", Some(corpo)).await.0 }
        };
        assert_eq!(put(json!({ "categoria_ids": ["nao-existe"] })).await, StatusCode::NOT_FOUND);
        assert_eq!(put(json!({ "categoria_ids": [transf, transf] })).await, StatusCode::OK, "repetida é ignorada");
        let config = chamar(&app, "GET", "/vault/fechamento/config", None).await.1;
        assert_eq!(config["categorias_transferencia"], json!([transf]));

        // Lucros e transferência são excludentes nos dois sentidos.
        assert_eq!(put(json!({ "categoria_ids": [transf, lucros] })).await, StatusCode::OK);
        assert_eq!(chamar(&app, "PUT", "/vault/fechamento/lucros", Some(json!({ "categoria_id": lucros }))).await.0, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(put(json!({ "categoria_ids": [transf] })).await, StatusCode::OK);
        assert_eq!(chamar(&app, "PUT", "/vault/fechamento/lucros", Some(json!({ "categoria_id": lucros }))).await.0, StatusCode::OK);
        assert_eq!(put(json!({ "categoria_ids": [lucros] })).await, StatusCode::UNPROCESSABLE_ENTITY);

        // Lista vazia desfaz; categoria apagada some da configuração sem quebrar o fechamento.
        assert_eq!(put(json!({ "categoria_ids": [] })).await, StatusCode::OK);
        assert_eq!(chamar(&app, "GET", "/vault/fechamento/config", None).await.1["categorias_transferencia"], json!([]));
        assert_eq!(put(json!({ "categoria_ids": [transf] })).await, StatusCode::OK);
        assert_eq!(chamar(&app, "DELETE", &format!("/vault/categorias/{transf}"), None).await.0, StatusCode::OK);
        assert_eq!(fechar(&app, "2026-10-01", "2026-10-31").await["transferencias"]["configurada"], false);
    }

    #[tokio::test]
    async fn rota_do_pacote_devolve_um_zip_para_baixar_e_recusa_periodo_invertido() {
        let app = app();
        ativar(&app).await;
        let a = conta(&app, "Banco A", 0).await;
        lancar(&app, Some(&a), "entrada", 1_000, "2026-10-02", "efetivada", None).await;
        let pedir = |de: &'static str, ate: &'static str| {
            let app = app.clone();
            async move { app.clone().call(Request::builder().method("GET").uri(format!("/vault/fechamento/pacote?data_de={de}&data_ate={ate}")).header("x-ecos-usuario", "ana").body(Body::empty()).unwrap()).await.unwrap() }
        };
        let r = pedir("2026-10-01", "2026-10-31").await;
        assert_eq!(r.status(), StatusCode::OK);
        assert_eq!(r.headers()["content-type"], "application/zip");
        assert_eq!(r.headers()["content-disposition"], "attachment; filename=\"fechamento-2026-10.zip\"");
        assert_eq!(r.headers()["x-content-type-options"], "nosniff");
        let bytes = to_bytes(r.into_body(), 1 << 20).await.unwrap();
        assert_eq!(&bytes[..4], &0x0403_4B50u32.to_le_bytes(), "começa com a assinatura de arquivo local do zip");
        let ano = pedir("2026-01-01", "2026-12-31").await;
        assert_eq!(ano.headers()["content-disposition"], "attachment; filename=\"fechamento-2026-01-01_a_2026-12-31.zip\"");
        assert_eq!(pedir("2026-10-31", "2026-10-01").await.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    async fn abertura(app: &Router, conta_id: &str, data: &str, saldo: Option<i64>) -> StatusCode {
        chamar(app, "PUT", "/vault/fechamento/abertura", Some(json!({ "conta_id": conta_id, "data": data, "saldo_centavos": saldo }))).await.0
    }

    #[tokio::test]
    async fn abertura_troca_o_saldo_inicial_do_cadastro_e_encadeia_entre_os_periodos() {
        let app = app();
        ativar(&app).await;
        let a = conta(&app, "Banco A", 100_000).await;
        lancar(&app, Some(&a), "entrada", 20_000, "2026-09-30", "efetivada", None).await;
        lancar(&app, Some(&a), "entrada", 50_000, "2026-10-05", "efetivada", None).await;
        lancar(&app, Some(&a), "saida", 10_000, "2026-10-10", "efetivada", None).await;
        lancar(&app, Some(&a), "saida", 3_000, "2026-10-12", "pendente", None).await; // pendente nunca entra
        lancar(&app, Some(&a), "entrada", 7_000, "2026-11-02", "efetivada", None).await;
        let inicial = |v: &Value| (linha(v, &a)["saldo_inicial"].as_i64().unwrap(), linha(v, &a)["saldo_final"].as_i64().unwrap());

        // Sem abertura, parte do cadastro da conta e dos lançamentos anteriores.
        let v = fechar(&app, "2026-10-01", "2026-10-31").await;
        assert_eq!(inicial(&v), (120_000, 160_000));
        assert!(linha(&v, &a)["abertura"].is_null());
        assert_eq!(linha(&v, &a)["saldo_inicial_cadastrado"], 100_000);

        // O extrato do banco dizia 90.000 no começo de outubro: o saldo passa a partir dele.
        assert_eq!(abertura(&app, &a, "2026-10-01", Some(90_000)).await, StatusCode::OK);
        let v = fechar(&app, "2026-10-01", "2026-10-31").await;
        assert_eq!(inicial(&v), (90_000, 130_000));
        let l = linha(&v, &a);
        assert_eq!((l["abertura"]["data"].as_str(), l["abertura"]["saldo"].as_i64(), l["abertura"]["por"].as_str(), l["abertura_neste_periodo"].as_bool()), (Some("2026-10-01"), Some(90_000), Some("ana"), Some(true)));
        assert_eq!(l["saldo_inicial_cadastrado"], 100_000, "o cadastro da conta não muda");
        assert_eq!(v["totais"]["saldo_inicial"], 90_000);

        // Novembro herda a abertura de outubro e soma o que veio depois dela (outubro inteiro: +50.000 -10.000).
        let nov = fechar(&app, "2026-11-01", "2026-11-30").await;
        assert_eq!(inicial(&nov), (130_000, 137_000));
        assert_eq!(linha(&nov, &a)["abertura_neste_periodo"], false);
        // Um intervalo anterior à abertura continua usando o cadastro.
        assert_eq!(inicial(&fechar(&app, "2026-09-01", "2026-09-30").await).0, 100_000);

        // Uma abertura nova em novembro vale dali em diante e não mexe em outubro.
        assert_eq!(abertura(&app, &a, "2026-11-01", Some(135_000)).await, StatusCode::OK);
        assert_eq!(inicial(&fechar(&app, "2026-11-01", "2026-11-30").await), (135_000, 142_000));
        assert_eq!(inicial(&fechar(&app, "2026-10-01", "2026-10-31").await).0, 90_000);
        // Período que começa no meio do mês também parte da abertura mais recente antes dele.
        assert_eq!(inicial(&fechar(&app, "2026-10-08", "2026-10-31").await).0, 140_000);

        // O saldo do banco conferido em outubro vira sugestão de abertura para novembro.
        chamar(&app, "PUT", "/vault/fechamento/conferencia", Some(json!({ "mes": "2026-10", "conta_id": a, "saldo_banco_centavos": 130_500 }))).await;
        let nov = fechar(&app, "2026-11-01", "2026-11-30").await;
        assert_eq!((linha(&nov, &a)["saldo_banco_anterior"].as_i64(), linha(&nov, &a)["mes_anterior"].as_str()), (Some(130_500), Some("2026-10")));
        assert!(linha(&fechar(&app, "2026-11-05", "2026-11-30").await, &a)["saldo_banco_anterior"].is_null(), "só vale quando o período começa no dia 1");

        // Remover a abertura de novembro volta a encadear a de outubro.
        assert_eq!(abertura(&app, &a, "2026-11-01", None).await, StatusCode::OK);
        assert_eq!(inicial(&fechar(&app, "2026-11-01", "2026-11-30").await).0, 130_000);
    }

    #[tokio::test]
    async fn abertura_recusa_data_invalida_conta_inexistente_e_saldo_absurdo_e_some_com_a_conta() {
        let app = app();
        ativar(&app).await;
        let a = conta(&app, "Banco A", 0).await;
        assert_eq!(abertura(&app, &a, "01/10/2026", Some(1)).await, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(abertura(&app, &a, "2026-10-01", Some(i64::MAX)).await, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(abertura(&app, "nao-existe", "2026-10-01", Some(1)).await, StatusCode::NOT_FOUND);
        assert_eq!(abertura(&app, &a, "2026-10-01", Some(500)).await, StatusCode::OK);
        assert_eq!(abertura(&app, &a, "2026-10-01", Some(700)).await, StatusCode::OK, "regravar o mesmo dia substitui");
        assert_eq!(linha(&fechar(&app, "2026-10-01", "2026-10-31").await, &a)["saldo_inicial"], 700);
        assert_eq!(chamar(&app, "DELETE", &format!("/vault/contas/{a}"), None).await.0, StatusCode::OK);
        let b = conta(&app, "Banco B", 0).await;
        assert!(linha(&fechar(&app, "2026-10-01", "2026-10-31").await, &b)["abertura"].is_null());
    }

    #[tokio::test]
    async fn rota_do_resumo_em_pdf_devolve_so_o_pdf_para_baixar() {
        let app = app();
        ativar(&app).await;
        let a = conta(&app, "Banco A", 0).await;
        lancar(&app, Some(&a), "entrada", 1_000, "2026-10-02", "efetivada", None).await;
        let pedir = |de: &'static str, ate: &'static str| {
            let app = app.clone();
            async move { app.clone().call(Request::builder().method("GET").uri(format!("/vault/fechamento/resumo.pdf?data_de={de}&data_ate={ate}")).header("x-ecos-usuario", "ana").body(Body::empty()).unwrap()).await.unwrap() }
        };
        let r = pedir("2026-10-01", "2026-10-31").await;
        assert_eq!(r.status(), StatusCode::OK);
        assert_eq!(r.headers()["content-type"], "application/pdf");
        assert_eq!(r.headers()["content-disposition"], "attachment; filename=\"resumo-fechamento-2026-10.pdf\"");
        assert_eq!(r.headers()["x-content-type-options"], "nosniff");
        assert!(r.headers()["cache-control"].to_str().unwrap().contains("no-store"));
        let bytes = to_bytes(r.into_body(), 4 << 20).await.unwrap();
        assert!(bytes.starts_with(b"%PDF-1.4") && bytes.ends_with(b"%%EOF\n"));
        let outro = pedir("2026-10-05", "2026-10-20").await;
        assert_eq!(outro.headers()["content-disposition"], "attachment; filename=\"resumo-fechamento-2026-10-05_a_2026-10-20.pdf\"");
        assert_eq!(pedir("2026-10-31", "2026-10-01").await.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[tokio::test]
    async fn lista_de_lancamentos_traz_todos_os_efetivados_do_periodo_sem_as_contas_de_fora() {
        let app = app();
        ativar(&app).await;
        let a = conta(&app, "Banco A", 0).await;
        let b = conta(&app, "Caixa B", 0).await;
        lancar(&app, Some(&a), "saida", 2_500, "2026-10-09", "efetivada", None).await;
        lancar(&app, Some(&a), "entrada", 9_000, "2026-10-02", "efetivada", None).await;
        lancar(&app, Some(&b), "saida", 300, "2026-10-05", "efetivada", None).await;
        lancar(&app, None, "saida", 100, "2026-10-06", "efetivada", None).await;
        lancar(&app, Some(&a), "saida", 700, "2026-10-07", "pendente", None).await;
        lancar(&app, Some(&a), "saida", 800, "2026-11-01", "efetivada", None).await;
        let (s, v) = chamar(&app, "GET", "/vault/fechamento/lancamentos?data_de=2026-10-01&data_ate=2026-10-31", None).await;
        assert_eq!(s, StatusCode::OK);
        let datas: Vec<&str> = v["lancamentos"].as_array().unwrap().iter().map(|l| l["data"].as_str().unwrap()).collect();
        assert_eq!(datas, vec!["2026-10-02", "2026-10-05", "2026-10-06", "2026-10-09"]);
        assert_eq!(v["lancamentos"][0]["conta"], "Banco A");
        assert_eq!(v["lancamentos"][0]["tipo"], "entrada");
        assert_eq!(v["lancamentos"][2]["conta"], "Sem conta");
        assert_eq!(v["cortado"], false);

        chamar(&app, "PUT", "/vault/fechamento/contas", Some(json!({ "fora": [b] }))).await;
        let (_, v) = chamar(&app, "GET", "/vault/fechamento/lancamentos?data_de=2026-10-01&data_ate=2026-10-31", None).await;
        assert_eq!(v["lancamentos"].as_array().unwrap().len(), 3);
        assert!(v["lancamentos"].as_array().unwrap().iter().all(|l| l["conta"] != "Caixa B"));
        assert_eq!(chamar(&app, "GET", "/vault/fechamento/lancamentos?data_de=2026-10-31&data_ate=2026-10-01", None).await.0, StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[tokio::test]
    async fn periodo_que_ainda_nao_terminou_vem_marcado_como_em_andamento() {
        let app = app();
        ativar(&app).await;
        assert_eq!(fechar(&app, "2026-10-01", "2026-10-31").await["em_andamento"], false);
        assert_eq!(fechar(&app, "2099-01-01", "2099-01-31").await["em_andamento"], true);
    }

    #[tokio::test]
    async fn conta_fora_do_fechamento_some_dos_numeros_das_pendencias_e_do_pacote_mas_continua_na_lista() {
        let app = app();
        ativar(&app).await;
        let a = conta(&app, "Banco A", 1_000).await;
        let b = conta(&app, "Caixa B", 5_000).await;
        lancar(&app, Some(&a), "entrada", 10_000, "2026-10-02", "efetivada", None).await;
        lancar(&app, Some(&b), "saida", 3_000, "2026-10-03", "efetivada", None).await;
        lancar(&app, Some(&b), "saida", 700, "2026-10-04", "pendente", None).await;
        let antes = fechar(&app, "2026-10-01", "2026-10-31").await;
        assert_eq!(antes["contas"].as_array().unwrap().len(), 2);
        assert_eq!(antes["totais"]["saidas"], 3_000);
        assert_eq!(antes["pendencias"]["pendentes"]["quantidade"], 1);

        let (s, _) = chamar(&app, "PUT", "/vault/fechamento/contas", Some(json!({ "fora": [b, b] }))).await;
        assert_eq!(s, StatusCode::OK);
        let v = fechar(&app, "2026-10-01", "2026-10-31").await;
        let ids: Vec<&str> = v["contas"].as_array().unwrap().iter().filter_map(|c| c["conta_id"].as_str()).collect();
        assert_eq!(ids, vec![a.as_str()]);
        assert_eq!(v["totais"]["entradas"], 10_000);
        assert_eq!(v["totais"]["saidas"], 0);
        assert_eq!(v["totais"]["saldo_inicial"], 1_000);
        assert_eq!(v["pendencias"]["pendentes"]["quantidade"], 0);
        assert_eq!(v["pendencias"]["sem_categoria"]["quantidade"], 1);
        assert!(v["categorias"].as_array().unwrap().iter().all(|c| c["tipo"] != "saida"));
        // A lista para escolher continua com as duas, a de fora marcada.
        let todas = v["todas_as_contas"].as_array().unwrap();
        assert_eq!(todas.len(), 2);
        assert_eq!(todas.iter().find(|c| c["id"] == b.as_str()).unwrap()["fora"], true);
        assert_eq!(todas.iter().find(|c| c["id"] == a.as_str()).unwrap()["fora"], false);

        assert_eq!(chamar(&app, "PUT", "/vault/fechamento/contas", Some(json!({ "fora": ["nao-existe"] }))).await.0, StatusCode::NOT_FOUND);
        // Conta nova entra sozinha; lista vazia traz todas de volta.
        let c = conta(&app, "Conta C", 0).await;
        assert!(linha(&fechar(&app, "2026-10-01", "2026-10-31").await, &c)["conta_id"] == c.as_str());
        assert_eq!(chamar(&app, "PUT", "/vault/fechamento/contas", Some(json!({ "fora": [] }))).await.0, StatusCode::OK);
        let volta = fechar(&app, "2026-10-01", "2026-10-31").await;
        assert_eq!(volta["contas"].as_array().unwrap().len(), 3);
        assert_eq!(volta["totais"]["saidas"], 3_000);
        // Apagar a conta de fora não deixa rastro na configuração.
        chamar(&app, "PUT", "/vault/fechamento/contas", Some(json!({ "fora": [c] }))).await;
        assert_eq!(chamar(&app, "DELETE", &format!("/vault/contas/{c}"), None).await.0, StatusCode::OK);
        assert!(fechar(&app, "2026-10-01", "2026-10-31").await["todas_as_contas"].as_array().unwrap().iter().all(|c| c["fora"] == false));
    }

    #[tokio::test]
    async fn apagar_a_conta_apaga_a_conferencia_dela() {
        let app = app();
        ativar(&app).await;
        let a = conta(&app, "Banco A", 0).await;
        chamar(&app, "PUT", "/vault/fechamento/conferencia", Some(json!({ "mes": "2026-10", "conta_id": a, "saldo_banco_centavos": 100 }))).await;
        assert_eq!(chamar(&app, "DELETE", &format!("/vault/contas/{a}"), None).await.0, StatusCode::OK);
        let b = conta(&app, "Banco B", 0).await;
        let v = fechar(&app, "2026-10-01", "2026-10-31").await;
        assert!(linha(&v, &b)["saldo_banco"].is_null());
        assert!(v["contas"].as_array().unwrap().iter().all(|c| c["conta_id"] != a.as_str()));
    }
}
