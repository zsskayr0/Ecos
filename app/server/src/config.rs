//! Configuração via variável de ambiente (`.env`, modelo Jellyfin — seção
//! 2), com bootstrap do segredo de sessão quando ausente (seção 5.4:
//! "segredo de sessão nunca ausente em produção").

use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ambiente {
    Producao,
    Staging,
    Desenvolvimento,
}

/// Credenciais e endereços do Google (OAuth + Calendar API). Só existe quando `GOOGLE_CLIENT_ID` e
/// `GOOGLE_CLIENT_SECRET` estão no ambiente; os endereços só são trocados nos testes (servidor de mentira).
#[derive(Clone)]
pub struct GoogleConfig {
    pub client_id: String,
    pub client_secret: String,
    pub auth_url: String,
    pub token_url: String,
    pub revoke_url: String,
    pub api_base: String,
    /// Intervalo do job de sincronização (mínimo de 60 s).
    pub intervalo_secs: u64,
    /// Depois de criar/editar/apagar um evento do Google, envia logo (em ~1,5 s) em vez de esperar o próximo ciclo.
    pub envio_imediato: bool,
}

// À mão de propósito: o `derive(Debug)` imprimiria o client secret em qualquer `{:?}` da `Config`.
impl std::fmt::Debug for GoogleConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("GoogleConfig").field("client_id", &self.client_id).field("client_secret", &"<oculto>").field("api_base", &self.api_base).finish()
    }
}

impl GoogleConfig {
    fn do_ambiente() -> Option<Self> {
        let cheio = |k: &str| std::env::var(k).ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
        Some(Self {
            client_id: cheio("GOOGLE_CLIENT_ID")?,
            client_secret: cheio("GOOGLE_CLIENT_SECRET")?,
            auth_url: cheio("GOOGLE_AUTH_URL").unwrap_or_else(|| "https://accounts.google.com/o/oauth2/v2/auth".into()),
            token_url: cheio("GOOGLE_TOKEN_URL").unwrap_or_else(|| "https://oauth2.googleapis.com/token".into()),
            revoke_url: cheio("GOOGLE_REVOKE_URL").unwrap_or_else(|| "https://oauth2.googleapis.com/revoke".into()),
            api_base: cheio("GOOGLE_API_BASE").unwrap_or_else(|| "https://www.googleapis.com/calendar/v3".into()),
            intervalo_secs: env_u64("ECOS_CALENDARIO_INTERVAL_SECS", 300).max(60),
            envio_imediato: env_bool("ECOS_CALENDARIO_ENVIO_IMEDIATO", true),
        })
    }
}

#[derive(Debug, Clone)]
pub struct Config {
    pub ambiente: Ambiente,
    pub porta: u16,
    /// Raiz do vault de arquivos do usuário (`Ecos/`, seção 1.5) — contém
    /// `Notas/`, `Tarefas/`, `config/` e `.ecos/`.
    pub notes_root: PathBuf,
    pub index_db_path: PathBuf,
    pub vault_enabled: bool,
    /// URL interna (rede Docker `internal`) do `ecos-vault-db` — nunca
    /// exposta fora do `ecos-app` (seção 2).
    pub vault_internal_url: String,
    pub session_secret: Vec<u8>,
    pub ranking_interval_secs: u64,
    /// Build estática do client (Vite `dist/`) — quando presente, `ecos-app`
    /// serve a UI e a API na mesma porta (seção 2, "modelo Jellyfin/Immich":
    /// uma porta só em produção). `None` em desenvolvimento, onde o Vite
    /// dev server continua servindo a UI com HMR.
    pub static_dir: Option<PathBuf>,
    /// Cookie de sessão `Secure` (seção 5.1) exige HTTPS — mas o modelo
    /// "self-hosted na LAN/VPN" (seção 2) serve tudo em
    /// `http://` puro pro IP do PC (ou IP Tailscale); um cookie `Secure`
    /// nesse caso é silenciosamente descartado pelo navegador (login
    /// "funciona" — 200 — mas a sessão nunca gruda). Default `false` por
    /// isso; ligar `ECOS_COOKIE_SECURE=true` só quando há HTTPS de verdade
    /// na frente (proxy TLS local próprio).
    pub cookie_secure: bool,
    /// `None` = integração com o Google Calendar desligada (sem credenciais no ambiente).
    pub google: Option<GoogleConfig>,
}

fn env_bool(key: &str, default: bool) -> bool {
    std::env::var(key)
        .ok()
        .map(|v| matches!(v.trim().to_lowercase().as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(default)
}

fn env_u16(key: &str, default: u16) -> u16 {
    std::env::var(key).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}

fn env_u64(key: &str, default: u64) -> u64 {
    std::env::var(key).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}

/// Lê `ECOS_SESSION_SECRET` se presente; senão gera 32 bytes aleatórios e
/// persiste em `<pasta de segredos>/segredo-sessao` (ver `segredos.rs`: fora
/// da pasta de notas) no primeiro boot — nunca sobe sem segredo, mesmo padrão
/// do `NEXUS_API_KEY` ([[ecos-vault-nexus-reuse-policy]]). Um segredo que
/// ainda esteja em `<notas>/.ecos/` é movido para lá.
fn bootstrap_session_secret(notes_root: &Path, index_db_path: &Path) -> anyhow::Result<Vec<u8>> {
    if let Ok(from_env) = std::env::var("ECOS_SESSION_SECRET") {
        if !from_env.trim().is_empty() {
            return Ok(from_env.into_bytes());
        }
    }
    let dir = crate::segredos::resolver_dir(notes_root, index_db_path);
    let (segredo, criado) = crate::segredos::ler_ou_criar(&dir, &crate::segredos::dir_legado(notes_root), "segredo-sessao", 32)?;
    if criado {
        tracing::warn!(
            path = %dir.join("segredo-sessao").display(),
            "ECOS_SESSION_SECRET ausente — segredo de sessão gerado e persistido no primeiro boot"
        );
    }
    Ok(segredo)
}

impl Config {
    /// Pasta dos segredos desta instância (chave do calendário etc.), fora das notas. Ver `segredos.rs`.
    pub fn dir_segredos(&self) -> PathBuf {
        crate::segredos::resolver_dir(&self.notes_root, &self.index_db_path)
    }

    pub fn from_env() -> anyhow::Result<Self> {
        let ambiente = match std::env::var("ECOS_ENV").as_deref() {
            Ok("staging") => Ambiente::Staging,
            Ok("development") | Ok("dev") => Ambiente::Desenvolvimento,
            _ => Ambiente::Producao,
        };

        let notes_root: PathBuf = std::env::var("ECOS_NOTES_PATH")
            .unwrap_or_else(|_| "./data/notes".to_string())
            .into();
        // Layout por espaço: `<login|Equipe>/{Notas,Tarefas}` (ver `espacos.rs`); cada pasta é criada
        // no primeiro uso. Um vault no layout antigo (`Notas/`, `Tarefas/` ou `Pessoal/` na raiz) é migrado no boot.
        // A mídia é uma biblioteca por espaço (`<Espaço>/src/Media`), criada no primeiro envio.
        // Um `src/` na raiz é do layout antigo e vai para o Pessoal na migração (ver `espacos.rs`).
        std::fs::create_dir_all(notes_root.join(".ecos"))?;

        let index_db_path = std::env::var("ECOS_INDEX_DB_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| notes_root.join(".ecos").join("index.db"));

        let session_secret = bootstrap_session_secret(&notes_root, &index_db_path)?;

        Ok(Self {
            ambiente,
            porta: env_u16("ECOS_PORT", 7023),
            notes_root,
            index_db_path,
            vault_enabled: env_bool("ECOS_VAULT_ENABLED", false),
            vault_internal_url: std::env::var("ECOS_VAULT_URL")
                .unwrap_or_else(|_| "http://ecos-vault-db:8090".to_string()),
            session_secret,
            ranking_interval_secs: env_u64("ECOS_RANKING_INTERVAL_SECS", 300),
            static_dir: std::env::var("ECOS_STATIC_DIR").ok().map(PathBuf::from).filter(|p| p.is_dir()),
            cookie_secure: env_bool("ECOS_COOKIE_SECURE", false),
            google: GoogleConfig::do_ambiente(),
        })
    }
}
