//! Título das páginas dos links externos (`POST /links/titulos`).
//! Quem busca é o servidor, nunca o navegador, e só endereços públicos: a rede interna (LAN, localhost, nuvem
//! com metadados) fica fora do alcance mesmo que alguém escreva um link para ela numa nota.

use axum::{Extension, Json};
use regex::Regex;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::error::{AppError, AppResult, CampoInvalido};
use crate::middleware::auth_guard::UsuarioAutenticado;

const MAX_URLS: usize = 20;
const MAX_BYTES: usize = 256 * 1024;
const MAX_REDIRECIONAMENTOS: usize = 3;
const TEMPO_LIMITE: Duration = Duration::from_secs(5);
const VALIDADE_ACHADO: Duration = Duration::from_secs(7 * 24 * 3600);
const VALIDADE_FALHA: Duration = Duration::from_secs(3600);
const MAX_CACHE: usize = 2000;

type Cache = Mutex<HashMap<String, (Instant, Option<String>)>>;

fn cache() -> &'static Cache {
    static C: OnceLock<Cache> = OnceLock::new();
    C.get_or_init(Default::default)
}

fn do_cache(url: &str) -> Option<Option<String>> {
    let c = cache().lock().unwrap_or_else(|e| e.into_inner());
    let (quando, titulo) = c.get(url)?;
    let validade = if titulo.is_some() { VALIDADE_ACHADO } else { VALIDADE_FALHA };
    (quando.elapsed() < validade).then(|| titulo.clone())
}

fn guardar(url: &str, titulo: Option<String>) {
    let mut c = cache().lock().unwrap_or_else(|e| e.into_inner());
    if c.len() >= MAX_CACHE {
        c.retain(|_, (q, t)| q.elapsed() < if t.is_some() { VALIDADE_ACHADO } else { VALIDADE_FALHA });
        if c.len() >= MAX_CACHE {
            c.clear();
        }
    }
    c.insert(url.to_string(), (Instant::now(), titulo));
}

fn v4_publico(ip: Ipv4Addr) -> bool {
    let o = ip.octets();
    !(ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local()
        || ip.is_unspecified()
        || ip.is_broadcast()
        || ip.is_multicast()
        || ip.is_documentation()
        || (o[0] == 100 && (o[1] & 0xC0) == 64) // CGNAT 100.64/10
        || o[0] == 0
        || o[0] >= 240)
}

fn v6_publico(ip: Ipv6Addr) -> bool {
    if let Some(v4) = ip.to_ipv4_mapped() {
        return v4_publico(v4);
    }
    let s = ip.segments();
    !(ip.is_loopback() || ip.is_unspecified() || ip.is_multicast() || (s[0] & 0xFE00) == 0xFC00 || (s[0] & 0xFFC0) == 0xFE80)
}

fn publico(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(a) => v4_publico(a),
        IpAddr::V6(a) => v6_publico(a),
    }
}

fn re_og() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        Regex::new(r#"(?is)<meta\b[^>]*?(?:property|name)\s*=\s*["']og:title["'][^>]*?content\s*=\s*"([^"]*)"|<meta\b[^>]*?(?:property|name)\s*=\s*["']og:title["'][^>]*?content\s*=\s*'([^']*)'|<meta\b[^>]*?content\s*=\s*"([^"]*)"[^>]*?(?:property|name)\s*=\s*["']og:title["']"#).unwrap()
    })
}

fn re_titulo() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"(?is)<title\b[^>]*>(.*?)</title>").unwrap())
}

fn re_entidade() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);").unwrap())
}

fn decodificar(texto: &str) -> String {
    re_entidade()
        .replace_all(texto, |c: &regex::Captures| {
            let e = &c[1];
            let achado = if let Some(h) = e.strip_prefix("#x") {
                u32::from_str_radix(h, 16).ok().and_then(char::from_u32).map(String::from)
            } else if let Some(d) = e.strip_prefix('#') {
                d.parse::<u32>().ok().and_then(char::from_u32).map(String::from)
            } else {
                match e {
                    "amp" => Some("&".into()),
                    "lt" => Some("<".into()),
                    "gt" => Some(">".into()),
                    "quot" => Some("\"".into()),
                    "apos" => Some("'".into()),
                    "nbsp" => Some(" ".into()),
                    "ndash" => Some("–".into()),
                    "mdash" => Some("—".into()),
                    "hellip" => Some("…".into()),
                    _ => None,
                }
            };
            achado.unwrap_or_else(|| c[0].to_string())
        })
        .into_owned()
}

/// `og:title` (o título que a própria página escolhe mostrar) ou, na falta dele, `<title>`.
pub fn extrair_titulo(html: &str) -> Option<String> {
    let og = re_og().captures(html).and_then(|c| c.get(1).or(c.get(2)).or(c.get(3)).map(|m| m.as_str().to_string()));
    let bruto = og.filter(|t| !t.trim().is_empty()).or_else(|| re_titulo().captures(html).map(|c| c[1].to_string()))?;
    let limpo = decodificar(&bruto).split_whitespace().collect::<Vec<_>>().join(" ");
    if limpo.is_empty() {
        return None;
    }
    Some(if limpo.chars().count() > 200 { format!("{}…", limpo.chars().take(200).collect::<String>().trim_end()) } else { limpo })
}

async fn buscar(url: &str) -> Option<String> {
    let mut atual = reqwest::Url::parse(url).ok()?;
    for _ in 0..=MAX_REDIRECIONAMENTOS {
        if !matches!(atual.scheme(), "http" | "https") || !atual.username().is_empty() || atual.password().is_some() {
            return None;
        }
        let host = atual.host_str()?.to_string();
        let porta = atual.port_or_known_default()?;
        // Resolve uma vez, confere cada endereço e fixa o cliente nele: o que foi checado é o que será acessado.
        let enderecos: Vec<_> = tokio::net::lookup_host((host.as_str(), porta)).await.ok()?.collect();
        if enderecos.is_empty() || enderecos.iter().any(|a| !publico(a.ip())) {
            return None;
        }
        let cliente = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(TEMPO_LIMITE)
            .user_agent("Mozilla/5.0 (compatible; Ecos)")
            .resolve(&host, enderecos[0])
            .build()
            .ok()?;
        let mut resp = cliente.get(atual.clone()).header("Accept", "text/html,application/xhtml+xml").header("Accept-Language", "pt-BR,pt;q=0.9,en;q=0.5").send().await.ok()?;
        if resp.status().is_redirection() {
            let destino = resp.headers().get(reqwest::header::LOCATION)?.to_str().ok()?;
            atual = atual.join(destino).ok()?;
            continue;
        }
        if !resp.status().is_success() {
            return None;
        }
        let tipo = resp.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("").to_ascii_lowercase();
        if !tipo.contains("html") {
            return None;
        }
        let mut corpo: Vec<u8> = Vec::new();
        while let Ok(Some(pedaco)) = resp.chunk().await {
            corpo.extend_from_slice(&pedaco);
            let texto = String::from_utf8_lossy(&corpo);
            // O título está no <head>: assim que o fecha (ou passa do limite), já dá para parar.
            if texto.to_ascii_lowercase().contains("</head>") || corpo.len() >= MAX_BYTES {
                break;
            }
        }
        return extrair_titulo(&String::from_utf8_lossy(&corpo));
    }
    None
}

#[derive(Debug, Deserialize)]
pub struct CorpoTitulos {
    pub urls: Vec<String>,
}

/// `POST /links/titulos`: URL -> título da página (ou `null`). Falhas não viram erro: o front cai no domínio.
pub async fn titulos(Extension(_usuario): Extension<UsuarioAutenticado>, Json(corpo): Json<CorpoTitulos>) -> AppResult<Json<Value>> {
    if corpo.urls.len() > MAX_URLS {
        return Err(AppError::validation(vec![CampoInvalido { campo: "urls".into(), motivo: format!("no máximo {MAX_URLS} links por chamada") }]));
    }
    let mut mapa = serde_json::Map::new();
    let mut tarefas = tokio::task::JoinSet::new();
    for url in corpo.urls {
        if !(url.starts_with("http://") || url.starts_with("https://")) || url.len() > 2048 {
            mapa.insert(url, Value::Null);
        } else if let Some(t) = do_cache(&url) {
            mapa.insert(url, json!(t));
        } else {
            tarefas.spawn(async move {
                let t = buscar(&url).await;
                guardar(&url, t.clone());
                (url, t)
            });
        }
    }
    while let Some(r) = tarefas.join_next().await {
        if let Ok((url, t)) = r {
            mapa.insert(url, json!(t));
        }
    }
    Ok(Json(json!({ "titulos": mapa })))
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn so_enderecos_publicos() {
        for ip in ["127.0.0.1", "10.0.0.5", "192.168.1.1", "172.16.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"] {
            assert!(!publico(ip.parse().unwrap()), "{ip}");
        }
        for ip in ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"] {
            assert!(publico(ip.parse().unwrap()), "{ip}");
        }
    }

    #[test]
    fn titulo_prefere_og_e_decodifica() {
        let h = r#"<head><title>Fallback</title><meta property="og:title" content="Guia &amp; Dicas &#8211; Parte 1"></head>"#;
        assert_eq!(extrair_titulo(h).as_deref(), Some("Guia & Dicas – Parte 1"));
        assert_eq!(extrair_titulo("<TITLE>\n  Olá   mundo \n</TITLE>").as_deref(), Some("Olá mundo"));
        assert_eq!(extrair_titulo("<p>sem título</p>"), None);
        let h2 = r#"<meta content="Invertido" property="og:title"><title>x</title>"#;
        assert_eq!(extrair_titulo(h2).as_deref(), Some("Invertido"));
    }
}
