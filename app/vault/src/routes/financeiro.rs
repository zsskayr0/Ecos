use crate::{
    error::{AppError, AppResult},
    state::AppState,
};
use axum::{
    extract::{Query, State},
    Json,
};
use chrono::NaiveDate;
use ecos_core::{new_id, ErrorCode};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
pub struct Periodo {
    pub data_de: NaiveDate,
    pub data_ate: NaiveDate,
}
impl Periodo {
    pub fn validar(&self) -> AppResult<()> {
        if self.data_de > self.data_ate || (self.data_ate - self.data_de).num_days() > 3660 {
            return Err(AppError::new(ErrorCode::ValidationError)
                .with_message("Período inválido (máximo 10 anos)"));
        }
        Ok(())
    }
}

pub async fn painel(
    State(state): State<AppState>,
    Query(q): Query<Periodo>,
) -> AppResult<Json<Value>> {
    q.validar()?;
    let result = state.db.with(move |c| {
        let de=q.data_de.to_string(); let ate=q.data_ate.to_string();
        let (receitas,despesas): (i64,i64) = c.query_row("SELECT COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor_centavos ELSE 0 END),0),COALESCE(SUM(CASE WHEN tipo='saida' THEN valor_centavos ELSE 0 END),0) FROM transacao WHERE data BETWEEN ?1 AND ?2", [&de,&ate], |r| Ok((r.get(0)?,r.get(1)?)))?;
        let saldo: i64 = c.query_row("SELECT COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor_centavos ELSE -valor_centavos END),0) FROM transacao", [], |r| r.get(0))?;
        let mensal=(q.data_ate-q.data_de).num_days()>45;
        let agrupamento=if mensal {"substr(data,1,7)"} else {"data"};
        let mut stmt=c.prepare(&format!("SELECT {agrupamento},SUM(CASE WHEN tipo='entrada' THEN valor_centavos ELSE 0 END),SUM(CASE WHEN tipo='saida' THEN valor_centavos ELSE 0 END),SUM(CASE WHEN tipo='entrada' AND (status='efetivada' OR conciliada=1) THEN valor_centavos ELSE 0 END),SUM(CASE WHEN tipo='saida' AND (status='efetivada' OR conciliada=1) THEN valor_centavos ELSE 0 END) FROM transacao WHERE data BETWEEN ?1 AND ?2 GROUP BY 1 ORDER BY 1"))?;
        let series=stmt.query_map([&de,&ate], |r| Ok(json!({"data":r.get::<_,String>(0)?,"receitas":r.get::<_,i64>(1)?,"despesas":r.get::<_,i64>(2)?,"receitas_confirmadas":r.get::<_,i64>(3)?,"despesas_confirmadas":r.get::<_,i64>(4)?})))?.collect::<Result<Vec<_>,_>>()?;
        let grupos=|coluna: &str| -> rusqlite::Result<Vec<Value>> {
            let mut stmt=c.prepare(&format!("SELECT {coluna},SUM(valor_centavos) FROM transacao WHERE tipo='saida' AND data BETWEEN ?1 AND ?2 GROUP BY 1 ORDER BY 2 DESC"))?;
            let rows=stmt.query_map([&de,&ate], |r| Ok(json!({"chave":r.get::<_,Option<String>>(0)?,"valor":r.get::<_,i64>(1)?})))?.collect::<Result<Vec<_>,_>>()?;
            Ok(rows)
        };
        let categorias=grupos("categoria_id")?; let pagamentos=grupos("forma_pagamento")?;
        let maiores=|tipo: &str| -> rusqlite::Result<Vec<Value>> {
            let mut stmt=c.prepare("SELECT id,descricao,valor_centavos,data FROM transacao WHERE tipo=?1 AND data BETWEEN ?2 AND ?3 ORDER BY valor_centavos DESC,id LIMIT 5")?;
            let rows=stmt.query_map([tipo,&de,&ate], |r| Ok(json!({"id":r.get::<_,String>(0)?,"descricao":r.get::<_,String>(1)?,"valor":r.get::<_,i64>(2)?,"data":r.get::<_,String>(3)?})))?.collect::<Result<Vec<_>,_>>()?;
            Ok(rows)
        };
        Ok(json!({"saldo":saldo,"receitas":receitas,"despesas":despesas,"taxa_economia":if receitas>0 {Some((receitas-despesas) as f64/receitas as f64*100.0)} else {None},"series":series,"mensal":mensal,"categorias":categorias,"pagamentos":pagamentos,"maiores_entradas":maiores("entrada")?,"maiores_saidas":maiores("saida")?,"previsoes":super::fluxo::ocorrencias(c,q.data_de,q.data_ate)?}))
    }).await?;
    Ok(Json(result))
}

#[derive(Deserialize)]
pub struct Lote {
    pub ids: Vec<String>,
    pub acao: String,
}
pub async fn lote(State(state): State<AppState>, Json(p): Json<Lote>) -> AppResult<Json<Value>> {
    if p.ids.is_empty()
        || p.ids.len() > 1000
        || p.ids.iter().collect::<std::collections::HashSet<_>>().len() != p.ids.len()
        || !["conciliar", "desconciliar", "excluir", "efetivar"].contains(&p.acao.as_str())
    {
        return Err(AppError::new(ErrorCode::ValidationError)
            .with_message("Escolha de 1 a 1000 lançamentos e uma ação válida"));
    }
    let result=state.db.with(move |c| {
        let tx=c.unchecked_transaction()?;
        let mut errors=Vec::new();
        for (i,id) in p.ids.iter().enumerate() {
            let exists:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM transacao WHERE id=?1)",[id],|r|r.get(0))?;
            if !exists { errors.push(json!({"linha":i+1,"erro":"Lançamento não encontrado"})); }
        }
        if !errors.is_empty() { return Ok(json!({"aplicadas":0,"erros":errors})); }
        for id in &p.ids {
            if p.acao=="excluir" {
                tx.execute("DELETE FROM anexo WHERE transacao_id=?1",[id])?;
                tx.execute("DELETE FROM transacao WHERE id=?1",[id])?;
            } else if p.acao=="efetivar" {
                tx.execute("UPDATE transacao SET status='efetivada',conciliada=1,atualizado_em=datetime('now') WHERE id=?1",[id])?;
            } else { tx.execute("UPDATE transacao SET conciliada=?1,atualizado_em=datetime('now') WHERE id=?2",params![p.acao=="conciliar",id])?; }
        }
        tx.commit()?;
        Ok(json!({"aplicadas":p.ids.len(),"erros":[]}))
    }).await?;
    tracing::info!("operação financeira em lote processada");
    Ok(Json(result))
}

#[derive(Deserialize)]
pub struct LinhaImportacao {
    pub linha: usize,
    pub tipo: String,
    pub valor_centavos: i64,
    pub data: String,
    pub descricao: String,
    pub categoria: Option<String>,
    pub beneficiario: Option<String>,
    pub conta: Option<String>,
    pub forma_pagamento: Option<String>,
    pub observacoes: Option<String>,
    #[serde(default)]
    pub conciliada: bool,
    #[serde(default = "efetivada")]
    pub status: String,
}
fn efetivada() -> String {
    "efetivada".into()
}
#[derive(Deserialize)]
pub struct Importacao {
    pub linhas: Vec<LinhaImportacao>,
    pub dry_run: bool,
}
fn entidade(
    c: &Connection,
    tabela: &str,
    nome: &Option<String>,
    autor: &str,
) -> rusqlite::Result<Option<String>> {
    let Some(nome) = nome.as_ref().filter(|s| !s.trim().is_empty()) else {
        return Ok(None);
    };
    let existente = c
        .query_row(
            &format!("SELECT id FROM {tabela} WHERE nome=?1 ORDER BY id LIMIT 1"),
            [nome],
            |r| r.get::<_, String>(0),
        )
        .optional()?;
    if existente.is_some() {
        return Ok(existente);
    }
    let id = new_id();
    let sql = if tabela == "beneficiario" {
        format!("INSERT INTO {tabela}(id,nome,criado_por) VALUES(?1,?2,?3)")
    } else if tabela == "categoria" {
        format!("INSERT INTO {tabela}(id,nome,espaco,tipo,criado_por) VALUES(?1,?2,'pessoal','ambos',?3)")
    } else {
        format!("INSERT INTO {tabela}(id,nome,espaco,criado_por) VALUES(?1,?2,'pessoal',?3)")
    };
    c.execute(&sql, [&id, nome, autor])?;
    Ok(Some(id))
}
pub async fn importar(
    State(state): State<AppState>,
    Json(p): Json<Importacao>,
) -> AppResult<Json<Value>> {
    if p.linhas.is_empty() || p.linhas.len() > 10000 {
        return Err(AppError::new(ErrorCode::ValidationError)
            .with_message("Importe entre 1 e 10.000 linhas"));
    }
    let autor=crate::db::autor_atual().unwrap_or_default();
    let result=state.db.with(move |c| {
        let tx=c.unchecked_transaction()?;
        let mut erros=Vec::new(); let mut duplicadas=Vec::new(); let mut validas=Vec::new();
        let mut vistas=std::collections::HashSet::new();
        for l in p.linhas {
            if !["entrada","saida"].contains(&l.tipo.as_str()) || l.valor_centavos<=0 || l.valor_centavos>9_000_000_000_000 || !NaiveDate::parse_from_str(&l.data,"%Y-%m-%d").map(|d| d.to_string()==l.data).unwrap_or(false) || l.descricao.trim().is_empty() || l.descricao.len()>2000 || !["efetivada","pendente"].contains(&l.status.as_str()) || l.forma_pagamento.as_ref().is_some_and(|f| !["pix","pix_automatico","ted","cartao","dinheiro","boleto","outro"].contains(&f.as_str())) {
                erros.push(json!({"linha":l.linha,"erro":"Data, valor, descrição, tipo, status ou pagamento inválido"})); continue;
            }
            let chave=(l.data.clone(),l.tipo.clone(),l.valor_centavos,l.descricao.trim().to_lowercase(),l.conta.clone());
            let existe:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM transacao t LEFT JOIN conta c ON c.id=t.conta_id WHERE t.data=?1 AND t.tipo=?2 AND t.valor_centavos=?3 AND lower(trim(t.descricao))=lower(trim(?4)) AND COALESCE(c.nome,'')=COALESCE(?5,''))",params![l.data,l.tipo,l.valor_centavos,l.descricao,l.conta],|r|r.get(0))?;
            if existe || !vistas.insert(chave) { duplicadas.push(l.linha); } else { validas.push(l); }
        }
        let quantidade=validas.len();
        if !p.dry_run && erros.is_empty() {
            for l in validas {
                let categoria=entidade(&tx,"categoria",&l.categoria,&autor)?; let beneficiario=entidade(&tx,"beneficiario",&l.beneficiario,&autor)?; let conta=entidade(&tx,"conta",&l.conta,&autor)?;
                tx.execute("INSERT INTO transacao(id,tipo,valor_centavos,data,descricao,categoria_id,beneficiario_id,conta_id,forma_pagamento,observacoes,conciliada,status,espaco,criado_por) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,'pessoal',?13)",params![new_id(),l.tipo,l.valor_centavos,l.data,l.descricao,categoria,beneficiario,conta,l.forma_pagamento,l.observacoes,l.conciliada,l.status,autor])?;
            }
            tx.commit()?;
        }
        Ok(json!({"dry_run":p.dry_run,"validas":quantidade,"importadas":if !p.dry_run && erros.is_empty(){quantidade}else{0},"duplicadas":duplicadas,"erros":erros}))
    }).await?;
    tracing::info!("importação financeira validada");
    Ok(Json(result))
}

fn celula(s: &str) -> String {
    let seguro = if s.trim_start().starts_with(['=', '+', '-', '@', '\t', '\r']) {
        format!("'{s}")
    } else {
        s.to_string()
    };
    format!("\"{}\"", seguro.replace('"', "\"\""))
}
pub async fn exportar(
    State(state): State<AppState>,
    Query(q): Query<Periodo>,
) -> AppResult<Json<Value>> {
    q.validar()?;
    let csv=state.db.with(move |c| {
        let mut csv="\u{feff}Data;Descrição;Tipo;Valor;Categoria;Pagador/Recebedor;Conta;Forma de pagamento;Observações;Conciliada;Status\r\n".to_string();
        let mut stmt=c.prepare("SELECT t.data,t.descricao,t.tipo,t.valor_centavos,c.nome,b.nome,a.nome,t.forma_pagamento,t.observacoes,t.conciliada,t.status FROM transacao t LEFT JOIN categoria c ON c.id=t.categoria_id LEFT JOIN beneficiario b ON b.id=t.beneficiario_id LEFT JOIN conta a ON a.id=t.conta_id WHERE t.data BETWEEN ?1 AND ?2 ORDER BY t.data,t.id")?;
        let mut rows=stmt.query([q.data_de.to_string(),q.data_ate.to_string()])?;
        while let Some(r)=rows.next()? {
            let valor:i64=r.get(3)?;
            let mut cols=vec![r.get::<_,String>(0)?,r.get(1)?,r.get(2)?,format!("{},{:02}",valor/100,valor%100)];
            for i in 4..9 { cols.push(r.get::<_,Option<String>>(i)?.unwrap_or_default()); }
            cols.push(if r.get::<_,bool>(9)? {"sim"}else{"não"}.into()); cols.push(r.get(10)?);
            csv.push_str(&cols.iter().map(|s|celula(s)).collect::<Vec<_>>().join(";")); csv.push_str("\r\n");
        }
        Ok(csv)
    }).await?;
    Ok(Json(json!({"csv":csv})))
}

#[cfg(test)]
mod testes {
    use super::*;
    #[tokio::test]
    async fn painel_concilia_trinta_mil_lancamentos_sem_paginar_agregacao() {
        let raiz = std::env::temp_dir().join(format!("cofre-volume-{}", new_id()));
        let config = std::sync::Arc::new(crate::config::Config {
            porta: 0,
            db_path: raiz.join("vault.db"),
            meta_path: raiz.join("meta.json"),
            backups_dir: raiz.join("backups"),
        });
        let state = AppState {
            db: crate::db::VaultDb::trancado(),
            config,
        };
        crate::db::USUARIO.scope("volume".into(),async {
            state.db.destrancar(&raiz.join("vault.db"),&"ab".repeat(32)).unwrap();
            state.db.with(|c| {
                let tx=c.unchecked_transaction()?;
                {
                    let mut stmt=tx.prepare("INSERT INTO transacao(id,tipo,valor_centavos,data,descricao,espaco,criado_por,conciliada) VALUES(?1,?2,12345,?3,'volume','pessoal','teste',1)")?;
                    for i in 0..30000 {
                        let data=NaiveDate::from_ymd_opt(2018,1,1).unwrap()+chrono::Duration::days(i/10);
                        stmt.execute(params![format!("v{i}"),if i%2==0 {"entrada"}else{"saida"},data.to_string()])?;
                    }
                }
                tx.commit()
            }).await.unwrap();
            let inicio=std::time::Instant::now();
            let Json(p)=painel(State(state.clone()),Query(Periodo {data_de:"2018-01-01".parse().unwrap(),data_ate:"2026-12-31".parse().unwrap()})).await.unwrap();
            assert_eq!(p["receitas"],15000*12345);assert_eq!(p["despesas"],15000*12345);assert_eq!(p["saldo"],0);
            assert_eq!(p["categorias"][0]["valor"],15000*12345);
            assert_eq!(p["pagamentos"][0]["valor"],15000*12345);
            let soma:i64=p["series"].as_array().unwrap().iter().map(|s|s["receitas"].as_i64().unwrap()).sum();
            assert_eq!(soma,15000*12345);
            eprintln!("painel 30.000 registros: {:?}",inicio.elapsed());
            state.db.trancar();
        }).await;
        let _ = std::fs::remove_dir_all(raiz);
    }
    #[test]
    fn csv_neutraliza_formulas_e_escapa_aspas() {
        assert_eq!(celula("=HYPERLINK(\"x\")"), "\"'=HYPERLINK(\"\"x\"\")\"");
        assert_eq!(celula("texto; normal"), "\"texto; normal\"");
    }
}
