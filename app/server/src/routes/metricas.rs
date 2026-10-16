//! `GET /me/metricas`: resumo agregado do espaço da pessoa, calculado no servidor (as contagens não dependem
//! da paginação do cliente). O escopo é sempre devolvido: por padrão só o conteúdo pessoal; com
//! `?escopo=pessoal_e_equipes` entram também notas e tarefas das equipes de que a pessoa é membro.

use axum::extract::{Query, State};
use axum::{Extension, Json};
use ecos_core::ErrorCode;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult, CampoInvalido};
use crate::middleware::auth_guard::UsuarioAutenticado;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct MetricasQuery {
    pub escopo: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Metricas {
    /// `pessoal` ou `pessoal_e_equipes`: o que as contagens abaixo cobrem.
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
        None | Some("pessoal") => "pessoal",
        Some("pessoal_e_equipes") => "pessoal_e_equipes",
        Some(_) => return Err(AppError::validation(vec![CampoInvalido { campo: "escopo".into(), motivo: "use pessoal ou pessoal_e_equipes".into() }])),
    };
    let uid = usuario.0.clone();
    let com_equipes = escopo == "pessoal_e_equipes";
    let metricas = state
        .db
        .with(move |conn| {
            let entrou_em: Option<String> = conn.query_row("SELECT criado_em FROM usuario WHERE id = ?1", [&uid], |r| r.get(0)).ok();
            let Some(entrou_em) = entrou_em else { return Ok(None) };
            let (nota_vis, tarefa_vis) = if com_equipes {
                (crate::espacos::visivel_sql("n", &uid), crate::espacos::visivel_sql("t", &uid))
            } else {
                ("(n.espaco = 'pessoal' AND n.criado_por = ?1)".to_string(), "(t.espaco = 'pessoal' AND t.criado_por = ?1)".to_string())
            };
            let param: Vec<&dyn rusqlite::ToSql> = if com_equipes { vec![] } else { vec![&uid] };
            let tarefas: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM tarefa t WHERE {tarefa_vis}"), param.as_slice(), |r| r.get(0))?;
            let (notas, primeira): (i64, Option<String>) =
                conn.query_row(&format!("SELECT COUNT(*), MIN(n.criado_em) FROM nota n WHERE {nota_vis}"), param.as_slice(), |r| Ok((r.get(0)?, r.get(1)?)))?;
            // Palavras e caracteres vêm do índice de texto (sem abrir os .md), contados em streaming.
            let mut stmt = conn.prepare(&format!(
                "SELECT COALESCE(nf.titulo, n.titulo), COALESCE(nf.corpo, '') FROM nota n LEFT JOIN nota_fts nf ON nf.id = n.id WHERE {nota_vis}"
            ))?;
            let (mut palavras, mut caracteres) = (0i64, 0i64);
            let linhas = stmt.query_map(param.as_slice(), |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
            for l in linhas {
                let (titulo, corpo) = l?;
                palavras += (titulo.split_whitespace().count() + corpo.split_whitespace().count()) as i64;
                caracteres += (titulo.chars().count() + corpo.chars().count()) as i64;
            }
            Ok(Some((entrou_em, primeira, notas, tarefas, palavras, caracteres)))
        })
        .await?;
    let (entrou_em, primeira_nota_em, notas, tarefas, palavras, caracteres) = metricas.ok_or(AppError::new(ErrorCode::NotFound))?;
    Ok(Json(Metricas { escopo: escopo.to_string(), entrou_em, primeira_nota_em, notas, tarefas, palavras, caracteres }))
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
        assert_eq!((m["escopo"].as_str(), m["notas"].as_i64(), m["tarefas"].as_i64()), (Some("pessoal_e_equipes"), Some(3), Some(3)));

        // Quem não tem conteúdo recebe zeros e nenhuma "primeira nota".
        let (st, m) = get(&app, "/api/v1/me/metricas?escopo=pessoal_e_equipes", &tk("VAZIO")).await;
        assert_eq!(st, StatusCode::OK);
        assert_eq!((m["notas"].as_i64(), m["tarefas"].as_i64(), m["palavras"].as_i64(), m["caracteres"].as_i64()), (Some(0), Some(0), Some(0), Some(0)));
        assert!(m["primeira_nota_em"].is_null());
        assert_eq!(m["entrou_em"], "2026-03-04T10:00:00+00:00");

        assert_eq!(get(&app, "/api/v1/me/metricas?escopo=tudo", &tk("U1")).await.0, StatusCode::UNPROCESSABLE_ENTITY);
        let _ = std::fs::remove_dir_all(&temp);
    }
}
