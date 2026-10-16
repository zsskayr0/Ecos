//! Entrega de push das notificações (seção 6.5): fila, preferências por categoria e envio atrás de uma interface.
//!
//! Fluxo: `notificacoes::criar` grava a notificação na caixa (se a categoria estiver ligada) e, se o push dessa
//! categoria também estiver ligado, enfileira uma entrega por aparelho com push configurado. O job (`jobs::push`)
//! chama `processar_fila` com uma `EntregaPush`. O polling (`GET /notificacoes`) continua sendo o fallback: nada
//! aqui é necessário para a caixa funcionar.
//!
//! O que existe de verdade: UnifiedPush (POST HTTP no endpoint registrado, `EntregaHttp`). O que fica pendente e
//! documentado: FCM (exige conta de serviço do Firebase, que não pertence ao repositório). Para `fcm` a entrega
//! devolve `NaoConfigurado` e o item é cancelado sem erro: o aparelho segue recebendo pelo polling.

use chrono::{DateTime, Duration, Utc};
use rusqlite::{params, Connection};
use std::future::Future;
use std::pin::Pin;

use crate::state::AppState;

/// Tentativas antes de desistir de um item (com recuo exponencial entre elas).
pub const MAX_TENTATIVAS: i64 = 5;
/// Quantos itens um ciclo processa (o resto fica para o próximo).
const LOTE: i64 = 50;
/// Depois de tanto tempo sem entregar, o aviso não vale mais como push (a caixa continua com ele).
const VALIDADE_HORAS: i64 = 24;
/// Falhas temporárias seguidas (de itens diferentes) que desativam o endpoint do aparelho.
const FALHAS_PARA_DESATIVAR: i64 = 10;
pub const CATEGORIAS: [&str; 4] = ["cofre", "agenda", "equipes", "sync"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Destino {
    pub tipo: String,
    pub endpoint: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Mensagem {
    pub categoria: String,
    pub titulo: String,
    pub corpo: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResultadoEnvio {
    Entregue,
    /// Falha que pode passar (rede, 5xx, 429): tenta de novo com recuo.
    Temporario(String),
    /// O serviço recusou o endpoint (404/410/4xx): ele não existe mais ou não aceita este app.
    EndpointInvalido(String),
    /// O canal não tem credenciais neste servidor (FCM): nada a fazer, o polling cobre.
    NaoConfigurado,
}

pub type FuturoEnvio<'a> = Pin<Box<dyn Future<Output = ResultadoEnvio> + Send + 'a>>;

/// Interface de envio. A implementação real é `EntregaHttp`; os testes usam uma simulada.
pub trait EntregaPush: Send + Sync {
    fn enviar<'a>(&'a self, destino: &'a Destino, mensagem: &'a Mensagem) -> FuturoEnvio<'a>;
}

/// Conteúdo que vai ao serviço de push. O Cofre nunca sai com texto: valores e nomes de conta passam por servidores
/// de terceiros, então o push só diz que há um aviso.
pub fn conteudo_para_push(m: &Mensagem) -> (String, String) {
    if m.categoria == "cofre" {
        ("Ecos".to_string(), "Você tem um novo aviso no Ecos.".to_string())
    } else {
        (m.titulo.clone(), m.corpo.clone())
    }
}

/// UnifiedPush: `POST` do JSON no endpoint que o distribuidor (ntfy etc.) deu ao aparelho. FCM não é enviado daqui.
pub struct EntregaHttp {
    pub http: reqwest::Client,
}

impl EntregaPush for EntregaHttp {
    fn enviar<'a>(&'a self, destino: &'a Destino, mensagem: &'a Mensagem) -> FuturoEnvio<'a> {
        Box::pin(async move {
            if destino.tipo != "unifiedpush" {
                return ResultadoEnvio::NaoConfigurado;
            }
            let (titulo, corpo) = conteudo_para_push(mensagem);
            let resposta = self
                .http
                .post(&destino.endpoint)
                .timeout(std::time::Duration::from_secs(10))
                .json(&serde_json::json!({ "titulo": titulo, "corpo": corpo, "categoria": mensagem.categoria }))
                .send()
                .await;
            match resposta {
                Err(e) => ResultadoEnvio::Temporario(format!("rede: {}", e.without_url())),
                Ok(r) => classificar_status(r.status().as_u16()),
            }
        })
    }
}

pub fn classificar_status(status: u16) -> ResultadoEnvio {
    match status {
        200..=299 => ResultadoEnvio::Entregue,
        408 | 425 | 429 | 500..=599 => ResultadoEnvio::Temporario(format!("http {status}")),
        _ => ResultadoEnvio::EndpointInvalido(format!("http {status}")),
    }
}

/// Endpoint aceito no registro: http(s) com host, sem credenciais na URL e sem destinos que só servem para atacar o
/// próprio servidor (loopback e link-local/metadados de nuvem). Redes privadas continuam permitidas: um ntfy
/// self-hosted na LAN é o caso de uso normal.
pub fn validar_endpoint(endpoint: &str) -> Result<(), &'static str> {
    let url = reqwest::Url::parse(endpoint).map_err(|_| "endereço inválido")?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("use um endereço http ou https");
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("não coloque usuário ou senha no endereço");
    }
    let host = url.host_str().ok_or("endereço sem servidor")?.trim_matches(['[', ']']).to_ascii_lowercase();
    if host == "localhost" || host.ends_with(".localhost") {
        return Err("endereço local não é permitido");
    }
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        let proibido = match ip {
            std::net::IpAddr::V4(v4) => v4.is_loopback() || v4.is_link_local() || v4.is_unspecified(),
            std::net::IpAddr::V6(v6) => v6.is_loopback() || v6.is_unspecified() || (v6.segments()[0] & 0xffc0) == 0xfe80,
        };
        if proibido {
            return Err("endereço local não é permitido");
        }
    }
    Ok(())
}

/// Preferência da pessoa para uma categoria: `(caixa, push)`. Sem linha, tudo ligado.
pub fn preferencia(conn: &Connection, usuario_id: &str, categoria: &str) -> rusqlite::Result<(bool, bool)> {
    match conn.query_row("SELECT caixa, push FROM notificacao_preferencia WHERE usuario_id = ?1 AND categoria = ?2", [usuario_id, categoria], |r| Ok((r.get::<_, i64>(0)? != 0, r.get::<_, i64>(1)? != 0))) {
        Ok(p) => Ok(p),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok((true, true)),
        Err(e) => Err(e),
    }
}

/// Enfileira a entrega de uma notificação já gravada para cada aparelho da pessoa com push configurado e ativo.
pub fn enfileirar(conn: &Connection, usuario_id: &str, notificacao_id: &str, agora: DateTime<Utc>) -> rusqlite::Result<usize> {
    let mut stmt = conn.prepare("SELECT id FROM dispositivo WHERE usuario_id = ?1 AND push_tipo IN ('unifiedpush', 'fcm') AND push_endpoint IS NOT NULL AND push_endpoint <> '' AND push_desativado_em IS NULL")?;
    let aparelhos = stmt.query_map([usuario_id], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
    let (agora_s, expira) = (agora.to_rfc3339(), (agora + Duration::hours(VALIDADE_HORAS)).to_rfc3339());
    for id in &aparelhos {
        conn.execute(
            "INSERT INTO push_fila (id, notificacao_id, dispositivo_id, proxima_tentativa_em, expira_em, criado_em) VALUES (?1, ?2, ?3, ?4, ?5, ?4)",
            params![ecos_core::new_id(), notificacao_id, id, agora_s, expira],
        )?;
    }
    Ok(aparelhos.len())
}

fn recuo(tentativas: i64) -> Duration {
    match tentativas {
        1 => Duration::minutes(1),
        2 => Duration::minutes(5),
        3 => Duration::minutes(30),
        _ => Duration::hours(2),
    }
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct ResumoCiclo {
    pub entregues: usize,
    pub reagendados: usize,
    pub falhos: usize,
    pub cancelados: usize,
    pub aparelhos_desativados: usize,
}

struct Pendente {
    fila_id: String,
    dispositivo_id: String,
    tipo: String,
    endpoint: String,
    tentativas: i64,
    expira_em: String,
    mensagem: Mensagem,
}

/// Um ciclo do job. Falha de um item (ou de um aparelho) nunca interrompe os demais: cada resultado é gravado
/// separadamente e erros de banco só viram log.
pub async fn processar_fila(state: &AppState, entrega: &dyn EntregaPush, agora: DateTime<Utc>) -> ResumoCiclo {
    let agora_s = agora.to_rfc3339();
    let pendentes: Vec<Pendente> = match state
        .db
        .with(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT f.id, f.dispositivo_id, d.push_tipo, COALESCE(d.push_endpoint, ''), f.tentativas, f.expira_em, n.categoria, n.titulo, n.corpo \
                 FROM push_fila f JOIN dispositivo d ON d.id = f.dispositivo_id JOIN notificacao n ON n.id = f.notificacao_id \
                 WHERE f.estado = 'pendente' AND f.proxima_tentativa_em <= ?1 ORDER BY f.proxima_tentativa_em LIMIT ?2",
            )?;
            let linhas = stmt
                .query_map(params![agora_s, LOTE], |r| {
                    Ok(Pendente {
                        fila_id: r.get(0)?, dispositivo_id: r.get(1)?, tipo: r.get(2)?, endpoint: r.get(3)?, tentativas: r.get(4)?, expira_em: r.get(5)?,
                        mensagem: Mensagem { categoria: r.get(6)?, titulo: r.get(7)?, corpo: r.get(8)? },
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(linhas)
        })
        .await
    {
        Ok(p) => p,
        Err(e) => {
            tracing::error!(error = %e, "push: não foi possível ler a fila");
            return ResumoCiclo::default();
        }
    };

    let mut resumo = ResumoCiclo::default();
    let mut aparelhos_invalidos: std::collections::HashSet<String> = Default::default();
    for p in pendentes {
        let agora_s = agora.to_rfc3339();
        // Aparelho desativado neste mesmo ciclo: os itens dele já foram cancelados no banco, mas o lote já foi lido.
        if aparelhos_invalidos.contains(&p.dispositivo_id) {
            continue;
        }
        if p.expira_em.as_str() <= agora_s.as_str() {
            gravar(state, &p.fila_id, "cancelado", p.tentativas, None, Some("expirou"), &agora_s).await;
            resumo.cancelados += 1;
            continue;
        }
        let destino = Destino { tipo: p.tipo.clone(), endpoint: p.endpoint.clone() };
        match entrega.enviar(&destino, &p.mensagem).await {
            ResultadoEnvio::Entregue => {
                gravar(state, &p.fila_id, "enviado", p.tentativas + 1, None, None, &agora_s).await;
                zerar_falhas(state, &p.dispositivo_id).await;
                resumo.entregues += 1;
            }
            ResultadoEnvio::NaoConfigurado => {
                gravar(state, &p.fila_id, "cancelado", p.tentativas, None, Some("canal sem credenciais neste servidor (polling cobre)"), &agora_s).await;
                resumo.cancelados += 1;
            }
            ResultadoEnvio::EndpointInvalido(motivo) => {
                tracing::warn!(dispositivo = %p.dispositivo_id, motivo = %motivo, "push: endpoint recusado; aparelho desativado para push");
                gravar(state, &p.fila_id, "falhou", p.tentativas + 1, None, Some(&motivo), &agora_s).await;
                desativar(state, &p.dispositivo_id, &agora_s).await;
                aparelhos_invalidos.insert(p.dispositivo_id.clone());
                resumo.falhos += 1;
                resumo.aparelhos_desativados += 1;
            }
            ResultadoEnvio::Temporario(motivo) => {
                let tentativas = p.tentativas + 1;
                if tentativas >= MAX_TENTATIVAS {
                    gravar(state, &p.fila_id, "falhou", tentativas, None, Some(&motivo), &agora_s).await;
                    resumo.falhos += 1;
                } else {
                    let proxima = (agora + recuo(tentativas)).to_rfc3339();
                    gravar(state, &p.fila_id, "pendente", tentativas, Some(&proxima), Some(&motivo), &agora_s).await;
                    resumo.reagendados += 1;
                }
                if registrar_falha(state, &p.dispositivo_id).await >= FALHAS_PARA_DESATIVAR {
                    desativar(state, &p.dispositivo_id, &agora_s).await;
                    aparelhos_invalidos.insert(p.dispositivo_id.clone());
                    resumo.aparelhos_desativados += 1;
                }
            }
        }
    }
    resumo
}

async fn gravar(state: &AppState, fila_id: &str, estado: &str, tentativas: i64, proxima: Option<&str>, erro: Option<&str>, _agora: &str) {
    let (id, estado, proxima, erro) = (fila_id.to_string(), estado.to_string(), proxima.map(str::to_string), erro.map(str::to_string));
    let r = state
        .db
        .with(move |conn| conn.execute("UPDATE push_fila SET estado = ?1, tentativas = ?2, proxima_tentativa_em = COALESCE(?3, proxima_tentativa_em), ultimo_erro = ?4 WHERE id = ?5", params![estado, tentativas, proxima, erro, id]))
        .await;
    if let Err(e) = r {
        tracing::error!(error = %e, "push: não foi possível gravar o resultado da entrega");
    }
}

async fn zerar_falhas(state: &AppState, dispositivo_id: &str) {
    let id = dispositivo_id.to_string();
    let _ = state.db.with(move |conn| conn.execute("UPDATE dispositivo SET push_falhas = 0 WHERE id = ?1", [&id])).await;
}

async fn registrar_falha(state: &AppState, dispositivo_id: &str) -> i64 {
    let id = dispositivo_id.to_string();
    state
        .db
        .with(move |conn| {
            conn.execute("UPDATE dispositivo SET push_falhas = push_falhas + 1 WHERE id = ?1", [&id])?;
            conn.query_row("SELECT push_falhas FROM dispositivo WHERE id = ?1", [&id], |r| r.get(0))
        })
        .await
        .unwrap_or(0)
}

/// Desativa o push do aparelho e cancela o que estava pendente para ele. O aparelho continua pareado.
async fn desativar(state: &AppState, dispositivo_id: &str, agora: &str) {
    let (id, agora) = (dispositivo_id.to_string(), agora.to_string());
    let r = state
        .db
        .with(move |conn| {
            conn.execute("UPDATE dispositivo SET push_desativado_em = ?1 WHERE id = ?2", params![agora, id])?;
            conn.execute("UPDATE push_fila SET estado = 'cancelado', ultimo_erro = 'aparelho desativado para push' WHERE dispositivo_id = ?1 AND estado = 'pendente'", [&id])
        })
        .await;
    if let Err(e) = r {
        tracing::error!(error = %e, "push: não foi possível desativar o aparelho");
    }
}

#[cfg(test)]
mod testes {
    use super::*;
    use crate::{config::{Ambiente, Config}, db::IndexDb};
    use std::sync::{Arc, Mutex};

    struct Simulada {
        respostas: Mutex<std::collections::HashMap<String, ResultadoEnvio>>,
        enviados: Mutex<Vec<(String, Mensagem)>>,
    }
    impl Simulada {
        fn nova(respostas: &[(&str, ResultadoEnvio)]) -> Self {
            Self { respostas: Mutex::new(respostas.iter().map(|(k, v)| (k.to_string(), v.clone())).collect()), enviados: Mutex::new(vec![]) }
        }
    }
    impl EntregaPush for Simulada {
        fn enviar<'a>(&'a self, destino: &'a Destino, mensagem: &'a Mensagem) -> FuturoEnvio<'a> {
            Box::pin(async move {
                self.enviados.lock().unwrap().push((destino.endpoint.clone(), mensagem.clone()));
                self.respostas.lock().unwrap().get(&destino.endpoint).cloned().unwrap_or(ResultadoEnvio::Entregue)
            })
        }
    }

    async fn estado() -> AppState {
        let temp = std::env::temp_dir().join(format!("ecos-push-{}", ecos_core::new_id()));
        std::fs::create_dir_all(&temp).unwrap();
        let state = AppState {
            db: IndexDb::open(&temp.join("index.db")).unwrap(),
            config: Arc::new(Config {
                ambiente: Ambiente::Desenvolvimento, porta: 0, notes_root: temp.clone(), index_db_path: temp.join("index.db"),
                vault_enabled: false, vault_internal_url: String::new(), session_secret: b"segredo-efemero-do-teste-de-push".to_vec(), ranking_interval_secs: 300,
                static_dir: None, cookie_secure: false, google: None,
            }),
            http: reqwest::Client::new(), pareamentos: Arc::new(Mutex::new(Default::default())),
        };
        state.db.with(|c| {
            c.execute("INSERT INTO usuario (id, nome_usuario, senha_hash, recovery_key_hash) VALUES ('U1', 'ana', 'x', 'x')", [])?;
            c.execute("INSERT INTO dispositivo (id, usuario_id, nome, papel, push_tipo, push_endpoint) VALUES \
                ('UP1', 'U1', 'Celular', 'primario', 'unifiedpush', 'https://ntfy.exemplo/up1'), \
                ('UP2', 'U1', 'Tablet', 'espelho', 'unifiedpush', 'https://ntfy.exemplo/up2'), \
                ('FCM', 'U1', 'Android', 'espelho', 'fcm', 'token-fcm'), \
                ('SEM', 'U1', 'Notebook', 'espelho', 'nenhum', NULL)", [])?;
            Ok(())
        }).await.unwrap();
        state
    }

    async fn chamar(state: &AppState, metodo: &str, uri: &str, corpo: Option<serde_json::Value>) -> (axum::http::StatusCode, serde_json::Value) {
        use tower::Service;
        let token = crate::auth::session::emitir_access_token("U1", &state.config.session_secret).unwrap();
        let app = crate::routes::montar(state.clone());
        let mut pedido = axum::http::Request::builder().method(metodo).uri(uri).header("authorization", format!("Bearer {token}"));
        let corpo = match corpo {
            Some(c) => { pedido = pedido.header("content-type", "application/json"); axum::body::Body::from(c.to_string()) }
            None => axum::body::Body::empty(),
        };
        let r = app.clone().call(pedido.body(corpo).unwrap()).await.unwrap();
        let st = r.status();
        let b = axum::body::to_bytes(r.into_body(), 1024 * 1024).await.unwrap();
        (st, serde_json::from_slice(&b).unwrap_or(serde_json::Value::Null))
    }

    #[tokio::test]
    async fn rotas_de_preferencia_e_registro_de_endpoint() {
        use axum::http::StatusCode;
        let state = estado().await;
        let (st, p) = chamar(&state, "GET", "/api/v1/notificacoes/preferencias", None).await;
        assert_eq!(st, StatusCode::OK);
        assert_eq!(p["items"].as_array().unwrap().len(), 4);
        assert!(p["items"].as_array().unwrap().iter().all(|i| i["caixa"] == true && i["push"] == true));
        assert_eq!(chamar(&state, "PATCH", "/api/v1/notificacoes/preferencias/agenda", Some(serde_json::json!({ "push": false }))).await.0, StatusCode::OK);
        let (_, p) = chamar(&state, "GET", "/api/v1/notificacoes/preferencias", None).await;
        let agenda = p["items"].as_array().unwrap().iter().find(|i| i["categoria"] == "agenda").unwrap().clone();
        assert_eq!((agenda["caixa"].as_bool(), agenda["push"].as_bool()), (Some(true), Some(false)));
        assert_eq!(chamar(&state, "PATCH", "/api/v1/notificacoes/preferencias/inexistente", Some(serde_json::json!({ "push": false }))).await.0, StatusCode::NOT_FOUND);

        // Endpoint perigoso é recusado no registro; um válido reativa o aparelho desativado.
        let invalido = chamar(&state, "PATCH", "/api/v1/sync/dispositivos/UP1/push", Some(serde_json::json!({ "push_tipo": "unifiedpush", "push_endpoint": "http://169.254.169.254/x" }))).await;
        assert_eq!(invalido.0, StatusCode::UNPROCESSABLE_ENTITY);
        state.db.with(|c| c.execute("UPDATE dispositivo SET push_desativado_em = '2026-01-01T00:00:00+00:00', push_falhas = 9 WHERE id = 'UP1'", [])).await.unwrap();
        assert_eq!(chamar(&state, "PATCH", "/api/v1/sync/dispositivos/UP1/push", Some(serde_json::json!({ "push_tipo": "unifiedpush", "push_endpoint": "https://ntfy.exemplo/novo" }))).await.0, StatusCode::OK);
        assert_eq!(contar(&state, "SELECT COUNT(*) FROM dispositivo WHERE id = 'UP1' AND push_desativado_em IS NULL AND push_falhas = 0").await, 1);
    }

    async fn notificar(state: &AppState, categoria: &str, chave: &str) -> bool {
        let (c, k) = (categoria.to_string(), chave.to_string());
        state.db.with(move |conn| crate::routes::notificacoes::criar(conn, "U1", &c, "Prazo próximo", "A tarefa \"Pagar boleto de 1500\" vence hoje.", Some(&k))).await.unwrap()
    }

    async fn contar(state: &AppState, sql: &str) -> i64 {
        let sql = sql.to_string();
        state.db.with(move |conn| conn.query_row(&sql, [], |r| r.get(0))).await.unwrap()
    }

    #[tokio::test]
    async fn enfileira_so_para_aparelhos_com_push_e_uma_unica_vez_por_notificacao() {
        let state = estado().await;
        assert!(notificar(&state, "agenda", "k1").await);
        assert!(!notificar(&state, "agenda", "k1").await, "mesma chave não gera de novo");
        assert_eq!(contar(&state, "SELECT COUNT(*) FROM notificacao").await, 1);
        assert_eq!(contar(&state, "SELECT COUNT(*) FROM push_fila").await, 3, "UP1, UP2 e FCM; o aparelho sem push não entra");
    }

    #[tokio::test]
    async fn preferencias_por_categoria_valem_para_caixa_e_para_push() {
        let state = estado().await;
        state.db.with(|c| c.execute("INSERT INTO notificacao_preferencia (usuario_id, categoria, caixa, push) VALUES ('U1', 'agenda', 1, 0), ('U1', 'equipes', 0, 1)", [])).await.unwrap();
        assert!(notificar(&state, "agenda", "a").await, "push desligado: ainda cai na caixa");
        assert_eq!(contar(&state, "SELECT COUNT(*) FROM push_fila").await, 0);
        assert!(!notificar(&state, "equipes", "e").await, "caixa desligada: nada é gravado nem enviado");
        assert_eq!(contar(&state, "SELECT COUNT(*) FROM notificacao").await, 1);
        assert_eq!(contar(&state, "SELECT COUNT(*) FROM push_fila").await, 0);
        assert!(notificar(&state, "sync", "s").await, "categoria sem preferência: tudo ligado");
        assert_eq!(contar(&state, "SELECT COUNT(*) FROM push_fila").await, 3);
    }

    #[tokio::test]
    async fn entrega_marca_enviado_e_fcm_sem_credencial_e_cancelado_sem_erro() {
        let state = estado().await;
        notificar(&state, "agenda", "k").await;
        let entrega = Simulada::nova(&[("token-fcm", ResultadoEnvio::NaoConfigurado)]);
        let r = processar_fila(&state, &entrega, Utc::now() + Duration::seconds(5)).await;
        assert_eq!((r.entregues, r.cancelados, r.falhos), (2, 1, 0));
        assert_eq!(contar(&state, "SELECT COUNT(*) FROM push_fila WHERE estado = 'enviado'").await, 2);
        assert_eq!(contar(&state, "SELECT COUNT(*) FROM push_fila WHERE estado = 'cancelado'").await, 1);
        // Rodar de novo não reenvia nada.
        let r2 = processar_fila(&state, &entrega, Utc::now() + Duration::seconds(10)).await;
        assert_eq!(r2, ResumoCiclo::default());
        assert_eq!(entrega.enviados.lock().unwrap().len(), 3);
    }

    #[tokio::test]
    async fn falha_temporaria_tenta_de_novo_com_recuo_e_desiste_no_limite() {
        let state = estado().await;
        state.db.with(|c| c.execute("DELETE FROM dispositivo WHERE id <> 'UP1'", [])).await.unwrap();
        notificar(&state, "agenda", "k").await;
        let entrega = Simulada::nova(&[("https://ntfy.exemplo/up1", ResultadoEnvio::Temporario("http 503".into()))]);
        let t0 = Utc::now() + Duration::seconds(1);
        let r = processar_fila(&state, &entrega, t0).await;
        assert_eq!(r.reagendados, 1);
        // Antes do recuo vencer, nada acontece.
        assert_eq!(processar_fila(&state, &entrega, t0 + Duration::seconds(30)).await, ResumoCiclo::default());
        let mut t = t0;
        for _ in 1..MAX_TENTATIVAS - 1 {
            t += Duration::hours(3);
            assert_eq!(processar_fila(&state, &entrega, t).await.reagendados, 1);
        }
        t += Duration::hours(3);
        let ultimo = processar_fila(&state, &entrega, t).await;
        assert_eq!((ultimo.falhos, ultimo.reagendados), (1, 0));
        assert_eq!(contar(&state, "SELECT tentativas FROM push_fila").await, MAX_TENTATIVAS);
        assert_eq!(contar(&state, "SELECT COUNT(*) FROM push_fila WHERE estado = 'falhou'").await, 1);
    }

    #[tokio::test]
    async fn endpoint_invalido_desativa_o_aparelho_sem_travar_os_outros() {
        let state = estado().await;
        notificar(&state, "agenda", "k1").await;
        notificar(&state, "agenda", "k2").await;
        let entrega = Simulada::nova(&[("https://ntfy.exemplo/up1", ResultadoEnvio::EndpointInvalido("http 410".into())), ("token-fcm", ResultadoEnvio::NaoConfigurado)]);
        let r = processar_fila(&state, &entrega, Utc::now() + Duration::seconds(5)).await;
        assert_eq!(r.aparelhos_desativados, 1);
        assert_eq!(r.entregues, 2, "UP2 recebeu as duas notificações no mesmo ciclo");
        assert_eq!(contar(&state, "SELECT COUNT(*) FROM dispositivo WHERE id = 'UP1' AND push_desativado_em IS NOT NULL").await, 1);
        assert_eq!(contar(&state, "SELECT COUNT(*) FROM dispositivo WHERE id = 'UP1'").await, 1, "continua pareado");
        // Novas notificações não são enfileiradas para o aparelho desativado.
        notificar(&state, "agenda", "k3").await;
        assert_eq!(contar(&state, "SELECT COUNT(*) FROM push_fila WHERE dispositivo_id = 'UP1' AND estado = 'pendente'").await, 0);
    }

    #[tokio::test]
    async fn aviso_vencido_nao_vira_push() {
        let state = estado().await;
        notificar(&state, "agenda", "k").await;
        let entrega = Simulada::nova(&[]);
        let r = processar_fila(&state, &entrega, Utc::now() + Duration::hours(VALIDADE_HORAS + 1)).await;
        assert_eq!((r.entregues, r.cancelados), (0, 3));
        assert!(entrega.enviados.lock().unwrap().is_empty());
    }

    #[test]
    fn cofre_nunca_vai_com_texto_para_o_push() {
        let m = Mensagem { categoria: "cofre".into(), titulo: "Conta de luz".into(), corpo: "R$ 1.234,56 vence hoje".into() };
        let (t, c) = conteudo_para_push(&m);
        assert!(!format!("{t}{c}").contains("1.234") && !t.contains("luz"));
        let a = Mensagem { categoria: "agenda".into(), titulo: "Prazo".into(), corpo: "corpo".into() };
        assert_eq!(conteudo_para_push(&a), ("Prazo".to_string(), "corpo".to_string()));
    }

    #[test]
    fn status_http_e_classificado_e_endpoint_perigoso_e_recusado() {
        assert_eq!(classificar_status(201), ResultadoEnvio::Entregue);
        assert!(matches!(classificar_status(503), ResultadoEnvio::Temporario(_)));
        assert!(matches!(classificar_status(429), ResultadoEnvio::Temporario(_)));
        assert!(matches!(classificar_status(410), ResultadoEnvio::EndpointInvalido(_)));
        assert!(matches!(classificar_status(404), ResultadoEnvio::EndpointInvalido(_)));
        assert!(validar_endpoint("https://ntfy.exemplo/up/abc").is_ok());
        assert!(validar_endpoint("http://192.168.1.10:8080/up").is_ok());
        for ruim in ["ftp://x/y", "https://user:pw@x/y", "http://localhost/x", "http://127.0.0.1/x", "http://169.254.169.254/latest", "http://[::1]/x", "nao-e-url", "file:///etc/passwd"] {
            assert!(validar_endpoint(ruim).is_err(), "{ruim}");
        }
    }
}
