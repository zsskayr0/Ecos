//! `/vault/contas` (seção 11.14) — de onde/pra onde o dinheiro sai/entra,
//! incluindo carteira física (`banco = null`).

use axum::extract::{Path, State};
use axum::Json;
use ecos_core::{new_id, ErrorCode};
use rusqlite::OptionalExtension;
use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// Tipos aceitos para a conta.
const TIPOS: [&str; 6] = ["corrente", "poupanca", "carteira", "investimento", "cartao", "outro"];

/// Tabelas que apontam para uma conta.
const TABELAS_COM_CONTA: [&str; 2] = ["transacao", "transacao_recorrente"];

pub async fn listar(State(state): State<AppState>) -> AppResult<Json<serde_json::Value>> {
    let usuario = crate::db::autor_atual().unwrap_or_default();
    let linhas: Vec<serde_json::Value> = state
        .db
        .with(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT id, nome, banco, agencia, numero_conta, cor, padrao, espaco, criado_por, tipo, codigo_banco, saldo_inicial_centavos, sigla FROM conta ORDER BY nome",
            )?;
            let linhas = stmt
                .query_map([], |r| {
                    Ok(serde_json::json!({
                        "id": r.get::<_, String>(0)?, "nome": r.get::<_, String>(1)?, "banco": r.get::<_, Option<String>>(2)?,
                        "agencia": r.get::<_, Option<String>>(3)?, "numero_conta": r.get::<_, Option<String>>(4)?,
                        "cor": r.get::<_, String>(5)?, "padrao": r.get::<_, i64>(6)? != 0, "espaco": r.get::<_, String>(7)?,
                        "criado_por": r.get::<_, Option<String>>(8)?,
                        "tipo": r.get::<_, String>(9)?, "codigo_banco": r.get::<_, Option<String>>(10)?,
                        "saldo_inicial_centavos": r.get::<_, i64>(11)?, "sigla": r.get::<_, Option<String>>(12)?,
                    }))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            let mut linhas = linhas;
            // Ordem e conta padrão são de quem pergunta: o `padrao` da coluna só vale enquanto a pessoa não escolheu.
            super::preferencias::ordenar_por(&mut linhas, &super::preferencias::ler_ordem(conn, &usuario, super::preferencias::ORDEM_CONTAS)?);
            if let Some(escolhida) = super::preferencias::ler(conn, &usuario, super::preferencias::CONTA_PADRAO)?.and_then(|v| v.as_str().map(str::to_string)) {
                if linhas.iter().any(|l| l["id"] == escolhida.as_str()) {
                    for l in linhas.iter_mut() {
                        l["padrao"] = serde_json::json!(l["id"] == escolhida.as_str());
                    }
                }
            }
            Ok(linhas)
        })
        .await?;
    Ok(Json(serde_json::json!(linhas)))
}

#[derive(Debug, Deserialize)]
pub struct ContaPayload {
    pub nome: String,
    #[serde(default)]
    pub banco: Option<String>,
    #[serde(default)]
    pub agencia: Option<String>,
    #[serde(default)]
    pub numero_conta: Option<String>,
    #[serde(default = "cor_padrao")]
    pub cor: String,
    #[serde(default = "espaco_padrao")]
    pub espaco: String,
    #[serde(default = "tipo_padrao")]
    pub tipo: String,
    #[serde(default)]
    pub codigo_banco: Option<String>,
    #[serde(default)]
    pub saldo_inicial_centavos: i64,
    /// Sigla do selo de um banco personalizado (até 4 letras ou números).
    #[serde(default)]
    pub sigla: Option<String>,
}

fn cor_padrao() -> String {
    "#8f8f96".to_string()
}
fn espaco_padrao() -> String {
    "pessoal".to_string()
}
fn tipo_padrao() -> String {
    "corrente".to_string()
}

fn validar(payload: &ContaPayload) -> AppResult<()> {
    if payload.nome.trim().is_empty() {
        return Err(AppError::new(ErrorCode::ValidationError).with_message("nome não pode ser vazio"));
    }
    if !TIPOS.contains(&payload.tipo.as_str()) {
        return Err(AppError::new(ErrorCode::ValidationError).with_message("tipo de conta inválido"));
    }
    if let Some(s) = payload.sigla.as_deref().map(str::trim) {
        if s.chars().count() > 4 || !s.chars().all(|c| c.is_alphanumeric()) {
            return Err(AppError::new(ErrorCode::ValidationError).with_message("a sigla tem até 4 letras ou números"));
        }
    }
    // Dinheiro de verdade cabe com folga em 15 dígitos de centavos; isto só barra lixo.
    if payload.saldo_inicial_centavos.abs() > 999_999_999_999_999 {
        return Err(AppError::new(ErrorCode::ValidationError).with_message("saldo inicial fora do limite"));
    }
    Ok(())
}

pub async fn criar(State(state): State<AppState>, Json(payload): Json<ContaPayload>) -> AppResult<Json<serde_json::Value>> {
    validar(&payload)?;
    let id = new_id();
    let autor = crate::db::autor_atual();
    state
        .db
        .with({
            let id = id.clone();
            move |conn| {
                conn.execute(
                    "INSERT INTO conta (id, nome, banco, agencia, numero_conta, cor, espaco, criado_por, tipo, codigo_banco, saldo_inicial_centavos, sigla) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                    rusqlite::params![id, payload.nome.trim(), payload.banco, payload.agencia, payload.numero_conta, payload.cor, payload.espaco, autor, payload.tipo, payload.codigo_banco, payload.saldo_inicial_centavos, payload.sigla.as_deref().map(str::trim).filter(|x| !x.is_empty()).map(str::to_uppercase)],
                )
            }
        })
        .await?;
    Ok(Json(serde_json::json!({ "id": id })))
}

pub async fn atualizar(State(state): State<AppState>, Path(id): Path<String>, Json(payload): Json<ContaPayload>) -> AppResult<Json<serde_json::Value>> {
    validar(&payload)?;
    let afetadas = state
        .db
        .with(move |conn| {
            conn.execute(
                "UPDATE conta SET nome = ?1, banco = ?2, agencia = ?3, numero_conta = ?4, cor = ?5, tipo = ?6, codigo_banco = ?7, saldo_inicial_centavos = ?8, sigla = ?9, \
                 atualizado_em = datetime('now') WHERE id = ?10",
                rusqlite::params![payload.nome.trim(), payload.banco, payload.agencia, payload.numero_conta, payload.cor, payload.tipo, payload.codigo_banco, payload.saldo_inicial_centavos, payload.sigla.as_deref().map(str::trim).filter(|x| !x.is_empty()).map(str::to_uppercase), id],
            )
        })
        .await?;
    if afetadas == 0 {
        return Err(AppError::new(ErrorCode::AccountNotFound));
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// O que está pendurado numa conta, para a tela mostrar antes de apagar: contagens e os lançamentos mais recentes.
pub async fn uso(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let resposta = state
        .db
        .with(move |conn| {
            let existe: Option<i64> = conn.query_row("SELECT 1 FROM conta WHERE id = ?1", [&id], |r| r.get(0)).optional()?;
            if existe.is_none() {
                return Ok(None);
            }
            let contar = |tabela: &str| conn.query_row(&format!("SELECT COUNT(*) FROM {tabela} WHERE conta_id = ?1"), [&id], |r| r.get::<_, i64>(0));
            let (transacoes, recorrencias) = (contar("transacao")?, contar("transacao_recorrente")?);
            let mut stmt = conn.prepare("SELECT id, data, descricao, tipo, valor_centavos FROM transacao WHERE conta_id = ?1 ORDER BY data DESC, id DESC LIMIT 100")?;
            let amostra = stmt
                .query_map([&id], |r| Ok(serde_json::json!({ "id": r.get::<_, String>(0)?, "data": r.get::<_, String>(1)?, "descricao": r.get::<_, String>(2)?, "tipo": r.get::<_, String>(3)?, "valor_centavos": r.get::<_, i64>(4)? })))?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(Some(serde_json::json!({ "transacoes": transacoes, "recorrencias": recorrencias, "amostra": amostra })))
        })
        .await?;
    Ok(Json(resposta.ok_or(AppError::new(ErrorCode::AccountNotFound))?))
}

#[derive(Debug, Default, Deserialize)]
pub struct ExcluirPayload {
    /// Conta para onde vão os lançamentos e recorrências da que será apagada.
    pub mover_para: Option<String>,
    /// `true`: eles ficam sem conta.
    #[serde(default)]
    pub sem_conta: bool,
}

enum Resultado {
    NaoExiste,
    PrecisaDecidir(i64),
    DestinoInexistente,
    DestinoIgual,
    Apagada(i64),
}

/// Apaga uma conta. Se algo usa a conta, é obrigatório dizer para onde vai (`mover_para` ou `sem_conta`);
/// mover e apagar acontecem juntos, ou nada acontece. Mover para outra conta leva o saldo dos lançamentos junto,
/// mas o saldo inicial da conta apagada some com ela.
pub async fn excluir(State(state): State<AppState>, Path(id): Path<String>, corpo: Option<Json<ExcluirPayload>>) -> AppResult<Json<serde_json::Value>> {
    let decisao = corpo.map(|Json(c)| c).unwrap_or_default();
    if decisao.sem_conta && decisao.mover_para.is_some() {
        return Err(AppError::new(ErrorCode::ValidationError).with_message("Escolha um único destino para os itens da conta."));
    }
    let resultado = state
        .db
        .with(move |conn| {
            let tx = conn.unchecked_transaction()?;
            let existe: Option<i64> = tx.query_row("SELECT 1 FROM conta WHERE id = ?1", [&id], |r| r.get(0)).optional()?;
            if existe.is_none() {
                return Ok(Resultado::NaoExiste);
            }
            let mut usos = 0;
            for tabela in TABELAS_COM_CONTA {
                usos += tx.query_row(&format!("SELECT COUNT(*) FROM {tabela} WHERE conta_id = ?1"), [&id], |r| r.get::<_, i64>(0))?;
            }
            if usos > 0 {
                let destino: Option<String> = match (&decisao.mover_para, decisao.sem_conta) {
                    (None, false) => return Ok(Resultado::PrecisaDecidir(usos)),
                    (None, true) => None,
                    (Some(d), _) => {
                        if d == &id {
                            return Ok(Resultado::DestinoIgual);
                        }
                        let existe_destino: Option<i64> = tx.query_row("SELECT 1 FROM conta WHERE id = ?1", [d], |r| r.get(0)).optional()?;
                        if existe_destino.is_none() {
                            return Ok(Resultado::DestinoInexistente);
                        }
                        Some(d.clone())
                    }
                };
                for tabela in TABELAS_COM_CONTA {
                    tx.execute(&format!("UPDATE {tabela} SET conta_id = ?1, atualizado_em = datetime('now') WHERE conta_id = ?2"), rusqlite::params![destino, id])?;
                }
            }
            tx.execute("DELETE FROM conta WHERE id = ?1", [&id])?;
            tx.commit()?;
            Ok(Resultado::Apagada(usos))
        })
        .await?;
    match resultado {
        Resultado::Apagada(movidos) => Ok(Json(serde_json::json!({ "ok": true, "movidos": movidos }))),
        Resultado::NaoExiste | Resultado::DestinoInexistente => Err(AppError::new(ErrorCode::AccountNotFound)),
        Resultado::PrecisaDecidir(n) => Err(AppError::new(ErrorCode::Conflict).with_message(format!("Esta conta é usada por {n} {}. Escolha para onde movê-los antes de apagar.", if n == 1 { "item" } else { "itens" }))),
        Resultado::DestinoIgual => Err(AppError::new(ErrorCode::ValidationError).with_message("Escolha outra conta como destino.")),
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
        let raiz = std::env::temp_dir().join(format!("ecos-contas-{}", new_id()));
        let config = Arc::new(Config { porta: 0, db_path: raiz.join("vault/ecos-vault.db"), meta_path: raiz.join("vault/ecos-vault.meta.json"), backups_dir: raiz.join("backups") });
        std::fs::create_dir_all(raiz.join("vault")).unwrap();
        std::fs::create_dir_all(raiz.join("backups")).unwrap();
        (routes::montar(AppState { db: VaultDb::trancado(), config }), raiz)
    }

    async fn chamar(app: &Router, metodo: &str, uri: &str, corpo: Option<Value>) -> (StatusCode, Value) {
        let mut p = Request::builder().method(metodo).uri(uri).header("x-ecos-usuario", "ana");
        let body = match corpo {
            Some(c) => { p = p.header("content-type", "application/json"); Body::from(c.to_string()) }
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

    async fn conta(app: &Router, corpo: Value) -> String {
        let (s, c) = chamar(app, "POST", "/vault/contas", Some(corpo)).await;
        assert_eq!(s, StatusCode::OK, "{c}");
        c["id"].as_str().unwrap().to_string()
    }

    async fn lancar(app: &Router, conta_id: &str, tipo: &str, valor: i64) -> String {
        let (s, t) = chamar(app, "POST", "/vault/transacoes", Some(json!({ "tipo": tipo, "valor_centavos": valor, "data": "2026-09-30", "descricao": "teste", "conta_id": conta_id }))).await;
        assert_eq!(s, StatusCode::OK, "{t}");
        t["id"].as_str().unwrap().to_string()
    }

    async fn saldo(app: &Router, conta_id: &str) -> i64 {
        let (_, cfg) = chamar(app, "GET", "/vault/config", None).await;
        cfg["saldos_por_conta"].as_array().unwrap().iter().find(|c| c["conta_id"] == conta_id).unwrap()["saldo_centavos"].as_i64().unwrap()
    }

    #[tokio::test]
    async fn conta_guarda_tipo_banco_e_saldo_inicial_que_entra_no_saldo() {
        let (app, raiz) = app();
        ativar(&app).await;
        let id = conta(&app, json!({ "nome": "Nubank", "banco": "Nubank", "codigo_banco": "260", "agencia": "0001", "numero_conta": "123-4", "tipo": "corrente", "saldo_inicial_centavos": 100_000 })).await;
        lancar(&app, &id, "entrada", 25_000).await;
        lancar(&app, &id, "saida", 5_000).await;
        let (_, lista) = chamar(&app, "GET", "/vault/contas", None).await;
        let c = &lista.as_array().unwrap()[0];
        assert_eq!((c["tipo"].as_str(), c["codigo_banco"].as_str(), c["saldo_inicial_centavos"].as_i64()), (Some("corrente"), Some("260"), Some(100_000)));
        assert_eq!(saldo(&app, &id).await, 120_000, "saldo inicial + entradas − saídas");
        // Editar o saldo inicial move o saldo.
        let (s, _) = chamar(&app, "PATCH", &format!("/vault/contas/{id}"), Some(json!({ "nome": "Nubank", "tipo": "poupanca", "saldo_inicial_centavos": 0 }))).await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(saldo(&app, &id).await, 20_000);
        let _ = std::fs::remove_dir_all(raiz);
    }

    #[tokio::test]
    async fn sigla_do_banco_personalizado_e_guardada_em_maiusculas_e_validada() {
        let (app, raiz) = app();
        ativar(&app).await;
        let id = conta(&app, json!({ "nome": "Banco da Vila", "banco": "Banco da Vila", "sigla": " bv1 " })).await;
        let (_, lista) = chamar(&app, "GET", "/vault/contas", None).await;
        assert_eq!(lista[0]["sigla"], "BV1");
        // Sigla vazia limpa; longa demais ou com símbolo é recusada.
        assert_eq!(chamar(&app, "PATCH", &format!("/vault/contas/{id}"), Some(json!({ "nome": "Banco da Vila", "sigla": "" }))).await.0, StatusCode::OK);
        assert!(chamar(&app, "GET", "/vault/contas", None).await.1[0]["sigla"].is_null());
        assert_eq!(chamar(&app, "PATCH", &format!("/vault/contas/{id}"), Some(json!({ "nome": "X", "sigla": "ABCDE" }))).await.0, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(chamar(&app, "POST", "/vault/contas", Some(json!({ "nome": "X", "sigla": "A-B" }))).await.0, StatusCode::UNPROCESSABLE_ENTITY);
        let _ = std::fs::remove_dir_all(raiz);
    }

    #[tokio::test]
    async fn tipo_invalido_e_nome_vazio_sao_recusados() {
        let (app, raiz) = app();
        ativar(&app).await;
        assert_eq!(chamar(&app, "POST", "/vault/contas", Some(json!({ "nome": "X", "tipo": "banana" }))).await.0, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(chamar(&app, "POST", "/vault/contas", Some(json!({ "nome": "  " }))).await.0, StatusCode::UNPROCESSABLE_ENTITY);
        let _ = std::fs::remove_dir_all(raiz);
    }

    #[tokio::test]
    async fn apagar_conta_em_uso_exige_destino_e_move_atomicamente() {
        let (app, raiz) = app();
        ativar(&app).await;
        let a = conta(&app, json!({ "nome": "A" })).await;
        let b = conta(&app, json!({ "nome": "B" })).await;
        let t = lancar(&app, &a, "saida", 1000).await;
        let (s, uso) = chamar(&app, "GET", &format!("/vault/contas/{a}/uso"), None).await;
        assert_eq!((s, uso["transacoes"].as_i64()), (StatusCode::OK, Some(1)));
        // Sem decidir, recusa e nada muda.
        assert_eq!(chamar(&app, "DELETE", &format!("/vault/contas/{a}"), None).await.0, StatusCode::CONFLICT);
        assert_eq!(chamar(&app, "GET", &format!("/vault/transacoes/{t}"), None).await.1["conta_id"], json!(a));
        // Destino igual ou inexistente é recusado.
        assert_eq!(chamar(&app, "DELETE", &format!("/vault/contas/{a}"), Some(json!({ "mover_para": a }))).await.0, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(chamar(&app, "DELETE", &format!("/vault/contas/{a}"), Some(json!({ "mover_para": "nao-existe" }))).await.0, StatusCode::NOT_FOUND);
        // Mover para B.
        assert_eq!(chamar(&app, "DELETE", &format!("/vault/contas/{a}"), Some(json!({ "mover_para": b }))).await.0, StatusCode::OK);
        assert_eq!(chamar(&app, "GET", &format!("/vault/transacoes/{t}"), None).await.1["conta_id"], json!(b));
        assert_eq!(saldo(&app, &b).await, -1000);
        // Sem conta.
        assert_eq!(chamar(&app, "DELETE", &format!("/vault/contas/{b}"), Some(json!({ "sem_conta": true }))).await.0, StatusCode::OK);
        assert_eq!(chamar(&app, "GET", &format!("/vault/transacoes/{t}"), None).await.1["conta_id"], Value::Null);
        assert_eq!(chamar(&app, "DELETE", &format!("/vault/contas/{b}"), None).await.0, StatusCode::NOT_FOUND);
        let _ = std::fs::remove_dir_all(raiz);
    }
}
