//! Watch de `Notas/`/`Tarefas/` (seção 4: "recálculo incremental disparado
//! por evento de escrita relevante"). Roda numa thread própria (a API do
//! `notify` é síncrona) e dispara uma reindexação completa, debounced, no
//! runtime Tokio — reindex completo é rápido o bastante pra escala pessoal
//! (seção 1.1: é cache reconstruível, não há problema em refazer inteiro).

use crate::db::reindex;
use crate::state::AppState;
use notify::{RecursiveMode, Watcher};
use std::sync::mpsc;
use std::time::Duration;

/// Assinatura barata da árvore (nº de arquivos, tamanho total, mtime mais novo).
fn assinatura(raiz: &std::path::Path) -> (u64, u64, std::time::SystemTime) {
    let mut n = 0u64;
    let mut bytes = 0u64;
    let mut novo = std::time::UNIX_EPOCH;
    for sub in ["Notas", "Tarefas"] {
        for e in walkdir::WalkDir::new(raiz.join(sub)).into_iter().filter_map(|e| e.ok()).filter(|e| e.file_type().is_file()) {
            if let Ok(m) = e.metadata() {
                n += 1;
                bytes += m.len();
                if let Ok(t) = m.modified() {
                    novo = novo.max(t);
                }
            }
        }
    }
    (n, bytes, novo)
}

/// No Docker Desktop (Windows/macOS) o `notify` não recebe eventos de arquivos criados no host, então
/// um `.md` jogado direto na pasta nunca dispararia a reindexação. Este laço confere a árvore a cada poucos segundos.
fn vigiar_por_varredura(state: AppState, handle: tokio::runtime::Handle) {
    std::thread::spawn(move || {
        let raiz = state.config.notes_root.clone();
        let mut ultima = assinatura(&raiz);
        loop {
            std::thread::sleep(Duration::from_secs(5));
            let atual = assinatura(&raiz);
            if atual == ultima {
                continue;
            }
            let state = state.clone();
            handle.block_on(async move {
                for _ in 0..8 {
                    match reindex::reindexar_tudo(&state.db, &state.config.notes_root).await {
                        Ok(r) if r.adiados > 0 => tokio::time::sleep(Duration::from_millis(2500)).await,
                        Ok(_) => break,
                        Err(err) => {
                            tracing::error!(error = %err, "reindex por varredura falhou");
                            break;
                        }
                    }
                }
            });
            // A própria adoção grava arquivos: reassina para não reindexar de novo por causa dela.
            ultima = assinatura(&raiz);
        }
    });
}

pub fn iniciar(state: AppState) {
    // Precisa ser capturado aqui, ainda dentro do runtime Tokio de
    // `#[tokio::main]` — a thread do watcher não tem runtime próprio.
    let handle = tokio::runtime::Handle::current();
    let notes_root = state.config.notes_root.clone();
    vigiar_por_varredura(state.clone(), handle.clone());

    std::thread::spawn(move || {
        let (tx, rx) = mpsc::channel();
        let mut watcher = match notify::recommended_watcher(move |res| {
            let _ = tx.send(res);
        }) {
            Ok(w) => w,
            Err(err) => {
                tracing::error!(error = %err, "não foi possível iniciar o watcher de arquivos");
                return;
            }
        };

        for sub in ["Notas", "Tarefas"] {
            let caminho = notes_root.join(sub);
            std::fs::create_dir_all(&caminho).ok();
            if let Err(err) = watcher.watch(&caminho, RecursiveMode::Recursive) {
                tracing::warn!(error = %err, pasta = %caminho.display(), "watch falhou pra esta pasta");
            }
        }

        for resultado in rx.iter() {
            match resultado {
                Ok(_evento) => {
                    // Debounce simples: agrupa rajadas de eventos (ex. o
                    // editor grava em duas etapas) numa reindexação só.
                    std::thread::sleep(Duration::from_millis(300));
                    while rx.try_recv().is_ok() {}

                    let state = state.clone();
                    handle.spawn(async move {
                        // `.md` soltos ainda sendo copiados voltam como `adiados`: espera estabilizar e tenta de novo.
                        for _ in 0..8 {
                            match reindex::reindexar_tudo(&state.db, &state.config.notes_root).await {
                                Ok(r) if r.adiados > 0 => tokio::time::sleep(Duration::from_millis(2500)).await,
                                Ok(_) => break,
                                Err(err) => {
                                    tracing::error!(error = %err, "reindex disparado pelo watcher falhou");
                                    break;
                                }
                            }
                        }
                    });
                }
                Err(err) => tracing::warn!(error = %err, "erro do watcher de arquivos"),
            }
        }
    });
}
