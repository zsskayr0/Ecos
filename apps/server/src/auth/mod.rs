//! Identidade local da instância (seção 5.1) — sem conta em nuvem, sem
//! cadastro público. `POST /auth/registrar` só é aceito enquanto não existe
//! nenhum usuário (primeiro boot); depois disso, novo usuário só entra por
//! convite explícito de Equipe (seção 11.10).

pub mod password;
pub mod recovery;
pub mod session;

use axum::extract::State;
use axum::{Extension, Json};
use axum_extra::extract::cookie::CookieJar;
use ecos_core::{new_id, ErrorCode};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult, CampoInvalido};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct RegistrarPayload {
    pub nome_usuario: String,
    pub senha: String,
}

#[derive(Debug, Serialize)]
pub struct RegistrarResposta {
    pub usuario_id: String,
    /// Exibida uma única vez — o backend não a guarda em claro (seção 5.1).
    pub recovery_key: String,
}

fn validar_registro(payload: &RegistrarPayload) -> AppResult<()> {
    let mut campos = Vec::new();
    if payload.nome_usuario.trim().len() < 3 {
        campos.push(CampoInvalido {
            campo: "nome_usuario".into(),
            motivo: "deve ter ao menos 3 caracteres".into(),
        });
    }
    if payload.senha.len() < 8 {
        campos.push(CampoInvalido {
            campo: "senha".into(),
            motivo: "deve ter ao menos 8 caracteres".into(),
        });
    }
    if campos.is_empty() {
        Ok(())
    } else {
        Err(AppError::validation(campos))
    }
}

pub async fn registrar(
    State(state): State<AppState>,
    Json(payload): Json<RegistrarPayload>,
) -> AppResult<Json<RegistrarResposta>> {
    validar_registro(&payload)?;

    let ja_existe: i64 = state.db.with(|conn| conn.query_row("SELECT COUNT(*) FROM usuario", [], |r| r.get(0))).await?;
    if ja_existe > 0 {
        return Err(AppError::new(ErrorCode::Conflict)
            .with_message("Esta instância já tem um usuário registrado. Peça um convite de Equipe."));
    }

    let usuario_id = new_id();
    let senha_hash = password::hash(&payload.senha)?;
    let recovery_key = recovery::gerar();
    let recovery_key_hash = password::hash(&recovery::normalizar(&recovery_key))?;
    let nome_usuario = payload.nome_usuario.trim().to_string();

    state
        .db
        .with(move |conn| {
            conn.execute(
                "INSERT INTO usuario (id, nome_usuario, senha_hash, recovery_key_hash) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![usuario_id, nome_usuario, senha_hash, recovery_key_hash],
            )?;
            conn.execute("INSERT INTO perfil_rotina (usuario_id) VALUES (?1)", [&usuario_id])?;
            conn.execute("INSERT INTO config_sync (usuario_id, modo) VALUES (?1, 'local_unico')", [
                &usuario_id,
            ])?;
            Ok(usuario_id)
        })
        .await
        .map(|usuario_id| {
            Json(RegistrarResposta {
                usuario_id,
                recovery_key,
            })
        })
        .map_err(AppError::from)
}

#[derive(Debug, Deserialize)]
pub struct LoginPayload {
    pub usuario: String,
    pub senha: String,
}

pub async fn login(State(state): State<AppState>, jar: CookieJar, Json(payload): Json<LoginPayload>) -> AppResult<(CookieJar, Json<serde_json::Value>)> {
    let nome_usuario = payload.usuario.trim().to_string();
    let linha: Option<(String, String)> = state
        .db
        .with(move |conn| {
            conn.query_row(
                "SELECT id, senha_hash FROM usuario WHERE nome_usuario = ?1",
                [&nome_usuario],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
        })
        .await?;

    let Some((usuario_id, senha_hash)) = linha else {
        return Err(AppError::new(ErrorCode::InvalidCredentials));
    };
    if !password::verify(&payload.senha, &senha_hash) {
        return Err(AppError::new(ErrorCode::InvalidCredentials));
    }

    let access = session::emitir_access_token(&usuario_id, &state.config.session_secret)
        .map_err(|_| AppError::new(ErrorCode::InternalError))?;
    let refresh_valor = session::gerar_refresh_token();
    let refresh_hash = session::hash_refresh_token(&refresh_valor);
    let sessao_id = new_id();
    let expira_em = (chrono::Utc::now() + chrono::Duration::days(session::DURACAO_REFRESH_DIAS)).to_rfc3339();

    let usuario_id_para_sessao = usuario_id.clone();
    state
        .db
        .with(move |conn| {
            conn.execute(
                "INSERT INTO sessao (id, usuario_id, refresh_token_hash, expira_em) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![sessao_id, usuario_id_para_sessao, refresh_hash, expira_em],
            )
        })
        .await?;

    let jar = jar
        .add(session::cookie_sessao(access))
        .add(session::cookie_refresh(refresh_valor));

    Ok((jar, Json(serde_json::json!({ "usuario_id": usuario_id }))))
}

pub async fn logout(State(state): State<AppState>, jar: CookieJar) -> AppResult<CookieJar> {
    if let Some(refresh) = jar.get(session::NOME_COOKIE_REFRESH) {
        let hash = session::hash_refresh_token(refresh.value());
        state
            .db
            .with(move |conn| {
                conn.execute(
                    "UPDATE sessao SET revogado_em = datetime('now') WHERE refresh_token_hash = ?1",
                    [hash],
                )
            })
            .await?;
    }
    Ok(jar
        .add(session::cookie_sessao_expirado())
        .add(session::cookie_refresh_expirado()))
}

#[derive(Debug, Deserialize)]
pub struct RecuperarSenhaPayload {
    pub recovery_key: String,
    pub nova_senha: String,
}

pub async fn recuperar_senha(State(state): State<AppState>, Json(payload): Json<RecuperarSenhaPayload>) -> AppResult<Json<serde_json::Value>> {
    if payload.nova_senha.len() < 8 {
        return Err(AppError::validation(vec![CampoInvalido {
            campo: "nova_senha".into(),
            motivo: "deve ter ao menos 8 caracteres".into(),
        }]));
    }
    let frase_normalizada = recovery::normalizar(&payload.recovery_key);

    // Conjunto de usuários é pequeno (instância pessoal/familiar) — não
    // guardamos a recovery key em claro nem indexável, então a checagem é
    // por hash, uma linha de cada vez (seção 5.1/5.4: comparação nunca
    // vaza timing informativo sobre qual usuário bateu, já que o loop
    // sempre roda até o fim ou até achar).
    let usuarios: Vec<(String, String)> = state
        .db
        .with(|conn| {
            let mut stmt = conn.prepare("SELECT id, recovery_key_hash FROM usuario")?;
            let linhas = stmt
                .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await?;

    let encontrado = usuarios
        .into_iter()
        .find(|(_, hash)| password::verify(&frase_normalizada, hash));

    let Some((usuario_id, _)) = encontrado else {
        return Err(AppError::new(ErrorCode::InvalidCredentials).with_message("Recovery key inválida."));
    };

    let nova_senha_hash = password::hash(&payload.nova_senha)?;
    state
        .db
        .with(move |conn| conn.execute("UPDATE usuario SET senha_hash = ?1 WHERE id = ?2", rusqlite::params![nova_senha_hash, usuario_id]))
        .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

// --- Perfil (seção 11.2) ---------------------------------------------

pub async fn perfil(State(state): State<AppState>, Extension(usuario): Extension<crate::middleware::auth_guard::UsuarioAutenticado>) -> AppResult<Json<serde_json::Value>> {
    let usuario_id = usuario.0.clone();
    let nome_usuario: Option<String> = state
        .db
        .with({
            let usuario_id = usuario_id.clone();
            move |conn| conn.query_row("SELECT nome_usuario FROM usuario WHERE id = ?1", [&usuario_id], |r| r.get(0)).optional()
        })
        .await?;
    let nome_usuario = nome_usuario.ok_or(AppError::new(ErrorCode::NotFound))?;

    let equipes: Vec<serde_json::Value> = state
        .db
        .with({
            let usuario_id = usuario_id.clone();
            move |conn| {
                let mut stmt = conn.prepare("SELECT e.id, e.nome, m.cargo FROM equipe e JOIN membro_equipe m ON m.equipe_id = e.id WHERE m.usuario_id = ?1")?;
                let linhas = stmt
                    .query_map([&usuario_id], |r| Ok(serde_json::json!({"id": r.get::<_, String>(0)?, "nome": r.get::<_, String>(1)?, "cargo": r.get::<_, String>(2)?})))?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(linhas)
            }
        })
        .await?;

    Ok(Json(serde_json::json!({
        "id": usuario_id,
        "nome_usuario": nome_usuario,
        "cofre_ativado": state.config.vault_enabled,
        "equipes": equipes,
    })))
}

#[derive(Debug, Deserialize)]
pub struct AtualizarPerfilPayload {
    #[serde(default)]
    pub nome_usuario: Option<String>,
}

pub async fn atualizar_perfil(State(state): State<AppState>, Extension(usuario): Extension<crate::middleware::auth_guard::UsuarioAutenticado>, Json(payload): Json<AtualizarPerfilPayload>) -> AppResult<Json<serde_json::Value>> {
    if let Some(nome) = payload.nome_usuario {
        if nome.trim().len() < 3 {
            return Err(AppError::validation(vec![CampoInvalido { campo: "nome_usuario".into(), motivo: "deve ter ao menos 3 caracteres".into() }]));
        }
        state
            .db
            .with(move |conn| conn.execute("UPDATE usuario SET nome_usuario = ?1 WHERE id = ?2", rusqlite::params![nome, usuario.0]))
            .await?;
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Export geral (seção 8.3) — manifesto JSON com os caminhos de
/// Notas/Tarefas (o próprio `.md` já é portátil, ver seção 1.5) mais um
/// aviso de como pegar o Cofre (`POST /vault/backup/exportar`, seção
/// 11.14). Empacotar tudo num único `.zip` assinado fica fora desta
/// primeira versão.
pub async fn exportar(State(state): State<AppState>) -> AppResult<Json<serde_json::Value>> {
    let notas: Vec<String> = state.db.with(|conn| {
        let mut stmt = conn.prepare("SELECT caminho_arquivo FROM nota")?;
        let linhas = stmt.query_map([], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
        Ok(linhas)
    }).await?;
    let tarefas: Vec<String> = state.db.with(|conn| {
        let mut stmt = conn.prepare("SELECT caminho_arquivo FROM tarefa")?;
        let linhas = stmt.query_map([], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
        Ok(linhas)
    }).await?;
    Ok(Json(serde_json::json!({
        "notas": notas,
        "tarefas": tarefas,
        "cofre": if state.config.vault_enabled { "use POST /vault/backup/exportar" } else { "Cofre não ativado" },
    })))
}

#[derive(Debug, Deserialize)]
pub struct ExcluirContaPayload {
    pub confirm: String,
}

/// `DELETE /me` — exige `{confirm:"EXCLUIR CONTA"}` (seção 7.3/11.2).
/// Remove a linha de `usuario` e suas sessões; participação em Equipes de
/// terceiros é apenas desvinculada, nunca apaga histórico compartilhado
/// (seção 8.3).
pub async fn excluir_conta(State(state): State<AppState>, Extension(usuario): Extension<crate::middleware::auth_guard::UsuarioAutenticado>, jar: CookieJar, Json(payload): Json<ExcluirContaPayload>) -> AppResult<(CookieJar, Json<serde_json::Value>)> {
    if payload.confirm != "EXCLUIR CONTA" {
        return Err(AppError::new(ErrorCode::ConfirmationPhraseRequired));
    }
    state
        .db
        .with(move |conn| {
            let tx = conn.unchecked_transaction()?;
            tx.execute("DELETE FROM membro_equipe WHERE usuario_id = ?1", [&usuario.0])?;
            tx.execute("DELETE FROM sessao WHERE usuario_id = ?1", [&usuario.0])?;
            tx.execute("DELETE FROM usuario WHERE id = ?1", [&usuario.0])?;
            tx.commit()
        })
        .await?;
    let jar = jar.add(session::cookie_sessao_expirado()).add(session::cookie_refresh_expirado());
    Ok((jar, Json(serde_json::json!({ "ok": true }))))
}
