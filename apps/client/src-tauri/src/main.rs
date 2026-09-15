// Ecos client — shell Tauri. Toda a lógica de UI vive no front-end React
// (../src); comandos Tauri (`invoke`) que precisam falar com o índice local
// (SQLite) ou o filesystem de Notas/Tarefas entram aqui conforme a
// integração real avança (ver ecos-arquitetura-tecnica.md, seção 0.1 —
// Captura grava local, sem round-trip de rede).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Ecos");
}
