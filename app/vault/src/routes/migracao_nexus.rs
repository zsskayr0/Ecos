//! `POST /vault/migracao/nexus` — migração assistida do Nexus para o Cofre.
//!
//! Recebe o pacote no formato do script de migração do Nexus (`categories`, `payees`, `accounts`,
//! `recurringTransactions`, `transactions`, `pendingItems`, `recurringExclusions`) mais `attachments` opcionais, e roda
//! **sempre o mesmo caminho** dentro de uma transação:
//!
//! - `dry_run: true` — processa tudo, devolve o relatório e **descarta** a transação (o banco não muda);
//! - `dry_run: false` + `confirmar` — tira um backup cifrado antes, processa e só confirma se não houve nenhum erro.
//!   Qualquer erro (referência ausente, enum inválido…) desfaz tudo: nada é gravado pela metade.
//!
//! Idempotência: `migracao_origem` guarda origem→destino. Reaplicar não duplica; o mesmo vale para entidades que já
//! existem no Cofre (casam por nome) e lançamentos iguais já cadastrados (casam por data, tipo, valor, descrição e
//! conta, contados como multiconjunto para não confundir dois pagamentos legítimos iguais do próprio pacote).

use std::collections::{HashMap, HashSet};

use axum::extract::State;
use axum::Json;
use base64::Engine as _;
use chrono::{NaiveDate, Utc};
use ecos_core::types::ANEXO_TAMANHO_MAXIMO_BYTES;
use ecos_core::{new_id, ErrorCode};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::arquivo::{detectar_tipo, nome_seguro, sha256_hex};
use crate::error::{AppError, AppResult};
use crate::routes::ativacao::usuario;
use crate::state::AppState;

/// Frase que o cliente envia para aplicar de verdade (a simulação não precisa dela).
pub const FRASE_CONFIRMACAO: &str = "MIGRAR NEXUS";
const ORIGEM: &str = "nexus";
const LIMITE_REGISTROS: usize = 50_000;

#[derive(Debug, Deserialize)]
pub struct Requisicao {
    pub dry_run: bool,
    #[serde(default)]
    pub confirmar: Option<String>,
    #[serde(default)]
    pub dados: Pacote,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Pacote {
    pub categories: Vec<Cat>,
    pub payees: Vec<Pagador>,
    pub accounts: Vec<ContaNx>,
    pub recurring_transactions: Vec<Rec>,
    pub transactions: Vec<Tx>,
    pub pending_items: Vec<Pend>,
    pub recurring_exclusions: Vec<Exclusao>,
    pub attachments: Vec<Anexo>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Cat {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub tipo: String,
    pub icon: Option<String>,
    pub color: Option<String>,
}
#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Pagador {
    pub id: String,
    pub name: String,
    pub document: Option<String>,
    pub notes: Option<String>,
}
#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ContaNx {
    pub id: String,
    pub name: String,
    pub bank: Option<String>,
    pub agency: Option<String>,
    pub account_number: Option<String>,
    pub color: Option<String>,
}
#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Rec {
    pub id: String,
    #[serde(rename = "type")]
    pub tipo: String,
    pub description: String,
    pub amount_cents: i64,
    pub category_id: Option<String>,
    pub payee_id: Option<String>,
    pub account_id: Option<String>,
    pub payment_method: Option<String>,
    pub recurrence_kind: String,
    pub frequency: String,
    pub interval_count: Option<i64>,
    pub due_day: Option<i64>,
    pub start_date: String,
    pub end_date: Option<String>,
    pub total_installments: Option<i64>,
    pub installments_generated: Option<i64>,
    pub notes: Option<String>,
    pub is_active: Option<bool>,
}
#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Tx {
    pub id: String,
    #[serde(rename = "type")]
    pub tipo: String,
    pub amount_cents: i64,
    pub currency: Option<String>,
    pub occurred_at: String,
    pub description: String,
    pub category_id: Option<String>,
    pub payee_id: Option<String>,
    pub account_id: Option<String>,
    pub payment_method: Option<String>,
    pub notes: Option<String>,
    pub source: Option<String>,
    pub ocr_raw_text: Option<String>,
    pub ocr_confidence: Option<f64>,
    pub recurring_transaction_id: Option<String>,
    pub is_reconciled: Option<bool>,
}
#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Pend {
    pub id: String,
    #[serde(rename = "type")]
    pub tipo: String,
    pub description: String,
    pub amount_cents: i64,
    pub category_id: Option<String>,
    pub payee_id: Option<String>,
    pub recurring_transaction_id: Option<String>,
    pub notes: Option<String>,
}
#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Exclusao {
    pub recurring_transaction_id: String,
    pub occurrence_date: String,
}
#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Anexo {
    pub id: String,
    pub transaction_id: String,
    pub file_name: String,
    pub content_base64: Option<String>,
    pub checksum_sha256: Option<String>,
}

#[derive(Default)]
struct Contagem {
    recebidas: usize,
    criadas: usize,
    reaproveitadas: usize,
    ja_migradas: usize,
    ignoradas: usize,
    com_erro: usize,
}

impl Contagem {
    fn json(&self) -> Value {
        json!({ "recebidas": self.recebidas, "criadas": self.criadas, "reaproveitadas": self.reaproveitadas, "ja_migradas": self.ja_migradas, "ignoradas": self.ignoradas, "com_erro": self.com_erro })
    }
}

#[derive(Default)]
struct Relatorio {
    contagens: Vec<(&'static str, Contagem)>,
    erros: Vec<Value>,
    avisos: Vec<String>,
    origem_qtd: i64,
    origem_entradas: i64,
    origem_saidas: i64,
    criadas_qtd: i64,
    criadas_entradas: i64,
    criadas_saidas: i64,
}

struct Totais {
    qtd: i64,
    entradas: i64,
    saidas: i64,
    anexos: i64,
}

fn totais(c: &Connection) -> rusqlite::Result<Totais> {
    let (qtd, entradas, saidas) = c.query_row(
        "SELECT COUNT(*), COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor_centavos END),0), COALESCE(SUM(CASE WHEN tipo='saida' THEN valor_centavos END),0) FROM transacao",
        [],
        |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?)),
    )?;
    let anexos = c.query_row("SELECT COUNT(*) FROM anexo", [], |r| r.get(0))?;
    Ok(Totais { qtd, entradas, saidas, anexos })
}

fn data_valida(s: &str) -> Option<String> {
    let base = if s.len() > 10 && matches!(s.as_bytes()[10], b'T' | b' ') { &s[..10] } else { s };
    NaiveDate::parse_from_str(base, "%Y-%m-%d").ok().filter(|d| d.to_string() == base).map(|d| d.to_string())
}

fn tipo_fluxo(s: &str) -> Option<&'static str> {
    match s {
        "income" | "entrada" => Some("entrada"),
        "expense" | "saida" => Some("saida"),
        _ => None,
    }
}

fn cor_valida(cor: &Option<String>, padrao: &str) -> String {
    match cor {
        Some(c) if c.starts_with('#') && matches!(c.len(), 4 | 7) && c[1..].chars().all(|h| h.is_ascii_hexdigit()) => c.clone(),
        _ => padrao.to_string(),
    }
}

fn texto_opcional(s: &Option<String>, max: usize) -> Option<String> {
    s.as_ref().map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).map(|t| t.chars().take(max).collect())
}

struct Ctx<'a> {
    c: &'a Connection,
    autor: &'a str,
    /// (tabela, id de origem) → id no Cofre.
    mapa: HashMap<(&'static str, String), String>,
    /// Destinos já ocupados por um item deste pacote (ou de uma execução anterior): base do casamento por multiconjunto.
    usados: HashSet<String>,
    rel: Relatorio,
}

impl<'a> Ctx<'a> {
    fn cont(&mut self, tabela: &'static str) -> &mut Contagem {
        if let Some(i) = self.rel.contagens.iter().position(|(t, _)| *t == tabela) {
            return &mut self.rel.contagens[i].1;
        }
        self.rel.contagens.push((tabela, Contagem::default()));
        &mut self.rel.contagens.last_mut().expect("acabou de inserir").1
    }

    fn erro(&mut self, tabela: &'static str, id: &str, msg: impl Into<String>) {
        self.cont(tabela).com_erro += 1;
        self.rel.erros.push(json!({ "tabela": tabela, "id": id, "erro": msg.into() }));
    }

    fn registrar(&mut self, tabela: &'static str, origem_id: &str, destino: &str) -> rusqlite::Result<()> {
        self.c.execute(
            "INSERT INTO migracao_origem (origem, tabela, origem_id, destino_id) VALUES (?1, ?2, ?3, ?4)",
            params![ORIGEM, tabela, origem_id, destino],
        )?;
        self.mapa.insert((tabela, origem_id.to_string()), destino.to_string());
        self.usados.insert(destino.to_string());
        Ok(())
    }

    /// `Ok(None)` = sem referência; `Err` = aponta para algo que não está no pacote nem foi migrado antes.
    fn referencia(&self, tabela: &'static str, id: &Option<String>, rotulo: &str) -> Result<Option<String>, String> {
        match id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            None => Ok(None),
            Some(i) => self.mapa.get(&(tabela, i.to_string())).cloned().map(Some).ok_or_else(|| format!("{rotulo} \"{i}\" não existe no pacote nem foi migrada antes")),
        }
    }

    fn forma_ok(&self, forma: &Option<String>) -> Result<Option<String>, String> {
        match texto_opcional(forma, 64) {
            None => Ok(None),
            Some(f) if crate::routes::formas_pagamento::existe(self.c, &f) => Ok(Some(f)),
            Some(f) => Err(format!("forma de pagamento desconhecida: {f}")),
        }
    }

    /// Primeiro destino livre entre os que casam com a consulta (multiconjunto).
    fn casar_livre(&self, sql: &str, p: &[&dyn rusqlite::ToSql]) -> rusqlite::Result<Option<String>> {
        let mut stmt = self.c.prepare(sql)?;
        let ids = stmt.query_map(p, |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
        Ok(ids.into_iter().find(|i| !self.usados.contains(i)))
    }
}

fn nome_ok(s: &str) -> Option<String> {
    let n = s.trim();
    (!n.is_empty() && n.chars().count() <= 200).then(|| n.to_string())
}

fn processar(c: &Connection, p: &Pacote, autor: &str) -> rusqlite::Result<Relatorio> {
    let mut ctx = Ctx { c, autor, mapa: HashMap::new(), usados: HashSet::new(), rel: Relatorio::default() };
    {
        let mut stmt = c.prepare("SELECT tabela, origem_id, destino_id FROM migracao_origem WHERE origem = ?1")?;
        let linhas = stmt.query_map([ORIGEM], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))?.collect::<Result<Vec<_>, _>>()?;
        for (tabela, origem, destino) in linhas {
            let t: &'static str = match tabela.as_str() {
                "categorias" => "categorias",
                "beneficiarios" => "beneficiarios",
                "contas" => "contas",
                "recorrencias" => "recorrencias",
                "lancamentos" => "lancamentos",
                "pendencias" => "pendencias",
                "anexos" => "anexos",
                _ => continue,
            };
            ctx.usados.insert(destino.clone());
            ctx.mapa.insert((t, origem), destino);
        }
    }

    // Categorias, pagadores e contas casam por nome: várias origens podem apontar para o mesmo destino.
    for x in &p.categories {
        ctx.cont("categorias").recebidas += 1;
        if ctx.mapa.contains_key(&("categorias", x.id.clone())) {
            ctx.cont("categorias").ja_migradas += 1;
            continue;
        }
        let (Some(nome), false) = (nome_ok(&x.name), x.id.trim().is_empty()) else { ctx.erro("categorias", &x.id, "id ou nome ausente"); continue };
        let Some(tipo) = (match x.tipo.as_str() { "both" | "ambos" => Some("ambos"), t => tipo_fluxo(t) }) else {
            ctx.erro("categorias", &x.id, format!("tipo desconhecido: {}", x.tipo));
            continue;
        };
        let existente: Option<String> = c.query_row("SELECT id FROM categoria WHERE lower(trim(nome)) = lower(?1) AND espaco = 'pessoal' ORDER BY id LIMIT 1", [&nome], |r| r.get(0)).optional()?;
        match existente {
            Some(d) => {
                ctx.registrar("categorias", &x.id, &d)?;
                ctx.cont("categorias").reaproveitadas += 1;
            }
            None => {
                let d = new_id();
                c.execute(
                    "INSERT INTO categoria (id, nome, tipo, icone, cor, padrao, espaco, criado_por) VALUES (?1, ?2, ?3, ?4, ?5, 0, 'pessoal', ?6)",
                    params![d, nome, tipo, texto_opcional(&x.icon, 64), cor_valida(&x.color, "#8f8f96"), ctx.autor],
                )?;
                ctx.registrar("categorias", &x.id, &d)?;
                ctx.cont("categorias").criadas += 1;
            }
        }
    }

    for x in &p.payees {
        ctx.cont("beneficiarios").recebidas += 1;
        if ctx.mapa.contains_key(&("beneficiarios", x.id.clone())) {
            ctx.cont("beneficiarios").ja_migradas += 1;
            continue;
        }
        let (Some(nome), false) = (nome_ok(&x.name), x.id.trim().is_empty()) else { ctx.erro("beneficiarios", &x.id, "id ou nome ausente"); continue };
        let existente: Option<String> = c.query_row("SELECT id FROM beneficiario WHERE lower(trim(nome)) = lower(?1) ORDER BY id LIMIT 1", [&nome], |r| r.get(0)).optional()?;
        match existente {
            Some(d) => {
                ctx.registrar("beneficiarios", &x.id, &d)?;
                ctx.cont("beneficiarios").reaproveitadas += 1;
            }
            None => {
                let d = new_id();
                c.execute("INSERT INTO beneficiario (id, nome, documento, observacoes, criado_por) VALUES (?1, ?2, ?3, ?4, ?5)", params![d, nome, texto_opcional(&x.document, 40), texto_opcional(&x.notes, 2000), ctx.autor])?;
                ctx.registrar("beneficiarios", &x.id, &d)?;
                ctx.cont("beneficiarios").criadas += 1;
            }
        }
    }

    for x in &p.accounts {
        ctx.cont("contas").recebidas += 1;
        if ctx.mapa.contains_key(&("contas", x.id.clone())) {
            ctx.cont("contas").ja_migradas += 1;
            continue;
        }
        let (Some(nome), false) = (nome_ok(&x.name), x.id.trim().is_empty()) else { ctx.erro("contas", &x.id, "id ou nome ausente"); continue };
        let existente: Option<String> = c.query_row("SELECT id FROM conta WHERE lower(trim(nome)) = lower(?1) AND espaco = 'pessoal' ORDER BY id LIMIT 1", [&nome], |r| r.get(0)).optional()?;
        match existente {
            Some(d) => {
                ctx.registrar("contas", &x.id, &d)?;
                ctx.cont("contas").reaproveitadas += 1;
            }
            None => {
                let d = new_id();
                c.execute(
                    "INSERT INTO conta (id, nome, banco, agencia, numero_conta, cor, espaco, padrao, criado_por) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pessoal', 0, ?7)",
                    params![d, nome, texto_opcional(&x.bank, 120), texto_opcional(&x.agency, 40), texto_opcional(&x.account_number, 40), cor_valida(&x.color, "#8f8f96"), ctx.autor],
                )?;
                ctx.registrar("contas", &x.id, &d)?;
                ctx.cont("contas").criadas += 1;
            }
        }
    }

    for x in &p.recurring_transactions {
        ctx.cont("recorrencias").recebidas += 1;
        if ctx.mapa.contains_key(&("recorrencias", x.id.clone())) {
            ctx.cont("recorrencias").ja_migradas += 1;
            continue;
        }
        let resolvido = (|| -> Result<_, String> {
            if x.id.trim().is_empty() {
                return Err("id ausente".into());
            }
            let descricao = nome_ok(&x.description).ok_or("descrição ausente")?;
            let tipo = tipo_fluxo(&x.tipo).ok_or_else(|| format!("tipo desconhecido: {}", x.tipo))?;
            if x.amount_cents <= 0 || x.amount_cents > 9_000_000_000_000 {
                return Err("valor inválido".into());
            }
            let kind = match x.recurrence_kind.as_str() { "fixed" | "fixa" => "fixa", "installment" | "parcelada" => "parcelada", o => return Err(format!("tipo de recorrência desconhecido: {o}")) };
            let freq = match x.frequency.as_str() { "weekly" | "semanal" => "semanal", "monthly" | "mensal" => "mensal", "yearly" | "anual" => "anual", o => return Err(format!("frequência desconhecida: {o}")) };
            let intervalo = x.interval_count.unwrap_or(1);
            if !(1..=1200).contains(&intervalo) || x.due_day.is_some_and(|d| !(1..=31).contains(&d)) || x.total_installments.is_some_and(|n| n <= 0 || n > 10_000) {
                return Err("intervalo, vencimento ou parcelas inválidos".into());
            }
            if kind == "parcelada" && x.total_installments.is_none() {
                return Err("recorrência parcelada sem total de parcelas".into());
            }
            let inicio = data_valida(&x.start_date).ok_or("data de início inválida")?;
            let fim = match &x.end_date { Some(f) if !f.trim().is_empty() => Some(data_valida(f).ok_or("data de término inválida")?), _ => None };
            if fim.as_ref().is_some_and(|f| *f < inicio) {
                return Err("término antes do início".into());
            }
            let cat = ctx.referencia("categorias", &x.category_id, "categoria")?;
            let ben = ctx.referencia("beneficiarios", &x.payee_id, "pagador")?;
            let conta = ctx.referencia("contas", &x.account_id, "conta")?;
            let forma = ctx.forma_ok(&x.payment_method)?;
            Ok((descricao, tipo, kind, freq, intervalo, inicio, fim, cat, ben, conta, forma))
        })();
        let (descricao, tipo, kind, freq, intervalo, inicio, fim, cat, ben, conta, forma) = match resolvido {
            Ok(v) => v,
            Err(e) => { ctx.erro("recorrencias", &x.id, e); continue; }
        };
        let igual = ctx.casar_livre(
            "SELECT id FROM transacao_recorrente WHERE tipo = ?1 AND lower(trim(descricao)) = lower(?2) AND valor_centavos = ?3 AND data_inicio = ?4 ORDER BY id",
            &[&tipo, &descricao, &x.amount_cents, &inicio],
        )?;
        if let Some(d) = igual {
            ctx.registrar("recorrencias", &x.id, &d)?;
            ctx.cont("recorrencias").reaproveitadas += 1;
            continue;
        }
        let d = new_id();
        let geradas = x.installments_generated.unwrap_or(0).max(0);
        c.execute(
            "INSERT INTO transacao_recorrente (id, tipo, descricao, valor_centavos, categoria_id, conta_id, beneficiario_id, forma_pagamento, \
             tipo_recorrencia, frequencia, intervalo, dia_vencimento, data_inicio, data_fim, total_parcelas, parcelas_geradas, ocorrencias_legadas, \
             observacoes, espaco, ativa, criado_por) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?16,?17,'pessoal',?18,?19)",
            params![d, tipo, descricao, x.amount_cents, cat, conta, ben, forma, kind, freq, intervalo, x.due_day, inicio, fim, x.total_installments, geradas, texto_opcional(&x.notes, 2000), x.is_active.unwrap_or(true), ctx.autor],
        )?;
        ctx.registrar("recorrencias", &x.id, &d)?;
        ctx.cont("recorrencias").criadas += 1;
    }

    // Multiconjunto: o que já estava no Cofre antes (e não veio desta migração) pode absorver um lançamento igual do pacote.
    let limite = crate::routes::transacoes::limite_para_efetivar().to_string();
    for x in &p.transactions {
        ctx.cont("lancamentos").recebidas += 1;
        if ctx.mapa.contains_key(&("lancamentos", x.id.clone())) {
            ctx.cont("lancamentos").ja_migradas += 1;
            continue;
        }
        let resolvido = (|| -> Result<_, String> {
            if x.id.trim().is_empty() {
                return Err("id ausente".into());
            }
            let descricao = nome_ok(&x.description).ok_or("descrição ausente ou longa demais")?;
            let tipo = tipo_fluxo(&x.tipo).ok_or_else(|| format!("tipo desconhecido: {}", x.tipo))?;
            if x.amount_cents <= 0 || x.amount_cents > 9_000_000_000_000 {
                return Err("valor inválido".into());
            }
            let data = data_valida(&x.occurred_at).ok_or("data inválida")?;
            let moeda = texto_opcional(&x.currency, 3).unwrap_or_else(|| "BRL".into());
            let cat = ctx.referencia("categorias", &x.category_id, "categoria")?;
            let ben = ctx.referencia("beneficiarios", &x.payee_id, "pagador")?;
            let conta = ctx.referencia("contas", &x.account_id, "conta")?;
            let rec = ctx.referencia("recorrencias", &x.recurring_transaction_id, "recorrência")?;
            let forma = ctx.forma_ok(&x.payment_method)?;
            let origem = match x.source.as_deref().unwrap_or("manual") {
                "manual" => "manual",
                "share_intent" | "gallery" | "captura_camera" => "captura_camera",
                "recurring_generated" | "recorrencia_gerada" => "recorrencia_gerada",
                o => return Err(format!("origem desconhecida: {o}")),
            };
            Ok((descricao, tipo, data, moeda, cat, ben, conta, rec, forma, origem))
        })();
        let (descricao, tipo, data, moeda, cat, ben, conta, rec, forma, origem) = match resolvido {
            Ok(v) => v,
            Err(e) => { ctx.erro("lancamentos", &x.id, e); continue; }
        };
        ctx.rel.origem_qtd += 1;
        if tipo == "entrada" { ctx.rel.origem_entradas += x.amount_cents } else { ctx.rel.origem_saidas += x.amount_cents }
        let igual = ctx.casar_livre(
            "SELECT id FROM transacao WHERE data = ?1 AND tipo = ?2 AND valor_centavos = ?3 AND lower(trim(descricao)) = lower(?4) AND COALESCE(conta_id,'') = COALESCE(?5,'') ORDER BY id",
            &[&data, &tipo, &x.amount_cents, &descricao, &conta],
        )?;
        if let Some(d) = igual {
            ctx.registrar("lancamentos", &x.id, &d)?;
            ctx.cont("lancamentos").reaproveitadas += 1;
            continue;
        }
        let d = new_id();
        let status = if data > limite { "pendente" } else { "efetivada" };
        c.execute(
            "INSERT INTO transacao (id, tipo, valor_centavos, moeda, data, descricao, categoria_id, conta_id, beneficiario_id, forma_pagamento, status, observacoes, \
             origem, ocr_texto_bruto, ocr_confianca, transacao_recorrente_id, data_ocorrencia, conciliada, espaco, criado_por) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,'pessoal',?19)",
            params![d, tipo, x.amount_cents, moeda, data, descricao, cat, conta, ben, forma, status, texto_opcional(&x.notes, 4000), origem,
                    texto_opcional(&x.ocr_raw_text, 20_000), x.ocr_confidence, rec, rec.as_ref().map(|_| data.clone()), x.is_reconciled.unwrap_or(false), ctx.autor],
        )?;
        if let Some(r) = &rec {
            // Mesmo registro que a migration 0002 fez para o legado: o job não recria essa ocorrência.
            c.execute("INSERT OR IGNORE INTO ocorrencia_processada (recorrencia_id, data_ocorrencia, transacao_id) VALUES (?1, ?2, ?3)", params![r, data, d])?;
        }
        ctx.registrar("lancamentos", &x.id, &d)?;
        ctx.cont("lancamentos").criadas += 1;
        ctx.rel.criadas_qtd += 1;
        if tipo == "entrada" { ctx.rel.criadas_entradas += x.amount_cents } else { ctx.rel.criadas_saidas += x.amount_cents }
    }

    for x in &p.pending_items {
        ctx.cont("pendencias").recebidas += 1;
        if ctx.mapa.contains_key(&("pendencias", x.id.clone())) {
            ctx.cont("pendencias").ja_migradas += 1;
            continue;
        }
        let resolvido = (|| -> Result<_, String> {
            if x.id.trim().is_empty() {
                return Err("id ausente".into());
            }
            let descricao = nome_ok(&x.description).ok_or("descrição ausente")?;
            let tipo = tipo_fluxo(&x.tipo).ok_or_else(|| format!("tipo desconhecido: {}", x.tipo))?;
            if x.amount_cents <= 0 || x.amount_cents > 9_000_000_000_000 {
                return Err("valor inválido".into());
            }
            let cat = ctx.referencia("categorias", &x.category_id, "categoria")?;
            let ben = ctx.referencia("beneficiarios", &x.payee_id, "pagador")?;
            let rec = ctx.referencia("recorrencias", &x.recurring_transaction_id, "recorrência")?;
            Ok((descricao, tipo, cat, ben, rec))
        })();
        let (descricao, tipo, cat, ben, rec) = match resolvido {
            Ok(v) => v,
            Err(e) => { ctx.erro("pendencias", &x.id, e); continue; }
        };
        let igual = ctx.casar_livre(
            "SELECT id FROM pendencia_avulsa WHERE tipo = ?1 AND lower(trim(descricao)) = lower(?2) AND valor_centavos = ?3 ORDER BY id",
            &[&tipo, &descricao, &x.amount_cents],
        )?;
        if let Some(d) = igual {
            ctx.registrar("pendencias", &x.id, &d)?;
            ctx.cont("pendencias").reaproveitadas += 1;
            continue;
        }
        let d = new_id();
        c.execute(
            "INSERT INTO pendencia_avulsa (id, tipo, descricao, valor_centavos, categoria_id, beneficiario_id, transacao_recorrente_id, observacoes, espaco, criado_por) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'pessoal',?9)",
            params![d, tipo, descricao, x.amount_cents, cat, ben, rec, texto_opcional(&x.notes, 2000), ctx.autor],
        )?;
        ctx.registrar("pendencias", &x.id, &d)?;
        ctx.cont("pendencias").criadas += 1;
    }

    for x in &p.recurring_exclusions {
        ctx.cont("exclusoes").recebidas += 1;
        let id = format!("{}@{}", x.recurring_transaction_id, x.occurrence_date);
        let Some(rec) = ctx.mapa.get(&("recorrencias", x.recurring_transaction_id.clone())).cloned() else {
            ctx.erro("exclusoes", &id, "recorrência não existe no pacote nem foi migrada antes");
            continue;
        };
        let Some(data) = data_valida(&x.occurrence_date) else { ctx.erro("exclusoes", &id, "data inválida"); continue };
        let n = c.execute("INSERT OR IGNORE INTO recorrencia_exclusao (transacao_recorrente_id, data_ocorrencia) VALUES (?1, ?2)", params![rec, data])?;
        if n == 1 { ctx.cont("exclusoes").criadas += 1 } else { ctx.cont("exclusoes").ja_migradas += 1 }
    }

    for x in &p.attachments {
        ctx.cont("anexos").recebidas += 1;
        if ctx.mapa.contains_key(&("anexos", x.id.clone())) {
            ctx.cont("anexos").ja_migradas += 1;
            continue;
        }
        if x.id.trim().is_empty() {
            ctx.erro("anexos", &x.id, "id ausente");
            continue;
        }
        let Some(tx_destino) = ctx.mapa.get(&("lancamentos", x.transaction_id.clone())).cloned() else {
            ctx.erro("anexos", &x.id, format!("lançamento \"{}\" não existe no pacote nem foi migrado antes", x.transaction_id));
            continue;
        };
        let Some(b64) = x.content_base64.as_deref().filter(|s| !s.is_empty()) else {
            ctx.cont("anexos").ignoradas += 1;
            ctx.rel.avisos.push(format!("Anexo \"{}\": o arquivo não veio no pacote e não foi migrado.", x.file_name));
            continue;
        };
        let bytes = match base64::engine::general_purpose::STANDARD.decode(b64) {
            Ok(b) if !b.is_empty() && b.len() as i64 <= ANEXO_TAMANHO_MAXIMO_BYTES => b,
            Ok(_) => { ctx.erro("anexos", &x.id, "arquivo vazio ou acima do limite"); continue; }
            Err(_) => { ctx.erro("anexos", &x.id, "conteúdo não é base64 válido"); continue; }
        };
        let checksum = sha256_hex(&bytes);
        if x.checksum_sha256.as_deref().is_some_and(|dado| !dado.eq_ignore_ascii_case(&checksum)) {
            ctx.erro("anexos", &x.id, "checksum não confere com o conteúdo");
            continue;
        }
        let Some(tipo) = detectar_tipo(&bytes) else { ctx.erro("anexos", &x.id, "tipo de arquivo não aceito (JPEG, PNG, WebP, HEIC ou PDF)"); continue };
        let existente: Option<String> = c.query_row("SELECT id FROM anexo WHERE transacao_id = ?1 AND checksum_sha256 = ?2", params![tx_destino, checksum], |r| r.get(0)).optional()?;
        match existente {
            Some(d) => {
                ctx.registrar("anexos", &x.id, &d)?;
                ctx.cont("anexos").reaproveitadas += 1;
            }
            None => {
                let d = new_id();
                c.execute(
                    "INSERT INTO anexo (id, transacao_id, nome_arquivo, mime_type, tamanho_bytes, checksum_sha256, conteudo, tipo) VALUES (?1,?2,?3,?4,?5,?6,?7,'comprovante')",
                    params![d, tx_destino, nome_seguro(&x.file_name, tipo.extensao), tipo.mime, bytes.len() as i64, checksum, bytes],
                )?;
                ctx.registrar("anexos", &x.id, &d)?;
                ctx.cont("anexos").criadas += 1;
            }
        }
    }

    Ok(ctx.rel)
}

fn relatorio_json(rel: &Relatorio, antes: &Totais, depois: &Totais, dry_run: bool, aplicado: bool, backup: Option<String>) -> Value {
    let confere = depois.qtd == antes.qtd + rel.criadas_qtd
        && depois.entradas == antes.entradas + rel.criadas_entradas
        && depois.saidas == antes.saidas + rel.criadas_saidas;
    let mut entidades = serde_json::Map::new();
    for (t, c) in &rel.contagens {
        entidades.insert((*t).to_string(), c.json());
    }
    json!({
        "dry_run": dry_run,
        "aplicado": aplicado,
        "backup": backup,
        "entidades": entidades,
        "erros": rel.erros,
        "avisos": rel.avisos,
        "verificacao": {
            "antes": { "lancamentos": antes.qtd, "entradas_centavos": antes.entradas, "saidas_centavos": antes.saidas, "anexos": antes.anexos },
            "depois": { "lancamentos": depois.qtd, "entradas_centavos": depois.entradas, "saidas_centavos": depois.saidas, "anexos": depois.anexos },
            "origem": { "lancamentos": rel.origem_qtd, "entradas_centavos": rel.origem_entradas, "saidas_centavos": rel.origem_saidas },
            "criados": { "lancamentos": rel.criadas_qtd, "entradas_centavos": rel.criadas_entradas, "saidas_centavos": rel.criadas_saidas },
            "confere": confere,
            "projetado": dry_run,
        },
    })
}

pub async fn nexus(State(state): State<AppState>, Json(req): Json<Requisicao>) -> AppResult<Json<Value>> {
    let d = &req.dados;
    let total = d.categories.len() + d.payees.len() + d.accounts.len() + d.recurring_transactions.len() + d.transactions.len() + d.pending_items.len() + d.recurring_exclusions.len() + d.attachments.len();
    if total == 0 || total > LIMITE_REGISTROS {
        return Err(AppError::new(ErrorCode::ValidationError).with_message("Envie entre 1 e 50.000 registros por vez"));
    }
    if !req.dry_run && req.confirmar.as_deref() != Some(FRASE_CONFIRMACAO) {
        return Err(AppError::new(ErrorCode::ConfirmationPhraseRequired));
    }
    let autor = crate::db::autor_atual().unwrap_or_default();
    let dry_run = req.dry_run;
    // Lotes só de anexos (arquivos grandes enviados um a um) não precisam de outra cópia: a do primeiro lote já cobre o antes.
    let so_anexos = total == d.attachments.len();
    let pacote = req.dados;
    let backup_path = if dry_run || so_anexos {
        None
    } else {
        let pasta = state.config.backups_de(&usuario()?);
        std::fs::create_dir_all(&pasta)?;
        Some(pasta.join(format!("pre-migracao-nexus-{}.enc", Utc::now().format("%Y%m%d-%H%M%S%3f"))))
    };
    let backup_para_sql = backup_path.clone();

    let (json, aplicado) = state
        .db
        .with(move |c| {
            // O backup sai antes de qualquer escrita e fora da transação (VACUUM não roda dentro dela).
            if let Some(destino) = &backup_para_sql {
                c.execute("VACUUM INTO ?1", [destino.to_string_lossy().to_string()])?;
            }
            let tx = c.unchecked_transaction()?;
            let antes = totais(&tx)?;
            let rel = processar(&tx, &pacote, &autor)?;
            let depois = totais(&tx)?;
            let aplicar = !dry_run && rel.erros.is_empty();
            let confere = depois.qtd == antes.qtd + rel.criadas_qtd && depois.entradas == antes.entradas + rel.criadas_entradas && depois.saidas == antes.saidas + rel.criadas_saidas;
            let aplicar = aplicar && confere;
            let nome = backup_para_sql.as_ref().and_then(|p| p.file_name()).map(|n| n.to_string_lossy().to_string());
            let json = relatorio_json(&rel, &antes, &depois, dry_run, aplicar, if aplicar { nome } else { None });
            if aplicar {
                tx.commit()?;
            }
            // Sem `commit`, a transação é descartada ao sair: simulação e migração com erro não deixam rastro.
            Ok((json, aplicar))
        })
        .await?;
    if let Some(p) = backup_path {
        if !aplicado {
            let _ = std::fs::remove_file(p);
        }
    }
    tracing::info!(simulacao = dry_run, aplicado, "migração do Nexus processada");
    Ok(Json(json))
}
