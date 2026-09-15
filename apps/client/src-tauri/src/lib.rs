// Ecos client — Tauri shell, shared between the desktop entry point
// (`main.rs`) and the mobile one (`tauri::mobile_entry_point` below,
// required for `tauri android`/`tauri ios` builds: mobile targets link
// against this library, not a `main()` binary). All UI logic lives in the
// React front end (../src); Tauri commands (`invoke`) that need to talk
// to the local index (SQLite) or the Notas/Tarefas filesystem go here as
// the real integration progresses (see ecos-arquitetura-tecnica.md,
// section 0.1 — Capture writes locally, no network round-trip).

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error starting Ecos");
}
