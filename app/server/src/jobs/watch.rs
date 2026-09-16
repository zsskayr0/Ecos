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

pub fn iniciar(state: AppState) {
    // Precisa ser capturado aqui, ainda dentro do runtime Tokio de
    // `#[tokio::main]` — a thread do watcher não tem runtime próprio.
    let handle = tokio::runtime::Handle::current();
    let notes_root = state.config.notes_root.clone();

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
                        if let Err(err) = reindex::reindexar_tudo(&state.db, &state.config.notes_root).await {
                            tracing::error!(error = %err, "reindex disparado pelo watcher falhou");
                        }
                    });
                }
                Err(err) => tracing::warn!(error = %err, "erro do watcher de arquivos"),
            }
        }
    });
}
