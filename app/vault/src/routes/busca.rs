//! `GET /vault/busca?q=` — pesquisa nos lançamentos por descrição, observações, categoria, pagador, conta, forma de
//! pagamento, valor, data, nome dos anexos e texto lido dos comprovantes (OCR). Ignora acento e maiúscula, aceita
//! erro de digitação e as confusões do OCR (`crate::busca`). Devolve só ids e a nota: a tela cruza com a lista que
//! já tem carregada. O texto dos comprovantes é lido aqui dentro, do arquivo cifrado, e nunca sai.

use axum::extract::{Query, State};
use axum::Json;
use chrono::NaiveDate;
use serde::Deserialize;

use crate::busca::Consulta;
use crate::error::AppResult;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct BuscaQuery {
    pub q: Option<String>,
    pub data_de: Option<NaiveDate>,
    pub data_ate: Option<NaiveDate>,
    pub limit: Option<usize>,
}

pub async fn buscar(State(state): State<AppState>, Query(q): Query<BuscaQuery>) -> AppResult<Json<serde_json::Value>> {
    let Some(consulta) = q.q.as_deref().and_then(Consulta::nova) else {
        return Ok(Json(serde_json::json!({ "items": [] })));
    };
    let limite = q.limit.unwrap_or(500).clamp(1, 2000);
    let (de, ate) = (q.data_de.map(|d| d.to_string()), q.data_ate.map(|d| d.to_string()));
    let mut achados: Vec<(f32, String, bool)> = state
        .db
        .with(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT t.id, t.descricao, t.observacoes, t.valor_centavos, t.data, t.forma_pagamento, t.ocr_texto_bruto, \
                        c.nome, b.nome, ct.nome, \
                        (SELECT group_concat(a.nome_arquivo, ' ') FROM anexo a WHERE a.transacao_id = t.id), \
                        (SELECT group_concat(a.ocr_texto, ' ') FROM anexo a WHERE a.transacao_id = t.id), \
                        fp.nome \
                 FROM transacao t \
                 LEFT JOIN forma_pagamento fp ON fp.codigo = t.forma_pagamento \
                 LEFT JOIN categoria c ON c.id = t.categoria_id \
                 LEFT JOIN beneficiario b ON b.id = t.beneficiario_id \
                 LEFT JOIN conta ct ON ct.id = t.conta_id \
                 WHERE (?1 IS NULL OR t.data >= ?1) AND (?2 IS NULL OR t.data <= ?2)",
            )?;
            let mut linhas = stmt.query(rusqlite::params![de, ate])?;
            let mut achados = Vec::new();
            while let Some(r) = linhas.next()? {
                let id: String = r.get(0)?;
                let valor: i64 = r.get(3)?;
                let (reais, centavos) = (valor.abs() / 100, valor.abs() % 100);
                let data: String = r.get(4)?;
                let data_br = data.split('-').rev().collect::<Vec<_>>().join("/");
                let texto = |i: usize| r.get::<_, Option<String>>(i).map(Option::unwrap_or_default);
                let forma = texto(12)?;
                let (descricao, observacoes, categoria, pagador, conta, arquivos) = (texto(1)?, texto(2)?, texto(7)?, texto(8)?, texto(9)?, texto(10)?);
                let valor_txt = format!("{reais},{centavos:02} {reais}.{centavos:02}");
                let datas = format!("{data} {data_br}");
                let (ocr_anexos, ocr_transacao) = (texto(11)?, texto(6)?);
                let campos = [descricao.as_str(), observacoes.as_str(), categoria.as_str(), pagador.as_str(), conta.as_str(), forma.as_str(), valor_txt.as_str(), datas.as_str(), arquivos.as_str()];
                if let Some(a) = consulta.avaliar(&campos, &[ocr_anexos.as_str(), ocr_transacao.as_str()]) {
                    achados.push((a.pontuacao, id, a.so_no_anexo));
                }
            }
            Ok(achados)
        })
        .await?;
    achados.sort_by(|a, b| b.0.total_cmp(&a.0));
    achados.truncate(limite);
    let items: Vec<_> = achados.into_iter().map(|(p, id, so_no_anexo)| serde_json::json!({ "id": id, "pontuacao": p, "so_no_anexo": so_no_anexo })).collect();
    Ok(Json(serde_json::json!({ "items": items })))
}
