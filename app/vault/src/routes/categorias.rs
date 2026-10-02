//! `/vault/categorias` (seção 11.14).

use axum::extract::{Path, State};
use axum::Json;
use ecos_core::{new_id, ErrorCode};
use rusqlite::OptionalExtension;
use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

pub async fn listar(State(state): State<AppState>) -> AppResult<Json<serde_json::Value>> {
    let linhas: Vec<serde_json::Value> = state
        .db
        .with(|conn| {
            let mut stmt = conn.prepare("SELECT id, nome, tipo, icone, cor, padrao, espaco, criado_por FROM categoria ORDER BY nome")?;
            let linhas = stmt
                .query_map([], |r| {
                    Ok(serde_json::json!({
                        "id": r.get::<_, String>(0)?, "nome": r.get::<_, String>(1)?, "tipo": r.get::<_, String>(2)?,
                        "icone": r.get::<_, Option<String>>(3)?, "cor": r.get::<_, String>(4)?,
                        "padrao": r.get::<_, i64>(5)? != 0, "espaco": r.get::<_, String>(6)?, "criado_por": r.get::<_, Option<String>>(7)?,
                    }))
                })?
                .collect::<Result<Vec<_>, _>>()?;
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
                conn.execute(
                    "INSERT INTO categoria (id, nome, tipo, icone, cor, espaco, criado_por) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    rusqlite::params![id, payload.nome, payload.tipo, payload.icone, payload.cor, payload.espaco, autor],
                )
            }
        })
        .await?;
    Ok(Json(serde_json::json!({ "id": id })))
}

pub async fn atualizar(State(state): State<AppState>, Path(id): Path<String>, Json(payload): Json<CategoriaPayload>) -> AppResult<Json<serde_json::Value>> {
    let afetadas = state
        .db
        .with(move |conn| {
            conn.execute(
                "UPDATE categoria SET nome = ?1, tipo = ?2, icone = ?3, cor = ?4, atualizado_em = datetime('now') WHERE id = ?5",
                rusqlite::params![payload.nome, payload.tipo, payload.icone, payload.cor, id],
            )
        })
        .await?;
    if afetadas == 0 {
        return Err(AppError::new(ErrorCode::CategoryNotFound));
    }
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
            Ok(Some(serde_json::json!({ "transacoes": transacoes, "recorrencias": recorrencias, "pendencias": pendencias, "tipos": tipos, "amostra": amostra })))
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
}

enum Resultado {
    NaoExiste,
    PrecisaDecidir(i64),
    DestinoInexistente,
    DestinoIgual,
    DestinoIncompativel(String),
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
            tx.execute("DELETE FROM categoria WHERE id = ?1", [&id])?;
            tx.commit()?;
            Ok(Resultado::Apagada(usos))
        })
        .await?;
    match resultado {
        Resultado::Apagada(movidos) => Ok(Json(serde_json::json!({ "ok": true, "movidos": movidos }))),
        Resultado::NaoExiste | Resultado::DestinoInexistente => Err(AppError::new(ErrorCode::CategoryNotFound)),
        Resultado::PrecisaDecidir(n) => Err(AppError::new(ErrorCode::Conflict).with_message(format!("Esta categoria é usada por {n} {}. Escolha para onde movê-los antes de apagar.", if n == 1 { "item" } else { "itens" }))),
        Resultado::DestinoIgual => Err(AppError::new(ErrorCode::ValidationError).with_message("Escolha outra categoria como destino.")),
        Resultado::DestinoIncompativel(tipo) => Err(AppError::new(ErrorCode::ValidationError).with_message(format!("A categoria de destino é só de {}, e há itens do outro tipo. Escolha outra ou “Sem categoria”.", if tipo == "entrada" { "receitas" } else { "despesas" }))),
    }
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
}
