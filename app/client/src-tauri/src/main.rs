// Desktop entry point — mobile builds (`tauri android`/`tauri ios`) don't
// use this file at all, they call `ecos_client_lib::run()` (`lib.rs`)
// directly via `tauri::mobile_entry_point`.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ecos_client_lib::run();
}
