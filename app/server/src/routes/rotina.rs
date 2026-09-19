//! Perfil de Rotina (seção 11.9) — alimenta o cálculo de capacidade do dia
//! (seção 4.3 do handoff / `GET /agenda/capacidade`).

use axum::extract::{Path, State};
use axum::Extension;
use axum::Json;
use ecos_core::{new_id, ErrorCode};
use serde::Deserialize;

use crate::error::{AppError, AppResult, CampoInvalido};
use crate::middleware::auth_guard::UsuarioAutenticado;
use crate::state::AppState;

const TIPOS_VALIDOS: &[&str] = &["sono", "trabalho_fixo", "refeicao", "deslocamento", "bloqueio_pessoal", "outro"];
const CLASSIFICACOES_VALIDAS: &[&str] = &["indisponivel", "disponivel_producao", "tempo_livre"];

pub async fn listar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>) -> AppResult<Json<serde_json::Value>> {
    let blocos: Vec<serde_json::Value> = state
        .db
        .with(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT id, tipo, hora_inicio, hora_fim, dias_semana, classificacao FROM bloco_rotina WHERE usuario_id = ?1",
            )?;
            let linhas = stmt
                .query_map([&usuario.0], |r| {
                    Ok(serde_json::json!({
                        "id": r.get::<_, String>(0)?, "tipo": r.get::<_, String>(1)?,
                        "hora_inicio": r.get::<_, String>(2)?, "hora_fim": r.get::<_, String>(3)?,
                        "dias_semana": r.get::<_, String>(4)?, "classificacao": r.get::<_, String>(5)?,
                    }))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await?;
    Ok(Json(serde_json::json!(blocos)))
}

#[derive(Debug, Deserialize)]
pub struct BlocoPayload {
    pub tipo: String,
    pub hora_inicio: String,
    pub hora_fim: String,
    pub dias_semana: String,
    pub classificacao: String,
}

fn validar_bloco(payload: &BlocoPayload) -> AppResult<()> {
    let mut campos = Vec::new();
    if !TIPOS_VALIDOS.contains(&payload.tipo.as_str()) {
        campos.push(CampoInvalido { campo: "tipo".into(), motivo: format!("deve ser um de: {}", TIPOS_VALIDOS.join(", ")) });
    }
    if !CLASSIFICACOES_VALIDAS.contains(&payload.classificacao.as_str()) {
        campos.push(CampoInvalido {
            campo: "classificacao".into(),
            motivo: format!("deve ser uma de: {}", CLASSIFICACOES_VALIDAS.join(", ")),
        });
    }
    for (campo, valor) in [("hora_inicio", &payload.hora_inicio), ("hora_fim", &payload.hora_fim)] {
        if chrono::NaiveTime::parse_from_str(valor, "%H:%M").is_err() {
            campos.push(CampoInvalido { campo: campo.into(), motivo: "deve estar no formato HH:MM".into() });
        }
    }
    let dias_ok = payload.dias_semana == "diario"
        || (!payload.dias_semana.is_empty() && payload.dias_semana.split(',').all(|d| matches!(d.trim().parse::<u32>(), Ok(1..=7))));
    if !dias_ok {
        campos.push(CampoInvalido { campo: "dias_semana".into(), motivo: "deve ser \"diario\" ou dias de 1 (segunda) a 7 separados por vírgula".into() });
    }
    if campos.is_empty() {
        Ok(())
    } else {
        Err(AppError::validation(campos))
    }
}

pub async fn criar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Json(payload): Json<BlocoPayload>) -> AppResult<Json<serde_json::Value>> {
    validar_bloco(&payload)?;
    let id = new_id();
    state
        .db
        .with({
            let id = id.clone();
            move |conn| {
                conn.execute(
                    "INSERT INTO bloco_rotina (id, usuario_id, tipo, hora_inicio, hora_fim, dias_semana, classificacao) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    rusqlite::params![id, usuario.0, payload.tipo, payload.hora_inicio, payload.hora_fim, payload.dias_semana, payload.classificacao],
                )
            }
        })
        .await?;
    Ok(Json(serde_json::json!({ "id": id })))
}

pub async fn atualizar(State(state): State<AppState>, Path(id): Path<String>, Json(payload): Json<BlocoPayload>) -> AppResult<Json<serde_json::Value>> {
    validar_bloco(&payload)?;
    let afetadas = state
        .db
        .with({
            let id = id.clone();
            move |conn| {
                conn.execute(
                    "UPDATE bloco_rotina SET tipo = ?1, hora_inicio = ?2, hora_fim = ?3, dias_semana = ?4, classificacao = ?5 WHERE id = ?6",
                    rusqlite::params![payload.tipo, payload.hora_inicio, payload.hora_fim, payload.dias_semana, payload.classificacao, id],
                )
            }
        })
        .await?;
    if afetadas == 0 {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    Ok(Json(serde_json::json!({ "id": id })))
}

pub async fn excluir(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let afetadas = state.db.with(move |conn| conn.execute("DELETE FROM bloco_rotina WHERE id = ?1", [&id])).await?;
    if afetadas == 0 {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}
