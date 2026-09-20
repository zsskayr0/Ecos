//! Calendário externo (seção 11.13 / 6.5). Google é real (OAuth 2.0 com PKCE, tokens cifrados, sync incremental);
//! Microsoft segue como contrato com `501` explícito, nunca um fluxo fingido.
//!
//! O callback do Google chega sem cookie nem `Authorization`, então fica fora do guard de sessão: quem
//! identifica o usuário é o `state` aleatório de uso único gravado em `oauth_pendente` ao iniciar o fluxo.

use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap};
use axum::response::{Html, IntoResponse};
use axum::{Extension, Json};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{Duration, Utc};
use ecos_core::ErrorCode;
use rand::RngCore;
use rusqlite::{params, OptionalExtension};
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::calendario::crypto::Cofre;
use crate::calendario::google;
use crate::calendario::sync::{self, SyncErro};
use crate::error::{AppError, AppResult};
use crate::middleware::auth_guard::UsuarioAutenticado;
use crate::state::AppState;

/// Quanto tempo o usuário tem para concluir a autorização no Google.
const VALIDADE_STATE_MIN: i64 = 10;

fn exigir_provider(provider: &str) -> AppResult<()> {
    if ["google", "microsoft"].contains(&provider) {
        Ok(())
    } else {
        Err(AppError::new(ErrorCode::ValidationError).with_message("provider deve ser 'google' ou 'microsoft'"))
    }
}

fn erro_de_sync(e: SyncErro) -> AppError {
    match e {
        SyncErro::Desligado => AppError::new(ErrorCode::NotImplemented).with_message("A integração com o Google não está configurada: defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no servidor."),
        SyncErro::NaoConectado => AppError::new(ErrorCode::NotFound).with_message("Nenhuma conta Google conectada."),
        SyncErro::PrecisaReconectar => AppError::new(ErrorCode::Conflict).with_message("O acesso ao Google foi revogado ou expirou. Reconecte a conta."),
        SyncErro::Google(g) => AppError::new(ErrorCode::InternalError).with_message(g.to_string()),
        SyncErro::Interno(m) => {
            tracing::error!(error = %m, "falha interna no sync do calendário");
            AppError::new(ErrorCode::InternalError)
        }
    }
}

pub async fn config(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>) -> AppResult<Json<serde_json::Value>> {
    let conectados = state
        .db
        .with(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT provider, conectado_em, email, ultima_sync_em, ultimo_erro, precisa_reconectar FROM config_calendario WHERE usuario_id = ?1",
            )?;
            let linhas = stmt
                .query_map([&usuario.0], |r| {
                    Ok(serde_json::json!({
                        "provider": r.get::<_, String>(0)?, "conectado_em": r.get::<_, String>(1)?, "email": r.get::<_, Option<String>>(2)?,
                        "ultima_sync_em": r.get::<_, Option<String>>(3)?, "ultimo_erro": r.get::<_, Option<String>>(4)?,
                        "precisa_reconectar": r.get::<_, bool>(5)?,
                    }))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await?;
    Ok(Json(serde_json::json!({ "conectados": conectados, "google_configurado": state.config.google.is_some() })))
}

fn aleatorio_b64(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    URL_SAFE_NO_PAD.encode(buf)
}

/// O Google só aceita redirect em `localhost`/loopback sem HTTPS. Usa o `Host` da própria requisição, então
/// funciona com qualquer porta (dev, Docker mapeado…) desde que o Ecos tenha sido aberto por um endereço loopback.
fn redirect_uri_de(headers: &HeaderMap) -> AppResult<String> {
    let host = headers.get(header::HOST).and_then(|h| h.to_str().ok()).unwrap_or_default();
    let so_host = host.rsplit_once(':').filter(|(_, p)| p.chars().all(|c| c.is_ascii_digit())).map_or(host, |(h, _)| h);
    if ["127.0.0.1", "localhost", "[::1]"].contains(&so_host) {
        Ok(format!("http://{host}/api/v1/calendario/callback/google"))
    } else {
        Err(AppError::validation(vec![crate::error::CampoInvalido {
            campo: "host".into(),
            motivo: "o Google só aceita o retorno em localhost: abra o Ecos por http://localhost:PORTA (ou 127.0.0.1) no computador do servidor para conectar".into(),
        }]))
    }
}

pub async fn conectar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(provider): Path<String>, headers: HeaderMap) -> AppResult<Json<serde_json::Value>> {
    exigir_provider(&provider)?;
    if provider == "microsoft" {
        return Err(AppError::new(ErrorCode::NotImplemented).with_message("A integração com o Microsoft Outlook ainda não está disponível."));
    }
    let cfg = state.config.google.clone().ok_or_else(|| erro_de_sync(SyncErro::Desligado))?;
    let redirect_uri = redirect_uri_de(&headers)?;

    let (estado, verifier) = (aleatorio_b64(24), aleatorio_b64(32));
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let url = google::url_autorizacao(&cfg, &redirect_uri, &estado, &challenge).map_err(|e| AppError::new(ErrorCode::InternalError).with_message(e.to_string()))?;

    let (agora, limite, estado_db) = (Utc::now(), (Utc::now() - Duration::minutes(VALIDADE_STATE_MIN)).to_rfc3339(), estado.clone());
    state
        .db
        .with(move |conn| {
            conn.execute("DELETE FROM oauth_pendente WHERE criado_em < ?1", [limite])?;
            conn.execute(
                "INSERT INTO oauth_pendente (state, usuario_id, provider, code_verifier, redirect_uri, criado_em) VALUES (?1, ?2, 'google', ?3, ?4, ?5)",
                params![estado_db, usuario.0, verifier, redirect_uri, agora.to_rfc3339()],
            )
        })
        .await?;
    Ok(Json(serde_json::json!({ "url": url })))
}

#[derive(Debug, Deserialize)]
pub struct CallbackQuery {
    pub code: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Copy)]
enum Tom {
    Ok,
    Aviso,
    Erro,
}

/// A CSP do servidor (`default-src 'self'`) bloqueia `<style>`, `style=` e scripts embutidos: o visual vem de um
/// arquivo do mesmo domínio (`retorno.css`) e o ícone é SVG inline (marcação, não estilo).
const CSS_RETORNO: &str = include_str!("calendario_retorno.css");

pub async fn retorno_css() -> impl IntoResponse {
    ([(header::CONTENT_TYPE, "text/css; charset=utf-8"), (header::CACHE_CONTROL, "public, max-age=3600")], CSS_RETORNO)
}

/// Página estática (nenhum parâmetro da URL é refletido no HTML).
fn pagina(tom: Tom, titulo: &str, mensagem: &str) -> impl IntoResponse {
    let (classe, icone) = match tom {
        Tom::Ok => ("ok", r#"<path d="M20 33l8 8 16-17"/>"#),
        Tom::Aviso => ("aviso", r#"<path d="M32 19v17M32 44v.5"/>"#),
        Tom::Erro => ("erro", r#"<path d="M23 23l18 18M41 23L23 41"/>"#),
    };
    (
        [(header::CACHE_CONTROL, "no-store"), (header::REFERRER_POLICY, "no-referrer")],
        Html(format!(
            "<!doctype html><html lang=\"pt-BR\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">             <meta name=\"color-scheme\" content=\"dark light\"><title>Ecos · {titulo}</title>             <link rel=\"stylesheet\" href=\"/api/v1/calendario/retorno.css\"></head>             <body><main class=\"{classe}\"><p class=\"marca\">Ecos</p>             <svg class=\"icone\" viewBox=\"0 0 64 64\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"3.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><circle cx=\"32\" cy=\"32\" r=\"28\" opacity=\".35\"/>{icone}</svg>             <h1>{titulo}</h1><p>{mensagem}</p></main></body></html>"
        )),
    )
}

pub async fn callback(State(state): State<AppState>, Path(provider): Path<String>, Query(q): Query<CallbackQuery>) -> impl IntoResponse {
    if provider != "google" {
        return pagina(Tom::Erro, "Não foi possível conectar", "Provedor desconhecido.").into_response();
    }
    let Some(cfg) = state.config.google.clone() else {
        return pagina(Tom::Erro, "Não foi possível conectar", "A integração com o Google não está configurada neste servidor.").into_response();
    };
    // Sem `state` conhecido não há usuário a quem atribuir a conexão: descarta sem mais informação.
    let Some(estado) = q.state.clone().filter(|s| !s.is_empty() && s.len() <= 128) else {
        return pagina(Tom::Erro, "Não foi possível conectar", "Solicitação inválida. Volte ao Ecos e tente conectar de novo.").into_response();
    };
    let limite = (Utc::now() - Duration::minutes(VALIDADE_STATE_MIN)).to_rfc3339();
    // Consome o `state` (uso único), mesmo que a autorização tenha falhado.
    let pendente = state
        .db
        .with(move |conn| {
            let linha = conn
                .query_row("SELECT usuario_id, code_verifier, redirect_uri, criado_em FROM oauth_pendente WHERE state = ?1", [&estado], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?))
                })
                .optional()?;
            conn.execute("DELETE FROM oauth_pendente WHERE state = ?1", [&estado])?;
            Ok(linha)
        })
        .await;
    let Ok(Some((usuario_id, verifier, redirect_uri, criado_em))) = pendente else {
        return pagina(Tom::Erro, "Não foi possível conectar", "Esta autorização expirou ou já foi usada. Volte ao Ecos e tente conectar de novo.").into_response();
    };
    if criado_em < limite {
        return pagina(Tom::Erro, "Não foi possível conectar", "Esta autorização expirou. Volte ao Ecos e tente conectar de novo.").into_response();
    }
    if q.error.is_some() {
        return pagina(Tom::Aviso, "Conexão cancelada", "O acesso ao Google Calendar não foi autorizado. Você pode fechar esta janela.").into_response();
    }
    let Some(code) = q.code.filter(|c| !c.is_empty()) else {
        return pagina(Tom::Erro, "Não foi possível conectar", "O Google não devolveu o código de autorização.").into_response();
    };

    match concluir_conexao(&state, &cfg, &usuario_id, &code, &verifier, &redirect_uri).await {
        Ok(()) => {
            // Primeira sincronização em segundo plano: a janela do Google não precisa esperar por ela.
            let (estado_app, usuario) = (state.clone(), usuario_id.clone());
            tokio::spawn(async move {
                if let Err(e) = sync::sincronizar(&estado_app, &usuario).await {
                    tracing::warn!(error = %e, "primeira sincronização depois de conectar falhou");
                }
            });
            pagina(Tom::Ok, "Google Calendar conectado", "Tudo certo. Você pode fechar esta janela e voltar ao Ecos.").into_response()
        }
        Err(mensagem) => {
            tracing::warn!(error = %mensagem, "conexão com o Google Calendar falhou");
            pagina(Tom::Erro, "Não foi possível conectar", "O Google recusou a conexão. Volte ao Ecos e tente de novo.").into_response()
        }
    }
}

async fn concluir_conexao(state: &AppState, cfg: &crate::config::GoogleConfig, usuario_id: &str, code: &str, verifier: &str, redirect_uri: &str) -> Result<(), String> {
    let tokens = google::trocar_codigo(&state.http, cfg, code, verifier, redirect_uri).await.map_err(|e| e.to_string())?;
    let refresh = tokens.refresh_token.clone().ok_or("o Google não devolveu refresh token (revogue o acesso do Ecos em myaccount.google.com/permissions e conecte de novo)")?;
    let primario = google::calendario_primario(&state.http, cfg, &tokens.access_token).await.map_err(|e| e.to_string())?;

    let cofre = Cofre::carregar(&state.config.notes_root).map_err(|e| e.to_string())?;
    let access_cifrado = cofre.cifrar(tokens.access_token.as_bytes()).map_err(|e| e.to_string())?;
    let refresh_cifrado = cofre.cifrar(refresh.as_bytes()).map_err(|e| e.to_string())?;
    let expira = (Utc::now() + Duration::seconds(tokens.expires_in.unwrap_or(3600))).to_rfc3339();
    let (usuario, agora) = (usuario_id.to_string(), Utc::now().to_rfc3339());
    state
        .db
        .with(move |conn| {
            // Reconectar (talvez outra conta) recomeça a carga do zero: cursor limpo e sem pendência de reconexão.
            conn.execute(
                "INSERT INTO config_calendario (usuario_id, provider, access_token_encrypted, refresh_token_encrypted, calendar_id, conectado_em, \
                 sync_cursor, email, fuso, access_expira_em, ultima_sync_em, ultimo_erro, precisa_reconectar) \
                 VALUES (?1, 'google', ?2, ?3, ?4, ?5, NULL, ?4, ?6, ?7, NULL, NULL, 0) \
                 ON CONFLICT (usuario_id, provider) DO UPDATE SET access_token_encrypted = ?2, refresh_token_encrypted = ?3, calendar_id = ?4, \
                 conectado_em = ?5, sync_cursor = NULL, email = ?4, fuso = ?6, access_expira_em = ?7, ultima_sync_em = NULL, ultimo_erro = NULL, precisa_reconectar = 0",
                params![usuario, access_cifrado, refresh_cifrado, primario.id, agora, primario.time_zone, expira],
            )
        })
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn sincronizar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>) -> AppResult<Json<sync::ResumoSync>> {
    Ok(Json(sync::sincronizar(&state, &usuario.0).await.map_err(erro_de_sync)?))
}

pub async fn desconectar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(provider): Path<String>) -> AppResult<Json<serde_json::Value>> {
    // Tarefas nunca são apagadas: o vínculo `evento_externo` delas só some no reindex, a partir do `.md`.
    let (usuario_id, prov) = (usuario.0.clone(), provider.clone());
    let refresh: Option<Vec<u8>> = state
        .db
        .with(move |conn| {
            let r = conn.query_row("SELECT refresh_token_encrypted FROM config_calendario WHERE usuario_id = ?1 AND provider = ?2", params![usuario_id, prov], |r| r.get(0)).optional()?;
            conn.execute("DELETE FROM config_calendario WHERE usuario_id = ?1 AND provider = ?2", params![usuario_id, prov])?;
            Ok(r.flatten())
        })
        .await?;
    if provider == "google" {
        // Os eventos ficam no Ecos, sem vínculo e privados; só a conexão some.
        let soltos = sync::desvincular_eventos(&state).await.map_err(erro_de_sync)?;
        tracing::info!(eventos_desvinculados = soltos, "Google Calendar desconectado");
        if let (Some(cfg), Some(blob)) = (state.config.google.as_ref(), refresh) {
            if let Ok(claro) = Cofre::carregar(&state.config.notes_root).and_then(|c| c.decifrar(&blob)) {
                google::revogar(&state.http, cfg, &String::from_utf8_lossy(&claro)).await;
            }
        }
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}
