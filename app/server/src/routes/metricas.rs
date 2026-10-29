//! Métricas agregadas no servidor, sem depender da paginação do cliente. O perfil pode consultar
//! o espaço pessoal, o conjunto geral ou uma equipe de que a pessoa é membro.

use axum::extract::{Query, State};
use axum::{Extension, Json};
use ecos_core::ErrorCode;
use serde::{Deserialize, Serialize};
use chrono::{Duration, FixedOffset, Utc};

use crate::error::{AppError, AppResult, CampoInvalido};
use crate::middleware::auth_guard::UsuarioAutenticado;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct MetricasQuery {
    pub escopo: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AtividadeQuery {
    pub dias: Option<i64>,
    /// `geral`, `pessoal` ou `equipe:<id>`.
    pub escopo: Option<String>,
    /// Minutos a leste de UTC, como `Date#getTimezoneOffset` invertido.
    pub fuso_min: Option<i32>,
}

#[derive(Debug, Serialize)]
pub struct DiaAtividade {
    pub data: String,
    pub notas: i64,
    pub tarefas: i64,
    pub concluidas: i64,
}

#[derive(Debug, Serialize)]
pub struct TagAtividade {
    pub nome: String,
    pub quantidade: i64,
}

#[derive(Debug, Serialize)]
pub struct Atividade {
    pub escopo: String,
    pub dias: Vec<DiaAtividade>,
    pub tags: Vec<TagAtividade>,
    pub pendentes: i64,
    pub concluidas: i64,
}

/// Agregação no índice, sem ler os arquivos Markdown nem paginar itens para o navegador.
pub async fn atividade(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Query(q): Query<AtividadeQuery>) -> AppResult<Json<Atividade>> {
    let dias = match q.dias.unwrap_or(30) {
        30 | 90 | 365 => q.dias.unwrap_or(30),
        _ => return Err(AppError::validation(vec![CampoInvalido { campo: "dias".into(), motivo: "use 30, 90 ou 365".into() }])),
    };
    let escopo = match q.escopo.as_deref() {
        None | Some("geral") | Some("pessoal_e_equipes") => "geral".to_string(),
        Some("pessoal") => "pessoal".to_string(),
        Some(e) if e.starts_with("equipe:") && e.len() > "equipe:".len() => e.to_string(),
        _ => return Err(AppError::validation(vec![CampoInvalido { campo: "escopo".into(), motivo: "use geral, pessoal ou equipe:<id>".into() }])),
    };
    let fuso_min = q.fuso_min.unwrap_or(0);
    if !(-840..=840).contains(&fuso_min) {
        return Err(AppError::validation(vec![CampoInvalido { campo: "fuso_min".into(), motivo: "fuso inválido".into() }]));
    }
    let fuso = FixedOffset::east_opt(fuso_min * 60).ok_or_else(|| AppError::validation(vec![CampoInvalido { campo: "fuso_min".into(), motivo: "fuso inválido".into() }]))?;
    let hoje = Utc::now().with_timezone(&fuso).date_naive();
    let inicio = hoje - Duration::days(dias - 1);
    let modificador = format!("{}{:02}:{:02}", if fuso_min < 0 { "-" } else { "+" }, fuso_min.abs() / 60, fuso_min.abs() % 60);
    let uid = usuario.0;
    let escopo_consulta = escopo.clone();
    let (linhas, tags, pendentes, concluidas) = state.db.with_read(move |conn| {
        let vis_n = crate::espacos::visivel_sql("n", &uid);
        let vis_t = crate::espacos::visivel_sql("t", &uid);
        let filtro = match escopo_consulta.as_str() {
            "geral" => String::new(),
            "pessoal" => " AND {alias}.espaco = 'pessoal'".to_string(),
            equipe => format!(" AND {{alias}}.espaco = '{}'", equipe.replace('\'', "''")),
        };
        let vis_n = format!("({vis_n}){}", filtro.replace("{alias}", "n"));
        let vis_t = format!("({vis_t}){}", filtro.replace("{alias}", "t"));
        let consulta = format!("SELECT dia, SUM(notas), SUM(tarefas), SUM(concluidas) FROM (\
            SELECT date(datetime(n.criado_em, ?1)) dia, 1 notas, 0 tarefas, 0 concluidas FROM nota n WHERE {vis_n} \
            UNION ALL SELECT date(datetime(t.criado_em, ?1)), 0, 1, 0 FROM tarefa t WHERE {vis_t} \
            UNION ALL SELECT date(datetime(t.concluida_em, ?1)), 0, 0, 1 FROM tarefa t WHERE {vis_t} AND t.concluida_em IS NOT NULL\
            ) WHERE dia BETWEEN ?2 AND ?3 GROUP BY dia ORDER BY dia");
        let mut stmt = conn.prepare(&consulta)?;
        let linhas = stmt.query_map(rusqlite::params![modificador, inicio.to_string(), hoje.to_string()], |r| Ok(DiaAtividade { data: r.get(0)?, notas: r.get(1)?, tarefas: r.get(2)?, concluidas: r.get(3)? }))?.collect::<Result<Vec<_>, _>>()?;
        let consulta_tags = format!("SELECT tag, COUNT(*) quantidade FROM (\
            SELECT nt.tag FROM nota_tag nt JOIN nota n ON n.id = nt.nota_id WHERE {vis_n} \
            UNION ALL SELECT tt.tag FROM tarefa_tag tt JOIN tarefa t ON t.id = tt.tarefa_id WHERE {vis_t}\
            ) GROUP BY tag ORDER BY quantidade DESC, tag COLLATE NOCASE LIMIT 6");
        let mut stmt = conn.prepare(&consulta_tags)?;
        let tags = stmt.query_map([], |r| Ok(TagAtividade { nome: r.get(0)?, quantidade: r.get(1)? }))?.collect::<Result<Vec<_>, _>>()?;
        let pendentes = conn.query_row(&format!("SELECT COUNT(*) FROM tarefa t WHERE {vis_t} AND t.status = 'pendente'"), [], |r| r.get(0))?;
        let concluidas = conn.query_row(&format!("SELECT COUNT(*) FROM tarefa t WHERE {vis_t} AND t.status = 'concluida'"), [], |r| r.get(0))?;
        Ok((linhas, tags, pendentes, concluidas))
    }).await?;
    let mut por_dia = linhas.into_iter().map(|d| (d.data.clone(), d)).collect::<std::collections::HashMap<_, _>>();
    let dias = (0..dias).map(|i| {
        let data = (inicio + Duration::days(i)).to_string();
        por_dia.remove(&data).unwrap_or(DiaAtividade { data, notas: 0, tarefas: 0, concluidas: 0 })
    }).collect();
    Ok(Json(Atividade { escopo, dias, tags, pendentes, concluidas }))
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Metricas {
    /// `pessoal`, `geral` ou `equipe:<id>`: o que as contagens abaixo cobrem.
    pub escopo: String,
    /// `usuario.criado_em`.
    pub entrou_em: String,
    /// Menor `criado_em` entre as notas contadas; `None` sem notas.
    pub primeira_nota_em: Option<String>,
    pub notas: i64,
    pub tarefas: i64,
    /// Palavras (sequências separadas por espaço) de título e corpo das notas contadas.
    pub palavras: i64,
    /// Caracteres Unicode de título e corpo das notas contadas.
    pub caracteres: i64,
}

pub async fn obter(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Query(q): Query<MetricasQuery>) -> AppResult<Json<Metricas>> {
    let escopo = match q.escopo.as_deref() {
        None | Some("pessoal") => "pessoal".to_string(),
        Some("geral") | Some("pessoal_e_equipes") => "geral".to_string(),
        Some(e) if e.starts_with("equipe:") && e.len() > "equipe:".len() => e.to_string(),
        Some(_) => return Err(AppError::validation(vec![CampoInvalido { campo: "escopo".into(), motivo: "use geral, pessoal ou equipe:<id>".into() }])),
    };
    let uid = usuario.0.clone();
    let escopo_consulta = escopo.clone();
    let metricas = state
        .db
        .with_read(move |conn| {
            let entrou_em: Option<String> = conn.query_row("SELECT criado_em FROM usuario WHERE id = ?1", [&uid], |r| r.get(0)).ok();
            let Some(entrou_em) = entrou_em else { return Ok(None) };
            let (nota_vis, tarefa_vis) = if escopo_consulta == "pessoal" {
                ("(n.espaco = 'pessoal' AND n.criado_por = ?1)".to_string(), "(t.espaco = 'pessoal' AND t.criado_por = ?1)".to_string())
            } else {
                let filtro = if escopo_consulta == "geral" { String::new() } else { format!(" AND {{alias}}.espaco = '{}'", escopo_consulta.replace('\'', "''")) };
                (format!("({}){}", crate::espacos::visivel_sql("n", &uid), filtro.replace("{alias}", "n")),
                 format!("({}){}", crate::espacos::visivel_sql("t", &uid), filtro.replace("{alias}", "t")))
            };
            let param: Vec<&dyn rusqlite::ToSql> = if escopo_consulta == "pessoal" { vec![&uid] } else { vec![] };
            let tarefas: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM tarefa t WHERE {tarefa_vis}"), param.as_slice(), |r| r.get(0))?;
            let (notas, primeira): (i64, Option<String>) =
                conn.query_row(&format!("SELECT COUNT(*), MIN(n.criado_em) FROM nota n WHERE {nota_vis}"), param.as_slice(), |r| Ok((r.get(0)?, r.get(1)?)))?;
            // Palavras e caracteres vêm do índice de texto (sem abrir os .md). `nota_fts.id` é UNINDEXED: o FTS é
            // varrido uma vez e cruzado com os ids visíveis em memória (juntar por linha era quadrático).
            let mut stmt = conn.prepare(&format!("SELECT n.id, n.titulo FROM nota n WHERE {nota_vis}"))?;
            let mut pendentes: std::collections::HashMap<String, String> = stmt
                .query_map(param.as_slice(), |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
                .collect::<Result<_, _>>()?;
            let (mut palavras, mut caracteres) = (0i64, 0i64);
            let mut conta = |titulo: &str, corpo: &str| {
                palavras += (titulo.split_whitespace().count() + corpo.split_whitespace().count()) as i64;
                caracteres += (titulo.chars().count() + corpo.chars().count()) as i64;
            };
            if !pendentes.is_empty() {
                let mut fts = conn.prepare("SELECT id, titulo, corpo FROM nota_fts")?;
                let mut linhas = fts.query([])?;
                while let Some(r) = linhas.next()? {
                    let id: String = r.get(0)?;
                    if pendentes.remove(&id).is_some() {
                        conta(&r.get::<_, String>(1)?, &r.get::<_, String>(2)?);
                    }
                }
            }
            // Nota sem linha no FTS: conta só o título, como o COALESCE anterior.
            for titulo in pendentes.values() {
                conta(titulo, "");
            }
            Ok(Some((entrou_em, primeira, notas, tarefas, palavras, caracteres)))
        })
        .await?;
    let (entrou_em, primeira_nota_em, notas, tarefas, palavras, caracteres) = metricas.ok_or(AppError::new(ErrorCode::NotFound))?;
    Ok(Json(Metricas { escopo, entrou_em, primeira_nota_em, notas, tarefas, palavras, caracteres }))
}

#[cfg(test)]
mod testes {
    use crate::{auth::session, config::{Ambiente, Config}, db::IndexDb, state::AppState};
    use axum::{body::{to_bytes, Body}, http::{Request, StatusCode}, Router};
    use ecos_core::new_id;
    use std::sync::{Arc, Mutex};
    use tower::Service;

    async fn get(app: &Router, uri: &str, token: &str) -> (StatusCode, serde_json::Value) {
        let req = Request::builder().method("GET").uri(uri).header("authorization", format!("Bearer {token}")).body(Body::empty()).unwrap();
        let r = app.clone().call(req).await.unwrap();
        let st = r.status();
        let b = to_bytes(r.into_body(), 1024 * 1024).await.unwrap();
        (st, serde_json::from_slice(&b).unwrap_or(serde_json::Value::Null))
    }

    #[tokio::test]
    async fn metricas_agregadas_por_usuario_com_escopo_explicito() {
        let temp = std::env::temp_dir().join(format!("ecos-metricas-{}", new_id()));
        std::fs::create_dir_all(&temp).unwrap();
        let segredo = b"segredo-efemero-exclusivo-do-teste-de-metricas".to_vec();
        let state = AppState {
            db: IndexDb::open(&temp.join("index.db")).unwrap(),
            config: Arc::new(Config {
                ambiente: Ambiente::Desenvolvimento, porta: 0, notes_root: temp.clone(), index_db_path: temp.join("index.db"),
                vault_enabled: false, vault_internal_url: String::new(), session_secret: segredo.clone(), ranking_interval_secs: 300,
                static_dir: None, cookie_secure: false, google: None,
            }),
            http: reqwest::Client::new(), pareamentos: Arc::new(Mutex::new(Default::default())),
        };
        state.db.with(|c| {
            c.execute("INSERT INTO usuario (id, nome_usuario, senha_hash, recovery_key_hash, criado_em) VALUES ('U1', 'ana', 'x', 'x', '2026-01-02T10:00:00+00:00'), ('U2', 'bia', 'x', 'x', '2026-02-03T10:00:00+00:00'), ('VAZIO', 'caio', 'x', 'x', '2026-03-04T10:00:00+00:00')", [])?;
            c.execute("INSERT INTO equipe (id, nome) VALUES ('EQ', 'Casa')", [])?;
            c.execute("INSERT INTO membro_equipe (equipe_id, usuario_id, cargo) VALUES ('EQ', 'U1', 'dono'), ('EQ', 'U2', 'membro')", [])?;
            for (id, esp, por, em, titulo, corpo) in [
                ("N1", "pessoal", "U1", "2026-05-01T00:00:00+00:00", "Olá mundo", "um dois três"),
                ("N2", "pessoal", "U1", "2026-04-01T00:00:00+00:00", "Ação", "coração"),
                ("N3", "pessoal", "U2", "2026-03-01T00:00:00+00:00", "De outra pessoa", "não conta"),
                ("N4", "equipe:EQ", "U2", "2026-06-01T00:00:00+00:00", "Da equipe", "quatro cinco"),
            ] {
                c.execute("INSERT INTO nota (id, caminho_arquivo, titulo, espaco, criado_em, atualizado_em, hash_conteudo, criado_por) VALUES (?1, ?2, ?3, ?4, ?5, ?5, 'h', ?6)", rusqlite::params![id, format!("{id}.md"), titulo, esp, em, por])?;
                c.execute("INSERT INTO nota_fts (id, titulo, corpo, ocr_texto_busca) VALUES (?1, ?2, ?3, '')", rusqlite::params![id, titulo, corpo])?;
            }
            for (id, esp, por) in [("T1", "pessoal", "U1"), ("T2", "pessoal", "U1"), ("T3", "equipe:EQ", "U2"), ("T4", "pessoal", "U2")] {
                c.execute("INSERT INTO tarefa (id, caminho_arquivo, titulo, espaco, criado_em, criado_por) VALUES (?1, ?2, 't', ?3, '2026-05-01T00:00:00+00:00', ?4)", rusqlite::params![id, format!("{id}.md"), esp, por])?;
            }
            Ok(())
        }).await.unwrap();
        let app = crate::routes::montar(state.clone());
        let tk = |id: &str| session::emitir_access_token(id, &segredo).unwrap();

        // Só o pessoal por padrão: 2 notas, 2 tarefas; palavras = (2+3) + (1+1); caracteres contam Unicode.
        let (st, m) = get(&app, "/api/v1/me/metricas", &tk("U1")).await;
        assert_eq!(st, StatusCode::OK, "{m}");
        assert_eq!(m["escopo"], "pessoal");
        assert_eq!((m["notas"].as_i64(), m["tarefas"].as_i64(), m["palavras"].as_i64()), (Some(2), Some(2), Some(7)));
        assert_eq!(m["caracteres"].as_i64(), Some("Olá mundo".chars().count() as i64 + "um dois três".chars().count() as i64 + 4 + 7));
        assert_eq!(m["entrou_em"], "2026-01-02T10:00:00+00:00");
        assert_eq!(m["primeira_nota_em"], "2026-04-01T00:00:00+00:00");

        // Com equipes entram os itens da equipe de que ela é membro.
        let (_, m) = get(&app, "/api/v1/me/metricas?escopo=pessoal_e_equipes", &tk("U1")).await;
        assert_eq!((m["escopo"].as_str(), m["notas"].as_i64(), m["tarefas"].as_i64()), (Some("geral"), Some(3), Some(3)));
        let (_, m) = get(&app, "/api/v1/me/metricas?escopo=equipe:EQ", &tk("U1")).await;
        assert_eq!((m["notas"].as_i64(), m["tarefas"].as_i64()), (Some(1), Some(1)));
        let (_, m) = get(&app, "/api/v1/me/metricas?escopo=equipe:EQ", &tk("VAZIO")).await;
        assert_eq!((m["notas"].as_i64(), m["tarefas"].as_i64()), (Some(0), Some(0)));

        // Quem não tem conteúdo recebe zeros e nenhuma "primeira nota".
        let (st, m) = get(&app, "/api/v1/me/metricas?escopo=pessoal_e_equipes", &tk("VAZIO")).await;
        assert_eq!(st, StatusCode::OK);
        assert_eq!((m["notas"].as_i64(), m["tarefas"].as_i64(), m["palavras"].as_i64(), m["caracteres"].as_i64()), (Some(0), Some(0), Some(0), Some(0)));
        assert!(m["primeira_nota_em"].is_null());
        assert_eq!(m["entrou_em"], "2026-03-04T10:00:00+00:00");

        assert_eq!(get(&app, "/api/v1/me/metricas?escopo=tudo", &tk("U1")).await.0, StatusCode::UNPROCESSABLE_ENTITY);
        // A série é agregada sem paginação e mantém o isolamento entre espaços.
        let agora = chrono::Utc::now().to_rfc3339();
        state.db.with(move |c| {
            for (id, espaco, dono) in [("NHOJE1", "pessoal", "U1"), ("NHOJE2", "pessoal", "U2"), ("NHOJE3", "equipe:EQ", "U2")] {
                c.execute("INSERT INTO nota (id, caminho_arquivo, titulo, espaco, criado_em, atualizado_em, hash_conteudo, criado_por) VALUES (?1, ?2, 'hoje', ?3, ?4, ?4, 'h', ?5)", rusqlite::params![id, format!("{id}.md"), espaco, agora, dono])?;
                c.execute("INSERT INTO nota_tag (nota_id, tag) VALUES (?1, 'projeto')", [id])?;
            }
            c.execute("INSERT INTO tarefa (id, caminho_arquivo, titulo, status, espaco, criado_em, criado_por, concluida_em) VALUES ('THOJE', 'THOJE.md', 'feito', 'concluida', 'pessoal', ?1, 'U1', ?1)", [&agora])?;
            Ok(())
        }).await.unwrap();
        let (st, a) = get(&app, "/api/v1/me/atividade?dias=30&escopo=pessoal&fuso_min=0", &tk("U1")).await;
        assert_eq!(st, StatusCode::OK, "{a}");
        assert_eq!(a["dias"].as_array().unwrap().len(), 30);
        let ultimo = &a["dias"][29];
        assert_eq!((ultimo["notas"].as_i64(), ultimo["tarefas"].as_i64(), ultimo["concluidas"].as_i64()), (Some(1), Some(1), Some(1)));
        assert_eq!(a["tags"][0]["quantidade"], 1);
        let (_, a) = get(&app, "/api/v1/me/atividade?dias=30&escopo=geral", &tk("U1")).await;
        assert_eq!(a["dias"][29]["notas"], 2);
        assert_eq!(a["tags"][0]["quantidade"], 2);
        let (_, a) = get(&app, "/api/v1/me/atividade?dias=30&escopo=equipe:EQ", &tk("U1")).await;
        assert_eq!(a["dias"][29]["notas"], 1);
        assert_eq!(a["tags"][0]["quantidade"], 1);
        let (_, a) = get(&app, "/api/v1/me/atividade?dias=30&escopo=equipe:EQ", &tk("VAZIO")).await;
        assert_eq!(a["dias"][29]["notas"], 0);
        assert!(a["tags"].as_array().unwrap().is_empty());
        assert_eq!(get(&app, "/api/v1/me/atividade?dias=31", &tk("U1")).await.0, StatusCode::UNPROCESSABLE_ENTITY);
        let _ = std::fs::remove_dir_all(&temp);
    }
}
