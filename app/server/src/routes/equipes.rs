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
    // Política de dados: a equipe só é excluída vazia. Notas, tarefas e eventos não são movidos nem apagados em
    // silêncio — quem exclui decide o destino de cada item antes. Assim nunca sobra conteúdo ativo apontando para
    // uma equipe inexistente. (A Lixeira não conta: não há como esvaziá-la, e o que ela guarda segue em disco.)
    let espaco = format!("equipe:{id}");
    let (notas, tarefas, eventos): (i64, i64, i64) = state
        .db
        .with(move |conn| {
            let contar = |tabela: &str| conn.query_row(&format!("SELECT COUNT(*) FROM {tabela} WHERE espaco = ?1"), [&espaco], |r| r.get::<_, i64>(0));
            Ok((contar("nota")?, contar("tarefa")?, contar("evento")?))
        })
        .await?;
    if notas + tarefas + eventos > 0 {
        let mut partes = Vec::new();
        for (n, singular, plural) in [(notas, "nota", "notas"), (tarefas, "tarefa", "tarefas"), (eventos, "evento", "eventos")] {
            if n > 0 { partes.push(format!("{n} {}", if n == 1 { singular } else { plural })); }
        }
        return Err(AppError::new(ErrorCode::Conflict).with_message(format!(
            "A equipe ainda tem {}. Exclua ou mova esse conteúdo antes de excluir a equipe.",
            partes.join(", ")
        )));
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

/// Resultado de uma mudança de composição da equipe, decidido e aplicado numa única transação: as regras
/// (um dono ao menos, admin sem poder sobre dono) são checadas e gravadas juntas, então pedidos concorrentes
/// não conseguem, cada um por si válido, deixar a equipe sem dono.
enum Desfecho {
    Feito,
    NaoEncontrado,
    Proibido,
    UltimoDono,
    UnicaPessoa,
}

fn cargo_em(tx: &rusqlite::Transaction<'_>, equipe_id: &str, usuario_id: &str) -> rusqlite::Result<Option<String>> {
    tx.query_row("SELECT cargo FROM membro_equipe WHERE equipe_id = ?1 AND usuario_id = ?2", rusqlite::params![equipe_id, usuario_id], |r| r.get(0)).optional()
}

fn donos_em(tx: &rusqlite::Transaction<'_>, equipe_id: &str) -> rusqlite::Result<i64> {
    tx.query_row("SELECT COUNT(*) FROM membro_equipe WHERE equipe_id = ?1 AND cargo = 'dono'", [equipe_id], |r| r.get(0))
}

fn desfecho_para_erro(d: Desfecho, mensagem_ultimo_dono: &'static str) -> AppResult<()> {
    match d {
        Desfecho::Feito => Ok(()),
        Desfecho::NaoEncontrado => Err(AppError::new(ErrorCode::NotFound)),
        Desfecho::Proibido => Err(AppError::new(ErrorCode::Forbidden)),
        Desfecho::UltimoDono => Err(AppError::new(ErrorCode::Conflict).with_message(mensagem_ultimo_dono)),
        Desfecho::UnicaPessoa => Err(AppError::new(ErrorCode::Conflict).with_message("Você é a única pessoa desta equipe. Para sair, exclua a equipe.")),
    }
}

pub async fn trocar_cargo(
    State(state): State<AppState>,
    Extension(usuario): Extension<UsuarioAutenticado>,
    Path((equipe_id, usuario_alvo)): Path<(String, String)>,
    Json(payload): Json<TrocarCargoPayload>,
) -> AppResult<Json<serde_json::Value>> {
    if !["dono", "admin", "membro"].contains(&payload.cargo.as_str()) {
        return Err(AppError::validation(vec![CampoInvalido { campo: "cargo".into(), motivo: "inválido".into() }]));
    }
    let (eu, novo) = (usuario.0.clone(), payload.cargo.clone());
    let desfecho = state
        .db
        .with(move |conn| {
            let tx = conn.unchecked_transaction()?;
            let Some(meu) = cargo_em(&tx, &equipe_id, &eu)? else { return Ok(Desfecho::NaoEncontrado) };
            if meu == "membro" { return Ok(Desfecho::Proibido); }
            let Some(atual) = cargo_em(&tx, &equipe_id, &usuario_alvo)? else { return Ok(Desfecho::NaoEncontrado) };
            // Só quem é dono passa a propriedade e só o dono mexe em outro dono (admin não se promove nem rebaixa dono).
            if (novo == "dono" || atual == "dono") && meu != "dono" { return Ok(Desfecho::Proibido); }
            if atual == "dono" && novo != "dono" && donos_em(&tx, &equipe_id)? <= 1 { return Ok(Desfecho::UltimoDono); }
            tx.execute("UPDATE membro_equipe SET cargo = ?1 WHERE equipe_id = ?2 AND usuario_id = ?3", rusqlite::params![novo, equipe_id, usuario_alvo])?;
            tx.commit()?;
            Ok(Desfecho::Feito)
        })
        .await?;
    desfecho_para_erro(desfecho, "A equipe precisa de ao menos um dono. Passe a propriedade para outra pessoa antes.")?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Debug, Deserialize)]
pub struct TransferirPayload {
    pub usuario_id: String,
}

/// `POST /equipes/:id/transferir` — o dono passa a propriedade a outra pessoa da equipe e vira administrador,
/// numa só operação (a equipe nunca fica sem dono nem sem a pessoa que responde por ela).
pub async fn transferir_propriedade(
    State(state): State<AppState>,
    Extension(usuario): Extension<UsuarioAutenticado>,
    Path(equipe_id): Path<String>,
    Json(payload): Json<TransferirPayload>,
) -> AppResult<Json<serde_json::Value>> {
    if payload.usuario_id == usuario.0 {
        return Err(AppError::validation(vec![CampoInvalido { campo: "usuario_id".into(), motivo: "escolha outra pessoa da equipe".into() }]));
    }
    let (eu, alvo) = (usuario.0.clone(), payload.usuario_id.clone());
    let desfecho = state
        .db
        .with(move |conn| {
            let tx = conn.unchecked_transaction()?;
            match cargo_em(&tx, &equipe_id, &eu)?.as_deref() {
                None => return Ok(Desfecho::NaoEncontrado),
                Some("dono") => {}
                Some(_) => return Ok(Desfecho::Proibido),
            }
            if cargo_em(&tx, &equipe_id, &alvo)?.is_none() { return Ok(Desfecho::NaoEncontrado); }
            tx.execute("UPDATE membro_equipe SET cargo = 'dono' WHERE equipe_id = ?1 AND usuario_id = ?2", rusqlite::params![equipe_id, alvo])?;
            tx.execute("UPDATE membro_equipe SET cargo = 'admin' WHERE equipe_id = ?1 AND usuario_id = ?2", rusqlite::params![equipe_id, eu])?;
            tx.commit()?;
            Ok(Desfecho::Feito)
        })
        .await?;
    desfecho_para_erro(desfecho, "")?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn remover_membro(
    State(state): State<AppState>,
    Extension(usuario): Extension<UsuarioAutenticado>,
    Path((equipe_id, usuario_alvo)): Path<(String, String)>,
) -> AppResult<Json<serde_json::Value>> {
    let eu = usuario.0.clone();
    let desfecho = state
        .db
        .with(move |conn| {
            let tx = conn.unchecked_transaction()?;
            let Some(meu) = cargo_em(&tx, &equipe_id, &eu)? else { return Ok(Desfecho::NaoEncontrado) };
            if meu == "membro" { return Ok(Desfecho::Proibido); }
            let Some(atual) = cargo_em(&tx, &equipe_id, &usuario_alvo)? else { return Ok(Desfecho::NaoEncontrado) };
            if atual == "dono" {
                if meu != "dono" { return Ok(Desfecho::Proibido); }
                if donos_em(&tx, &equipe_id)? <= 1 { return Ok(Desfecho::UltimoDono); }
            }
            tx.execute("DELETE FROM membro_equipe WHERE equipe_id = ?1 AND usuario_id = ?2", rusqlite::params![equipe_id, usuario_alvo])?;
            tx.commit()?;
            Ok(Desfecho::Feito)
        })
        .await?;
    desfecho_para_erro(desfecho, "Esta pessoa é a única dona da equipe. Passe a propriedade para outra pessoa antes de removê-la.")?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// `POST /equipes/:id/sair` — a própria pessoa deixa a equipe. Os itens que ela criou continuam na equipe
/// com a autoria original (histórico compartilhado). Dono com outras pessoas precisa transferir a
/// propriedade antes; quem é a única pessoa deve excluir a equipe.
pub async fn sair(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(equipe_id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let eu = usuario.0.clone();
    let desfecho = state
        .db
        .with(move |conn| {
            let tx = conn.unchecked_transaction()?;
            let Some(cargo) = cargo_em(&tx, &equipe_id, &eu)? else { return Ok(Desfecho::NaoEncontrado) };
            let total: i64 = tx.query_row("SELECT COUNT(*) FROM membro_equipe WHERE equipe_id = ?1", [&equipe_id], |r| r.get(0))?;
            if total <= 1 { return Ok(Desfecho::UnicaPessoa); }
            // Outro dono na equipe? Então este pode sair; senão a propriedade precisa passar antes.
            if cargo == "dono" && donos_em(&tx, &equipe_id)? <= 1 { return Ok(Desfecho::UltimoDono); }
            tx.execute("DELETE FROM membro_equipe WHERE equipe_id = ?1 AND usuario_id = ?2", rusqlite::params![equipe_id, eu])?;
            tx.commit()?;
            Ok(Desfecho::Feito)
        })
        .await?;
    desfecho_para_erro(desfecho, "Você é dono desta equipe. Transfira a propriedade para outra pessoa antes de sair.")?;
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

/// `GET /equipes/:id/convites` — convites ainda válidos (pendentes e não vencidos), só para dono/admin.
pub async fn listar_convites(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    exigir_cargo(&cargo_do_usuario(&state, &id, &usuario.0).await?, &["dono", "admin"])?;
    let agora = Utc::now();
    let linhas: Vec<(String, String, String, String)> = state
        .db
        .with(move |conn| {
            let mut stmt = conn.prepare("SELECT id, codigo, criado_em, expira_em FROM convite_equipe WHERE equipe_id = ?1 AND estado = 'pendente' ORDER BY criado_em DESC")?;
            let l = stmt.query_map([&id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?.collect::<Result<Vec<_>, _>>()?;
            Ok(l)
        })
        .await?;
    let validos: Vec<serde_json::Value> = linhas
        .into_iter()
        .filter(|(_, _, _, expira)| chrono::DateTime::parse_from_rfc3339(expira).map(|d| d >= agora).unwrap_or(false))
        .map(|(id, codigo, criado_em, expira_em)| serde_json::json!({ "id": id, "codigo": codigo, "criado_em": criado_em, "expira_em": expira_em }))
        .collect();
    Ok(Json(serde_json::json!(validos)))
}

/// `DELETE /equipes/:id/convites/:convite_id` — revoga um convite pendente (dono/admin). O estado fica
/// `expirado` (o schema não tem um estado próprio de revogação) e a validade é encerrada agora.
pub async fn revogar_convite(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path((id, convite_id)): Path<(String, String)>) -> AppResult<Json<serde_json::Value>> {
    exigir_cargo(&cargo_do_usuario(&state, &id, &usuario.0).await?, &["dono", "admin"])?;
    let agora = Utc::now().to_rfc3339();
    let afetadas = state
        .db
        .with(move |conn| conn.execute(
            "UPDATE convite_equipe SET estado = 'expirado', expira_em = ?1 WHERE id = ?2 AND equipe_id = ?3 AND estado = 'pendente'",
            rusqlite::params![agora, convite_id, id],
        ))
        .await?;
    if afetadas == 0 { return Err(AppError::new(ErrorCode::NotFound)); }
    Ok(Json(serde_json::json!({ "ok": true })))
}

enum ResultadoConvite { Aceito, JaMembro, Indisponivel, NaoExiste }

/// Consumo atômico: a validade (estado, expiração) é conferida e o convite é consumido na mesma transação,
/// então duas pessoas usando o mesmo código ao mesmo tempo não entram as duas, e um convite vencido ou
/// revogado nunca é aceito. Quem já é da equipe não gasta o convite.
pub async fn aceitar_convite(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(codigo): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let codigo = codigo.trim().to_uppercase();
    let agora = Utc::now();
    let resultado = state
        .db
        .with(move |conn| {
            let tx = conn.unchecked_transaction()?;
            let convite: Option<(String, String, String, String)> = tx
                .query_row("SELECT id, equipe_id, estado, expira_em FROM convite_equipe WHERE codigo = ?1", [&codigo], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
                .optional()?;
            let Some((convite_id, equipe_id, estado, expira_em)) = convite else { return Ok(ResultadoConvite::NaoExiste) };
            let vencido = chrono::DateTime::parse_from_rfc3339(&expira_em).map(|d| d < agora).unwrap_or(true);
            if estado != "pendente" || vencido {
                if estado == "pendente" { tx.execute("UPDATE convite_equipe SET estado = 'expirado' WHERE id = ?1 AND estado = 'pendente'", [&convite_id])?; tx.commit()?; }
                return Ok(ResultadoConvite::Indisponivel);
            }
            if cargo_em(&tx, &equipe_id, &usuario.0)?.is_some() { return Ok(ResultadoConvite::JaMembro); }
            let consumido = tx.execute("UPDATE convite_equipe SET estado = 'aceito' WHERE id = ?1 AND estado = 'pendente'", [&convite_id])?;
            if consumido != 1 { return Ok(ResultadoConvite::Indisponivel); }
            tx.execute("INSERT INTO membro_equipe (equipe_id, usuario_id, cargo) VALUES (?1, ?2, 'membro')", rusqlite::params![equipe_id, usuario.0])?;
            tx.commit()?;
            Ok(ResultadoConvite::Aceito)
        })
        .await?;
    match resultado {
        ResultadoConvite::Aceito => Ok(Json(serde_json::json!({ "ok": true }))),
        ResultadoConvite::JaMembro => Ok(Json(serde_json::json!({ "ok": true, "ja_membro": true }))),
        ResultadoConvite::NaoExiste => Err(AppError::new(ErrorCode::NotFound)),
        ResultadoConvite::Indisponivel => Err(AppError::new(ErrorCode::Conflict).with_message("Este convite já foi usado, foi revogado ou expirou.")),
    }
}

#[cfg(test)]
mod testes;
#[cfg(test)]
mod testes_identidade;
#[cfg(test)]
mod testes_propriedade;
#[cfg(test)]
mod testes_exclusao;
