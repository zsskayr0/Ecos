//! Cliente HTTP do Google (OAuth 2.0 com PKCE + Calendar API v3), escrito à mão sobre `reqwest`
//! (arquitetura seção 10.2). Nada aqui toca disco ou índice: só fala com o Google e devolve tipos.

use crate::config::GoogleConfig;
use serde::Deserialize;
use std::collections::HashMap;

pub const ESCOPO: &str = "https://www.googleapis.com/auth/calendar";

#[derive(Debug)]
pub enum GoogleErro {
    /// `syncToken` vencido (HTTP 410): descartar o cursor e refazer a sincronização completa.
    Gone,
    /// Refresh token revogado ou expirado: só reconectando a conta.
    InvalidGrant,
    /// `If-Match` não bateu (HTTP 412): o evento mudou no Google desde a última leitura.
    PreCondicao,
    /// O evento (ou o calendário) não existe mais no Google (HTTP 404).
    NaoEncontrado,
    Http { status: u16, mensagem: String },
    Rede(String),
}

impl std::fmt::Display for GoogleErro {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GoogleErro::Gone => write!(f, "cursor de sincronização vencido"),
            GoogleErro::InvalidGrant => write!(f, "o Google recusou o token (acesso revogado ou expirado)"),
            GoogleErro::PreCondicao => write!(f, "o evento mudou no Google desde a última leitura"),
            GoogleErro::NaoEncontrado => write!(f, "evento não encontrado no Google"),
            GoogleErro::Http { status, mensagem } => write!(f, "o Google respondeu {status}: {mensagem}"),
            GoogleErro::Rede(m) => write!(f, "falha de rede ao falar com o Google: {m}"),
        }
    }
}

impl std::error::Error for GoogleErro {}

#[derive(Debug, Deserialize)]
pub struct TokenResposta {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub expires_in: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct CalendarioPrimario {
    pub id: String,
    #[serde(default, rename = "timeZone")]
    pub time_zone: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Quando {
    #[serde(default, rename = "dateTime")]
    pub date_time: Option<String>,
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default, rename = "timeZone")]
    pub time_zone: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct ExtendedProperties {
    #[serde(default)]
    pub private: HashMap<String, String>,
}

/// Só os campos que o Ecos usa; o resto do payload do Google é ignorado.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct EventoGoogle {
    pub id: String,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub etag: Option<String>,
    #[serde(default)]
    pub updated: Option<String>,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub start: Option<Quando>,
    #[serde(default)]
    pub end: Option<Quando>,
    #[serde(default)]
    pub recurrence: Option<Vec<String>>,
    /// Presente nas exceções/ocorrências de uma série (não no evento mestre).
    #[serde(default, rename = "recurringEventId")]
    pub recurring_event_id: Option<String>,
    /// Início ORIGINAL da ocorrência a que esta exceção se refere (chave da exceção).
    #[serde(default, rename = "originalStartTime")]
    pub original_start_time: Option<Quando>,
    #[serde(default, rename = "extendedProperties")]
    pub extended_properties: Option<ExtendedProperties>,
}

impl EventoGoogle {
    pub fn cancelado(&self) -> bool {
        self.status.as_deref() == Some("cancelled")
    }
}

#[derive(Debug, Deserialize)]
pub struct PaginaEventos {
    #[serde(default)]
    pub items: Vec<EventoGoogle>,
    #[serde(default, rename = "nextPageToken")]
    pub next_page_token: Option<String>,
    #[serde(default, rename = "nextSyncToken")]
    pub next_sync_token: Option<String>,
}

pub fn url_autorizacao(cfg: &GoogleConfig, redirect_uri: &str, state: &str, code_challenge: &str) -> Result<String, GoogleErro> {
    let url = reqwest::Url::parse_with_params(
        &cfg.auth_url,
        [
            ("client_id", cfg.client_id.as_str()),
            ("redirect_uri", redirect_uri),
            ("response_type", "code"),
            ("scope", ESCOPO),
            // `offline` + `consent` garantem o refresh token mesmo numa reautorização.
            ("access_type", "offline"),
            ("prompt", "consent"),
            ("state", state),
            ("code_challenge", code_challenge),
            ("code_challenge_method", "S256"),
        ],
    )
    .map_err(|e| GoogleErro::Rede(format!("GOOGLE_AUTH_URL inválida: {e}")))?;
    Ok(url.to_string())
}

async fn resposta_ou_erro(resp: reqwest::Response) -> Result<reqwest::Response, GoogleErro> {
    let status = resp.status();
    if status.is_success() {
        return Ok(resp);
    }
    let corpo = resp.text().await.unwrap_or_default();
    match status.as_u16() {
        410 => return Err(GoogleErro::Gone),
        412 => return Err(GoogleErro::PreCondicao),
        404 => return Err(GoogleErro::NaoEncontrado),
        _ => {}
    }
    let json: serde_json::Value = serde_json::from_str(&corpo).unwrap_or(serde_json::Value::Null);
    let codigo = json["error"].as_str().or_else(|| json["error"]["status"].as_str()).unwrap_or_default();
    if codigo == "invalid_grant" {
        return Err(GoogleErro::InvalidGrant);
    }
    let mensagem = json["error_description"].as_str().or_else(|| json["error"]["message"].as_str()).unwrap_or(codigo).to_string();
    Err(GoogleErro::Http { status: status.as_u16(), mensagem })
}

fn rede(e: reqwest::Error) -> GoogleErro {
    GoogleErro::Rede(e.without_url().to_string())
}

async fn ler_json<T: serde::de::DeserializeOwned>(resp: reqwest::Response) -> Result<T, GoogleErro> {
    resposta_ou_erro(resp).await?.json::<T>().await.map_err(rede)
}

pub async fn trocar_codigo(http: &reqwest::Client, cfg: &GoogleConfig, code: &str, verifier: &str, redirect_uri: &str) -> Result<TokenResposta, GoogleErro> {
    let resp = http
        .post(&cfg.token_url)
        .form(&[
            ("code", code),
            ("client_id", cfg.client_id.as_str()),
            ("client_secret", cfg.client_secret.as_str()),
            ("redirect_uri", redirect_uri),
            ("grant_type", "authorization_code"),
            ("code_verifier", verifier),
        ])
        .send()
        .await
        .map_err(rede)?;
    ler_json(resp).await
}

pub async fn renovar(http: &reqwest::Client, cfg: &GoogleConfig, refresh_token: &str) -> Result<TokenResposta, GoogleErro> {
    let resp = http
        .post(&cfg.token_url)
        .form(&[
            ("refresh_token", refresh_token),
            ("client_id", cfg.client_id.as_str()),
            ("client_secret", cfg.client_secret.as_str()),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await
        .map_err(rede)?;
    ler_json(resp).await
}

/// Melhor esforço: se o Google não confirmar, a conexão local some do mesmo jeito.
pub async fn revogar(http: &reqwest::Client, cfg: &GoogleConfig, token: &str) {
    let resultado = http.post(&cfg.revoke_url).form(&[("token", token)]).send().await;
    if let Err(e) = resultado {
        tracing::warn!(error = %e.without_url(), "não foi possível revogar o token no Google");
    }
}

pub async fn calendario_primario(http: &reqwest::Client, cfg: &GoogleConfig, access_token: &str) -> Result<CalendarioPrimario, GoogleErro> {
    let resp = http.get(format!("{}/calendars/primary", cfg.api_base)).bearer_auth(access_token).send().await.map_err(rede)?;
    ler_json(resp).await
}

/// Uma página de eventos. Com `sync_token` devolve só o que mudou desde a última vez (o Google não aceita
/// `timeMin` junto); sem ele faz a carga inicial a partir de `time_min`.
pub async fn listar_eventos(
    http: &reqwest::Client,
    cfg: &GoogleConfig,
    access_token: &str,
    calendar_id: &str,
    sync_token: Option<&str>,
    time_min: Option<&str>,
    page_token: Option<&str>,
) -> Result<PaginaEventos, GoogleErro> {
    let mut consulta: Vec<(&str, &str)> = vec![("maxResults", "250"), ("singleEvents", "false"), ("showDeleted", "true")];
    if let Some(t) = sync_token {
        consulta.push(("syncToken", t));
    } else if let Some(t) = time_min {
        consulta.push(("timeMin", t));
    }
    if let Some(p) = page_token {
        consulta.push(("pageToken", p));
    }
    let url = format!("{}/calendars/{}/events", cfg.api_base, codificar_segmento(calendar_id));
    let resp = http.get(url).bearer_auth(access_token).query(&consulta).send().await.map_err(rede)?;
    ler_json(resp).await
}

fn url_do_evento(cfg: &GoogleConfig, calendar_id: &str, event_id: &str) -> String {
    format!("{}/calendars/{}/events/{}", cfg.api_base, codificar_segmento(calendar_id), codificar_segmento(event_id))
}

/// Cria o evento no Google e devolve como ele ficou (com `id`, `etag` e `updated`).
pub async fn inserir_evento(http: &reqwest::Client, cfg: &GoogleConfig, access_token: &str, calendar_id: &str, corpo: &serde_json::Value) -> Result<EventoGoogle, GoogleErro> {
    let url = format!("{}/calendars/{}/events", cfg.api_base, codificar_segmento(calendar_id));
    let resp = http.post(url).bearer_auth(access_token).json(corpo).send().await.map_err(rede)?;
    ler_json(resp).await
}

/// `PATCH` só dos campos enviados (o resto do evento no Google — convidados, lembretes — fica como está). Com `etag`
/// vai `If-Match`: se o evento mudou lá desde a última leitura, o Google responde 412 em vez de sobrescrever.
pub async fn atualizar_evento(http: &reqwest::Client, cfg: &GoogleConfig, access_token: &str, calendar_id: &str, event_id: &str, etag: Option<&str>, corpo: &serde_json::Value) -> Result<EventoGoogle, GoogleErro> {
    let mut req = http.patch(url_do_evento(cfg, calendar_id, event_id)).bearer_auth(access_token).json(corpo);
    if let Some(e) = etag {
        req = req.header("If-Match", e);
    }
    ler_json(req.send().await.map_err(rede)?).await
}

/// Apagar o que já não existe (404) ou já foi apagado (410) é sucesso: o resultado desejado já vale.
pub async fn apagar_evento(http: &reqwest::Client, cfg: &GoogleConfig, access_token: &str, calendar_id: &str, event_id: &str) -> Result<(), GoogleErro> {
    let resp = http.delete(url_do_evento(cfg, calendar_id, event_id)).bearer_auth(access_token).send().await.map_err(rede)?;
    match resposta_ou_erro(resp).await {
        Ok(_) | Err(GoogleErro::NaoEncontrado) | Err(GoogleErro::Gone) => Ok(()),
        Err(e) => Err(e),
    }
}

/// Instâncias de uma série entre `de` e `ate` (com as canceladas): serve para descobrir o id de uma ocorrência.
pub async fn listar_instancias(
    http: &reqwest::Client,
    cfg: &GoogleConfig,
    access_token: &str,
    calendar_id: &str,
    mestre_id: &str,
    de: chrono::DateTime<chrono::Utc>,
    ate: chrono::DateTime<chrono::Utc>,
) -> Result<Vec<EventoGoogle>, GoogleErro> {
    let url = format!("{}/instances", url_do_evento(cfg, calendar_id, mestre_id));
    let (de, ate) = (de.to_rfc3339_opts(chrono::SecondsFormat::Secs, true), ate.to_rfc3339_opts(chrono::SecondsFormat::Secs, true));
    let resp = http
        .get(url)
        .bearer_auth(access_token)
        .query(&[("timeMin", de.as_str()), ("timeMax", ate.as_str()), ("showDeleted", "true"), ("maxResults", "50")])
        .send()
        .await
        .map_err(rede)?;
    Ok(ler_json::<PaginaEventos>(resp).await?.items)
}

/// Escapa um segmento de caminho (o id do calendário é um e-mail: `@` e afins precisam de `%XX`).
fn codificar_segmento(texto: &str) -> String {
    texto
        .bytes()
        .map(|b| if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') { (b as char).to_string() } else { format!("%{b:02X}") })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn segmento_de_caminho_escapa_o_email_do_calendario() {
        assert_eq!(codificar_segmento("eu@gmail.com"), "eu%40gmail.com");
        assert_eq!(codificar_segmento("primary"), "primary");
    }

    #[test]
    fn url_de_autorizacao_leva_pkce_offline_e_state() {
        let cfg = GoogleConfig {
            client_id: "cid".into(), client_secret: "seg".into(), auth_url: "https://accounts.example/auth".into(),
            token_url: String::new(), revoke_url: String::new(), api_base: String::new(), intervalo_secs: 300, envio_imediato: false,
        };
        let url = url_autorizacao(&cfg, "http://127.0.0.1:7023/cb", "ST", "CH").unwrap();
        for trecho in ["client_id=cid", "state=ST", "code_challenge=CH", "code_challenge_method=S256", "access_type=offline", "prompt=consent", "redirect_uri=http%3A%2F%2F127.0.0.1%3A7023%2Fcb"] {
            assert!(url.contains(trecho), "faltou {trecho} em {url}");
        }
        assert!(!url.contains("seg"), "o secret nunca vai na URL do navegador");
    }
}
