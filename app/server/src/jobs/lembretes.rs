//! Lembretes de tarefa (categoria `agenda`), a cada minuto, sem depender de o app estar aberto:
//!
//! - **Prazo** ("vence hoje"/"vence amanhã"): roda a mesma varredura que o sino já fazia ao consultar
//!   `/notificacoes/nao-lidas` (`notificacoes::varrer_prazos`), para cada pessoa. Antes ela só acontecia com o app
//!   aberto, então o push de prazo nunca saía com o celular no bolso. Mesmas regras, mesmo texto, mesma chave.
//! - **Início** ("Começa às HH:MM"): tarefa com horário que começa nos próximos [ANTECEDENCIA_MIN] minutos.
//!
//! A chave de deduplicação garante uma notificação por tarefa e data, mesmo com o job rodando de novo ou o servidor
//! reiniciando. Tudo passa por `notificacoes::criar_com_acao`: respeita as preferências e enfileira o push.
//! Hora mostrada no fuso de cada pessoa (preferências do calendário; sem elas, `America/Sao_Paulo`).
//! Tarefa dentro de pasta trancada sai sem título ("Tarefa privada"): o push passa por servidores de terceiros.

use chrono::{DateTime, Duration, Utc};
use chrono_tz::Tz;

use crate::state::AppState;

/// Antecedência do aviso de tarefa com horário.
const ANTECEDENCIA_MIN: i64 = 15;

#[derive(Debug, Clone)]
pub struct TarefaComHorario {
    pub id: String,
    pub titulo: String,
    pub usuario_id: String,
    pub inicio: DateTime<Utc>,
    pub fuso: Tz,
    pub privada: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Lembrete {
    pub usuario_id: String,
    pub titulo: String,
    pub corpo: String,
    pub chave: String,
    pub acao_url: String,
}

/// O que deve ser avisado agora. Função pura: o job só lê o banco, chama esta e grava.
pub fn lembretes_de_inicio(tarefas: &[TarefaComHorario], agora: DateTime<Utc>) -> Vec<Lembrete> {
    tarefas
        .iter()
        // Começa dentro da antecedência e não começou há mais de um minuto (servidor que volta tarde não avisa atrasado).
        .filter(|t| t.inicio > agora - Duration::minutes(1) && t.inicio <= agora + Duration::minutes(ANTECEDENCIA_MIN))
        .map(|t| Lembrete {
            usuario_id: t.usuario_id.clone(),
            titulo: format!("Começa às {}", t.inicio.with_timezone(&t.fuso).format("%H:%M")),
            corpo: if t.privada { "Tarefa privada".to_string() } else { t.titulo.clone() },
            chave: format!("inicio:{}:{}", t.id, t.inicio.to_rfc3339()),
            acao_url: format!("/tarefa/{}", t.id),
        })
        .collect()
}

/// A pasta está dentro de alguma pasta trancada (a própria ou uma filha)?
fn dentro_de(pasta: Option<&str>, trancadas: &[String]) -> bool {
    let Some(p) = pasta.filter(|p| !p.is_empty()) else { return false };
    trancadas.iter().any(|t| p == t || p.starts_with(&format!("{t}/")))
}

async fn ciclo(state: &AppState) -> anyhow::Result<usize> {
    let agora = Utc::now();
    let (tarefas, pessoas) = state
        .db
        .with_read(move |conn| {
            use std::collections::HashMap;
            let mut trancadas: HashMap<String, Vec<String>> = HashMap::new();
            let mut st = conn.prepare("SELECT usuario_id, pasta FROM pasta_trancada")?;
            for linha in st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
                let (u, p) = linha?;
                trancadas.entry(u).or_default().push(p);
            }
            let mut fusos: HashMap<String, Tz> = HashMap::new();
            let mut st = conn.prepare("SELECT usuario_id, fuso FROM preferencia_calendario")?;
            for linha in st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
                let (u, f) = linha?;
                if let Ok(tz) = f.parse() {
                    fusos.insert(u, tz);
                }
            }
            let mut st = conn.prepare(
                "SELECT id, titulo, criado_por, scheduled_at, espaco, pasta_id FROM tarefa \
                 WHERE status = 'pendente' AND criado_por IS NOT NULL AND scheduled_at BETWEEN ?1 AND ?2",
            )?;
            let (de, ate) = ((agora - Duration::minutes(2)).to_rfc3339(), (agora + Duration::minutes(ANTECEDENCIA_MIN + 1)).to_rfc3339());
            let linhas = st
                .query_map(rusqlite::params![de, ate], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, String>(4)?, r.get::<_, Option<String>>(5)?))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            let tarefas: Vec<TarefaComHorario> = linhas
                .into_iter()
                .filter_map(|(id, titulo, usuario_id, sched, espaco, pasta)| {
                    let inicio = DateTime::parse_from_rfc3339(&sched).ok()?.with_timezone(&Utc);
                    let privada = espaco == "pessoal" && dentro_de(pasta.as_deref(), trancadas.get(&usuario_id).map(Vec::as_slice).unwrap_or(&[]));
                    let fuso = fusos.get(&usuario_id).copied().unwrap_or(chrono_tz::America::Sao_Paulo);
                    Some(TarefaComHorario { id, titulo, usuario_id, inicio, fuso, privada })
                })
                .collect();
            // Quem tem tarefa pessoal pendente com prazo perto de hoje: só para essas pessoas vale varrer prazos.
            let mut st = conn.prepare("SELECT DISTINCT criado_por FROM tarefa WHERE espaco = 'pessoal' AND status = 'pendente' AND criado_por IS NOT NULL AND due_date BETWEEN ?1 AND ?2")?;
            let (d0, d1) = ((agora - Duration::days(1)).date_naive().to_string(), (agora + Duration::days(2)).date_naive().to_string());
            let pessoas = st.query_map(rusqlite::params![d0, d1], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
            Ok((tarefas, pessoas))
        })
        .await?;

    for uid in &pessoas {
        if let Err(e) = crate::routes::notificacoes::varrer_prazos(state, uid).await {
            tracing::error!(error = %e, "lembretes: varredura de prazos falhou para uma pessoa");
        }
    }

    let lembretes = lembretes_de_inicio(&tarefas, agora);
    if lembretes.is_empty() {
        return Ok(0);
    }
    let gravados = state
        .db
        .with(move |conn| {
            let mut n = 0;
            for l in &lembretes {
                if crate::routes::notificacoes::criar_com_acao(conn, &l.usuario_id, "agenda", &l.titulo, &l.corpo, Some(&l.chave), Some(&l.acao_url))? {
                    n += 1;
                }
            }
            Ok(n)
        })
        .await?;
    Ok(gravados)
}

pub fn iniciar(state: AppState) {
    tokio::spawn(async move {
        loop {
            match ciclo(&state).await {
                Ok(0) => {}
                Ok(n) => tracing::info!(avisos = n, "lembretes: avisos de início gravados"),
                Err(e) => tracing::error!(error = %e, "lembretes: ciclo falhou"),
            }
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
        }
    });
}

#[cfg(test)]
mod testes {
    use super::*;

    const SP: Tz = chrono_tz::America::Sao_Paulo;

    fn t(id: &str, inicio: &str, privada: bool) -> TarefaComHorario {
        TarefaComHorario { id: id.into(), titulo: format!("Tarefa {id}"), usuario_id: "U1".into(), inicio: inicio.parse().unwrap(), fuso: SP, privada }
    }

    #[test]
    fn avisa_quinze_minutos_antes_com_a_hora_no_fuso_da_pessoa() {
        let agora: DateTime<Utc> = "2026-11-27T13:50:00Z".parse().unwrap(); // 10:50 em São Paulo
        let l = lembretes_de_inicio(&[t("a", "2026-11-27T14:00:00Z", false), t("b", "2026-11-27T15:00:00Z", false)], agora);
        assert_eq!(l.len(), 1, "só a que começa dentro de 15 min");
        assert_eq!((l[0].titulo.as_str(), l[0].corpo.as_str(), l[0].acao_url.as_str()), ("Começa às 11:00", "Tarefa a", "/tarefa/a"));
    }

    #[test]
    fn nao_avisa_o_que_ja_comecou() {
        let agora: DateTime<Utc> = "2026-11-27T14:05:00Z".parse().unwrap();
        assert!(lembretes_de_inicio(&[t("a", "2026-11-27T14:00:00Z", false)], agora).is_empty());
    }

    #[test]
    fn tarefa_de_pasta_trancada_nao_mostra_o_titulo() {
        let agora: DateTime<Utc> = "2026-11-27T13:50:00Z".parse().unwrap();
        assert_eq!(lembretes_de_inicio(&[t("s", "2026-11-27T14:00:00Z", true)], agora)[0].corpo, "Tarefa privada");
    }

    #[test]
    fn pasta_trancada_vale_para_as_filhas() {
        let tr = vec!["Diário".to_string()];
        assert!(dentro_de(Some("Diário"), &tr));
        assert!(dentro_de(Some("Diário/2026"), &tr));
        assert!(!dentro_de(Some("Diários"), &tr));
        assert!(!dentro_de(None, &tr));
    }
}
