//! Reprodução do "de vez em quando trava": leituras (GET) esperando uma reindexação em andamento.
//! Biblioteca pequena como a real (~40 notas, ~300 tarefas). Imprime `MEDIDA` com as latências.

mod comum;

use comum::*;
use serde_json::json;
use std::time::Instant;

/// Os testes deste arquivo usam contadores globais do processo e medem tempo: rodam um de cada vez.
static SERIE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

async fn semear(e: &Instancia, token: &str) -> (std::path::PathBuf, String) {
    // Tamanho da biblioteca: padrão = a real do usuário (36 notas, 308 tarefas); `CONTENCAO_NOTAS`/`CONTENCAO_TAREFAS` ampliam.
    let n_notas: usize = std::env::var("CONTENCAO_NOTAS").ok().and_then(|v| v.parse().ok()).unwrap_or(40);
    let n_tarefas: usize = std::env::var("CONTENCAO_TAREFAS").ok().and_then(|v| v.parse().ok()).unwrap_or(300);
    let (_, n) = e.chamar("POST", "/api/v1/notas", Some(token), Some(json!({ "titulo": "modelonota", "corpo": "texto ".repeat(50), "tags": ["a"] }))).await;
    let id_nota = n["id"].as_str().unwrap().to_string();
    let ndir = e.raiz.join("ana/Notas");
    let narq = std::fs::read_dir(&ndir).unwrap().flatten().map(|x| x.path()).find(|p| std::fs::read_to_string(p).map(|s| s.contains(&id_nota)).unwrap_or(false)).unwrap();
    let nmodelo = std::fs::read_to_string(&narq).unwrap();
    for i in 0..n_notas {
        std::fs::write(ndir.join(format!("n{i}.md")), nmodelo.replace(&id_nota, &ecos_core::new_id()).replace("modelonota", &format!("Nota {i}"))).unwrap();
    }
    let (_, t) = e.chamar("POST", "/api/v1/tarefas", Some(token), Some(json!({ "titulo": "modelo" }))).await;
    let id_modelo = t["id"].as_str().unwrap().to_string();
    let dir = e.raiz.join("ana/Tarefas");
    let arq = std::fs::read_dir(&dir).unwrap().flatten().map(|x| x.path()).find(|p| std::fs::read_to_string(p).map(|s| s.contains(&id_modelo)).unwrap_or(false)).unwrap();
    let modelo = std::fs::read_to_string(&arq).unwrap();
    for i in 0..n_tarefas {
        let novo = ecos_core::new_id();
        std::fs::write(dir.join(format!("t{i}.md")), modelo.replace(&id_modelo, &novo).replace("modelo", &format!("Tarefa {i}"))).unwrap();
    }
    ecos_app::db::reindex::reindexar_tudo(&e.state.db, &e.state.config.notes_root).await.unwrap();
    (arq, modelo)
}

fn p(v: &mut Vec<f64>, q: f64) -> f64 {
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    v[((v.len() as f64 - 1.0) * q) as usize]
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn leitura_nao_espera_reindexacao_em_andamento() {
    let _g = SERIE.lock().await;
    let e = nova();
    let (_, token) = e.admin("ana").await;
    let (arq, modelo) = semear(&e, &token).await;

    // Escritor: muda um arquivo e reindexa de verdade (resumo diferente a cada volta), em laço, enquanto o leitor mede.
    let state = e.state.clone();
    let escritor = tokio::spawn(async move {
        let mut tempos = Vec::new();
        for i in 0..25 {
            std::fs::write(&arq, modelo.replace("modelo", &format!("modelo editado {i}"))).unwrap();
            let t = Instant::now();
            ecos_app::db::reindex::reindexar_tudo(&state.db, &state.config.notes_root).await.unwrap();
            tempos.push(t.elapsed().as_secs_f64() * 1000.0);
        }
        tempos
    });
    let mut leituras = Vec::new();
    while !escritor.is_finished() {
        for rota in ["/api/v1/me", "/api/v1/feed?limit=40", "/api/v1/notificacoes/nao-lidas"] {
            let t = Instant::now();
            let (st, _) = e.chamar("GET", rota, Some(&token), None).await;
            assert!(st.is_success());
            leituras.push(t.elapsed().as_secs_f64() * 1000.0);
        }
        tokio::time::sleep(std::time::Duration::from_millis(1)).await;
    }
    let mut reindex = escritor.await.unwrap();
    let max = leituras.iter().cloned().fold(0.0, f64::max);
    println!("MEDIDA | reindex completo: mediana {:.1} ms, max {:.1} ms ({} voltas)", p(&mut reindex, 0.5), reindex.iter().cloned().fold(0.0, f64::max), reindex.len());
    println!("MEDIDA | leituras durante reindex: n={} mediana {:.2} ms p95 {:.2} ms max {:.2} ms", leituras.len(), p(&mut leituras, 0.5), p(&mut leituras, 0.95), max);
    assert!(p(&mut leituras, 0.5) < 50.0, "a mediana das leituras não deve depender da reindexação");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn reindexar_sem_mudanca_e_noop_e_mudanca_real_e_aplicada() {
    let _g = SERIE.lock().await;
    let e = nova();
    let (_, token) = e.admin("ana").await;
    let (arq, modelo) = semear(&e, &token).await;
    let raiz = e.state.config.notes_root.clone();

    let completos = ecos_app::observabilidade::contagem_reindex("completo");
    let pulados = ecos_app::observabilidade::contagem_reindex("pulado");
    for _ in 0..3 {
        ecos_app::db::reindex::reindexar_tudo(&e.state.db, &raiz).await.unwrap();
    }
    assert_eq!(ecos_app::observabilidade::contagem_reindex("pulado") - pulados, 3, "sem mudança real, nada é regravado");
    assert_eq!(ecos_app::observabilidade::contagem_reindex("completo"), completos);

    std::fs::write(&arq, modelo.replace("modelo", "titulo trocado")).unwrap();
    ecos_app::db::reindex::reindexar_tudo(&e.state.db, &raiz).await.unwrap();
    let (_, busca) = e.chamar("GET", "/api/v1/busca?q=trocado", Some(&token), None).await;
    assert_eq!(busca["tarefas"].as_array().unwrap().len(), 1, "a mudança real entra no índice: {busca}");
}
