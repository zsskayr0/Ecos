//! Watch da árvore de cada espaço (seção 4: "recálculo incremental disparado
//! por evento de escrita relevante"). Roda numa thread própria (a API do
//! `notify` é síncrona) e dispara uma reindexação completa, debounced, no
//! runtime Tokio — reindex completo é rápido o bastante pra escala pessoal
//! (seção 1.1: é cache reconstruível, não há problema em refazer inteiro).

use crate::db::reindex;
use crate::state::AppState;
use notify::{RecursiveMode, Watcher};
use std::sync::mpsc;
use std::time::Duration;

/// Estado de cada arquivo da árvore (tamanho, mtime): permite saber QUAIS mudaram, não só que algo mudou.
type Assinatura = std::collections::HashMap<std::path::PathBuf, (u64, std::time::SystemTime)>;

fn assinatura(raiz: &std::path::Path) -> Assinatura {
    let mut out = Assinatura::new();
    for (_, dir) in crate::espacos::listar(raiz) {
        // A mídia (`<Espaço>/src`) não muda o índice: fica fora da assinatura.
        let raiz_midia = dir.join("src");
        for e in walkdir::WalkDir::new(&dir).into_iter().filter_entry(|e| e.path() != raiz_midia).filter_map(|e| e.ok()).filter(|e| e.file_type().is_file()) {
            if let Ok(m) = e.metadata() {
                out.insert(e.path().to_path_buf(), (m.len(), m.modified().unwrap_or(std::time::UNIX_EPOCH)));
            }
        }
    }
    out
}

/// Arquivos que mudaram entre duas assinaturas, descontando os que o próprio servidor escreveu (o índice já os reflete).
fn mudancas_externas(state: &AppState, antes: &Assinatura, depois: &Assinatura) -> usize {
    let raiz = &state.config.notes_root;
    let adicionados_ou_alterados = depois.iter().filter(|(p, v)| antes.get(*p) != Some(*v)).map(|(p, _)| p);
    let removidos = antes.keys().filter(|p| !depois.contains_key(*p));
    adicionados_ou_alterados.chain(removidos).filter(|p| !p.components().any(|c| c.as_os_str() == "_anexos")).filter(|p| !state.db.e_escrita_propria(raiz, p)).count()
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
            // Só o que o servidor mesmo escreveu (rotas já reindexaram esses itens): nada a reconstruir.
            if mudancas_externas(&state, &ultima, &atual) == 0 {
                ultima = atual;
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

        // Vigia a raiz inteira: equipes novas criam diretórios de espaço depois do boot.
        if let Err(err) = watcher.watch(&notes_root, RecursiveMode::Recursive) {
            tracing::warn!(error = %err, pasta = %notes_root.display(), "watch falhou pra raiz das notas");
        }

        for resultado in rx.iter() {
            match resultado {
                Ok(evento) => {
                    // Mídia e dados internos não mudam o índice de Notas/Tarefas.
                    let relevante = evento.paths.iter().any(|p| {
                        let rel = p.strip_prefix(&notes_root).unwrap_or(p);
                        let mut partes = rel.components().map(|c| c.as_os_str());
                        let topo = partes.next();
                        let segundo = partes.next();
                        let terceiro = partes.next();
                        // `.ecos`, o `src/` legado e a mídia de cada espaço (`<Espaço>/.ecos_app/Media`; antes `<Espaço>/src`).
                        // Eventos e séries, também em `.ecos_app/`, continuam disparando o reindex.
                        let midia = segundo.is_some_and(|c| c == crate::espacos::APP_DIR) && terceiro.is_some_and(|c| c == "Media");
                        !(topo.is_some_and(|c| c == ".ecos" || c == "src") || segundo.is_some_and(|c| c == "src") || midia)
                    });
                    // Escritas do próprio servidor já foram aplicadas ao índice pela reindexação incremental.
                    let externo = evento.paths.iter().any(|p| !p.components().any(|c| c.as_os_str() == "_anexos") && !state.db.e_escrita_propria(&notes_root, p));
                    if !relevante || !externo { continue; }
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
