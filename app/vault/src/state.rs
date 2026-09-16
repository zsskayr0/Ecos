use crate::config::Config;
use crate::db::VaultDb;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub db: VaultDb,
    pub config: Arc<Config>,
}
