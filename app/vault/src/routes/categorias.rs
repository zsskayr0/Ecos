//! `/vault/categorias` (seção 11.14).

use axum::extract::{Path, State};
use axum::Json;
use ecos_core::{new_id, ErrorCode};
use rusqlite::OptionalExtension;
use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

pub async fn listar(State(state): State<AppState>) -> AppResult<Json<serde_json::Value>> {
    let usuario = crate::db::autor_atual().unwrap_or_default();
    let linhas: Vec<serde_json::Value> = state
        .db
        .with(move |conn| {
            let mut stmt = conn.prepare("SELECT id, nome, tipo, icone, cor, padrao, espaco, criado_por, pai_id, arquivada FROM categoria ORDER BY nome")?;
            let linhas = stmt
                .query_map([], |r| {
                    Ok(serde_json::json!({
                        "id": r.get::<_, String>(0)?, "nome": r.get::<_, String>(1)?, "tipo": r.get::<_, String>(2)?,
                        "icone": r.get::<_, Option<String>>(3)?, "cor": r.get::<_, String>(4)?,
                        "padrao": r.get::<_, i64>(5)? != 0, "espaco": r.get::<_, String>(6)?, "criado_por": r.get::<_, Option<String>>(7)?, "pai_id": r.get::<_, Option<String>>(8)?, "arquivada": r.get::<_, i64>(9)? != 0,
                    }))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            let mut linhas = linhas;
            super::preferencias::ordenar_por(&mut linhas, &super::preferencias::ler_ordem(conn, &usuario, super::preferencias::ORDEM_CATEGORIAS)?);
            Ok(linhas)
        })
        .await?;
    Ok(Json(serde_json::json!(linhas)))
}

#[derive(Debug, Deserialize)]
pub struct CategoriaPayload {
    pub nome: String,
    #[serde(default = "tipo_padrao")]
    pub tipo: String,
    #[serde(default)]
    pub icone: Option<String>,
    #[serde(default = "cor_padrao")]
    pub cor: String,
    #[serde(default = "espaco_padrao")]
    pub espaco: String,
    /// Categoria-mãe. Ausente: na criação, categoria de topo; na edição, não muda. `null`: vira categoria de topo.
    #[serde(default, deserialize_with = "campo_opcional")]
    pub pai_id: Option<Option<String>>,
    /// Arquivar esconde a categoria dos seletores (arquivar a mãe arquiva as filhas). Ausente: não muda.
    #[serde(default)]
    pub arquivada: Option<bool>,
}

fn campo_opcional<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Option<String>>, D::Error> {
    Ok(Some(Option::deserialize(d)?))
}

/// Regras das subcategorias: um nível só (sem árvore), a mãe existe e é de topo, ninguém vira filha de si mesma,
/// quem já tem filhas não vira filha, e o tipo da filha cabe no da mãe (mãe "ambos" aceita qualquer um).
fn validar_pai(conn: &rusqlite::Connection, propria: Option<&str>, pai: &str, tipo: &str) -> rusqlite::Result<Result<(), AppError>> {
    let invalido = |m: &str| Ok(Err(AppError::new(ErrorCode::ValidationError).with_message(m.to_string())));
    if Some(pai) == propria {
        return invalido("Uma categoria não pode ser subcategoria de si mesma.");
    }
    let linha: Option<(Option<String>, String)> = conn.query_row("SELECT pai_id, tipo FROM categoria WHERE id = ?1", [pai], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
    let Some((avo, tipo_pai)) = linha else { return Ok(Err(AppError::new(ErrorCode::CategoryNotFound))) };
    if avo.is_some() {
        return invalido("Subcategorias não têm subcategorias: escolha uma categoria de nível principal.");
    }
    if let Some(id) = propria {
        let filhas: i64 = conn.query_row("SELECT COUNT(*) FROM categoria WHERE pai_id = ?1", [id], |r| r.get(0))?;
        if filhas > 0 {
            return invalido("Esta categoria já tem subcategorias, então não pode virar subcategoria de outra.");
        }
    }
    if tipo_pai != "ambos" && tipo_pai != tipo {
        return invalido("O tipo da subcategoria precisa ser o mesmo da categoria-mãe (ou a mãe ser “Ambas”).");
    }
    Ok(Ok(()))
}

fn tipo_padrao() -> String {
    "saida".to_string()
}
fn cor_padrao() -> String {
    "#7DD3FC".to_string()
}
fn espaco_padrao() -> String {
    "pessoal".to_string()
}

pub async fn criar(State(state): State<AppState>, Json(payload): Json<CategoriaPayload>) -> AppResult<Json<serde_json::Value>> {
    if !["entrada", "saida", "ambos"].contains(&payload.tipo.as_str()) {
        return Err(AppError::new(ErrorCode::ValidationError).with_message("tipo deve ser 'entrada', 'saida' ou 'ambos'"));
    }
    let id = new_id();
    let autor = crate::db::autor_atual();
    state
        .db
        .with({
            let id = id.clone();
            move |conn| {
                let pai = payload.pai_id.clone().flatten();
                if let Some(p) = &pai {
                    if let Err(e) = validar_pai(conn, None, p, &payload.tipo)? {
                        return Ok(Err(e));
                    }
                }
                conn.execute(
                    "INSERT INTO categoria (id, nome, tipo, icone, cor, espaco, criado_por, pai_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    rusqlite::params![id, payload.nome, payload.tipo, payload.icone, payload.cor, payload.espaco, autor, pai],
                )?;
                Ok(Ok(()))
            }
        })
        .await??;
    Ok(Json(serde_json::json!({ "id": id })))
}

pub async fn atualizar(State(state): State<AppState>, Path(id): Path<String>, Json(payload): Json<CategoriaPayload>) -> AppResult<Json<serde_json::Value>> {
    if !["entrada", "saida", "ambos"].contains(&payload.tipo.as_str()) {
        return Err(AppError::new(ErrorCode::ValidationError).with_message("tipo deve ser 'entrada', 'saida' ou 'ambos'"));
    }
    state
        .db
        .with(move |conn| {
            let atual: Option<Option<String>> = conn.query_row("SELECT pai_id FROM categoria WHERE id = ?1", [&id], |r| r.get(0)).optional()?;
            let Some(pai_atual) = atual else { return Ok(Err(AppError::new(ErrorCode::CategoryNotFound))) };
            let pai = match &payload.pai_id {
                Some(novo) => novo.clone(),
                None => pai_atual,
            };
            if let Some(p) = &pai {
                if let Err(e) = validar_pai(conn, Some(&id), p, &payload.tipo)? {
                    return Ok(Err(e));
                }
            } else if payload.tipo != "ambos" {
                // Mãe que muda de tipo não pode deixar filhas de tipo incompatível.
                let fora: i64 = conn.query_row("SELECT COUNT(*) FROM categoria WHERE pai_id = ?1 AND tipo <> ?2", rusqlite::params![id, payload.tipo], |r| r.get(0))?;
                if fora > 0 {
                    return Ok(Err(AppError::new(ErrorCode::ValidationError).with_message("Há subcategorias de outro tipo. Ajuste-as antes de mudar o tipo desta categoria.")));
                }
            }
            conn.execute(
                "UPDATE categoria SET nome = ?1, tipo = ?2, icone = ?3, cor = ?4, pai_id = ?5, atualizado_em = datetime('now') WHERE id = ?6",
                rusqlite::params![payload.nome, payload.tipo, payload.icone, payload.cor, pai, id],
            )?;
            if let Some(a) = payload.arquivada {
                conn.execute("UPDATE categoria SET arquivada = ?1, atualizado_em = datetime('now') WHERE id = ?2", rusqlite::params![i64::from(a), id])?;
                if a {
                    conn.execute("UPDATE categoria SET arquivada = 1, atualizado_em = datetime('now') WHERE pai_id = ?1", [&id])?;
                } else if let Some(mae) = &pai {
                    // Desarquivar uma subcategoria desarquiva a mãe, senão ela ficaria escondida debaixo de uma mãe arquivada.
                    conn.execute("UPDATE categoria SET arquivada = 0, atualizado_em = datetime('now') WHERE id = ?1", [mae])?;
                }
            }
            Ok(Ok(()))
        })
        .await??;
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Tabelas que apontam para uma categoria.
const TABELAS_COM_CATEGORIA: [&str; 3] = ["transacao", "transacao_recorrente", "pendencia_avulsa"];

/// O que está pendurado numa categoria, para a tela mostrar antes de apagar: contagens, os tipos presentes
/// (para só oferecer destinos compatíveis) e os lançamentos mais recentes.
pub async fn uso(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let resposta = state
        .db
        .with(move |conn| {
            let existe: Option<String> = conn.query_row("SELECT tipo FROM categoria WHERE id = ?1", [&id], |r| r.get(0)).optional()?;
            if existe.is_none() {
                return Ok(None);
            }
            let contar = |tabela: &str| conn.query_row(&format!("SELECT COUNT(*) FROM {tabela} WHERE categoria_id = ?1"), [&id], |r| r.get::<_, i64>(0));
            let (transacoes, recorrencias, pendencias) = (contar("transacao")?, contar("transacao_recorrente")?, contar("pendencia_avulsa")?);
            let mut stmt = conn.prepare(
                "SELECT tipo FROM transacao WHERE categoria_id = ?1 UNION SELECT tipo FROM transacao_recorrente WHERE categoria_id = ?1 \
                 UNION SELECT tipo FROM pendencia_avulsa WHERE categoria_id = ?1 ORDER BY 1",
            )?;
            let tipos = stmt.query_map([&id], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
            let mut stmt = conn.prepare("SELECT id, data, descricao, tipo, valor_centavos FROM transacao WHERE categoria_id = ?1 ORDER BY data DESC, id DESC LIMIT 100")?;
            let amostra = stmt
                .query_map([&id], |r| Ok(serde_json::json!({ "id": r.get::<_, String>(0)?, "data": r.get::<_, String>(1)?, "descricao": r.get::<_, String>(2)?, "tipo": r.get::<_, String>(3)?, "valor_centavos": r.get::<_, i64>(4)? })))?
                .collect::<Result<Vec<_>, _>>()?;
            let subcategorias: i64 = conn.query_row("SELECT COUNT(*) FROM categoria WHERE pai_id = ?1", [&id], |r| r.get(0))?;
            Ok(Some(serde_json::json!({ "transacoes": transacoes, "recorrencias": recorrencias, "pendencias": pendencias, "subcategorias": subcategorias, "tipos": tipos, "amostra": amostra })))
        })
        .await?;
    Ok(Json(resposta.ok_or(AppError::new(ErrorCode::CategoryNotFound))?))
}

#[derive(Debug, Default, Deserialize)]
pub struct ExcluirPayload {
    /// Categoria para onde vão os lançamentos, recorrências e pendências da que será apagada.
    pub mover_para: Option<String>,
    /// `true`: eles ficam sem categoria.
    #[serde(default)]
    pub sem_categoria: bool,
    /// Mesclar: com `mover_para`, as subcategorias da apagada passam para o destino em vez de virarem principais.
    #[serde(default)]
    pub filhas_para_destino: bool,
}

enum Resultado {
    NaoExiste,
    PrecisaDecidir(i64),
    DestinoInexistente,
    DestinoIgual,
    DestinoIncompativel(String),
    MesclarSemDestino,
    Apagada(i64),
}

/// Apaga uma categoria. Se algo usa a categoria, é obrigatório dizer para onde vai (`mover_para` ou `sem_categoria`);
/// mover e apagar acontecem juntos, ou nada acontece. Qualquer categoria pode ser apagada; "sem categoria" é o destino neutro.
pub async fn excluir(State(state): State<AppState>, Path(id): Path<String>, corpo: Option<Json<ExcluirPayload>>) -> AppResult<Json<serde_json::Value>> {
    let decisao = corpo.map(|Json(c)| c).unwrap_or_default();
    if decisao.sem_categoria && decisao.mover_para.is_some() {
        return Err(AppError::new(ErrorCode::ValidationError).with_message("Escolha um único destino para os itens da categoria."));
    }
    let resultado = state
        .db
        .with(move |conn| {
            let tx = conn.unchecked_transaction()?;
            let existe: Option<i64> = tx.query_row("SELECT 1 FROM categoria WHERE id = ?1", [&id], |r| r.get(0)).optional()?;
            if existe.is_none() {
                return Ok(Resultado::NaoExiste);
            }
            let mut destino_mesclar: Option<String> = None;
            if decisao.filhas_para_destino {
                let Some(d) = &decisao.mover_para else { return Ok(Resultado::MesclarSemDestino) };
                if d == &id {
                    return Ok(Resultado::DestinoIgual);
                }
                let existe_destino: Option<i64> = tx.query_row("SELECT 1 FROM categoria WHERE id = ?1", [d], |r| r.get(0)).optional()?;
                if existe_destino.is_none() {
                    return Ok(Resultado::DestinoInexistente);
                }
                destino_mesclar = Some(d.clone());
            }
            let mut usos = 0;
            for tabela in TABELAS_COM_CATEGORIA {
                usos += tx.query_row(&format!("SELECT COUNT(*) FROM {tabela} WHERE categoria_id = ?1"), [&id], |r| r.get::<_, i64>(0))?;
            }
            if usos > 0 {
                let destino: Option<String> = match (&decisao.mover_para, decisao.sem_categoria) {
                    (None, false) => return Ok(Resultado::PrecisaDecidir(usos)),
                    (None, true) => None,
                    (Some(d), _) => {
                        if d == &id {
                            return Ok(Resultado::DestinoIgual);
                        }
                        let tipo_destino: Option<String> = tx.query_row("SELECT tipo FROM categoria WHERE id = ?1", [d], |r| r.get(0)).optional()?;
                        let Some(tipo_destino) = tipo_destino else { return Ok(Resultado::DestinoInexistente) };
                        if tipo_destino != "ambos" {
                            // Despesa não pode ir para uma categoria só de receitas (e vice-versa).
                            for tabela in TABELAS_COM_CATEGORIA {
                                let fora: i64 = tx.query_row(&format!("SELECT COUNT(*) FROM {tabela} WHERE categoria_id = ?1 AND tipo <> ?2"), rusqlite::params![id, tipo_destino], |r| r.get(0))?;
                                if fora > 0 {
                                    return Ok(Resultado::DestinoIncompativel(tipo_destino));
                                }
                            }
                        }
                        Some(d.clone())
                    }
                };
                for tabela in TABELAS_COM_CATEGORIA {
                    tx.execute(&format!("UPDATE {tabela} SET categoria_id = ?1, atualizado_em = datetime('now') WHERE categoria_id = ?2"), rusqlite::params![destino, id])?;
                }
            }
            if let Some(d) = &destino_mesclar {
                // Mesclar: o destino que era filha da apagada sobe a principal; as outras filhas passam para ele (se for principal).
                tx.execute("UPDATE categoria SET pai_id = NULL WHERE id = ?1 AND pai_id = ?2", rusqlite::params![d, id])?;
                let (pai_destino, tipo_destino): (Option<String>, String) = tx.query_row("SELECT pai_id, tipo FROM categoria WHERE id = ?1", [d], |r| Ok((r.get(0)?, r.get(1)?)))?;
                let novo_pai = if pai_destino.is_none() { Some(d.clone()) } else { None };
                tx.execute("UPDATE categoria SET pai_id = ?1, atualizado_em = datetime('now') WHERE pai_id = ?2 AND id <> ?3", rusqlite::params![novo_pai, id, d])?;
                if novo_pai.is_some() && tipo_destino != "ambos" {
                    tx.execute("UPDATE categoria SET tipo = ?1 WHERE pai_id = ?2", rusqlite::params![tipo_destino, d])?;
                }
            }
            // As subcategorias que sobraram não somem junto: viram categorias de nível principal.
            tx.execute("UPDATE categoria SET pai_id = NULL, atualizado_em = datetime('now') WHERE pai_id = ?1", [&id])?;
            tx.execute("DELETE FROM categoria WHERE id = ?1", [&id])?;
            tx.commit()?;
            Ok(Resultado::Apagada(usos))
        })
        .await?;
    match resultado {
        Resultado::Apagada(movidos) => Ok(Json(serde_json::json!({ "ok": true, "movidos": movidos }))),
        Resultado::NaoExiste | Resultado::DestinoInexistente => Err(AppError::new(ErrorCode::CategoryNotFound)),
        Resultado::PrecisaDecidir(n) => Err(AppError::new(ErrorCode::Conflict).with_message(format!("Esta categoria é usada por {n} {}. Escolha para onde movê-los antes de apagar.", if n == 1 { "item" } else { "itens" }))),
        Resultado::MesclarSemDestino => Err(AppError::new(ErrorCode::ValidationError).with_message("Escolha a categoria que fica ao mesclar.")),
        Resultado::DestinoIgual => Err(AppError::new(ErrorCode::ValidationError).with_message("Escolha outra categoria como destino.")),
        Resultado::DestinoIncompativel(tipo) => Err(AppError::new(ErrorCode::ValidationError).with_message(format!("A categoria de destino é só de {}, e há itens do outro tipo. Escolha outra ou “Sem categoria”.", if tipo == "entrada" { "receitas" } else { "despesas" }))),
    }
}

#[derive(Debug, Deserialize)]
pub struct SugestaoQuery {
    pub beneficiario: Option<String>,
    pub descricao: Option<String>,
    pub tipo: Option<String>,
}

/// Sugere a categoria mais usada com o mesmo pagador (ou, sem pagador, com a mesma descrição), ignorando as arquivadas.
pub async fn sugestao(State(state): State<AppState>, axum::extract::Query(q): axum::extract::Query<SugestaoQuery>) -> AppResult<Json<serde_json::Value>> {
    let resposta = state
        .db
        .with(move |conn| {
            let tipo = q.tipo.filter(|t| t == "entrada" || t == "saida");
            let consulta = |campo: &str, valor: &str, motivo: &str| -> rusqlite::Result<Option<serde_json::Value>> {
                let (juncao, filtro) = if campo == "beneficiario" { ("JOIN beneficiario b ON b.id = t.beneficiario_id", "b.nome = ?1 COLLATE NOCASE") } else { ("", "t.descricao = ?1 COLLATE NOCASE") };
                let sql = format!(
                    "SELECT t.categoria_id, COUNT(*) AS usos FROM transacao t {juncao} JOIN categoria k ON k.id = t.categoria_id \
                     WHERE {filtro} AND k.arquivada = 0 AND (?2 IS NULL OR t.tipo = ?2) GROUP BY t.categoria_id ORDER BY usos DESC, MAX(t.data) DESC LIMIT 1"
                );
                let linha: Option<(String, i64)> = conn.query_row(&sql, rusqlite::params![valor, tipo], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
                Ok(linha.map(|(id, usos)| serde_json::json!({ "categoria_id": id, "motivo": motivo, "usos": usos })))
            };
            if let Some(b) = q.beneficiario.as_deref().map(str::trim).filter(|b| !b.is_empty()) {
                if let Some(r) = consulta("beneficiario", b, "pagador")? {
                    return Ok(r);
                }
            }
            if let Some(d) = q.descricao.as_deref().map(str::trim).filter(|d| !d.is_empty()) {
                if let Some(r) = consulta("descricao", d, "descricao")? {
                    return Ok(r);
                }
            }
            Ok(serde_json::json!({ "categoria_id": null }))
        })
        .await?;
    Ok(Json(resposta))
}

#[cfg(test)]
mod testes {
    use crate::{config::Config, db::VaultDb, routes, state::AppState};
    use axum::{body::{to_bytes, Body}, http::{Request, StatusCode}, Router};
    use ecos_core::new_id;
    use serde_json::{json, Value};
    use std::sync::Arc;
    use tower::Service;

    fn app() -> (Router, std::path::PathBuf) {
        let raiz = std::env::temp_dir().join(format!("ecos-categorias-{}", new_id()));
        let config = Arc::new(Config { porta: 0, db_path: raiz.join("vault/ecos-vault.db"), meta_path: raiz.join("vault/ecos-vault.meta.json"), backups_dir: raiz.join("backups") });
        std::fs::create_dir_all(raiz.join("vault")).unwrap();
        std::fs::create_dir_all(raiz.join("backups")).unwrap();
        (routes::montar(AppState { db: VaultDb::trancado(), config }), raiz)
    }

    async fn chamar(app: &Router, usuario: &str, metodo: &str, uri: &str, corpo: Option<Value>) -> (StatusCode, Value) {
        let mut p = Request::builder().method(metodo).uri(uri).header("x-ecos-usuario", usuario);
        let body = match corpo {
            Some(c) => { p = p.header("content-type", "application/json"); Body::from(c.to_string()) }
            None => Body::empty(),
        };
        let r = app.clone().call(p.body(body).unwrap()).await.unwrap();
        let s = r.status();
        let b = to_bytes(r.into_body(), 1 << 20).await.unwrap();
        (s, serde_json::from_slice(&b).unwrap_or(Value::Null))
    }

    async fn ativar(app: &Router, u: &str) {
        let (s, _) = chamar(app, u, "POST", "/vault/ativar", Some(json!({ "senha": "senha-financeiro-123" }))).await;
        assert_eq!(s, StatusCode::OK);
    }

    async fn nomes(app: &Router, u: &str) -> Vec<String> {
        let (_, v) = chamar(app, u, "GET", "/vault/categorias", None).await;
        v.as_array().unwrap().iter().map(|c| c["nome"].as_str().unwrap().to_string()).collect()
    }

    async fn lancar(app: &Router, u: &str, tipo: &str, descricao: &str, categoria: &str) -> String {
        let (s, t) = chamar(app, u, "POST", "/vault/transacoes", Some(json!({ "tipo": tipo, "valor_centavos": 1000, "data": "2026-09-30", "descricao": descricao, "categoria_id": categoria }))).await;
        assert_eq!(s, StatusCode::OK, "{t}");
        t["id"].as_str().unwrap().to_string()
    }

    async fn categoria_de(app: &Router, u: &str, transacao: &str) -> Value {
        chamar(app, u, "GET", &format!("/vault/transacoes/{transacao}"), None).await.1["categoria_id"].clone()
    }

    #[tokio::test]
    async fn qualquer_categoria_sem_uso_pode_ser_apagada_inclusive_outros() {
        let (app, raiz) = app();
        ativar(&app, "ana").await;
        assert!(nomes(&app, "ana").await.contains(&"Moradia".to_string()));
        // "Moradia" é "de sistema" (padrao = 1) e antes era impossível apagar.
        assert_eq!(chamar(&app, "ana", "DELETE", "/vault/categorias/cat_nexus_moradia", None).await.0, StatusCode::OK);
        assert_eq!(chamar(&app, "ana", "DELETE", "/vault/categorias/cat_nexus_streaming", None).await.0, StatusCode::OK);
        let restantes = nomes(&app, "ana").await;
        assert!(!restantes.contains(&"Moradia".to_string()) && !restantes.contains(&"Streaming".to_string()));
        // "Outros" também: "sem categoria" é o destino neutro, não há categoria intocável.
        assert_eq!(chamar(&app, "ana", "DELETE", "/vault/categorias/cat_nexus_outros", None).await.0, StatusCode::OK);
        assert!(!nomes(&app, "ana").await.contains(&"Outros".to_string()));
        assert_eq!(chamar(&app, "ana", "DELETE", "/vault/categorias/nao-existe", None).await.0, StatusCode::NOT_FOUND);
        drop(app);
        let _ = std::fs::remove_dir_all(raiz);
    }

    #[tokio::test]
    async fn categoria_em_uso_mostra_o_que_a_usa_e_exige_um_destino() {
        let (app, raiz) = app();
        ativar(&app, "ana").await;
        let t1 = lancar(&app, "ana", "saida", "Mercado", "cat_nexus_alimentacao").await;
        lancar(&app, "ana", "saida", "Padaria", "cat_nexus_alimentacao").await;
        chamar(&app, "ana", "POST", "/vault/pendencias", Some(json!({ "tipo": "saida", "descricao": "Feira", "valor_centavos": 500, "categoria_id": "cat_nexus_alimentacao" }))).await;
        let (s, uso) = chamar(&app, "ana", "GET", "/vault/categorias/cat_nexus_alimentacao/uso", None).await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!((uso["transacoes"].as_i64(), uso["recorrencias"].as_i64(), uso["pendencias"].as_i64()), (Some(2), Some(0), Some(1)));
        assert_eq!(uso["tipos"], json!(["saida"]));
        assert_eq!(uso["amostra"].as_array().unwrap().len(), 2);
        assert_eq!(uso["amostra"][0]["descricao"].as_str().is_some(), true);
        assert_eq!(chamar(&app, "ana", "GET", "/vault/categorias/nao-existe/uso", None).await.0, StatusCode::NOT_FOUND);

        // Sem dizer para onde os itens vão, nada é apagado.
        let (s, e) = chamar(&app, "ana", "DELETE", "/vault/categorias/cat_nexus_alimentacao", None).await;
        assert_eq!(s, StatusCode::CONFLICT);
        assert!(e["message"].as_str().unwrap().contains("3 itens"));
        assert!(nomes(&app, "ana").await.contains(&"Alimentação".to_string()));
        assert_eq!(categoria_de(&app, "ana", &t1).await, "cat_nexus_alimentacao");
        drop(app);
        let _ = std::fs::remove_dir_all(raiz);
    }

    #[tokio::test]
    async fn mover_para_outra_categoria_leva_lancamentos_e_pendencias_e_apaga() {
        let (app, raiz) = app();
        ativar(&app, "ana").await;
        let t1 = lancar(&app, "ana", "saida", "Mercado", "cat_nexus_alimentacao").await;
        chamar(&app, "ana", "POST", "/vault/pendencias", Some(json!({ "tipo": "saida", "descricao": "Feira", "valor_centavos": 500, "categoria_id": "cat_nexus_alimentacao" }))).await;
        let (s, r) = chamar(&app, "ana", "DELETE", "/vault/categorias/cat_nexus_alimentacao", Some(json!({ "mover_para": "cat_nexus_outros" }))).await;
        assert_eq!(s, StatusCode::OK, "{r}");
        assert_eq!(r["movidos"], 2);
        assert!(!nomes(&app, "ana").await.contains(&"Alimentação".to_string()));
        assert_eq!(categoria_de(&app, "ana", &t1).await, "cat_nexus_outros");
        let (_, p) = chamar(&app, "ana", "GET", "/vault/pendencias", None).await;
        assert_eq!(p[0]["categoria_id"], "cat_nexus_outros");
        drop(app);
        let _ = std::fs::remove_dir_all(raiz);
    }

    #[tokio::test]
    async fn sem_categoria_deixa_os_itens_sem_categoria_de_verdade() {
        let (app, raiz) = app();
        ativar(&app, "ana").await;
        let t1 = lancar(&app, "ana", "saida", "Uber", "cat_nexus_transporte").await;
        let (s, _) = chamar(&app, "ana", "DELETE", "/vault/categorias/cat_nexus_transporte", Some(json!({ "sem_categoria": true }))).await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(categoria_de(&app, "ana", &t1).await, Value::Null, "nada pode ficar apontando para uma categoria que não existe mais");
        drop(app);
        let _ = std::fs::remove_dir_all(raiz);
    }

    #[tokio::test]
    async fn destino_invalido_nao_apaga_nem_move_nada() {
        let (app, raiz) = app();
        ativar(&app, "ana").await;
        let despesa = lancar(&app, "ana", "saida", "Mercado", "cat_nexus_alimentacao").await;
        let uri = "/vault/categorias/cat_nexus_alimentacao";
        // Despesa para categoria só de receitas.
        let (s, e) = chamar(&app, "ana", "DELETE", uri, Some(json!({ "mover_para": "cat_nexus_renda" }))).await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
        assert!(e["message"].as_str().unwrap().contains("receitas"));
        // Para ela mesma, para uma que não existe, e dois destinos ao mesmo tempo.
        assert_eq!(chamar(&app, "ana", "DELETE", uri, Some(json!({ "mover_para": "cat_nexus_alimentacao" }))).await.0, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(chamar(&app, "ana", "DELETE", uri, Some(json!({ "mover_para": "fantasma" }))).await.0, StatusCode::NOT_FOUND);
        assert_eq!(chamar(&app, "ana", "DELETE", uri, Some(json!({ "mover_para": "cat_nexus_outros", "sem_categoria": true }))).await.0, StatusCode::UNPROCESSABLE_ENTITY);
        // Tudo ou nada: a categoria e o lançamento continuam como estavam.
        assert!(nomes(&app, "ana").await.contains(&"Alimentação".to_string()));
        assert_eq!(categoria_de(&app, "ana", &despesa).await, "cat_nexus_alimentacao");
        // "Outros" aceita qualquer tipo.
        assert_eq!(chamar(&app, "ana", "DELETE", uri, Some(json!({ "mover_para": "cat_nexus_outros" }))).await.0, StatusCode::OK);
        drop(app);
        let _ = std::fs::remove_dir_all(raiz);
    }

    #[tokio::test]
    async fn cofre_de_equipe_novo_nasce_sem_categorias_e_o_pessoal_continua_completo() {
        let (app, raiz) = app();
        ativar(&app, "eq_crbs").await;
        assert!(nomes(&app, "eq_crbs").await.is_empty(), "equipe começa do zero; lançamentos ficam sem categoria até ela criar as suas");
        ativar(&app, "ana").await;
        assert_eq!(nomes(&app, "ana").await.len(), 10);
        // Em equipe, categorias próprias continuam sendo criadas normalmente.
        assert_eq!(chamar(&app, "eq_crbs", "POST", "/vault/categorias", Some(json!({ "nome": "Fornecedores", "tipo": "saida" }))).await.0, StatusCode::OK);
        assert_eq!(nomes(&app, "eq_crbs").await, vec!["Fornecedores".to_string()]);
        drop(app);
        let _ = std::fs::remove_dir_all(raiz);
    }

    #[tokio::test]
    async fn subcategorias_tem_um_nivel_so_e_respeitam_tipo() {
        let (app, raiz) = app();
        ativar(&app, "ana").await;
        let (s, mae) = chamar(&app, "ana", "POST", "/vault/categorias", Some(json!({ "nome": "Funcionários", "tipo": "saida" }))).await;
        assert_eq!(s, StatusCode::OK);
        let mae = mae["id"].as_str().unwrap().to_string();
        let (s, sub) = chamar(&app, "ana", "POST", "/vault/categorias", Some(json!({ "nome": "Salários", "tipo": "saida", "pai_id": mae }))).await;
        assert_eq!(s, StatusCode::OK);
        let sub = sub["id"].as_str().unwrap().to_string();
        let (_, lista) = chamar(&app, "ana", "GET", "/vault/categorias", None).await;
        assert!(lista.as_array().unwrap().iter().any(|c| c["id"] == sub.as_str() && c["pai_id"] == mae.as_str()));
        // Sem árvore: subcategoria não tem subcategoria, e mãe com filhas não vira filha.
        assert_eq!(chamar(&app, "ana", "POST", "/vault/categorias", Some(json!({ "nome": "Bônus", "tipo": "saida", "pai_id": sub }))).await.0, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(chamar(&app, "ana", "PATCH", &format!("/vault/categorias/{mae}"), Some(json!({ "nome": "Funcionários", "tipo": "saida", "pai_id": "cat_nexus_moradia" }))).await.0, StatusCode::UNPROCESSABLE_ENTITY);
        // Tipo incompatível com a mãe, e mãe inexistente.
        assert_eq!(chamar(&app, "ana", "POST", "/vault/categorias", Some(json!({ "nome": "Comissão", "tipo": "entrada", "pai_id": mae }))).await.0, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(chamar(&app, "ana", "POST", "/vault/categorias", Some(json!({ "nome": "X", "tipo": "saida", "pai_id": "fantasma" }))).await.0, StatusCode::NOT_FOUND);
        // Editar sem mandar `pai_id` não solta a subcategoria; `null` solta.
        assert_eq!(chamar(&app, "ana", "PATCH", &format!("/vault/categorias/{sub}"), Some(json!({ "nome": "Salários 2", "tipo": "saida" }))).await.0, StatusCode::OK);
        let (_, lista) = chamar(&app, "ana", "GET", "/vault/categorias", None).await;
        assert!(lista.as_array().unwrap().iter().any(|c| c["id"] == sub.as_str() && c["pai_id"] == mae.as_str() && c["nome"] == "Salários 2"));
        // Lançamento na subcategoria aparece no filtro da mãe só com `com_subcategorias`.
        lancar(&app, "ana", "saida", "Folha", &sub).await;
        let (_, a) = chamar(&app, "ana", "GET", &format!("/vault/transacoes?categoria_id={mae}"), None).await;
        let (_, b) = chamar(&app, "ana", "GET", &format!("/vault/transacoes?categoria_id={mae}&com_subcategorias=true"), None).await;
        assert_eq!((a["items"].as_array().unwrap().len(), b["items"].as_array().unwrap().len()), (0, 1));
        // Apagar a mãe promove a filha a categoria de topo.
        assert_eq!(chamar(&app, "ana", "DELETE", &format!("/vault/categorias/{mae}"), None).await.0, StatusCode::OK);
        let (_, lista) = chamar(&app, "ana", "GET", "/vault/categorias", None).await;
        assert!(lista.as_array().unwrap().iter().any(|c| c["id"] == sub.as_str() && c["pai_id"].is_null()));
        drop(app);
        let _ = std::fs::remove_dir_all(raiz);
    }

    #[tokio::test]
    async fn mesclar_move_tudo_leva_as_filhas_e_arquivar_esconde_com_as_filhas() {
        let (app, raiz) = app();
        ativar(&app, "ana").await;
        let (_, a) = chamar(&app, "ana", "POST", "/vault/categorias", Some(json!({ "nome": "Impostos e Taxas", "tipo": "saida" }))).await;
        let (_, b) = chamar(&app, "ana", "POST", "/vault/categorias", Some(json!({ "nome": "Tarifas e Impostos", "tipo": "saida" }))).await;
        let (a, b) = (a["id"].as_str().unwrap().to_string(), b["id"].as_str().unwrap().to_string());
        let (_, f) = chamar(&app, "ana", "POST", "/vault/categorias", Some(json!({ "nome": "DAS", "tipo": "saida", "pai_id": a }))).await;
        let f = f["id"].as_str().unwrap().to_string();
        let t = lancar(&app, "ana", "saida", "Guia", &a).await;
        // Mesclar sem destino é recusado; com destino, os lançamentos e as filhas passam para ele.
        assert_eq!(chamar(&app, "ana", "DELETE", &format!("/vault/categorias/{a}"), Some(json!({ "filhas_para_destino": true }))).await.0, StatusCode::UNPROCESSABLE_ENTITY);
        let (s, r) = chamar(&app, "ana", "DELETE", &format!("/vault/categorias/{a}"), Some(json!({ "mover_para": b, "filhas_para_destino": true }))).await;
        assert_eq!(s, StatusCode::OK, "{r}");
        assert_eq!(categoria_de(&app, "ana", &t).await, b.as_str());
        let (_, lista) = chamar(&app, "ana", "GET", "/vault/categorias", None).await;
        let das = lista.as_array().unwrap().iter().find(|c| c["id"] == f.as_str()).unwrap();
        assert_eq!(das["pai_id"], b.as_str());
        // Arquivar a mãe arquiva as filhas; desarquivar a filha desarquiva a mãe.
        assert_eq!(chamar(&app, "ana", "PATCH", &format!("/vault/categorias/{b}"), Some(json!({ "nome": "Tarifas e Impostos", "tipo": "saida", "arquivada": true }))).await.0, StatusCode::OK);
        let (_, lista) = chamar(&app, "ana", "GET", "/vault/categorias", None).await;
        let arquivada = |lista: &Value, id: &str| lista.as_array().unwrap().iter().find(|c| c["id"] == id).unwrap()["arquivada"].as_bool().unwrap();
        assert!(arquivada(&lista, &b) && arquivada(&lista, &f));
        assert_eq!(chamar(&app, "ana", "PATCH", &format!("/vault/categorias/{f}"), Some(json!({ "nome": "DAS", "tipo": "saida", "arquivada": false }))).await.0, StatusCode::OK);
        let (_, lista) = chamar(&app, "ana", "GET", "/vault/categorias", None).await;
        assert!(!arquivada(&lista, &b) && !arquivada(&lista, &f));
        drop(app);
        let _ = std::fs::remove_dir_all(raiz);
    }

    #[tokio::test]
    async fn sugestao_usa_a_categoria_mais_usada_do_pagador_e_ignora_arquivadas() {
        let (app, raiz) = app();
        ativar(&app, "ana").await;
        let (s, b) = chamar(&app, "ana", "POST", "/vault/beneficiarios", Some(json!({ "nome": "Mercado Extra" }))).await;
        assert_eq!(s, StatusCode::OK, "{b}");
        let beneficiario = b["id"].as_str().unwrap().to_string();
        for _ in 0..2 {
            let (s, r) = chamar(&app, "ana", "POST", "/vault/transacoes", Some(json!({ "tipo": "saida", "valor_centavos": 500, "data": "2026-09-30", "descricao": "Compra", "categoria_id": "cat_nexus_alimentacao", "beneficiario_id": beneficiario }))).await;
            assert_eq!(s, StatusCode::OK, "{r}");
        }
        let (_, v) = chamar(&app, "ana", "GET", "/vault/categorias/sugestao?beneficiario=mercado%20extra&tipo=saida", None).await;
        assert_eq!(v["categoria_id"], "cat_nexus_alimentacao");
        assert_eq!(v["motivo"], "pagador");
        let (_, v) = chamar(&app, "ana", "GET", "/vault/categorias/sugestao?beneficiario=Ninguem", None).await;
        assert!(v["categoria_id"].is_null());
        assert_eq!(chamar(&app, "ana", "PATCH", "/vault/categorias/cat_nexus_alimentacao", Some(json!({ "nome": "Alimentação", "tipo": "saida", "arquivada": true }))).await.0, StatusCode::OK);
        let (_, v) = chamar(&app, "ana", "GET", "/vault/categorias/sugestao?beneficiario=Mercado%20Extra", None).await;
        assert!(v["categoria_id"].is_null(), "arquivada não é sugerida");
        drop(app);
        let _ = std::fs::remove_dir_all(raiz);
    }
}
