//! `/vault/formas-pagamento`: formas de pagamento cadastráveis. Os lançamentos e recorrências guardam o `codigo`
//! (texto estável) em `forma_pagamento`; renomear muda só o `nome`. As de fábrica (`padrao`) não se apagam.

use axum::extract::{Path, State};
use axum::Json;
use ecos_core::ErrorCode;
use rusqlite::{Connection, OptionalExtension};
use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// A forma existe no cadastro? (Inativa também vale: lançamentos antigos continuam válidos.)
pub fn existe(conn: &Connection, codigo: &str) -> bool {
    conn.query_row("SELECT 1 FROM forma_pagamento WHERE codigo = ?1", [codigo], |r| r.get::<_, i64>(0)).optional().ok().flatten().is_some()
}

/// Validação usada por lançamentos e recorrências: `None` é "sem forma" e vale.
pub async fn checar(state: &AppState, codigo: &Option<String>) -> AppResult<()> {
    let Some(codigo) = codigo.clone() else { return Ok(()) };
    if state.db.with(move |conn| Ok(existe(conn, &codigo))).await? {
        Ok(())
    } else {
        Err(AppError::new(ErrorCode::PaymentMethodInvalid))
    }
}

/// "Cartão de Débito" → `cartao_de_debito`: minúsculas, sem acento, só `[a-z0-9_]`.
pub(crate) fn gerar_codigo(nome: &str) -> String {
    let mut codigo = String::new();
    for c in nome.trim().to_lowercase().chars() {
        let c = match c {
            'á' | 'à' | 'â' | 'ã' | 'ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            c if c.is_ascii_alphanumeric() => c,
            _ => '_',
        };
        if c == '_' && (codigo.is_empty() || codigo.ends_with('_')) {
            continue;
        }
        codigo.push(c);
    }
    let codigo: String = codigo.trim_end_matches('_').chars().take(40).collect();
    if codigo.is_empty() { "forma".to_string() } else { codigo }
}

fn nome_valido(nome: &str) -> AppResult<String> {
    let nome = nome.trim();
    if nome.is_empty() || nome.chars().count() > 40 {
        return Err(AppError::new(ErrorCode::ValidationError).with_message("O nome da forma de pagamento precisa ter de 1 a 40 caracteres."));
    }
    Ok(nome.to_string())
}

fn nome_repetido() -> AppError {
    AppError::new(ErrorCode::Conflict).with_message("Já existe uma forma de pagamento com esse nome.")
}

pub async fn listar(State(state): State<AppState>) -> AppResult<Json<serde_json::Value>> {
    let linhas: Vec<serde_json::Value> = state
        .db
        .with(|conn| {
            let mut stmt = conn.prepare(
                "SELECT f.codigo, f.nome, f.icone, f.cor, f.padrao, f.ativa, f.ordem, f.criado_por, \
                        (SELECT COUNT(*) FROM transacao t WHERE t.forma_pagamento = f.codigo) + \
                        (SELECT COUNT(*) FROM transacao_recorrente r WHERE r.forma_pagamento = f.codigo) \
                 FROM forma_pagamento f ORDER BY f.ordem, f.nome COLLATE NOCASE",
            )?;
            let linhas = stmt
                .query_map([], |r| {
                    Ok(serde_json::json!({
                        "codigo": r.get::<_, String>(0)?, "nome": r.get::<_, String>(1)?, "icone": r.get::<_, Option<String>>(2)?,
                        "cor": r.get::<_, Option<String>>(3)?, "padrao": r.get::<_, i64>(4)? != 0, "ativa": r.get::<_, i64>(5)? != 0,
                        "ordem": r.get::<_, i64>(6)?, "criado_por": r.get::<_, Option<String>>(7)?, "usos": r.get::<_, i64>(8)?,
                    }))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await?;
    Ok(Json(serde_json::json!(linhas)))
}

#[derive(Debug, Deserialize)]
pub struct CriarPayload {
    pub nome: String,
    #[serde(default)]
    pub icone: Option<String>,
    #[serde(default)]
    pub cor: Option<String>,
}

pub async fn criar(State(state): State<AppState>, Json(payload): Json<CriarPayload>) -> AppResult<Json<serde_json::Value>> {
    let nome = nome_valido(&payload.nome)?;
    let autor = crate::db::autor_atual();
    let resultado = state
        .db
        .with(move |conn| {
            let repetido: Option<i64> = conn.query_row("SELECT 1 FROM forma_pagamento WHERE lower(nome) = lower(?1)", [&nome], |r| r.get(0)).optional()?;
            if repetido.is_some() {
                return Ok(None);
            }
            let base = gerar_codigo(&nome);
            let mut codigo = base.clone();
            let mut n = 2;
            while existe(conn, &codigo) {
                codigo = format!("{base}_{n}");
                n += 1;
            }
            conn.execute(
                "INSERT INTO forma_pagamento (codigo, nome, icone, cor, ordem, criado_por) VALUES (?1, ?2, ?3, ?4, (SELECT COALESCE(MAX(ordem), 0) + 1 FROM forma_pagamento), ?5)",
                rusqlite::params![codigo, nome, payload.icone, payload.cor, autor],
            )?;
            Ok(Some(codigo))
        })
        .await?;
    let codigo = resultado.ok_or_else(nome_repetido)?;
    Ok(Json(serde_json::json!({ "codigo": codigo })))
}

/// Campos omitidos não mudam. `icone` e `cor` aceitam `null` para limpar.
#[derive(Debug, Deserialize)]
pub struct AtualizarPayload {
    #[serde(default)]
    pub nome: Option<String>,
    #[serde(default, deserialize_with = "campo_opcional")]
    pub icone: Option<Option<String>>,
    #[serde(default, deserialize_with = "campo_opcional")]
    pub cor: Option<Option<String>>,
    #[serde(default)]
    pub ativa: Option<bool>,
}

fn campo_opcional<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Option<String>>, D::Error> {
    Option::<String>::deserialize(d).map(Some)
}

pub async fn atualizar(State(state): State<AppState>, Path(codigo): Path<String>, Json(payload): Json<AtualizarPayload>) -> AppResult<Json<serde_json::Value>> {
    let nome = payload.nome.as_deref().map(nome_valido).transpose()?;
    // 0 = não existe, 1 = ok, 2 = nome repetido.
    let resultado = state
        .db
        .with(move |conn| {
            if !existe(conn, &codigo) {
                return Ok(0u8);
            }
            if let Some(nome) = &nome {
                let outro: Option<i64> = conn
                    .query_row("SELECT 1 FROM forma_pagamento WHERE lower(nome) = lower(?1) AND codigo <> ?2", rusqlite::params![nome, codigo], |r| r.get(0))
                    .optional()?;
                if outro.is_some() {
                    return Ok(2);
                }
            }
            let tx = conn.unchecked_transaction()?;
            if let Some(nome) = &nome {
                tx.execute("UPDATE forma_pagamento SET nome = ?1 WHERE codigo = ?2", rusqlite::params![nome, codigo])?;
            }
            if let Some(icone) = &payload.icone {
                tx.execute("UPDATE forma_pagamento SET icone = ?1 WHERE codigo = ?2", rusqlite::params![icone, codigo])?;
            }
            if let Some(cor) = &payload.cor {
                tx.execute("UPDATE forma_pagamento SET cor = ?1 WHERE codigo = ?2", rusqlite::params![cor, codigo])?;
            }
            if let Some(ativa) = payload.ativa {
                tx.execute("UPDATE forma_pagamento SET ativa = ?1 WHERE codigo = ?2", rusqlite::params![ativa as i64, codigo])?;
            }
            tx.execute("UPDATE forma_pagamento SET atualizado_em = datetime('now') WHERE codigo = ?1", [&codigo])?;
            tx.commit()?;
            Ok(1)
        })
        .await?;
    match resultado {
        0 => Err(AppError::new(ErrorCode::NotFound)),
        2 => Err(nome_repetido()),
        _ => Ok(Json(serde_json::json!({ "ok": true }))),
    }
}

/// O que usa a forma, para a tela mostrar antes de apagar: contagens e os lançamentos mais recentes.
pub async fn uso(State(state): State<AppState>, Path(codigo): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let resposta = state
        .db
        .with(move |conn| {
            if !existe(conn, &codigo) {
                return Ok(None);
            }
            let contar = |tabela: &str| conn.query_row(&format!("SELECT COUNT(*) FROM {tabela} WHERE forma_pagamento = ?1"), [&codigo], |r| r.get::<_, i64>(0));
            let (transacoes, recorrencias) = (contar("transacao")?, contar("transacao_recorrente")?);
            let mut stmt = conn.prepare("SELECT id, data, descricao, tipo, valor_centavos FROM transacao WHERE forma_pagamento = ?1 ORDER BY data DESC, id DESC LIMIT 100")?;
            let amostra = stmt
                .query_map([&codigo], |r| {
                    Ok(serde_json::json!({ "id": r.get::<_, String>(0)?, "data": r.get::<_, String>(1)?, "descricao": r.get::<_, String>(2)?, "tipo": r.get::<_, String>(3)?, "valor_centavos": r.get::<_, i64>(4)? }))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(Some(serde_json::json!({ "transacoes": transacoes, "recorrencias": recorrencias, "amostra": amostra })))
        })
        .await?;
    Ok(Json(resposta.ok_or(AppError::new(ErrorCode::NotFound))?))
}

#[derive(Debug, Default, Deserialize)]
pub struct ExcluirPayload {
    /// Forma para onde vão os lançamentos e recorrências da que será apagada.
    pub mover_para: Option<String>,
    /// `true`: eles ficam sem forma de pagamento.
    #[serde(default)]
    pub sem_forma: bool,
}

enum Resultado {
    NaoExiste,
    DeFabrica,
    PrecisaDecidir(i64),
    DestinoInexistente,
    DestinoIgual,
    Apagada(i64),
}

/// Apaga uma forma criada pela pessoa. Se algo a usa, é obrigatório dizer para onde vai (`mover_para` ou `sem_forma`);
/// mover e apagar acontecem juntos, ou nada acontece. As de fábrica só se desativam.
pub async fn excluir(State(state): State<AppState>, Path(codigo): Path<String>, corpo: Option<Json<ExcluirPayload>>) -> AppResult<Json<serde_json::Value>> {
    let decisao = corpo.map(|Json(c)| c).unwrap_or_default();
    if decisao.sem_forma && decisao.mover_para.is_some() {
        return Err(AppError::new(ErrorCode::ValidationError).with_message("Escolha um único destino para os itens desta forma."));
    }
    let resultado = state
        .db
        .with(move |conn| {
            let tx = conn.unchecked_transaction()?;
            let padrao: Option<i64> = tx.query_row("SELECT padrao FROM forma_pagamento WHERE codigo = ?1", [&codigo], |r| r.get(0)).optional()?;
            match padrao {
                None => return Ok(Resultado::NaoExiste),
                Some(p) if p != 0 => return Ok(Resultado::DeFabrica),
                _ => {}
            }
            let mut usos = 0;
            for tabela in ["transacao", "transacao_recorrente"] {
                usos += tx.query_row(&format!("SELECT COUNT(*) FROM {tabela} WHERE forma_pagamento = ?1"), [&codigo], |r| r.get::<_, i64>(0))?;
            }
            if usos > 0 {
                let destino: Option<String> = match (&decisao.mover_para, decisao.sem_forma) {
                    (None, false) => return Ok(Resultado::PrecisaDecidir(usos)),
                    (None, true) => None,
                    (Some(d), _) => {
                        if d == &codigo {
                            return Ok(Resultado::DestinoIgual);
                        }
                        if !existe(&tx, d) {
                            return Ok(Resultado::DestinoInexistente);
                        }
                        Some(d.clone())
                    }
                };
                tx.execute("UPDATE transacao SET forma_pagamento = ?1, atualizado_em = datetime('now') WHERE forma_pagamento = ?2", rusqlite::params![destino, codigo])?;
                tx.execute("UPDATE transacao_recorrente SET forma_pagamento = ?1, atualizado_em = datetime('now') WHERE forma_pagamento = ?2", rusqlite::params![destino, codigo])?;
            }
            tx.execute("DELETE FROM forma_pagamento WHERE codigo = ?1", [&codigo])?;
            tx.commit()?;
            Ok(Resultado::Apagada(usos))
        })
        .await?;
    match resultado {
        Resultado::Apagada(movidos) => Ok(Json(serde_json::json!({ "ok": true, "movidos": movidos }))),
        Resultado::NaoExiste | Resultado::DestinoInexistente => Err(AppError::new(ErrorCode::NotFound)),
        Resultado::DeFabrica => Err(AppError::new(ErrorCode::Conflict).with_message("As formas de pagamento de fábrica não podem ser apagadas. Desative a que você não usa.")),
        Resultado::PrecisaDecidir(n) => Err(AppError::new(ErrorCode::Conflict).with_message(format!("Esta forma de pagamento é usada por {n} {}. Escolha para onde movê-los antes de apagar.", if n == 1 { "item" } else { "itens" }))),
        Resultado::DestinoIgual => Err(AppError::new(ErrorCode::ValidationError).with_message("Escolha outra forma de pagamento como destino.")),
    }
}
