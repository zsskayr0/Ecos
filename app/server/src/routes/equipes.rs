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
    crate::espacos::cargo_na_equipe(state, equipe_id, usuario_id).await
}

/// Quem não participa da equipe recebe 404 (não se confirma nem que ela existe); quem participa sem o cargo exigido, 403.
fn exigir_cargo(cargo: &Option<String>, permitidos: &[&str]) -> AppResult<()> {
    match cargo {
        Some(c) if permitidos.contains(&c.as_str()) => Ok(()),
        Some(_) => Err(AppError::new(ErrorCode::Forbidden)),
        None => Err(AppError::new(ErrorCode::NotFound)),
    }
}

/// Só o dono mexe no cargo (ou na permanência) de outro dono; admin da equipe não rebaixa nem remove quem é dono.
async fn proteger_dono(state: &AppState, equipe_id: &str, quem_pede: &Option<String>, alvo: &str) -> AppResult<Option<String>> {
    let cargo_alvo = cargo_do_usuario(state, equipe_id, alvo).await?.ok_or(AppError::new(ErrorCode::NotFound))?;
    if cargo_alvo == "dono" && quem_pede.as_deref() != Some("dono") {
        return Err(AppError::new(ErrorCode::Forbidden));
    }
    Ok(Some(cargo_alvo))
}

/// Mesma paleta e mesmo hash que o cliente usava para derivar a cor de uma equipe sem escolha salva
/// (hash = hash * 31 + código do caractere, 32 bits), para que equipes existentes não mudem de aparência.
const PALETA_EQUIPE: [&str; 6] = ["#5B8FC7", "#7DD3FC", "#22C55E", "#F59E0B", "#8FB4DC", "#3E6FA8"];

fn cor_derivada(equipe_id: &str) -> &'static str {
    let hash = equipe_id.encode_utf16().fold(0u32, |h, c| h.wrapping_mul(31).wrapping_add(c as u32));
    PALETA_EQUIPE[hash as usize % PALETA_EQUIPE.len()]
}

/// `#RRGGBB` (maiúsculas ou minúsculas). Nada de nomes, `rgb()` ou `url()` — o valor vai direto para estilos no cliente.
fn cor_valida(cor: &str) -> bool {
    cor.len() == 7 && cor.starts_with('#') && cor[1..].bytes().all(|b| b.is_ascii_hexdigit())
}

fn validar_cor(cor: &str) -> AppResult<String> {
    if cor_valida(cor) { Ok(cor.to_uppercase()) } else {
        Err(AppError::validation(vec![CampoInvalido { campo: "cor".into(), motivo: "use o formato #RRGGBB".into() }]))
    }
}

pub(crate) fn cor_efetiva(id: &str, salva: Option<String>) -> String {
    salva.filter(|c| cor_valida(c)).unwrap_or_else(|| cor_derivada(id).to_string())
}

pub(crate) fn versao_avatar_equipe(state: &AppState, equipe_id: &str) -> Option<u64> {
    crate::routes::avatar::versao_em(&crate::routes::avatar::raiz_equipes(state), equipe_id)
}

pub async fn listar_minhas(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>) -> AppResult<Json<serde_json::Value>> {
    let equipes: Vec<(String, String, String, String, i64, Option<String>)> = state
        .db
        .with(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT e.id, e.nome, m.cargo, e.tipo, (SELECT COUNT(*) FROM membro_equipe x WHERE x.equipe_id = e.id), e.cor FROM equipe e JOIN membro_equipe m ON m.equipe_id = e.id WHERE m.usuario_id = ?1",
            )?;
            let linhas = stmt
                .query_map([&usuario.0], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await?;
    let equipes: Vec<serde_json::Value> = equipes
        .into_iter()
        .map(|(id, nome, cargo, tipo, membros, cor)| {
            let avatar = versao_avatar_equipe(&state, &id);
            serde_json::json!({ "cor_personalizada": cor.is_some(), "cor": cor_efetiva(&id, cor), "avatar_atualizado_em": avatar, "id": id, "nome": nome, "cargo": cargo, "tipo": tipo, "membros": membros })
        })
        .collect();
    Ok(Json(serde_json::json!(equipes)))
}

#[derive(Debug, Deserialize)]
pub struct CriarEquipePayload {
    pub nome: String,
    #[serde(default)]
    pub tipo: Option<String>,
    #[serde(default)]
    pub cor: Option<String>,
}

pub const TIPOS_DE_EQUIPE: [&str; 2] = ["pessoal", "corporativo"];

fn tipo_valido(tipo: &str) -> AppResult<()> {
    if TIPOS_DE_EQUIPE.contains(&tipo) { Ok(()) } else { Err(AppError::validation(vec![CampoInvalido { campo: "tipo".into(), motivo: "deve ser 'pessoal' ou 'corporativo'".into() }])) }
}

pub async fn criar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Json(payload): Json<CriarEquipePayload>) -> AppResult<Json<serde_json::Value>> {
    if payload.nome.trim().is_empty() {
        return Err(AppError::validation(vec![CampoInvalido { campo: "nome".into(), motivo: "não pode ser vazio".into() }]));
    }
    let tipo = payload.tipo.clone().unwrap_or_else(|| "pessoal".to_string());
    tipo_valido(&tipo)?;
    let cor = payload.cor.as_deref().map(validar_cor).transpose()?;
    let id = new_id();
    state
        .db
        .with({
            let id = id.clone();
            move |conn| {
                let tx = conn.unchecked_transaction()?;
                tx.execute("INSERT INTO equipe (id, nome, tipo, cor) VALUES (?1, ?2, ?3, ?4)", rusqlite::params![id, payload.nome, tipo, cor])?;
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
    // A equipe pessoal não tem linha em `equipe`: são só os itens que a própria pessoa criou.
    if id == "pessoal" {
        let uid = usuario.0.clone();
        let (notas, tarefas): (i64, i64) = state
            .db
            .with(move |conn| {
                let notas: i64 = conn.query_row("SELECT COUNT(*) FROM nota WHERE espaco = 'pessoal' AND criado_por = ?1", [&uid], |r| r.get(0))?;
                let tarefas: i64 = conn.query_row("SELECT COUNT(*) FROM tarefa WHERE espaco = 'pessoal' AND criado_por = ?1", [&uid], |r| r.get(0))?;
                Ok((notas, tarefas))
            })
            .await?;
        return Ok(Json(serde_json::json!({ "id": "pessoal", "nome": "Pessoal", "tipo": "pessoal", "estatisticas": { "notas": notas, "tarefas": tarefas } })));
    }
    // Quem não é da equipe (nem administra a instância) não sabe nem que ela existe.
    if cargo_do_usuario(&state, &id, &usuario.0).await?.is_none() && !crate::admin::e_admin(&state, &usuario.0).await? {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    let id2 = id.clone();
    let equipe: Option<(String, String, String, Option<String>)> = state
        .db
        .with(move |conn| conn.query_row("SELECT id, nome, tipo, cor FROM equipe WHERE id = ?1", [&id2], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).optional())
        .await?;
    let (id, nome, tipo, cor) = equipe.ok_or(AppError::new(ErrorCode::NotFound))?;
    let cor = cor_efetiva(&id, cor);
    let avatar = versao_avatar_equipe(&state, &id);

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

    Ok(Json(serde_json::json!({ "id": id, "nome": nome, "tipo": tipo, "cor": cor, "avatar_atualizado_em": avatar, "estatisticas": { "notas": notas, "tarefas": tarefas } })))
}

#[derive(Debug, Deserialize)]
pub struct AtualizarEquipePayload {
    /// Opcional: dá para mudar só a cor ou só o tipo. Se vier, não pode ser vazio.
    #[serde(default)]
    pub nome: Option<String>,
    #[serde(default)]
    pub tipo: Option<String>,
    #[serde(default)]
    pub cor: Option<String>,
}

pub async fn atualizar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(id): Path<String>, Json(payload): Json<AtualizarEquipePayload>) -> AppResult<Json<serde_json::Value>> {
    exigir_cargo(&cargo_do_usuario(&state, &id, &usuario.0).await?, &["dono", "admin"])?;
    if let Some(tipo) = &payload.tipo { tipo_valido(tipo)?; }
    if payload.nome.as_deref().is_some_and(|n| n.trim().is_empty()) {
        return Err(AppError::validation(vec![CampoInvalido { campo: "nome".into(), motivo: "não pode ser vazio".into() }]));
    }
    let cor = payload.cor.as_deref().map(validar_cor).transpose()?;
    let afetadas = state
        .db
        .with(move |conn| conn.execute(
            "UPDATE equipe SET nome = COALESCE(?1, nome), tipo = COALESCE(?2, tipo), cor = COALESCE(?3, cor) WHERE id = ?4",
            rusqlite::params![payload.nome, payload.tipo, cor, id],
        ))
        .await?;
    if afetadas == 0 {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// `GET /equipes/:id/avatar` — qualquer membro vê a foto da equipe; quem não participa recebe 404.
pub async fn obter_avatar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(id): Path<String>) -> AppResult<axum::response::Response> {
    exigir_cargo(&cargo_do_usuario(&state, &id, &usuario.0).await?, &["dono", "admin", "membro"])?;
    crate::routes::avatar::servir_de(&crate::routes::avatar::raiz_equipes(&state), &id)
}

/// `PUT /equipes/:id/avatar` (multipart, campo `arquivo`) — só dono/admin. PNG/JPEG/WebP pelos bytes, até 2 MB.
pub async fn enviar_avatar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(id): Path<String>, mut multipart: axum::extract::Multipart) -> AppResult<Json<serde_json::Value>> {
    exigir_cargo(&cargo_do_usuario(&state, &id, &usuario.0).await?, &["dono", "admin"])?;
    let bytes = crate::routes::avatar::ler_campo_arquivo(&mut multipart).await?;
    let ext = crate::routes::avatar::validar_imagem(&bytes)?;
    crate::routes::avatar::gravar_em(&crate::routes::avatar::raiz_equipes(&state), &id, ext, &bytes)?;
    Ok(Json(serde_json::json!({ "ok": true, "avatar_atualizado_em": versao_avatar_equipe(&state, &id) })))
}

/// `DELETE /equipes/:id/avatar` — só dono/admin; idempotente.
pub async fn remover_avatar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    exigir_cargo(&cargo_do_usuario(&state, &id, &usuario.0).await?, &["dono", "admin"])?;
    crate::routes::avatar::remover_todos_em(&crate::routes::avatar::raiz_equipes(&state), &id);
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
    let id_arquivo = id.clone();
    state.db.with(move |conn| conn.execute("DELETE FROM equipe WHERE id = ?1", [&id])).await?;
    crate::routes::avatar::remover_todos_em(&crate::routes::avatar::raiz_equipes(&state), &id_arquivo);
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Só quem é membro da Equipe vê quem participa dela, e só o necessário: o id, o cargo e o nome de exibição (ou, sem ele, o nome de usuário).
pub async fn listar_membros(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    exigir_cargo(&cargo_do_usuario(&state, &id, &usuario.0).await?, &["dono", "admin", "membro"])?;
    let membros: Vec<(String, String, String, String, String)> = state
        .db
        .with(move |conn| {
            let mut stmt = conn.prepare("SELECT m.usuario_id, m.cargo, COALESCE(NULLIF(TRIM(u.nome), ''), u.nome_usuario), u.nome_usuario, m.entrou_em FROM membro_equipe m JOIN usuario u ON u.id = m.usuario_id WHERE m.equipe_id = ?1 ORDER BY u.nome_usuario COLLATE NOCASE")?;
            let linhas = stmt
                .query_map([&id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await?;
    // Identidade pública dentro da equipe: nome de exibição, nome de usuário, versão da foto e data de entrada. Nada além disso.
    let membros: Vec<serde_json::Value> = membros
        .into_iter()
        .map(|(usuario_id, cargo, nome, nome_usuario, entrou_em)| {
            let avatar = crate::routes::avatar::versao(&state, &usuario_id);
            serde_json::json!({ "usuario_id": usuario_id, "cargo": cargo, "nome": nome, "nome_usuario": nome_usuario, "avatar_atualizado_em": avatar, "entrou_em": entrou_em })
        })
        .collect();
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
    let meu_cargo = cargo_do_usuario(&state, &equipe_id, &usuario.0).await?;
    exigir_cargo(&meu_cargo, &["dono", "admin"])?;
    if !["dono", "admin", "membro"].contains(&payload.cargo.as_str()) {
        return Err(AppError::validation(vec![CampoInvalido { campo: "cargo".into(), motivo: "inválido".into() }]));
    }
    // Só quem é dono passa a propriedade (um cargo "admin" da equipe não se promove a dono).
    if payload.cargo == "dono" && meu_cargo.as_deref() != Some("dono") {
        return Err(AppError::new(ErrorCode::Forbidden));
    }
    let cargo_alvo = proteger_dono(&state, &equipe_id, &meu_cargo, &usuario_alvo).await?;
    if cargo_alvo.as_deref() == Some("dono") && payload.cargo != "dono" {
        let donos: i64 = state.db.with({ let id = equipe_id.clone(); move |conn| conn.query_row("SELECT COUNT(*) FROM membro_equipe WHERE equipe_id = ?1 AND cargo = 'dono'", [&id], |r| r.get(0)) }).await?;
        if donos <= 1 {
            return Err(AppError::new(ErrorCode::Conflict).with_message("A equipe precisa de ao menos um dono. Passe a propriedade para outra pessoa antes."));
        }
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
    let meu_cargo = cargo_do_usuario(&state, &equipe_id, &usuario.0).await?;
    exigir_cargo(&meu_cargo, &["dono", "admin"])?;
    proteger_dono(&state, &equipe_id, &meu_cargo, &usuario_alvo).await?;
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

    // Uso único mesmo sob corrida: só quem consegue mudar 'pendente' -> 'aceito' entra na equipe.
    let consumido = state
        .db
        .with(move |conn| {
            let tx = conn.unchecked_transaction()?;
            let afetadas = tx.execute("UPDATE convite_equipe SET estado = 'aceito' WHERE id = ?1 AND estado = 'pendente'", [&convite_id])?;
            if afetadas == 1 {
                tx.execute(
                    "INSERT OR IGNORE INTO membro_equipe (equipe_id, usuario_id, cargo) VALUES (?1, ?2, 'membro')",
                    rusqlite::params![equipe_id, usuario.0],
                )?;
            }
            tx.commit()?;
            Ok(afetadas == 1)
        })
        .await?;
    if !consumido {
        return Err(AppError::new(ErrorCode::Conflict).with_message("Este convite já foi usado ou expirou."));
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[cfg(test)]
mod testes;
#[cfg(test)]
mod testes_identidade;
