//! ecos-core — tipos e regras de negócio compartilhadas entre o cliente
//! (Tauri, futuro) e os serviços self-hosted (`ecos-app`, `ecos-vault-db`).
//!
//! Deliberadamente sem dependência de `axum`/`rusqlite`/IO de rede: esta
//! crate só conhece dados e regras (parsing de front-matter/wikilink,
//! recorrência financeira, fórmulas de ranking do Feed, catálogo de erros).
//! Ver `ecos-arquitetura-tecnica.md`, seção 10.1.

pub mod adotar;
pub mod credenciais;
pub mod errors;
pub mod frontmatter;
pub mod ids;
pub mod naming;
pub mod ranking;
pub mod recurrence;
pub mod types;
pub mod wikilink;

pub use errors::{ErrorCode, ErrorInfo};
pub use ids::new_id;
