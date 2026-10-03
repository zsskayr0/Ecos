//! `/vault/beneficiarios` (seção 11.14) — `POST` é find-or-create por nome; `PATCH` corrige o nome e `POST /mesclar`
//! junta nomes que são a mesma pessoa/empresa (conciliação na tela Sacados).

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
            let mut stmt = conn.prepare(
                "SELECT id, nome, documento, observacoes, \
                 (SELECT COUNT(*) FROM transacao t WHERE t.beneficiario_id = beneficiario.id) \
                 FROM beneficiario ORDER BY nome",
            )?;
            let linhas = stmt
                .query_map([], |r| {
                    Ok(serde_json::json!({
                        "id": r.get::<_, String>(0)?, "nome": r.get::<_, String>(1)?,
                        "documento": r.get::<_, Option<String>>(2)?, "observacoes": r.get::<_, Option<String>>(3)?,
                        "transacoes": r.get::<_, i64>(4)?,
                    }))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await?;
    Ok(Json(serde_json::json!(linhas)))
}

#[derive(Debug, Deserialize)]
pub struct BeneficiarioPayload {
    pub nome: String,
    #[serde(default)]
    pub documento: Option<String>,
    #[serde(default)]
    pub observacoes: Option<String>,
}

pub async fn criar_ou_encontrar(State(state): State<AppState>, Json(payload): Json<BeneficiarioPayload>) -> AppResult<Json<serde_json::Value>> {
    let nome = payload.nome.trim().to_string();
    let existente: Option<String> = state
        .db
        .with({
            let nome = nome.clone();
            move |conn| conn.query_row("SELECT id FROM beneficiario WHERE nome = ?1", [&nome], |r| r.get(0)).optional()
        })
        .await?;
    if let Some(id) = existente {
        return Ok(Json(serde_json::json!({ "id": id, "nome": nome, "novo": false })));
    }

    let id = new_id();
    let autor = crate::db::autor_atual();
    state
        .db
        .with({
            let id = id.clone();
            let nome = nome.clone();
            move |conn| conn.execute("INSERT INTO beneficiario (id, nome, documento, observacoes, criado_por) VALUES (?1, ?2, ?3, ?4, ?5)", rusqlite::params![id, nome, payload.documento, payload.observacoes, autor])
        })
        .await?;
    Ok(Json(serde_json::json!({ "id": id, "nome": nome, "novo": true })))
}

/// Tabelas que apontam para um beneficiário.
const TABELAS_COM_BENEFICIARIO: [&str; 3] = ["transacao", "transacao_recorrente", "pendencia_avulsa"];

fn limpar_nome(nome: &str) -> String {
    nome.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[derive(Debug, Deserialize)]
pub struct RenomearPayload {
    pub nome: String,
}

enum Renomeado {
    Feito,
    NomeEmUso,
    NaoExiste,
}

/// Corrige o nome de um beneficiário. Um nome que já é de outro cadastro não é aceito: a saída é mesclar os dois.
pub async fn renomear(State(state): State<AppState>, Path(id): Path<String>, Json(payload): Json<RenomearPayload>) -> AppResult<Json<serde_json::Value>> {
    let nome = limpar_nome(&payload.nome);
    if nome.is_empty() {
        return Err(AppError::new(ErrorCode::ValidationError).with_message("Informe o nome."));
    }
    let resultado = state
        .db
        .with({
            let nome = nome.clone();
            move |conn| {
                let outro: Option<String> = conn.query_row("SELECT id FROM beneficiario WHERE nome = ?1 AND id <> ?2", rusqlite::params![nome, id], |r| r.get(0)).optional()?;
                if outro.is_some() {
                    return Ok(Renomeado::NomeEmUso);
                }
                let n = conn.execute("UPDATE beneficiario SET nome = ?1 WHERE id = ?2", rusqlite::params![nome, id])?;
                Ok(if n == 0 { Renomeado::NaoExiste } else { Renomeado::Feito })
            }
        })
        .await?;
    match resultado {
        Renomeado::Feito => Ok(Json(serde_json::json!({ "ok": true, "nome": nome }))),
        Renomeado::NomeEmUso => Err(AppError::new(ErrorCode::Conflict).with_message("Já existe alguém com esse nome. Use “Mesclar” para juntar os dois cadastros.")),
        Renomeado::NaoExiste => Err(AppError::new(ErrorCode::NotFound)),
    }
}

#[derive(Debug, Deserialize)]
pub struct MesclarPayload {
    /// Cadastro que permanece.
    pub destino_id: String,
    /// Cadastros que passam a ser o destino e depois somem.
    pub origem_ids: Vec<String>,
    /// Nome final do destino (opcional); mantém o atual se ausente.
    #[serde(default)]
    pub nome: Option<String>,
}

enum Mescla {
    NaoExiste,
    NomeEmUso,
    Feita(i64),
}

/// Junta cadastros duplicados: lançamentos, recorrências e pendências das origens passam para o destino e as origens
/// são apagadas, tudo numa transação. O destino herda documento/observações que ainda não tinha.
pub async fn mesclar(State(state): State<AppState>, Json(payload): Json<MesclarPayload>) -> AppResult<Json<serde_json::Value>> {
    let origens: Vec<String> = payload.origem_ids.iter().filter(|o| **o != payload.destino_id).cloned().collect::<std::collections::BTreeSet<_>>().into_iter().collect();
    if origens.is_empty() {
        return Err(AppError::new(ErrorCode::ValidationError).with_message("Escolha ao menos um cadastro para juntar ao principal."));
    }
    let nome = payload.nome.as_deref().map(limpar_nome).filter(|n| !n.is_empty());
    let destino = payload.destino_id.clone();
    let resultado = state
        .db
        .with(move |conn| {
            let tx = conn.unchecked_transaction()?;
            let existe = |id: &str| -> rusqlite::Result<bool> { Ok(tx.query_row("SELECT 1 FROM beneficiario WHERE id = ?1", [id], |r| r.get::<_, i64>(0)).optional()?.is_some()) };
            if !existe(&destino)? {
                return Ok(Mescla::NaoExiste);
            }
            for o in &origens {
                if !existe(o)? {
                    return Ok(Mescla::NaoExiste);
                }
            }
            if let Some(n) = &nome {
                // O nome escolhido só pode coincidir com um cadastro que está sendo mesclado agora.
                let dono: Option<String> = tx.query_row("SELECT id FROM beneficiario WHERE nome = ?1", [n], |r| r.get(0)).optional()?;
                if let Some(dono) = dono {
                    if dono != destino && !origens.contains(&dono) {
                        return Ok(Mescla::NomeEmUso);
                    }
                }
            }
            let mut movidos = 0;
            for o in &origens {
                for tabela in TABELAS_COM_BENEFICIARIO {
                    movidos += tx.execute(&format!("UPDATE {tabela} SET beneficiario_id = ?1, atualizado_em = datetime('now') WHERE beneficiario_id = ?2"), rusqlite::params![destino, o])? as i64;
                }
                tx.execute(
                    "UPDATE beneficiario SET documento = COALESCE(documento, (SELECT documento FROM beneficiario WHERE id = ?2)), \
                     observacoes = COALESCE(observacoes, (SELECT observacoes FROM beneficiario WHERE id = ?2)) WHERE id = ?1",
                    rusqlite::params![destino, o],
                )?;
                tx.execute("DELETE FROM beneficiario WHERE id = ?1", [o])?;
            }
            if let Some(n) = &nome {
                tx.execute("UPDATE beneficiario SET nome = ?1 WHERE id = ?2", rusqlite::params![n, destino])?;
            }
            tx.commit()?;
            Ok(Mescla::Feita(movidos))
        })
        .await?;
    match resultado {
        Mescla::Feita(movidos) => Ok(Json(serde_json::json!({ "ok": true, "movidos": movidos }))),
        Mescla::NaoExiste => Err(AppError::new(ErrorCode::NotFound)),
        Mescla::NomeEmUso => Err(AppError::new(ErrorCode::Conflict).with_message("Esse nome já é de outro cadastro que não está nesta mescla.")),
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
        let raiz = std::env::temp_dir().join(format!("ecos-beneficiarios-{}", new_id()));
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

    async fn beneficiario(app: &Router, nome: &str) -> String {
        chamar(app, "POST", "/vault/beneficiarios", Some(json!({ "nome": nome }))).await.1["id"].as_str().unwrap().to_string()
    }

    async fn lancar(app: &Router, descricao: &str, beneficiario: &str) -> String {
        let (s, t) = chamar(app, "POST", "/vault/transacoes", Some(json!({ "tipo": "saida", "valor_centavos": 1000, "data": "2026-09-30", "descricao": descricao, "beneficiario_id": beneficiario }))).await;
        assert_eq!(s, StatusCode::OK, "{t}");
        t["id"].as_str().unwrap().to_string()
    }

    async fn nomes(app: &Router) -> Vec<String> {
        let (_, lista) = chamar(app, "GET", "/vault/beneficiarios", None).await;
        lista.as_array().unwrap().iter().map(|b| b["nome"].as_str().unwrap().to_string()).collect()
    }

    #[tokio::test]
    async fn renomear_corrige_o_nome_e_recusa_o_de_outro_cadastro() {
        let (app, raiz) = app();
        ativar(&app).await;
        let a = beneficiario(&app, "Mercado Extra ").await;
        let b = beneficiario(&app, "Padaria").await;
        let (s, r) = chamar(&app, "PATCH", &format!("/vault/beneficiarios/{a}"), Some(json!({ "nome": "  Mercado   Extra " }))).await;
        assert_eq!(s, StatusCode::OK, "{r}");
        assert_eq!(r["nome"], "Mercado Extra");
        assert_eq!(chamar(&app, "PATCH", &format!("/vault/beneficiarios/{a}"), Some(json!({ "nome": "Padaria" }))).await.0, StatusCode::CONFLICT);
        assert_eq!(chamar(&app, "PATCH", &format!("/vault/beneficiarios/{b}"), Some(json!({ "nome": "  " }))).await.0, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(chamar(&app, "PATCH", "/vault/beneficiarios/fantasma", Some(json!({ "nome": "X" }))).await.0, StatusCode::NOT_FOUND);
        drop(app);
        let _ = std::fs::remove_dir_all(raiz);
    }

    #[tokio::test]
    async fn mesclar_leva_os_lancamentos_para_o_destino_e_apaga_as_origens() {
        let (app, raiz) = app();
        ativar(&app).await;
        let certo = beneficiario(&app, "Mercado Extra").await;
        let erro1 = beneficiario(&app, "Mercdo Extra").await;
        let erro2 = beneficiario(&app, "mercado  extra ltda").await;
        let t1 = lancar(&app, "Compra 1", &erro1).await;
        let t2 = lancar(&app, "Compra 2", &erro2).await;
        let (_, lista) = chamar(&app, "GET", "/vault/beneficiarios", None).await;
        assert_eq!(lista.as_array().unwrap().iter().find(|b| b["id"] == erro1.as_str()).unwrap()["transacoes"], 1);

        let (s, r) = chamar(&app, "POST", "/vault/beneficiarios/mesclar", Some(json!({ "destino_id": certo, "origem_ids": [erro1, erro2, erro1, certo] }))).await;
        assert_eq!(s, StatusCode::OK, "{r}");
        assert_eq!(r["movidos"], 2);
        for t in [t1, t2] {
            assert_eq!(chamar(&app, "GET", &format!("/vault/transacoes/{t}"), None).await.1["beneficiario_id"], certo.as_str());
        }
        assert_eq!(nomes(&app).await, vec!["Mercado Extra".to_string()], "as origens somem; nada fica apontando para elas");
        drop(app);
        let _ = std::fs::remove_dir_all(raiz);
    }

    #[tokio::test]
    async fn mesclar_valida_antes_de_mexer_em_qualquer_coisa() {
        let (app, raiz) = app();
        ativar(&app).await;
        let a = beneficiario(&app, "Ana").await;
        let b = beneficiario(&app, "Ana Maria").await;
        beneficiario(&app, "Carlos").await;
        let t = lancar(&app, "Pix", &b).await;
        let uri = "/vault/beneficiarios/mesclar";
        assert_eq!(chamar(&app, "POST", uri, Some(json!({ "destino_id": a, "origem_ids": [] }))).await.0, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(chamar(&app, "POST", uri, Some(json!({ "destino_id": a, "origem_ids": [a] }))).await.0, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(chamar(&app, "POST", uri, Some(json!({ "destino_id": "fantasma", "origem_ids": [b] }))).await.0, StatusCode::NOT_FOUND);
        assert_eq!(chamar(&app, "POST", uri, Some(json!({ "destino_id": a, "origem_ids": [b, "fantasma"] }))).await.0, StatusCode::NOT_FOUND);
        // O nome final não pode ser o de um cadastro que fica de fora.
        assert_eq!(chamar(&app, "POST", uri, Some(json!({ "destino_id": a, "origem_ids": [b], "nome": "Carlos" }))).await.0, StatusCode::CONFLICT);
        assert_eq!(chamar(&app, "GET", &format!("/vault/transacoes/{t}"), None).await.1["beneficiario_id"], b.as_str());
        // Com nome novo, o destino é renomeado.
        assert_eq!(chamar(&app, "POST", uri, Some(json!({ "destino_id": a, "origem_ids": [b], "nome": "Ana Maria Souza" }))).await.0, StatusCode::OK);
        assert_eq!(nomes(&app).await, vec!["Ana Maria Souza".to_string(), "Carlos".to_string()]);
        drop(app);
        let _ = std::fs::remove_dir_all(raiz);
    }
}
