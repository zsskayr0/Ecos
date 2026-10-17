//! Preferências de calendário e localização por pessoa (`/me/preferencias/calendario`): país, fuso IANA,
//! início do dia acordado e exibição de prazos. Antes viviam só no `localStorage` de cada aparelho.

use axum::extract::State;
use axum::{Extension, Json};
use chrono::Utc;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult, CampoInvalido};
use crate::middleware::auth_guard::UsuarioAutenticado;
use crate::state::AppState;

const PAIS_PADRAO: &str = "Brasil";
const FUSO_PADRAO: &str = "America/Sao_Paulo";
const INICIO_PADRAO: &str = "06:00";

#[derive(Debug, Serialize)]
pub struct PreferenciasCalendario {
    pub pais: String,
    pub fuso: String,
    /// `HH:MM`, início do período acordado.
    pub inicio: String,
    /// "Mostrar prazos no calendário".
    pub deadlines: bool,
    /// `false` enquanto a pessoa nunca salvou: os valores são os padrões e o cliente pode subir os que tinha local.
    pub definido: bool,
}

impl Default for PreferenciasCalendario {
    fn default() -> Self {
        Self { pais: PAIS_PADRAO.into(), fuso: FUSO_PADRAO.into(), inicio: INICIO_PADRAO.into(), deadlines: true, definido: false }
    }
}

async fn ler(state: &AppState, usuario_id: &str) -> AppResult<PreferenciasCalendario> {
    let uid = usuario_id.to_string();
    let linha = state
        .db
        .with_read(move |conn| {
            conn.query_row(
                "SELECT pais, fuso, inicio_dia, mostrar_prazos FROM preferencia_calendario WHERE usuario_id = ?1",
                [&uid],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, bool>(3)?)),
            )
            .optional()
        })
        .await?;
    Ok(match linha {
        Some((pais, fuso, inicio, deadlines)) => PreferenciasCalendario { pais, fuso, inicio, deadlines, definido: true },
        None => PreferenciasCalendario::default(),
    })
}

/// `GET /me/preferencias/calendario`
pub async fn obter(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>) -> AppResult<Json<PreferenciasCalendario>> {
    Ok(Json(ler(&state, &usuario.0).await?))
}

#[derive(Debug, Deserialize)]
pub struct AtualizarPreferenciasPayload {
    #[serde(default)]
    pub pais: Option<String>,
    #[serde(default)]
    pub fuso: Option<String>,
    #[serde(default)]
    pub inicio: Option<String>,
    #[serde(default)]
    pub deadlines: Option<bool>,
}

fn inicio_valido(valor: &str) -> bool {
    let Some((h, m)) = valor.split_once(':') else { return false };
    let numeros = |s: &str, tam: &[usize]| tam.contains(&s.len()) && s.bytes().all(|b| b.is_ascii_digit());
    numeros(h, &[1, 2]) && numeros(m, &[2]) && h.parse::<u8>().is_ok_and(|h| h < 24) && m.parse::<u8>().is_ok_and(|m| m < 60)
}

/// `HH:MM` sempre com dois dígitos na hora, para o texto guardado ser único (`6:00` e `06:00` são o mesmo).
fn normalizar_inicio(valor: &str) -> String {
    let (h, m) = valor.split_once(':').unwrap_or((valor, "00"));
    format!("{:0>2}:{m}", h)
}

/// `PATCH /me/preferencias/calendario` — parcial: só os campos enviados mudam; cada campo inválido volta com o seu motivo.
pub async fn atualizar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Json(payload): Json<AtualizarPreferenciasPayload>) -> AppResult<Json<PreferenciasCalendario>> {
    let mut campos = Vec::new();
    let mut invalido = |campo: &str, motivo: &str| campos.push(CampoInvalido { campo: campo.into(), motivo: motivo.into() });
    let pais = payload.pais.as_deref().map(str::trim);
    if let Some(p) = pais {
        if p.is_empty() || p.chars().count() > 60 || p.chars().any(char::is_control) { invalido("pais", "informe um país com até 60 caracteres"); }
    }
    let fuso = payload.fuso.as_deref().map(str::trim);
    if let Some(f) = fuso {
        if f.parse::<chrono_tz::Tz>().is_err() { invalido("fuso", "esperado um fuso IANA, como America/Sao_Paulo"); }
    }
    let inicio = payload.inicio.as_deref().map(str::trim);
    if let Some(i) = inicio {
        if !inicio_valido(i) { invalido("inicio", "esperado o horário no formato HH:MM"); }
    }
    if !campos.is_empty() { return Err(AppError::validation(campos)); }

    let atuais = ler(&state, &usuario.0).await?;
    let (pais, fuso) = (pais.map_or(atuais.pais, str::to_string), fuso.map_or(atuais.fuso, str::to_string));
    let inicio = inicio.map_or(atuais.inicio, normalizar_inicio);
    let deadlines = payload.deadlines.unwrap_or(atuais.deadlines);
    let (uid, p, f, i) = (usuario.0.clone(), pais.clone(), fuso.clone(), inicio.clone());
    let agora = Utc::now().to_rfc3339();
    state
        .db
        .with(move |conn| {
            conn.execute(
                "INSERT INTO preferencia_calendario (usuario_id, pais, fuso, inicio_dia, mostrar_prazos, atualizado_em) VALUES (?1, ?2, ?3, ?4, ?5, ?6) \
                 ON CONFLICT (usuario_id) DO UPDATE SET pais = excluded.pais, fuso = excluded.fuso, inicio_dia = excluded.inicio_dia, mostrar_prazos = excluded.mostrar_prazos, atualizado_em = excluded.atualizado_em",
                rusqlite::params![uid, p, f, i, deadlines, agora],
            )
        })
        .await?;
    Ok(Json(PreferenciasCalendario { pais, fuso, inicio, deadlines, definido: true }))
}

#[cfg(test)]
mod testes {
    use super::*;

    use axum::http::StatusCode;
    use serde_json::{json, Value};
    use crate::auth::session;
    use crate::auth::testes::{chamar, novo_estado, SEGREDO};

    async fn duas_pessoas() -> (crate::state::AppState, String, String) {
        let state = novo_estado();
        state.db.with(|c| {
            c.execute("INSERT INTO usuario (id, nome_usuario, senha_hash, recovery_key_hash) VALUES ('a', 'a', 'h', 'r'), ('b', 'b', 'h', 'r')", [])?;
            Ok(())
        }).await.unwrap();
        let t = |u: &str| session::emitir_access_token(u, SEGREDO).unwrap();
        (state, t("a"), t("b"))
    }

    #[tokio::test]
    async fn sem_nada_salvo_devolve_padroes_e_salva_por_pessoa() {
        let (state, a, b) = duas_pessoas().await;
        let rota = "/api/v1/me/preferencias/calendario";
        let (st, padrao) = chamar(&state, "GET", rota, Some(&a), Value::Null).await;
        assert_eq!(st, StatusCode::OK);
        assert_eq!(padrao, json!({ "pais": "Brasil", "fuso": "America/Sao_Paulo", "inicio": "06:00", "deadlines": true, "definido": false }));

        let (st, salvo) = chamar(&state, "PATCH", rota, Some(&a), json!({ "pais": "Portugal", "fuso": "Europe/Lisbon", "inicio": "8:30", "deadlines": false })).await;
        assert_eq!(st, StatusCode::OK, "{salvo}");
        assert_eq!(salvo, json!({ "pais": "Portugal", "fuso": "Europe/Lisbon", "inicio": "08:30", "deadlines": false, "definido": true }));

        // Parcial: só o que veio muda. Outra pessoa continua com os padrões.
        let (_, parcial) = chamar(&state, "PATCH", rota, Some(&a), json!({ "deadlines": true })).await;
        assert_eq!((parcial["fuso"].as_str(), parcial["deadlines"].as_bool()), (Some("Europe/Lisbon"), Some(true)));
        let (_, de_b) = chamar(&state, "GET", rota, Some(&b), Value::Null).await;
        assert_eq!(de_b["definido"], false);
        assert_eq!(de_b["fuso"], "America/Sao_Paulo");
        let (_, de_a) = chamar(&state, "GET", rota, Some(&a), Value::Null).await;
        assert_eq!(de_a["pais"], "Portugal", "o que foi salvo vale em qualquer aparelho da pessoa");

        let (st, _) = chamar(&state, "GET", rota, None, Value::Null).await;
        assert_eq!(st, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn valores_invalidos_voltam_com_erro_por_campo_e_nada_e_gravado() {
        let (state, a, _) = duas_pessoas().await;
        let rota = "/api/v1/me/preferencias/calendario";
        let (st, corpo) = chamar(&state, "PATCH", rota, Some(&a), json!({ "pais": "  ", "fuso": "Marte/Olympus", "inicio": "25:99" })).await;
        assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY);
        let texto = corpo.to_string();
        for campo in ["pais", "fuso", "inicio"] { assert!(texto.contains(&format!("\"{campo}\"")), "{campo}: {texto}"); }
        let (_, depois) = chamar(&state, "GET", rota, Some(&a), Value::Null).await;
        assert_eq!(depois["definido"], false);
        let (st, _) = chamar(&state, "PATCH", rota, Some(&a), json!({ "fuso": "UTC" })).await;
        assert_eq!(st, StatusCode::OK);
    }

    #[test]
    fn inicio_aceita_so_horario_valido() {
        for ok in ["06:00", "6:00", "00:00", "23:59"] { assert!(inicio_valido(ok), "{ok}"); }
        for ruim in ["", "24:00", "12:60", "7", "ab:cd", "06:0", "06:000", "-1:00"] { assert!(!inicio_valido(ruim), "{ruim}"); }
        assert_eq!(normalizar_inicio("6:05"), "06:05");
    }
}
