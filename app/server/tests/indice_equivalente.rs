//! "Índice mantido ao longo do uso == índice reconstruído do zero": depois de cada operação (criar, editar, renomear,
//! excluir, equipes, wikilinks, tags, tarefas, eventos), o índice que as rotas e as reindexações (inclusive as que
//! são puladas por não haver mudança) deixaram é idêntico ao de um banco novo reindexado sobre os mesmos arquivos.

mod comum;

use comum::*;
use ecos_app::db::IndexDb;
use serde_json::json;

const TABELAS: &[&str] = &[
    "nota", "nota_tag", "links_nota", "link_item", "nota_fts", "tarefa", "tarefa_tag", "tarefa_fts", "tarefa_time_entry", "pasta_cache",
    "documento_cache", "evento", "categoria_evento", "evento_tarefa", "evento_nota",
];

fn despejar(conn: &rusqlite::Connection) -> rusqlite::Result<Vec<String>> {
    let mut saida = Vec::new();
    for t in TABELAS {
        let mut stmt = conn.prepare(&format!("SELECT * FROM {t}"))?;
        let n = stmt.column_count();
        let mut linhas: Vec<String> = stmt
            .query_map([], |r| {
                let mut partes = Vec::new();
                for i in 0..n {
                    let v: rusqlite::types::Value = r.get(i)?;
                    partes.push(format!("{v:?}"));
                }
                Ok(partes.join("|"))
            })?
            .collect::<Result<_, _>>()?;
        linhas.sort();
        saida.push(format!("## {t} ({})", linhas.len()));
        saida.extend(linhas);
    }
    Ok(saida)
}

async fn indice_do_zero(e: &Instancia) -> Vec<String> {
    let dir = std::env::temp_dir().join(format!("ecos-eq-{}", ecos_core::new_id()));
    std::fs::create_dir_all(&dir).unwrap();
    let db = IndexDb::open(&dir.join("zero.db")).unwrap();
    // Mesmos usuários (o dono é resolvido contra a tabela `usuario`) e mesmas equipes/membros.
    let origem = e.state.db.with(|c| {
        let mut sql = Vec::new();
        for (tabela, cols) in [("usuario", "id, nome_usuario, senha_hash, recovery_key_hash"), ("equipe", "id, nome"), ("membro_equipe", "equipe_id, usuario_id, cargo")] {
            let mut stmt = c.prepare(&format!("SELECT {cols} FROM {tabela}"))?;
            let n = stmt.column_count();
            let linhas = stmt.query_map([], |r| (0..n).map(|i| r.get::<_, Option<String>>(i)).collect::<Result<Vec<_>, _>>())?.collect::<Result<Vec<_>, _>>()?;
            for l in linhas {
                let vals: Vec<String> = l.into_iter().map(|v| v.map(|s| format!("'{}'", s.replace('\'', "''"))).unwrap_or_else(|| "NULL".into())).collect();
                sql.push(format!("INSERT INTO {tabela} ({cols}) VALUES ({})", vals.join(", ")));
            }
        }
        Ok(sql)
    }).await.unwrap();
    db.with(move |c| { for s in origem { c.execute(&s, [])?; } Ok(()) }).await.unwrap();
    ecos_app::db::reindex::reindexar_tudo(&db, &e.state.config.notes_root).await.unwrap();
    let d = db.with(despejar).await.unwrap();
    std::fs::remove_dir_all(dir).ok();
    d
}

async fn conferir(e: &Instancia, passo: &str) {
    // A reindexação extra costuma ser pulada (nada mudou desde a que a própria rota fez); o resultado é o mesmo.
    ecos_app::db::reindex::reindexar_tudo(&e.state.db, &e.state.config.notes_root).await.unwrap();
    let atual = e.state.db.with(despejar).await.unwrap();
    let zero = indice_do_zero(e).await;
    assert_eq!(atual, zero, "índice divergiu do reconstruído depois de: {passo}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn indice_incremental_igual_ao_completo_em_toda_operacao() {
    let e = nova();
    let (_, token) = e.admin("ana").await;
    let t = Some(token.as_str());
    let ok = |st: axum::http::StatusCode, c: &serde_json::Value| assert!(st.is_success(), "{c}");
    conferir(&e, "banco vazio").await;

    let (st, a) = e.chamar("POST", "/api/v1/notas", t, Some(json!({ "titulo": "Alfa", "corpo": "primeira", "tags": ["x", "Y"] }))).await;
    ok(st, &a);
    conferir(&e, "criar nota").await;
    let (st, b) = e.chamar("POST", "/api/v1/notas", t, Some(json!({ "titulo": "Beta", "corpo": "veja [[Alfa]] e [[Inexistente]]", "pasta": "Projetos/Ecos" }))).await;
    ok(st, &b);
    conferir(&e, "nota com wikilink e pasta aninhada").await;
    let (id_a, id_b) = (a["id"].as_str().unwrap().to_string(), b["id"].as_str().unwrap().to_string());

    let (st, r) = e.chamar("PATCH", &format!("/api/v1/notas/{id_a}"), t, Some(json!({ "corpo": "editada, agora cita [[Beta]]" }))).await;
    ok(st, &r);
    conferir(&e, "editar corpo (novo wikilink)").await;
    let (st, r) = e.chamar("PATCH", &format!("/api/v1/notas/{id_a}"), t, Some(json!({ "titulo": "Alfa Renomeada" }))).await;
    ok(st, &r);
    conferir(&e, "renomear (arquivo muda de nome; link para [[Alfa]] some)").await;
    let (st, r) = e.chamar("PATCH", &format!("/api/v1/notas/{id_b}"), t, Some(json!({ "corpo": "agora [[Alfa Renomeada]]", "tags": ["z"] }))).await;
    ok(st, &r);
    conferir(&e, "editar tags e link").await;

    let (st, tr) = e.chamar("POST", "/api/v1/tarefas", t, Some(json!({ "titulo": "Pagar conta", "due_date": "2030-01-02", "tags": ["fin"], "pasta": "Casa" }))).await;
    ok(st, &tr);
    conferir(&e, "criar tarefa em pasta").await;
    let id_t = tr["id"].as_str().unwrap().to_string();
    let (st, r) = e.chamar("PATCH", &format!("/api/v1/tarefas/{id_t}/status"), t, Some(json!({ "status": "concluida" }))).await;
    ok(st, &r);
    conferir(&e, "concluir tarefa").await;
    let (st, r) = e.chamar("PATCH", &format!("/api/v1/tarefas/{id_t}"), t, Some(json!({ "corpo": "ver [[Beta]] e [[nota:Alfa Renomeada]]" }))).await;
    ok(st, &r);
    conferir(&e, "corpo de tarefa com wikilinks (tarefa -> nota)").await;
    let (st, r) = e.chamar("PATCH", &format!("/api/v1/notas/{id_b}"), t, Some(json!({ "corpo": "agora [[Alfa Renomeada]] e [[tarefa:Pagar conta]]" }))).await;
    ok(st, &r);
    conferir(&e, "nota aponta para tarefa").await;
    let (st, r) = e.chamar("PATCH", &format!("/api/v1/tarefas/{id_t}"), t, Some(json!({ "titulo": "Pagar conta (renomeada)" }))).await;
    ok(st, &r);
    conferir(&e, "renomear tarefa (link da nota fica sem resolver)").await;

    let (st, eq) = e.chamar("POST", "/api/v1/equipes", t, Some(json!({ "nome": "Casa Comum" }))).await;
    ok(st, &eq);
    let espaco = format!("equipe:{}", eq["id"].as_str().unwrap());
    conferir(&e, "criar equipe").await;
    let (st, n) = e.chamar("POST", "/api/v1/notas", t, Some(json!({ "titulo": "Lista da casa", "corpo": "[[Beta]]", "espaco": espaco }))).await;
    ok(st, &n);
    let (st, r) = e.chamar("POST", "/api/v1/tarefas", t, Some(json!({ "titulo": "Compras", "espaco": espaco }))).await;
    ok(st, &r);
    conferir(&e, "nota e tarefa na equipe").await;

    let inicio = "2030-03-01T10:00:00Z";
    let fim = "2030-03-01T11:00:00Z";
    let (st, ev) = e.chamar("POST", "/api/v1/eventos", t, Some(json!({ "titulo": "Reunião", "inicio": inicio, "fim": fim, "tarefas": [id_t], "notas": [id_b] }))).await;
    ok(st, &ev);
    conferir(&e, "evento vinculado a tarefa e nota").await;

    let (st, r) = e.chamar("DELETE", &format!("/api/v1/notas/{id_b}"), t, None).await;
    ok(st, &r);
    conferir(&e, "excluir nota (vínculo do evento e links somem)").await;
    let (st, r) = e.chamar("DELETE", &format!("/api/v1/tarefas/{id_t}"), t, None).await;
    ok(st, &r);
    conferir(&e, "excluir tarefa").await;

    // Edição por fora (arquivo mexido direto no disco, como o vigia de arquivos vê) também converge.
    let dir = e.raiz.join("ana/Notas");
    let arq = std::fs::read_dir(&dir).unwrap().flatten().map(|x| x.path()).find(|p| p.extension().map(|x| x == "md").unwrap_or(false)).unwrap();
    let conteudo = std::fs::read_to_string(&arq).unwrap();
    std::fs::write(&arq, format!("{conteudo}\nlinha extra por fora\n")).unwrap();
    conferir(&e, "arquivo editado por fora").await;
    std::fs::remove_file(&arq).unwrap();
    conferir(&e, "arquivo removido por fora").await;
}
