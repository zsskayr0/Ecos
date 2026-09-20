//! Configuração via variável de ambiente (`.env`, modelo Jellyfin — seção
//! 2), com bootstrap do segredo de sessão quando ausente (seção 5.4:
//! "segredo de sessão nunca ausente em produção").

use rand::RngCore;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ambiente {
    Producao,
    Staging,
    Desenvolvimento,
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
/// persiste em `<notes_root>/.ecos/segredo-sessao` (criado no primeiro
/// boot) — nunca sobe sem segredo, mesmo padrão do `NEXUS_API_KEY`
/// ([[ecos-vault-nexus-reuse-policy]]).
fn bootstrap_session_secret(notes_root: &Path) -> anyhow::Result<Vec<u8>> {
    if let Ok(from_env) = std::env::var("ECOS_SESSION_SECRET") {
        if !from_env.trim().is_empty() {
            return Ok(from_env.into_bytes());
        }
    }

    let ecos_dir = notes_root.join(".ecos");
    std::fs::create_dir_all(&ecos_dir)?;
    let secret_path = ecos_dir.join("segredo-sessao");

    if secret_path.exists() {
        let existing = std::fs::read(&secret_path)?;
        if !existing.is_empty() {
            return Ok(existing);
        }
    }

    let mut secret = vec![0u8; 32];
    rand::thread_rng().fill_bytes(&mut secret);
    std::fs::write(&secret_path, &secret)?;
    tracing::warn!(
        path = %secret_path.display(),
        "ECOS_SESSION_SECRET ausente — segredo de sessão gerado e persistido no primeiro boot"
    );
    Ok(secret)
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let ambiente = match std::env::var("ECOS_ENV").as_deref() {
            Ok("staging") => Ambiente::Staging,
            Ok("development") | Ok("dev") => Ambiente::Desenvolvimento,
            _ => Ambiente::Producao,
        };

        let notes_root: PathBuf = std::env::var("ECOS_NOTES_PATH")
            .unwrap_or_else(|_| "./data/notes".to_string())
            .into();
        // Layout por espaço: `<Pessoal|Equipe>/{Notas,Tarefas}` (ver `espacos.rs`).
        // Um vault ainda no layout antigo (`Notas/`, `Tarefas/` na raiz) é migrado no boot.
        std::fs::create_dir_all(notes_root.join(crate::espacos::PESSOAL_DIR).join("Notas"))?;
        std::fs::create_dir_all(notes_root.join(crate::espacos::PESSOAL_DIR).join("Tarefas"))?;
        std::fs::write(notes_root.join(crate::espacos::PESSOAL_DIR).join(crate::espacos::MARCADOR), "pessoal")?;
        // A mídia é uma biblioteca por espaço (`<Espaço>/src/Media`), criada no primeiro envio.
        // Um `src/` na raiz é do layout antigo e vai para o Pessoal na migração (ver `espacos.rs`).
        std::fs::create_dir_all(notes_root.join(".ecos"))?;

        let index_db_path = std::env::var("ECOS_INDEX_DB_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| notes_root.join(".ecos").join("index.db"));

        let session_secret = bootstrap_session_secret(&notes_root)?;

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
        })
    }
}
