//! Equipes (seção 11.10) — matriz de cargos da seção 5.2 (todas as ações
//! `true` no MVP pra Membro comum, mas o middleware de autorização já
//! valida por `cargo`, pra não exigir retrabalho de segurança depois).

use axum::extract::{Path, State};
use axum::{Extension, Json};
use chrono::{Duration, Utc};
use ecos_core::{new_id, ErrorCode};
use rand::Rng;
use rusqlite::OptionalExtension;
use serde::Deserialize;

use crate::error::{AppError, AppResult, CampoInvalido};
use crate::middleware::auth_guard::UsuarioAutenticado;
use crate::state::AppState;

async fn cargo_do_usuario(state: &AppState, equipe_id: &str, usuario_id: &str) -> AppResult<Option<String>> {
    let (equipe_id, usuario_id) = (equipe_id.to_string(), usuario_id.to_string());
    let cargo: Option<String> = state
        .db
        .with(move |conn| {
            conn.query_row(
                "SELECT cargo FROM membro_equipe WHERE equipe_id = ?1 AND usuario_id = ?2",
                rusqlite::params![equipe_id, usuario_id],
                |r| r.get(0),
            )
            .optional()
        })
        .await?;
    Ok(cargo)
}

fn exigir_cargo(cargo: &Option<String>, permitidos: &[&str]) -> AppResult<()> {
    match cargo {
        Some(c) if permitidos.contains(&c.as_str()) => Ok(()),
        Some(_) => Err(AppError::new(ErrorCode::Forbidden)),
        None => Err(AppError::new(ErrorCode::Forbidden)),
    }
}

pub async fn listar_minhas(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>) -> AppResult<Json<serde_json::Value>> {
    let equipes: Vec<serde_json::Value> = state
        .db
        .with(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT e.id, e.nome, m.cargo FROM equipe e JOIN membro_equipe m ON m.equipe_id = e.id WHERE m.usuario_id = ?1",
            )?;
            let linhas = stmt
                .query_map([&usuario.0], |r| {
                    Ok(serde_json::json!({ "id": r.get::<_, String>(0)?, "nome": r.get::<_, String>(1)?, "cargo": r.get::<_, String>(2)? }))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await?;
    Ok(Json(serde_json::json!(equipes)))
}

#[derive(Debug, Deserialize)]
pub struct CriarEquipePayload {
    pub nome: String,
}

pub async fn criar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Json(payload): Json<CriarEquipePayload>) -> AppResult<Json<serde_json::Value>> {
    if payload.nome.trim().is_empty() {
        return Err(AppError::validation(vec![CampoInvalido { campo: "nome".into(), motivo: "não pode ser vazio".into() }]));
    }
    let id = new_id();
    state
        .db
        .with({
            let id = id.clone();
            move |conn| {
                let tx = conn.unchecked_transaction()?;
                tx.execute("INSERT INTO equipe (id, nome) VALUES (?1, ?2)", rusqlite::params![id, payload.nome])?;
                tx.execute(
                    "INSERT INTO membro_equipe (equipe_id, usuario_id, cargo) VALUES (?1, ?2, 'dono')",
                    rusqlite::params![id, usuario.0],
                )?;
                tx.commit()
            }
        })
        .await?;
    Ok(Json(serde_json::json!({ "id": id })))
}

pub async fn obter(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    // Quem não é da equipe (nem administra a instância) não sabe nem que ela existe.
    if cargo_do_usuario(&state, &id, &usuario.0).await?.is_none() && !crate::admin::e_admin(&state, &usuario.0).await? {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    let id2 = id.clone();
    let equipe: Option<(String, String)> = state
        .db
        .with(move |conn| conn.query_row("SELECT id, nome FROM equipe WHERE id = ?1", [&id2], |r| Ok((r.get(0)?, r.get(1)?))).optional())
        .await?;
    let (id, nome) = equipe.ok_or(AppError::new(ErrorCode::NotFound))?;

    let (notas, tarefas): (i64, i64) = state
        .db
        .with({
            let espaco = format!("equipe:{id}");
            move |conn| {
                let notas: i64 = conn.query_row("SELECT COUNT(*) FROM nota WHERE espaco = ?1", [&espaco], |r| r.get(0))?;
                let tarefas: i64 = conn.query_row("SELECT COUNT(*) FROM tarefa WHERE espaco = ?1", [&espaco], |r| r.get(0))?;
                Ok((notas, tarefas))
            }
        })
        .await?;

    Ok(Json(serde_json::json!({ "id": id, "nome": nome, "estatisticas": { "notas": notas, "tarefas": tarefas } })))
}

#[derive(Debug, Deserialize)]
pub struct AtualizarEquipePayload {
    pub nome: String,
}

pub async fn atualizar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(id): Path<String>, Json(payload): Json<AtualizarEquipePayload>) -> AppResult<Json<serde_json::Value>> {
    exigir_cargo(&cargo_do_usuario(&state, &id, &usuario.0).await?, &["dono", "admin"])?;
    let afetadas = state
        .db
        .with(move |conn| conn.execute("UPDATE equipe SET nome = ?1 WHERE id = ?2", rusqlite::params![payload.nome, id]))
        .await?;
    if afetadas == 0 {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Debug, Deserialize)]
pub struct ConfirmarPayload {
    pub confirm: String,
}

/// `DELETE /equipes/:id` — só Dono, exige `{confirm:"EXCLUIR EQUIPE"}`
/// (seção 5.4: confirmação explícita por frase em toda ação destrutiva de
/// larga escala, não só o Cofre).
pub async fn excluir(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(id): Path<String>, Json(payload): Json<ConfirmarPayload>) -> AppResult<Json<serde_json::Value>> {
    exigir_cargo(&cargo_do_usuario(&state, &id, &usuario.0).await?, &["dono"])?;
    if payload.confirm != "EXCLUIR EQUIPE" {
        return Err(AppError::new(ErrorCode::ConfirmationPhraseRequired));
    }
    state.db.with(move |conn| conn.execute("DELETE FROM equipe WHERE id = ?1", [&id])).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Só quem é membro da Equipe vê quem participa dela, e só o necessário: o id, o cargo e o nome de exibição (ou, sem ele, o nome de usuário).
pub async fn listar_membros(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    exigir_cargo(&cargo_do_usuario(&state, &id, &usuario.0).await?, &["dono", "admin", "membro"])?;
    let membros: Vec<serde_json::Value> = state
        .db
        .with(move |conn| {
            let mut stmt = conn.prepare("SELECT m.usuario_id, m.cargo, COALESCE(NULLIF(TRIM(u.nome), ''), u.nome_usuario) FROM membro_equipe m JOIN usuario u ON u.id = m.usuario_id WHERE m.equipe_id = ?1 ORDER BY u.nome_usuario COLLATE NOCASE")?;
            let linhas = stmt
                .query_map([&id], |r| {
                    Ok(serde_json::json!({ "usuario_id": r.get::<_, String>(0)?, "cargo": r.get::<_, String>(1)?, "nome": r.get::<_, String>(2)? }))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await?;
    Ok(Json(serde_json::json!(membros)))
}

#[derive(Debug, Deserialize)]
pub struct TrocarCargoPayload {
    pub cargo: String,
}

pub async fn trocar_cargo(
    State(state): State<AppState>,
    Extension(usuario): Extension<UsuarioAutenticado>,
    Path((equipe_id, usuario_alvo)): Path<(String, String)>,
    Json(payload): Json<TrocarCargoPayload>,
) -> AppResult<Json<serde_json::Value>> {
    exigir_cargo(&cargo_do_usuario(&state, &equipe_id, &usuario.0).await?, &["dono", "admin"])?;
    if !["dono", "admin", "membro"].contains(&payload.cargo.as_str()) {
        return Err(AppError::validation(vec![CampoInvalido { campo: "cargo".into(), motivo: "inválido".into() }]));
    }
    // Só quem é dono passa a propriedade (um cargo "admin" da equipe não se promove a dono).
    if payload.cargo == "dono" && cargo_do_usuario(&state, &equipe_id, &usuario.0).await?.as_deref() != Some("dono") {
        return Err(AppError::new(ErrorCode::Forbidden));
    }
    state
        .db
        .with(move |conn| {
            conn.execute(
                "UPDATE membro_equipe SET cargo = ?1 WHERE equipe_id = ?2 AND usuario_id = ?3",
                rusqlite::params![payload.cargo, equipe_id, usuario_alvo],
            )
        })
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn remover_membro(
    State(state): State<AppState>,
    Extension(usuario): Extension<UsuarioAutenticado>,
    Path((equipe_id, usuario_alvo)): Path<(String, String)>,
) -> AppResult<Json<serde_json::Value>> {
    exigir_cargo(&cargo_do_usuario(&state, &equipe_id, &usuario.0).await?, &["dono", "admin"])?;
    state
        .db
        .with(move |conn| conn.execute("DELETE FROM membro_equipe WHERE equipe_id = ?1 AND usuario_id = ?2", rusqlite::params![equipe_id, usuario_alvo]))
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// `POST /equipes/:id/sair` — a própria pessoa deixa a equipe. Os itens que ela criou continuam na equipe
/// com a autoria original (histórico compartilhado). Dono com outras pessoas precisa transferir a
/// propriedade antes; quem é a única pessoa deve excluir a equipe.
pub async fn sair(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(equipe_id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let cargo = cargo_do_usuario(&state, &equipe_id, &usuario.0).await?;
    exigir_cargo(&cargo, &["dono", "admin", "membro"])?;
    let total: i64 = state.db.with({ let id = equipe_id.clone(); move |conn| conn.query_row("SELECT COUNT(*) FROM membro_equipe WHERE equipe_id = ?1", [&id], |r| r.get(0)) }).await?;
    if total <= 1 {
        return Err(AppError::new(ErrorCode::Conflict).with_message("Você é a única pessoa desta equipe. Para sair, exclua a equipe."));
    }
    if cargo.as_deref() == Some("dono") {
        return Err(AppError::new(ErrorCode::Conflict).with_message("Você é dono desta equipe. Transfira a propriedade para outra pessoa antes de sair."));
    }
    state.db.with(move |conn| conn.execute("DELETE FROM membro_equipe WHERE equipe_id = ?1 AND usuario_id = ?2", rusqlite::params![equipe_id, usuario.0])).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

fn gerar_codigo_convite() -> String {
    let mut rng = rand::thread_rng();
    (0..8).map(|_| rng.sample(rand::distributions::Alphanumeric) as char).collect::<String>().to_uppercase()
}

pub async fn criar_convite(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    // Dono e admin da equipe (ou quem administra a instância) geram convites; o convite vira o QR code da equipe.
    if !crate::admin::e_admin(&state, &usuario.0).await? {
        exigir_cargo(&cargo_do_usuario(&state, &id, &usuario.0).await?, &["dono", "admin"])?;
    }
    let convite_id = new_id();
    let codigo = gerar_codigo_convite();
    let expira_em = (Utc::now() + Duration::days(7)).to_rfc3339();
    state
        .db
        .with({
            let convite_id = convite_id.clone();
            let codigo = codigo.clone();
            let expira_em = expira_em.clone();
            move |conn| {
                conn.execute(
                    "INSERT INTO convite_equipe (id, equipe_id, codigo, estado, expira_em) VALUES (?1, ?2, ?3, 'pendente', ?4)",
                    rusqlite::params![convite_id, id, codigo, expira_em],
                )
            }
        })
        .await?;
    Ok(Json(serde_json::json!({ "id": convite_id, "codigo": codigo, "expira_em": expira_em })))
}

pub async fn aceitar_convite(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(codigo): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let codigo = codigo.trim().to_uppercase();
    let convite: Option<(String, String, String, String)> = state
        .db
        .with(move |conn| {
            conn.query_row(
                "SELECT id, equipe_id, estado, expira_em FROM convite_equipe WHERE codigo = ?1",
                [&codigo],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .optional()
        })
        .await?;
    let (convite_id, equipe_id, estado, expira_em) = convite.ok_or(AppError::new(ErrorCode::NotFound))?;
    let vencido = chrono::DateTime::parse_from_rfc3339(&expira_em).map(|d| d < Utc::now()).unwrap_or(true);
    if estado != "pendente" || vencido {
        return Err(AppError::new(ErrorCode::Conflict).with_message("Este convite já foi usado ou expirou."));
    }

    state
        .db
        .with(move |conn| {
            let tx = conn.unchecked_transaction()?;
            tx.execute(
                "INSERT OR IGNORE INTO membro_equipe (equipe_id, usuario_id, cargo) VALUES (?1, ?2, 'membro')",
                rusqlite::params![equipe_id, usuario.0],
            )?;
            tx.execute("UPDATE convite_equipe SET estado = 'aceito' WHERE id = ?1", [&convite_id])?;
            tx.commit()
        })
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[cfg(test)]
mod testes;
