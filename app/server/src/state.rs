use crate::config::Config;
use crate::db::IndexDb;
use chrono::{DateTime, Utc};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Códigos de pareamento LAN pendentes (seção 6.1) — só em memória, de
/// propósito: um código de 6 dígitos não precisa sobreviver a um restart, e
/// manter fora do índice evita mais uma tabela pra um dado tão efêmero.
pub type Pareamentos = Arc<Mutex<HashMap<String, DateTime<Utc>>>>;

#[derive(Clone)]
pub struct AppState {
    pub db: IndexDb,
    pub config: Arc<Config>,
    pub http: reqwest::Client,
    pub pareamentos: Pareamentos,
}
