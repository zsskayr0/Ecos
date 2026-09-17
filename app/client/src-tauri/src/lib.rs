// Ecos client — Tauri shell, shared between the desktop entry point
// (`main.rs`) and the mobile one (`tauri::mobile_entry_point` below,
// required for `tauri android`/`tauri ios` builds: mobile targets link
// against this library, not a `main()` binary). All UI logic lives in the
// React front end (../src); Tauri commands (`invoke`) that need to talk
// to the local index (SQLite) or the Notas/Tarefas filesystem go here as
// the real integration progresses (see ecos-arquitetura-tecnica.md,
// section 0.1 — Capture writes locally, no network round-trip).

use serde::{Deserialize, Serialize};

const CREDENCIAL_SERVICO: &str = "app.ecos.client";
const CREDENCIAL_USUARIO: &str = "sessao-desktop";

#[derive(Serialize, Deserialize)]
struct CredencialSalva {
    servidor: String,
    refresh_token: String,
}

#[derive(Deserialize)]
struct RespostaSessao {
    access_token: String,
    refresh_token: Option<String>,
}

fn url_api(servidor: &str, rota: &str) -> String {
    format!("{}/api/v1{}", servidor.trim_end_matches('/'), rota)
}

#[cfg(windows)]
fn ler_credencial() -> Result<Option<CredencialSalva>, String> {
    let entry = keyring::Entry::new(CREDENCIAL_SERVICO, CREDENCIAL_USUARIO).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(valor) => serde_json::from_str(&valor).map(Some).map_err(|e| e.to_string()),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(windows)]
fn salvar_credencial(credencial: &CredencialSalva) -> Result<(), String> {
    let entry = keyring::Entry::new(CREDENCIAL_SERVICO, CREDENCIAL_USUARIO).map_err(|e| e.to_string())?;
    let valor = serde_json::to_string(credencial).map_err(|e| e.to_string())?;
    entry.set_password(&valor).map_err(|e| e.to_string())
}

#[cfg(windows)]
fn apagar_credencial() -> Result<(), String> {
    let entry = keyring::Entry::new(CREDENCIAL_SERVICO, CREDENCIAL_USUARIO).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(not(windows))]
fn ler_credencial() -> Result<Option<CredencialSalva>, String> { Err("Armazenamento seguro ainda não está disponível nesta plataforma.".into()) }
#[cfg(not(windows))]
fn salvar_credencial(_: &CredencialSalva) -> Result<(), String> { Err("Armazenamento seguro ainda não está disponível nesta plataforma.".into()) }
#[cfg(not(windows))]
fn apagar_credencial() -> Result<(), String> { Ok(()) }

async fn renovar(servidor: String, refresh_token: String) -> Result<RespostaSessao, String> {
    let client = reqwest::Client::builder().use_rustls_tls().build().map_err(|e| e.to_string())?;
    let resposta = client
        .post(url_api(&servidor, "/auth/refresh"))
        .header("x-ecos-native-client", "1")
        .json(&serde_json::json!({ "refresh_token": refresh_token }))
        .send().await.map_err(|e| e.to_string())?;
    if !resposta.status().is_success() {
        return Err("A sessão expirou. Entre novamente.".into());
    }
    resposta.json().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn login_desktop(servidor: String, usuario: String, senha: String) -> Result<String, String> {
    let client = reqwest::Client::builder().use_rustls_tls().build().map_err(|e| e.to_string())?;
    let resposta = client
        .post(url_api(&servidor, "/auth/login"))
        .header("x-ecos-native-client", "1")
        .json(&serde_json::json!({ "usuario": usuario, "senha": senha }))
        .send().await.map_err(|e| e.to_string())?;
    if !resposta.status().is_success() {
        return Err("Usuário ou senha inválidos.".into());
    }
    let sessao: RespostaSessao = resposta.json().await.map_err(|e| e.to_string())?;
    let Some(refresh_token) = sessao.refresh_token else { return Err("O servidor não retornou uma credencial de renovação.".into()) };
    salvar_credencial(&CredencialSalva { servidor, refresh_token })?;
    Ok(sessao.access_token)
}

#[tauri::command]
async fn renovar_sessao_desktop(servidor: String) -> Result<String, String> {
    let Some(credencial) = ler_credencial()? else { return Err("Não há sessão persistida neste dispositivo.".into()) };
    if credencial.servidor.trim_end_matches('/') != servidor.trim_end_matches('/') {
        return Err("A sessão salva pertence a outro servidor.".into());
    }
    let sessao = renovar(servidor.clone(), credencial.refresh_token).await?;
    let Some(refresh_token) = sessao.refresh_token else { return Err("O servidor não rotacionou a credencial.".into()) };
    salvar_credencial(&CredencialSalva { servidor, refresh_token })?;
    Ok(sessao.access_token)
}

#[tauri::command]
async fn logout_desktop(servidor: String) -> Result<(), String> {
    if let Some(credencial) = ler_credencial()? {
        if credencial.servidor.trim_end_matches('/') == servidor.trim_end_matches('/') {
            let client = reqwest::Client::builder().use_rustls_tls().build().map_err(|e| e.to_string())?;
            // Revoga no servidor antes de remover do Credential Manager. Não
            // retorna o segredo ao WebView em nenhum ponto.
            let resposta = client
                .post(url_api(&servidor, "/auth/logout"))
                .header("x-ecos-native-client", "1")
                .json(&serde_json::json!({ "refresh_token": credencial.refresh_token }))
                .send().await.map_err(|e| e.to_string())?;
            if !resposta.status().is_success() {
                return Err("Não foi possível revogar a sessão no servidor.".into());
            }
        }
    }
    apagar_credencial()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![login_desktop, renovar_sessao_desktop, logout_desktop])
        .run(tauri::generate_context!())
        .expect("error starting Ecos");
}
