//! Administração de usuários, no estilo do Jellyfin: quem administra cria as contas das outras pessoas (o
//! cadastro público só existe para o primeiro usuário, que vira administrador). A conta nasce com uma senha
//! temporária, gerada aqui e mostrada uma única vez a quem administra, e a pessoa é obrigada a trocá-la no
//! primeiro acesso (`deve_trocar_senha`, imposto em `middleware::auth_guard`). Quem não é administrador recebe 404
//! nestas rotas: elas nem parecem existir.

use axum::extract::{Path, State};
use axum::{Extension, Json};
use ecos_core::{credenciais, new_id, ErrorCode};
use rand::seq::SliceRandom;
use rand::Rng;
use rusqlite::OptionalExtension;
use serde::Deserialize;

use crate::auth::{password, recovery};
use crate::error::{AppError, AppResult, CampoInvalido};
use crate::middleware::auth_guard::UsuarioAutenticado;
use crate::state::AppState;

/// Sem 0/O, 1/l/I: a senha temporária é lida numa tela e digitada por outra pessoa.
const ALFABETO: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/// `Xk7mPq2dWs9hTn4v`, em grupos de quatro separados por hífen. Tenta de novo até passar na política de senhas.
fn gerar_senha_temporaria() -> String {
    let mut rng = rand::thread_rng();
    loop {
        let grupos: Vec<String> = (0..4).map(|_| (0..4).map(|_| *ALFABETO.choose(&mut rng).unwrap() as char).collect()).collect();
        let senha = grupos.join("-");
        if credenciais::validar_senha(&senha, None).is_ok() {
            return senha;
        }
        let _ = rng.gen::<u8>();
    }
}

/// A pessoa administra a instância?
pub async fn e_admin(state: &AppState, usuario_id: &str) -> AppResult<bool> {
    let id = usuario_id.to_string();
    Ok(state
        .db
        .with(move |conn| conn.query_row("SELECT papel = 'admin' FROM usuario WHERE id = ?1", [&id], |r| r.get(0)).optional().map(|v| v.unwrap_or(false)))
        .await?)
}

async fn exigir_admin(state: &AppState, usuario_id: &str) -> AppResult<()> {
    if e_admin(state, usuario_id).await? { Ok(()) } else { Err(AppError::new(ErrorCode::NotFound)) }
}

/// `GET /admin/usuarios`
pub async fn listar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>) -> AppResult<Json<serde_json::Value>> {
    exigir_admin(&state, &usuario.0).await?;
    let usuarios: Vec<serde_json::Value> = state
        .db
        .with(|conn| {
            let mut stmt = conn.prepare("SELECT id, nome_usuario, nome, papel, criado_em, deve_trocar_senha FROM usuario ORDER BY criado_em, id")?;
            let linhas = stmt
                .query_map([], |r| {
                    Ok(serde_json::json!({
                        "id": r.get::<_, String>(0)?, "nome_usuario": r.get::<_, String>(1)?, "nome": r.get::<_, Option<String>>(2)?,
                        "papel": r.get::<_, String>(3)?, "criado_em": r.get::<_, String>(4)?, "deve_trocar_senha": r.get::<_, i64>(5)? != 0,
                    }))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await?;
    Ok(Json(serde_json::json!(usuarios)))
}

#[derive(Debug, Deserialize)]
pub struct CriarUsuarioPayload {
    pub nome_usuario: String,
    #[serde(default)]
    pub nome: Option<String>,
    /// `usuario` (padrão) ou `admin`.
    #[serde(default)]
    pub papel: Option<String>,
}

/// `POST /admin/usuarios` — devolve a senha temporária (única vez em que ela existe em claro).
pub async fn criar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Json(payload): Json<CriarUsuarioPayload>) -> AppResult<Json<serde_json::Value>> {
    exigir_admin(&state, &usuario.0).await?;
    let mut campos = Vec::new();
    if let Err(motivo) = credenciais::validar_nome_usuario(&payload.nome_usuario) {
        campos.push(CampoInvalido { campo: "nome_usuario".into(), motivo });
    }
    let papel = match payload.papel.as_deref().unwrap_or("usuario") {
        p @ ("usuario" | "admin") => p.to_string(),
        _ => {
            campos.push(CampoInvalido { campo: "papel".into(), motivo: "deve ser 'usuario' ou 'admin'".into() });
            "usuario".into()
        }
    };
    if !campos.is_empty() {
        return Err(AppError::validation(campos));
    }
    let nome_usuario = payload.nome_usuario.clone();
    let existe: bool = state
        .db
        .with({
            let n = nome_usuario.clone();
            move |conn| conn.query_row("SELECT EXISTS(SELECT 1 FROM usuario WHERE nome_usuario = ?1 COLLATE NOCASE)", [&n], |r| r.get(0))
        })
        .await?;
    if existe {
        return Err(AppError::new(ErrorCode::Conflict).with_message("Já existe uma pessoa com esse nome de usuário."));
    }

    let id = new_id();
    let senha_temporaria = gerar_senha_temporaria();
    let senha_hash = password::hash(&senha_temporaria)?;
    // A recovery key é da própria pessoa: nasce aleatória e sem ninguém que a conheça, e é trocada por uma nova (mostrada só a ela)
    // quando ela define a senha definitiva.
    let recovery_key_hash = password::hash(&recovery::normalizar(&recovery::gerar()))?;
    let nome = payload.nome.as_deref().map(str::trim).filter(|n| !n.is_empty()).map(str::to_string);
    let (id_gravar, nome_usuario_gravar, papel_gravar) = (id.clone(), nome_usuario.clone(), papel.clone());
    state
        .db
        .with(move |conn| {
            let tx = conn.unchecked_transaction()?;
            tx.execute(
                "INSERT INTO usuario (id, nome_usuario, nome, senha_hash, recovery_key_hash, papel, deve_trocar_senha) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1)",
                rusqlite::params![id_gravar, nome_usuario_gravar, nome, senha_hash, recovery_key_hash, papel_gravar],
            )?;
            tx.execute("INSERT INTO perfil_rotina (usuario_id) VALUES (?1)", [&id_gravar])?;
            tx.execute("INSERT INTO config_sync (usuario_id, modo) VALUES (?1, 'local_unico')", [&id_gravar])?;
            tx.commit()
        })
        .await?;
    tracing::info!(criado_por = %usuario.0, novo_usuario = %id, papel = %papel, "usuário criado pela administração");
    Ok(Json(serde_json::json!({ "id": id, "nome_usuario": nome_usuario, "papel": papel, "senha_temporaria": senha_temporaria })))
}

/// `POST /admin/usuarios/:id/redefinir-senha` — nova senha temporária; a pessoa perde as sessões abertas e é obrigada a trocá-la.
pub async fn redefinir_senha(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    exigir_admin(&state, &usuario.0).await?;
    if id == usuario.0 {
        return Err(AppError::new(ErrorCode::Conflict).with_message("Para trocar a sua própria senha, use Editar perfil."));
    }
    let senha_temporaria = gerar_senha_temporaria();
    let senha_hash = password::hash(&senha_temporaria)?;
    let recovery_key_hash = password::hash(&recovery::normalizar(&recovery::gerar()))?;
    let alvo = id.clone();
    let afetadas = state
        .db
        .with(move |conn| {
            let tx = conn.unchecked_transaction()?;
            let n = tx.execute(
                "UPDATE usuario SET senha_hash = ?1, recovery_key_hash = ?2, deve_trocar_senha = 1 WHERE id = ?3",
                rusqlite::params![senha_hash, recovery_key_hash, alvo],
            )?;
            tx.execute("UPDATE sessao SET revogado_em = datetime('now') WHERE usuario_id = ?1 AND revogado_em IS NULL", [&alvo])?;
            tx.commit()?;
            Ok(n)
        })
        .await?;
    if afetadas == 0 {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    tracing::info!(por = %usuario.0, alvo = %id, "senha redefinida pela administração");
    Ok(Json(serde_json::json!({ "id": id, "senha_temporaria": senha_temporaria })))
}

/// `GET /admin/equipes` — todas as equipes da instância, com quem está em cada uma.
pub async fn listar_equipes(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>) -> AppResult<Json<serde_json::Value>> {
    exigir_admin(&state, &usuario.0).await?;
    let equipes: Vec<serde_json::Value> = state
        .db
        .with(|conn| {
            let mut eq = conn.prepare("SELECT id, nome FROM equipe ORDER BY nome COLLATE NOCASE")?;
            let mut mem = conn.prepare("SELECT m.usuario_id, u.nome_usuario, u.nome, m.cargo FROM membro_equipe m JOIN usuario u ON u.id = m.usuario_id WHERE m.equipe_id = ?1 ORDER BY u.nome_usuario COLLATE NOCASE")?;
            let base = eq.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?.collect::<Result<Vec<_>, _>>()?;
            let mut saida = Vec::new();
            for (id, nome) in base {
                let membros = mem
                    .query_map([&id], |r| Ok(serde_json::json!({ "usuario_id": r.get::<_, String>(0)?, "nome_usuario": r.get::<_, String>(1)?, "nome": r.get::<_, Option<String>>(2)?, "cargo": r.get::<_, String>(3)? })))?
                    .collect::<Result<Vec<_>, _>>()?;
                saida.push(serde_json::json!({ "id": id, "nome": nome, "membros": membros }));
            }
            Ok(saida)
        })
        .await?;
    Ok(Json(serde_json::json!(equipes)))
}

#[derive(Debug, Deserialize)]
pub struct AdicionarMembroPayload {
    pub usuario_id: String,
    /// `membro` (padrão) ou `admin`. Dono só pela própria equipe.
    #[serde(default)]
    pub cargo: Option<String>,
}

/// `POST /admin/equipes/:id/membros` — coloca uma conta existente numa equipe (alternativa ao convite por QR code).
pub async fn adicionar_membro(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(equipe_id): Path<String>, Json(payload): Json<AdicionarMembroPayload>) -> AppResult<Json<serde_json::Value>> {
    exigir_admin(&state, &usuario.0).await?;
    let cargo = payload.cargo.as_deref().unwrap_or("membro").to_string();
    if !["membro", "admin"].contains(&cargo.as_str()) {
        return Err(AppError::validation(vec![CampoInvalido { campo: "cargo".into(), motivo: "deve ser 'membro' ou 'admin'".into() }]));
    }
    let (eid, uid) = (equipe_id.clone(), payload.usuario_id.clone());
    let existem: (bool, bool) = state
        .db
        .with(move |conn| Ok((
            conn.query_row("SELECT EXISTS(SELECT 1 FROM equipe WHERE id = ?1)", [&eid], |r| r.get(0))?,
            conn.query_row("SELECT EXISTS(SELECT 1 FROM usuario WHERE id = ?1)", [&uid], |r| r.get(0))?,
        )))
        .await?;
    if existem != (true, true) {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    let (eid, uid) = (equipe_id, payload.usuario_id);
    state
        .db
        .with(move |conn| conn.execute("INSERT INTO membro_equipe (equipe_id, usuario_id, cargo) VALUES (?1, ?2, ?3) ON CONFLICT (equipe_id, usuario_id) DO UPDATE SET cargo = CASE WHEN cargo = 'dono' THEN cargo ELSE excluded.cargo END", rusqlite::params![eid, uid, cargo]))
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// `DELETE /admin/equipes/:id/membros/:usuario_id` — tira uma pessoa da equipe. A equipe nunca fica sem dono.
pub async fn remover_membro(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path((equipe_id, alvo)): Path<(String, String)>) -> AppResult<Json<serde_json::Value>> {
    exigir_admin(&state, &usuario.0).await?;
    let (eid, uid) = (equipe_id.clone(), alvo.clone());
    let donos_restantes: i64 = state
        .db
        .with(move |conn| conn.query_row("SELECT COUNT(*) FROM membro_equipe WHERE equipe_id = ?1 AND cargo = 'dono' AND usuario_id != ?2", [&eid, &uid], |r| r.get(0)))
        .await?;
    if donos_restantes == 0 {
        return Err(AppError::new(ErrorCode::Conflict).with_message("Esta pessoa é a única dona da equipe. Passe a propriedade para outra pessoa antes de removê-la."));
    }
    state.db.with(move |conn| conn.execute("DELETE FROM membro_equipe WHERE equipe_id = ?1 AND usuario_id = ?2", [&equipe_id, &alvo])).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn a_senha_temporaria_sempre_passa_na_politica_e_e_legivel() {
        for _ in 0..200 {
            let s = gerar_senha_temporaria();
            assert_eq!(s.len(), 19, "{s}");
            assert!(credenciais::validar_senha(&s, None).is_ok(), "{s}");
            assert!(!s.contains(['0', 'O', '1', 'l', 'I']), "{s}");
        }
    }
}
