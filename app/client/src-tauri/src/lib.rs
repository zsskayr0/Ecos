// Ecos client — Tauri shell, shared between the desktop entry point
// (`main.rs`) and the mobile one (`tauri::mobile_entry_point` below,
// required for `tauri android`/`tauri ios` builds: mobile targets link
// against this library, not a `main()` binary). All UI logic lives in the
// React front end (../src); Tauri commands (`invoke`) that need to talk
// to the local index (SQLite) or the Notas/Tarefas filesystem go here as
// the real integration progresses (see ecos-arquitetura-tecnica.md,
// section 0.1 — Capture writes locally, no network round-trip).

use serde::{Deserialize, Serialize};
#[cfg(target_os = "android")]
use tauri::Manager;

#[cfg(windows)]
const CREDENCIAL_SERVICO: &str = "app.ecos.client";
#[cfg(windows)]
const CREDENCIAL_USUARIO: &str = "sessao-desktop";

#[derive(Clone, Serialize, Deserialize)]
struct CredencialSalva {
    servidor: String,
    refresh_token: String,
}

// Android não tem Credential Manager. A versão anterior guardava isto só em
// memória do processo — mas o Android mata processos em segundo plano (para
// liberar RAM) com muita frequência, o que apagava o refresh token e forçava
// login de novo a cada reabertura: essa era a causa real do "desloga toda
// hora" no app. Persistir no diretório privado do app (isolado por UID pelo
// Android, cifrado em repouso pelo File-Based Encryption do SO — nenhum
// outro app ou pessoa sem a chave do aparelho lê este arquivo) resolve isso
// sem cair para armazenamento em claro na WebView.
#[cfg(any(target_os = "android", test))]
mod sessao_android {
    use super::CredencialSalva;
    use std::path::{Path, PathBuf};

    fn arquivo(dir: &Path) -> PathBuf {
        dir.join("sessao_nativa.json")
    }

    pub fn ler(dir: &Path) -> Result<Option<CredencialSalva>, String> {
        let caminho = arquivo(dir);
        if !caminho.exists() {
            return Ok(None);
        }
        let conteudo = std::fs::read_to_string(&caminho).map_err(|e| e.to_string())?;
        serde_json::from_str(&conteudo).map(Some).map_err(|e| e.to_string())
    }

    pub fn salvar(dir: &Path, valor: &CredencialSalva) -> Result<(), String> {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let conteudo = serde_json::to_string(valor).map_err(|e| e.to_string())?;
        std::fs::write(arquivo(dir), conteudo).map_err(|e| e.to_string())
    }

    pub fn apagar(dir: &Path) -> Result<(), String> {
        let caminho = arquivo(dir);
        if caminho.exists() {
            std::fs::remove_file(caminho).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

#[derive(Serialize)]
struct ErroNativo {
    code: &'static str,
    message: String,
    status: u16,
    retry_after_segundos: Option<u64>,
}

impl From<String> for ErroNativo {
    fn from(message: String) -> Self {
        Self { code: "SESSAO_NATIVA", message, status: 0, retry_after_segundos: None }
    }
}

impl From<&str> for ErroNativo {
    fn from(message: &str) -> Self { message.to_string().into() }
}

fn erro_conexao(_: reqwest::Error) -> ErroNativo {
    ErroNativo {
        code: "CONEXAO_INDISPONIVEL",
        message: "Não foi possível conectar ao servidor Ecos. Confira o endereço e a conexão do dispositivo.".into(),
        status: 0,
        retry_after_segundos: None,
    }
}

fn mensagem_auth(status: u16) -> &'static str {
    match status {
        401 => "Usuário ou senha inválidos, ou sessão expirada. Entre novamente.",
        403 => "Você não tem permissão para entrar nesta instância.",
        404 | 405 => "O endereço não aponta para uma API Ecos compatível. Confira o servidor ou atualize o backend.",
        429 => "Muitas tentativas de login. Aguarde antes de tentar novamente.",
        500..=599 => "O servidor Ecos está indisponível. Tente novamente mais tarde.",
        _ => "O servidor não conseguiu autenticar a sessão.",
    }
}

async fn ler_sessao(resposta: reqwest::Response) -> Result<RespostaSessao, ErroNativo> {
    let status = resposta.status().as_u16();
    if !resposta.status().is_success() {
        let retry_header = resposta.headers().get("retry-after").and_then(|v| v.to_str().ok()).and_then(|v| v.parse().ok());
        let body = resposta.json::<serde_json::Value>().await.ok();
        return Err(ErroNativo {
            code: "AUTH_NATIVA",
            message: mensagem_auth(status).into(),
            status,
            retry_after_segundos: body.as_ref().and_then(|v| v["retry_after_segundos"].as_u64()).or(retry_header),
        });
    }
    resposta.json().await.map_err(|_| ErroNativo {
        code: "RESPOSTA_INESPERADA",
        message: "O servidor respondeu em um formato incompatível com o Ecos. Confira o endereço e a versão do backend.".into(),
        status,
        retry_after_segundos: None,
    })
}

fn cliente_auth() -> Result<reqwest::Client, ErroNativo> {
    reqwest::Client::builder().use_rustls_tls()
        .timeout(std::time::Duration::from_secs(20))
        // Do not forward login credentials to a redirected host.
        .redirect(reqwest::redirect::Policy::none())
        .build().map_err(erro_conexao)
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
fn ler_credencial(_app: &tauri::AppHandle) -> Result<Option<CredencialSalva>, String> {
    let entry = keyring::Entry::new(CREDENCIAL_SERVICO, CREDENCIAL_USUARIO).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(valor) => serde_json::from_str(&valor).map(Some).map_err(|e| e.to_string()),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(windows)]
fn salvar_credencial(_app: &tauri::AppHandle, credencial: &CredencialSalva) -> Result<(), String> {
    let entry = keyring::Entry::new(CREDENCIAL_SERVICO, CREDENCIAL_USUARIO).map_err(|e| e.to_string())?;
    let valor = serde_json::to_string(credencial).map_err(|e| e.to_string())?;
    entry.set_password(&valor).map_err(|e| e.to_string())
}

#[cfg(windows)]
fn apagar_credencial(_app: &tauri::AppHandle) -> Result<(), String> {
    let entry = keyring::Entry::new(CREDENCIAL_SERVICO, CREDENCIAL_USUARIO).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(target_os = "android")]
fn diretorio_sessao_android(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_local_data_dir().map_err(|e| e.to_string())
}

#[cfg(target_os = "android")]
fn ler_credencial(app: &tauri::AppHandle) -> Result<Option<CredencialSalva>, String> {
    sessao_android::ler(&diretorio_sessao_android(app)?)
}
#[cfg(target_os = "android")]
fn salvar_credencial(app: &tauri::AppHandle, credencial: &CredencialSalva) -> Result<(), String> {
    sessao_android::salvar(&diretorio_sessao_android(app)?, credencial)
}
#[cfg(target_os = "android")]
fn apagar_credencial(app: &tauri::AppHandle) -> Result<(), String> {
    sessao_android::apagar(&diretorio_sessao_android(app)?)
}

#[cfg(not(any(windows, target_os = "android")))]
fn ler_credencial(_app: &tauri::AppHandle) -> Result<Option<CredencialSalva>, String> { Err("Armazenamento seguro ainda não está disponível nesta plataforma.".into()) }
#[cfg(not(any(windows, target_os = "android")))]
fn salvar_credencial(_app: &tauri::AppHandle, _: &CredencialSalva) -> Result<(), String> { Err("Armazenamento seguro ainda não está disponível nesta plataforma.".into()) }
#[cfg(not(any(windows, target_os = "android")))]
fn apagar_credencial(_app: &tauri::AppHandle) -> Result<(), String> { Ok(()) }

async fn renovar(servidor: String, refresh_token: String) -> Result<RespostaSessao, ErroNativo> {
    let client = cliente_auth()?;
    let resposta = client
        .post(url_api(&servidor, "/auth/refresh"))
        .header("x-ecos-native-client", "1")
        .json(&serde_json::json!({ "refresh_token": refresh_token }))
        .send().await.map_err(erro_conexao)?;
    ler_sessao(resposta).await
}

#[tauri::command]
async fn login_desktop(app: tauri::AppHandle, servidor: String, usuario: String, senha: String) -> Result<String, ErroNativo> {
    let client = cliente_auth()?;
    let resposta = client
        .post(url_api(&servidor, "/auth/login"))
        .header("x-ecos-native-client", "1")
        .json(&serde_json::json!({ "usuario": usuario, "senha": senha }))
        .send().await.map_err(erro_conexao)?;
    let sessao = ler_sessao(resposta).await?;
    let Some(refresh_token) = sessao.refresh_token else { return Err("O servidor não retornou uma credencial de renovação.".into()) };
    salvar_credencial(&app, &CredencialSalva { servidor, refresh_token })?;
    Ok(sessao.access_token)
}

#[tauri::command]
async fn renovar_sessao_desktop(app: tauri::AppHandle, servidor: String) -> Result<String, ErroNativo> {
    let Some(credencial) = ler_credencial(&app)? else { return Err("Não há sessão persistida neste dispositivo.".into()) };
    if credencial.servidor.trim_end_matches('/') != servidor.trim_end_matches('/') {
        return Err("A sessão salva pertence a outro servidor.".into());
    }
    let sessao = renovar(servidor.clone(), credencial.refresh_token).await?;
    let Some(refresh_token) = sessao.refresh_token else { return Err("O servidor não rotacionou a credencial.".into()) };
    salvar_credencial(&app, &CredencialSalva { servidor, refresh_token })?;
    Ok(sessao.access_token)
}

#[tauri::command]
async fn logout_desktop(app: tauri::AppHandle, servidor: String) -> Result<(), ErroNativo> {
    if let Some(credencial) = ler_credencial(&app)? {
        if credencial.servidor.trim_end_matches('/') == servidor.trim_end_matches('/') {
            let client = cliente_auth()?;
            // Revoga no servidor antes de remover da credencial persistida. Não
            // retorna o segredo ao WebView em nenhum ponto.
            let resposta = client
                .post(url_api(&servidor, "/auth/logout"))
                .header("x-ecos-native-client", "1")
                .json(&serde_json::json!({ "refresh_token": credencial.refresh_token }))
                .send().await.map_err(erro_conexao)?;
            if !resposta.status().is_success() {
                return Err("Não foi possível revogar a sessão no servidor.".into());
            }
        }
    }
    apagar_credencial(&app).map_err(ErroNativo::from)
}

/// Encerra a atividade nativa quando o usuário confirma a saída pelo botão
/// voltar no Android. A decisão de pedir a confirmação permanece no front-end,
/// que conhece a rota atual; o encerramento em si precisa ser nativo para que
/// o sistema retorne à tela inicial do celular.
#[tauri::command]
fn encerrar_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn android_native_session_can_login_rotate_and_logout() {
        let dir = std::env::temp_dir().join(format!("ecos-sessao-android-teste-{}", std::process::id()));
        sessao_android::apagar(&dir).unwrap();
        assert!(sessao_android::ler(&dir).unwrap().is_none());
        let mut credencial = CredencialSalva { servidor: "http://example.test".into(), refresh_token: "first-test-token".into() };
        sessao_android::salvar(&dir, &credencial).unwrap();
        assert_eq!(sessao_android::ler(&dir).unwrap().unwrap().refresh_token, "first-test-token");
        credencial.refresh_token = "rotated-test-token".into();
        sessao_android::salvar(&dir, &credencial).unwrap();
        let salva = sessao_android::ler(&dir).unwrap().unwrap();
        assert_eq!(salva.servidor, credencial.servidor);
        assert_eq!(salva.refresh_token, "rotated-test-token");
        sessao_android::apagar(&dir).unwrap();
        assert!(sessao_android::ler(&dir).unwrap().is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn native_errors_do_not_mislabel_server_failures_as_password_errors() {
        assert!(mensagem_auth(401).contains("senha"));
        assert!(!mensagem_auth(429).contains("inválidos"));
        assert!(mensagem_auth(503).contains("indisponível"));
        let error = serde_json::to_value(ErroNativo::from("Sessão indisponível".to_string())).unwrap();
        assert_eq!(error["code"], "SESSAO_NATIVA");
        assert_eq!(error["status"], 0);
    }

    #[test]
    fn native_http_contract_handles_sessions_rate_limits_and_invalid_responses() {
        use std::io::{Read, Write};
        for (status, body) in [
            (200, r#"{"access_token":"test-access","refresh_token":"test-refresh"}"#),
            (401, r#"{"error":"Unauthorized"}"#),
            (429, r#"{"retry_after_segundos":42}"#),
            (503, r#"{"error":"Unavailable"}"#),
            (200, "<html>wrong server</html>"),
        ] {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let server = std::thread::spawn(move || {
                let (mut socket, _) = listener.accept().unwrap();
                socket.set_read_timeout(Some(std::time::Duration::from_secs(5))).unwrap();
                let mut request = [0; 4096];
                socket.read(&mut request).unwrap();
                write!(socket, "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            });
            let result = tauri::async_runtime::block_on(async {
                let response = cliente_auth().ok().unwrap().get(format!("http://{address}")).send().await.unwrap();
                ler_sessao(response).await
            });
            server.join().unwrap();
            if status == 200 && body.starts_with('{') {
                let session = result.ok().unwrap();
                assert_eq!(session.access_token, "test-access");
                assert_eq!(session.refresh_token.as_deref(), Some("test-refresh"));
            } else {
                let error = result.err().unwrap();
                assert_eq!(error.status, status);
                if status == 429 { assert_eq!(error.retry_after_segundos, Some(42)); }
                if status == 200 { assert_eq!(error.code, "RESPOSTA_INESPERADA"); }
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![login_desktop, renovar_sessao_desktop, logout_desktop, encerrar_app])
        .run(tauri::generate_context!())
        .expect("error starting Ecos");
}
