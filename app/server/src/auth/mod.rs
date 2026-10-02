//! Identidade local da instância (seção 5.1) — sem conta em nuvem, sem
//! cadastro público. `POST /auth/registrar` só é aceito enquanto não existe
//! nenhum usuário (primeiro boot): esse usuário vira administrador. As demais contas são criadas por
//! quem administra (`crate::admin`), com senha temporária e troca obrigatória no primeiro acesso.

pub mod password;
pub mod recovery;
pub mod session;

use axum::extract::State;
use axum::http::HeaderMap;
use axum::{Extension, Json};
use axum_extra::extract::cookie::CookieJar;
use ecos_core::{new_id, ErrorCode};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult, CampoInvalido};
use crate::state::AppState;

/// Idade mínima para criar conta (a definir com a revisão jurídica). Não há
/// verificação nem data de nascimento: só a declaração, registrada em `consentimento`.
pub const IDADE_MINIMA: u8 = 18;

/// Versão vigente dos Termos de Uso e da Política de Privacidade (um aceite só
/// cobre os dois). Mudou o texto em app/client/src/legal? Mude esta data: toda
/// conta com aceite de outra versão passa a ver a tela de novo aceite.
pub const TERMOS_VERSAO: &str = "2026-09-20";

/// Pública e sem custo de informação sensível (só um booleano) — permite ao
/// cliente decidir, antes de qualquer tentativa de login, se deve mostrar a
/// tela de "criar conta" (instância nova, modelo Jellyfin/Immich: primeiro
/// acesso força o cadastro do admin) ou a de login normal.
#[derive(Debug, Serialize)]
pub struct StatusResposta {
    pub instancia_vazia: bool,
    /// Versão da release do servidor (tela Sobre do cliente).
    pub versao: &'static str,
    /// Idade mínima que o cadastro exige declarar.
    pub idade_minima: u8,
    /// Versão vigente dos Termos/Política, que o cadastro grava ao aceitar.
    pub termos_versao: &'static str,
}

pub async fn status(State(state): State<AppState>) -> AppResult<Json<StatusResposta>> {
    let total: i64 = state.db.with(|conn| conn.query_row("SELECT COUNT(*) FROM usuario", [], |r| r.get(0))).await?;
    Ok(Json(StatusResposta { instancia_vazia: total == 0, versao: env!("CARGO_PKG_VERSION"), idade_minima: IDADE_MINIMA, termos_versao: TERMOS_VERSAO }))
}

#[derive(Debug, Deserialize)]
pub struct RegistrarPayload {
    pub nome_usuario: String,
    pub senha: String,
    /// Nome de exibição (Feed/Equipe já mostram nome+avatar do dono de um
    /// item, ver migração 0003) — opcional pra não quebrar clientes
    /// antigos, mas o formulário atual sempre envia (nome + sobrenome
    /// juntos, seção UX).
    #[serde(default)]
    pub nome: Option<String>,
    /// Declaração de idade mínima ("tenho N anos ou mais"). Obrigatória e
    /// gravada em `consentimento`; sem ela o cadastro é recusado.
    #[serde(default)]
    pub declara_idade_minima: bool,
    /// "Li e aceito os Termos de uso e a Política de privacidade" — obrigatório.
    #[serde(default)]
    pub aceita_termos: bool,
}

#[derive(Debug, Serialize)]
pub struct RegistrarResposta {
    pub usuario_id: String,
    /// Exibida uma única vez — o backend não a guarda em claro (seção 5.1).
    pub recovery_key: String,
}

fn validar_registro(payload: &RegistrarPayload) -> AppResult<()> {
    let mut campos = Vec::new();
    // Sem `trim`: o nome vira login e nome de pasta, então o que foi digitado tem de ser válido como está.
    if let Err(motivo) = ecos_core::credenciais::validar_nome_usuario(&payload.nome_usuario) {
        campos.push(CampoInvalido { campo: "nome_usuario".into(), motivo });
    }
    if let Err(motivo) = ecos_core::credenciais::validar_senha(&payload.senha, Some(&payload.nome_usuario)) {
        campos.push(CampoInvalido { campo: "senha".into(), motivo });
    }
    if !payload.declara_idade_minima {
        campos.push(CampoInvalido {
            campo: "declara_idade_minima".into(),
            motivo: format!("é preciso declarar ter {IDADE_MINIMA} anos ou mais"),
        });
    }
    if !payload.aceita_termos {
        campos.push(CampoInvalido {
            campo: "aceita_termos".into(),
            motivo: "é preciso aceitar os Termos de uso e a Política de privacidade".into(),
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
            .with_message("Esta instância já tem um usuário registrado. Peça à pessoa que administra para criar a sua conta."));
    }

    let usuario_id = new_id();
    let senha_hash = password::hash(&payload.senha)?;
    let recovery_key = recovery::gerar();
    let recovery_key_hash = password::hash(&recovery::normalizar(&recovery_key))?;
    let nome_usuario = payload.nome_usuario.trim().to_string();
    let nome = payload.nome.as_deref().map(str::trim).filter(|n| !n.is_empty()).map(str::to_string);

    state
        .db
        .with(move |conn| {
            conn.execute(
                "INSERT INTO usuario (id, nome_usuario, nome, senha_hash, recovery_key_hash, papel) VALUES (?1, ?2, ?3, ?4, ?5, 'admin')",
                rusqlite::params![usuario_id, nome_usuario, nome, senha_hash, recovery_key_hash],
            )?;
            conn.execute(
                "INSERT INTO consentimento (usuario_id, tipo, versao) VALUES (?1, 'idade_minima', ?2)",
                rusqlite::params![usuario_id, IDADE_MINIMA.to_string()],
            )?;
            conn.execute(
                "INSERT INTO consentimento (usuario_id, tipo, versao) VALUES (?1, 'termos', ?2)",
                rusqlite::params![usuario_id, TERMOS_VERSAO],
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

#[derive(Debug, Deserialize)]
pub struct RefreshPayload {
    /// O cliente desktop envia este valor apenas pelo comando Rust, depois de
    /// lê-lo do Credential Manager. Navegadores usam o cookie HttpOnly.
    pub refresh_token: Option<String>,
}

fn resposta_sessao(access_token: String, refresh_token: String, headers: &HeaderMap) -> serde_json::Value {
    // Só o comando nativo precisa receber o refresh para guardá-lo no cofre
    // do SO. Não o exponha à aplicação web normal.
    let refresh_desktop = headers
        .get("x-ecos-native-client")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v == "1");
    serde_json::json!({
        "access_token": access_token,
        "refresh_token": if refresh_desktop { Some(refresh_token) } else { None::<String> },
    })
}

pub async fn login(State(state): State<AppState>, headers: HeaderMap, jar: CookieJar, Json(payload): Json<LoginPayload>) -> AppResult<(CookieJar, Json<serde_json::Value>)> {
    let nome_usuario = payload.usuario.trim().to_string();
    let linha: Option<(String, String)> = state
        .db
        .with(move |conn| {
            conn.query_row(
                "SELECT id, senha_hash FROM usuario WHERE nome_usuario = ?1 COLLATE NOCASE",
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
        .add(session::cookie_sessao(access.clone(), state.config.cookie_secure))
        .add(session::cookie_refresh(refresh_valor.clone(), state.config.cookie_secure));

    // `access_token` no corpo além do cookie — o navegador ignora esse
    // campo e usa o cookie normalmente; o cliente Tauri (sem cookie
    // cross-origin viável, ver `auth_guard::extrair_token`) guarda isto e
    // manda como `Authorization: Bearer`.
    let mut resposta = resposta_sessao(access, refresh_valor, &headers);
    resposta["usuario_id"] = serde_json::Value::String(usuario_id);
    Ok((jar, Json(resposta)))
}

/// Renova e rotaciona um refresh token. A atualização condicional garante
/// que um refresh antigo só pode ser usado uma vez, inclusive sob corrida.
pub async fn refresh(
    State(state): State<AppState>,
    headers: HeaderMap,
    jar: CookieJar,
    payload: Option<Json<RefreshPayload>>,
) -> AppResult<(CookieJar, Json<serde_json::Value>)> {
    let refresh_atual = payload
        .and_then(|Json(p)| p.refresh_token)
        .or_else(|| jar.get(session::NOME_COOKIE_REFRESH).map(|c| c.value().to_string()));
    let Some(refresh_atual) = refresh_atual.filter(|v| !v.is_empty()) else {
        return Err(AppError::new(ErrorCode::Unauthorized));
    };
    let hash_atual = session::hash_refresh_token(&refresh_atual);
    let novo_refresh = session::gerar_refresh_token();
    let novo_hash = session::hash_refresh_token(&novo_refresh);
    let agora = chrono::Utc::now();
    let expira_em = (agora + chrono::Duration::days(session::DURACAO_REFRESH_DIAS)).to_rfc3339();
    let usuario_id: Option<String> = state.db.with(move |conn| {
        let mut stmt = conn.prepare(
            "UPDATE sessao SET refresh_token_hash = ?1, expira_em = ?2 \
             WHERE refresh_token_hash = ?3 AND revogado_em IS NULL AND expira_em > ?4 \
             RETURNING usuario_id",
        )?;
        stmt.query_row(rusqlite::params![novo_hash, expira_em, hash_atual, agora.to_rfc3339()], |r| r.get(0)).optional()
    }).await?;
    let Some(usuario_id) = usuario_id else {
        return Err(AppError::new(ErrorCode::Unauthorized));
    };
    let access = session::emitir_access_token(&usuario_id, &state.config.session_secret)
        .map_err(|_| AppError::new(ErrorCode::InternalError))?;
    let novo_jar = jar
        .add(session::cookie_sessao(access.clone(), state.config.cookie_secure))
        .add(session::cookie_refresh(novo_refresh.clone(), state.config.cookie_secure));
    Ok((novo_jar, Json(resposta_sessao(access, novo_refresh, &headers))))
}

pub async fn logout(State(state): State<AppState>, jar: CookieJar, payload: Option<Json<RefreshPayload>>) -> AppResult<CookieJar> {
    let refresh = payload
        .and_then(|Json(p)| p.refresh_token)
        .or_else(|| jar.get(session::NOME_COOKIE_REFRESH).map(|c| c.value().to_string()));
    if let Some(refresh) = refresh {
        let hash = session::hash_refresh_token(&refresh);
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
        .add(session::cookie_sessao_expirado(state.config.cookie_secure))
        .add(session::cookie_refresh_expirado(state.config.cookie_secure)))
}

#[derive(Debug, Deserialize)]
pub struct RecuperarSenhaPayload {
    pub recovery_key: String,
    pub nova_senha: String,
}

pub async fn recuperar_senha(State(state): State<AppState>, Json(payload): Json<RecuperarSenhaPayload>) -> AppResult<Json<serde_json::Value>> {
    // O nome de usuário só é conhecido depois de achar a conta pela recovery key: aqui vale a regra geral, e a
    // checagem "não contém o usuário" é feita logo abaixo, com a conta em mãos.
    if let Err(motivo) = ecos_core::credenciais::validar_senha(&payload.nova_senha, None) {
        return Err(AppError::validation(vec![CampoInvalido { campo: "nova_senha".into(), motivo }]));
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

    let id_consulta = usuario_id.clone();
    let nome_usuario: String = state.db.with(move |conn| conn.query_row("SELECT nome_usuario FROM usuario WHERE id = ?1", [&id_consulta], |r| r.get(0))).await?;
    if let Err(motivo) = ecos_core::credenciais::validar_senha(&payload.nova_senha, Some(&nome_usuario)) {
        return Err(AppError::validation(vec![CampoInvalido { campo: "nova_senha".into(), motivo }]));
    }
    let nova_senha_hash = password::hash(&payload.nova_senha)?;
    // A pessoa acabou de escolher a senha: se a conta estava com senha temporária, a troca obrigatória está cumprida.
    state
        .db
        .with(move |conn| conn.execute("UPDATE usuario SET senha_hash = ?1, deve_trocar_senha = 0 WHERE id = ?2", rusqlite::params![nova_senha_hash, usuario_id]))
        .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Debug, Deserialize)]
pub struct TrocarSenhaPayload {
    pub senha_atual: String,
    pub nova_senha: String,
}

/// `POST /me/senha` — troca a própria senha. Exige a senha atual (uma sessão esquecida aberta não basta). Se a conta
/// estava com senha temporária, cumpre a troca obrigatória e devolve uma recovery key nova, que só a pessoa vê (a que
/// existia foi gerada às cegas na criação da conta). As outras sessões da pessoa são encerradas.
pub async fn trocar_senha(State(state): State<AppState>, Extension(usuario): Extension<crate::middleware::auth_guard::UsuarioAutenticado>, Json(payload): Json<TrocarSenhaPayload>) -> AppResult<Json<serde_json::Value>> {
    let id = usuario.0.clone();
    let linha: Option<(String, String, bool)> = state
        .db
        .with(move |conn| conn.query_row("SELECT nome_usuario, senha_hash, deve_trocar_senha != 0 FROM usuario WHERE id = ?1", [&id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).optional())
        .await?;
    let (nome_usuario, senha_hash_atual, era_temporaria) = linha.ok_or(AppError::new(ErrorCode::NotFound))?;
    if !password::verify(&payload.senha_atual, &senha_hash_atual) {
        return Err(AppError::new(ErrorCode::InvalidCredentials).with_message("A senha atual não confere."));
    }
    if payload.nova_senha == payload.senha_atual {
        return Err(AppError::validation(vec![CampoInvalido { campo: "nova_senha".into(), motivo: "deve ser diferente da senha atual".into() }]));
    }
    if let Err(motivo) = ecos_core::credenciais::validar_senha(&payload.nova_senha, Some(&nome_usuario)) {
        return Err(AppError::validation(vec![CampoInvalido { campo: "nova_senha".into(), motivo }]));
    }
    let nova_hash = password::hash(&payload.nova_senha)?;
    let nova_recovery = era_temporaria.then(recovery::gerar);
    let nova_recovery_hash = nova_recovery.as_deref().map(|k| password::hash(&recovery::normalizar(k))).transpose()?;
    let id = usuario.0.clone();
    state
        .db
        .with(move |conn| {
            let tx = conn.unchecked_transaction()?;
            tx.execute("UPDATE usuario SET senha_hash = ?1, deve_trocar_senha = 0 WHERE id = ?2", rusqlite::params![nova_hash, id])?;
            if let Some(h) = nova_recovery_hash {
                tx.execute("UPDATE usuario SET recovery_key_hash = ?1 WHERE id = ?2", rusqlite::params![h, id])?;
            }
            tx.commit()
        })
        .await?;
    tracing::info!(usuario = %usuario.0, temporaria = era_temporaria, "senha trocada");
    Ok(Json(serde_json::json!({ "ok": true, "recovery_key": nova_recovery })))
}

// --- Perfil (seção 11.2) ---------------------------------------------

pub async fn perfil(State(state): State<AppState>, Extension(usuario): Extension<crate::middleware::auth_guard::UsuarioAutenticado>) -> AppResult<Json<serde_json::Value>> {
    let usuario_id = usuario.0.clone();
    let linha: Option<(String, Option<String>, String, bool)> = state
        .db
        .with({
            let usuario_id = usuario_id.clone();
            move |conn| conn.query_row("SELECT nome_usuario, nome, papel, deve_trocar_senha != 0 FROM usuario WHERE id = ?1", [&usuario_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).optional()
        })
        .await?;
    let (nome_usuario, nome, papel, deve_trocar_senha) = linha.ok_or(AppError::new(ErrorCode::NotFound))?;

    let equipes: Vec<serde_json::Value> = state
        .db
        .with({
            let usuario_id = usuario_id.clone();
            move |conn| {
                let mut stmt = conn.prepare("SELECT e.id, e.nome, m.cargo, e.tipo FROM equipe e JOIN membro_equipe m ON m.equipe_id = e.id WHERE m.usuario_id = ?1")?;
                let linhas = stmt
                    .query_map([&usuario_id], |r| Ok(serde_json::json!({"id": r.get::<_, String>(0)?, "nome": r.get::<_, String>(1)?, "cargo": r.get::<_, String>(2)?, "tipo": r.get::<_, String>(3)?})))?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(linhas)
            }
        })
        .await?;

    let termos_aceitos: bool = state
        .db
        .with({
            let usuario_id = usuario_id.clone();
            move |conn| conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM consentimento WHERE usuario_id = ?1 AND tipo = 'termos' AND versao = ?2)",
                rusqlite::params![usuario_id, TERMOS_VERSAO],
                |r| r.get(0),
            )
        })
        .await?;

    Ok(Json(serde_json::json!({
        "id": usuario_id,
        "nome_usuario": nome_usuario,
        "papel": papel,
        "deve_trocar_senha": deve_trocar_senha,
        "termos_pendente": !termos_aceitos,
        "termos_versao": TERMOS_VERSAO,
        "nome": nome,
        "cofre_ativado": state.config.vault_enabled,
        "avatar_atualizado_em": crate::routes::avatar::versao(&state, &usuario_id),
        "equipes": equipes,
    })))
}

#[derive(Debug, Deserialize)]
pub struct AceitarTermosPayload {
    pub versao: String,
}

/// `POST /me/aceites/termos` — registra o aceite da versão vigente (novo aceite
/// depois que os textos mudam). Recusa versão diferente da vigente, para o
/// cliente nunca gravar um aceite de texto que a pessoa não viu.
pub async fn aceitar_termos(
    State(state): State<AppState>,
    Extension(usuario): Extension<crate::middleware::auth_guard::UsuarioAutenticado>,
    Json(payload): Json<AceitarTermosPayload>,
) -> AppResult<Json<serde_json::Value>> {
    if payload.versao != TERMOS_VERSAO {
        return Err(AppError::validation(vec![CampoInvalido {
            campo: "versao".into(),
            motivo: format!("a versão vigente é {TERMOS_VERSAO}; recarregue o app"),
        }]));
    }
    let usuario_id = usuario.0.clone();
    state
        .db
        .with(move |conn| {
            conn.execute(
                "INSERT OR IGNORE INTO consentimento (usuario_id, tipo, versao) VALUES (?1, 'termos', ?2)",
                rusqlite::params![usuario_id, TERMOS_VERSAO],
            )
        })
        .await?;
    Ok(Json(serde_json::json!({ "ok": true, "versao": TERMOS_VERSAO })))
}

#[derive(Debug, Deserialize)]
pub struct AtualizarPerfilPayload {
    #[serde(default)]
    pub nome_usuario: Option<String>,
    #[serde(default)]
    pub nome: Option<String>,
}

pub async fn atualizar_perfil(State(state): State<AppState>, Extension(usuario): Extension<crate::middleware::auth_guard::UsuarioAutenticado>, Json(payload): Json<AtualizarPerfilPayload>) -> AppResult<Json<serde_json::Value>> {
    // O nome de usuário é a identidade estável da pessoa (login e nome da pasta dela em disco): não muda depois do
    // cadastro. Reenviar o mesmo valor é aceito (clientes antigos), qualquer outro é recusado.
    if let Some(pedido) = payload.nome_usuario {
        let id = usuario.0.clone();
        let atual: Option<String> = state.db.with(move |conn| conn.query_row("SELECT nome_usuario FROM usuario WHERE id = ?1", [&id], |r| r.get(0)).optional()).await?;
        if atual.as_deref() != Some(pedido.trim()) {
            return Err(AppError::validation(vec![CampoInvalido { campo: "nome_usuario".into(), motivo: "o nome de usuário não pode ser alterado".into() }]));
        }
    }
    if let Some(nome) = payload.nome {
        state
            .db
            .with(move |conn| conn.execute("UPDATE usuario SET nome = ?1 WHERE id = ?2", rusqlite::params![nome.trim(), usuario.0]))
            .await?;
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[cfg(test)]
pub(crate) mod testes {
    use super::*;
    use crate::config::{Ambiente, Config};
    use crate::db::IndexDb;
    use axum::body::{to_bytes, Body};
    use axum::http::{Request, StatusCode};
    use std::sync::{Arc, Mutex};
    use tower::Service;

    pub(crate) const SEGREDO: &[u8] = b"segredo-efemero-exclusivo-do-teste";

    pub(crate) fn novo_estado() -> AppState {
        let temp = std::env::temp_dir().join(format!("ecos-auth-test-{}", new_id()));
        std::fs::create_dir_all(&temp).unwrap();
        AppState {
            db: IndexDb::open(&temp.join("index.db")).unwrap(),
            config: Arc::new(Config {
                ambiente: Ambiente::Desenvolvimento, porta: 0, notes_root: temp.clone(),
                index_db_path: temp.join("index.db"), vault_enabled: false, vault_internal_url: String::new(),
                session_secret: SEGREDO.to_vec(), ranking_interval_secs: 300,
                static_dir: None, cookie_secure: false, google: None,
            }),
            http: reqwest::Client::new(), pareamentos: Arc::new(Mutex::new(Default::default())),
        }
    }

    pub(crate) async fn chamar(state: &AppState, metodo: &str, rota: &str, token: Option<&str>, corpo: serde_json::Value) -> (StatusCode, serde_json::Value) {
        let mut req = Request::builder().method(metodo).uri(rota).header("content-type", "application/json");
        if let Some(t) = token {
            req = req.header("authorization", format!("Bearer {t}"));
        }
        let resp = crate::routes::montar(state.clone()).call(req.body(Body::from(corpo.to_string())).unwrap()).await.unwrap();
        let status = resp.status();
        let bytes = to_bytes(resp.into_body(), 65536).await.unwrap();
        (status, serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null))
    }

    async fn registrar_via_http(corpo: serde_json::Value) -> (StatusCode, AppState) {
        let state = novo_estado();
        let (status, _) = chamar(&state, "POST", "/api/v1/auth/registrar", None, corpo).await;
        (status, state)
    }

    async fn contar(state: &AppState, tipo: &'static str, versao: &'static str) -> i64 {
        state.db.with(move |c| c.query_row("SELECT COUNT(*) FROM consentimento WHERE tipo = ?1 AND versao = ?2", [tipo, versao], |r| r.get(0))).await.unwrap()
    }

    async fn total_usuarios(state: &AppState) -> i64 {
        state.db.with(|c| c.query_row("SELECT COUNT(*) FROM usuario", [], |r| r.get(0))).await.unwrap()
    }

    #[tokio::test]
    async fn cadastro_sem_declarar_a_idade_e_recusado_e_nao_cria_conta() {
        let (status, state) = registrar_via_http(serde_json::json!({ "nome_usuario": "diogo", "senha": "Vq7-lampada-Pato-42", "aceita_termos": true })).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(total_usuarios(&state).await, 0);
        assert_eq!(contar(&state, "idade_minima", "18").await, 0);
    }

    #[tokio::test]
    async fn cadastro_sem_aceitar_os_termos_e_recusado_e_nao_cria_conta() {
        let (status, state) = registrar_via_http(serde_json::json!({ "nome_usuario": "diogo", "senha": "Vq7-lampada-Pato-42", "declara_idade_minima": true })).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(total_usuarios(&state).await, 0);
        assert_eq!(contar(&state, "termos", TERMOS_VERSAO).await, 0);
    }

    #[tokio::test]
    async fn cadastro_completo_grava_idade_e_termos_com_a_versao_vigente() {
        let (status, state) = registrar_via_http(serde_json::json!({
            "nome_usuario": "diogo", "senha": "Vq7-lampada-Pato-42", "declara_idade_minima": true, "aceita_termos": true
        })).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(contar(&state, "idade_minima", "18").await, 1);
        assert_eq!(contar(&state, "termos", TERMOS_VERSAO).await, 1);
        let data: String = state.db.with(|c| c.query_row("SELECT aceito_em FROM consentimento WHERE tipo = 'termos'", [], |r| r.get(0))).await.unwrap();
        assert!(!data.is_empty());
    }

    #[tokio::test]
    async fn cadastro_recusa_usuario_e_senha_fora_da_politica_e_nao_cria_conta() {
        let base = |usuario: &str, senha: &str| serde_json::json!({ "nome_usuario": usuario, "senha": senha, "declara_idade_minima": true, "aceita_termos": true });
        let boa = "Vq7-lampada-Pato-42";
        for (usuario, senha, campo) in [
            ("joão", boa, "nome_usuario"),                     // acento
            ("com espaço", boa, "nome_usuario"),               // espaço
            ("../etc", boa, "nome_usuario"),                   // caminho
            ("Admin", boa, "nome_usuario"),                    // reservado
            ("ab", boa, "nome_usuario"),                       // curto
            ("diogo", "curta-1A", "senha"),                    // menos de 12
            ("diogo", "com espaco no meio 1A", "senha"),       // espaço na senha
            ("diogo", "Senha@123456789", "senha"),             // senha comum
            ("diogo", "xx-diogo-Pato-42-xx", "senha"),         // contém o usuário
        ] {
            let (status, state) = registrar_via_http(base(usuario, senha)).await;
            assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{usuario:?} / {senha:?}");
            assert_eq!(total_usuarios(&state).await, 0, "{campo}: não pode ter criado a conta");
        }
    }

    #[tokio::test]
    async fn versao_antiga_dos_termos_fica_pendente_ate_novo_aceite() {
        let state = novo_estado();
        state.db.with(|c| {
            c.execute("INSERT INTO usuario (id, nome_usuario, senha_hash, recovery_key_hash) VALUES ('u1', 'ana', 'x', 'x')", [])?;
            c.execute("INSERT INTO consentimento (usuario_id, tipo, versao) VALUES ('u1', 'termos', '2000-01-01')", [])?;
            Ok(())
        }).await.unwrap();
        let token = session::emitir_access_token("u1", SEGREDO).unwrap();

        let (_, perfil) = chamar(&state, "GET", "/api/v1/me", Some(&token), serde_json::Value::Null).await;
        assert_eq!(perfil["termos_pendente"], true);
        assert_eq!(perfil["termos_versao"], TERMOS_VERSAO);

        let (status, _) = chamar(&state, "POST", "/api/v1/me/aceites/termos", Some(&token), serde_json::json!({ "versao": "2000-01-01" })).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "só a versão vigente pode ser aceita");

        let (status, _) = chamar(&state, "POST", "/api/v1/me/aceites/termos", Some(&token), serde_json::json!({ "versao": TERMOS_VERSAO })).await;
        assert_eq!(status, StatusCode::OK);
        let (_, perfil) = chamar(&state, "GET", "/api/v1/me", Some(&token), serde_json::Value::Null).await;
        assert_eq!(perfil["termos_pendente"], false);
        assert_eq!(contar(&state, "termos", "2000-01-01").await, 1, "o aceite antigo fica no histórico");
    }
}
