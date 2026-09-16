//! Índice local (`ecos-index.db`) — SQLite puro, cache reconstruível (seção
//! 1.1). Uma única conexão protegida por mutex é suficiente pro perfil de
//! carga de um app pessoal/familiar; chamadas de banco rodam em
//! `spawn_blocking` pra nunca travar o executor async do Axum.

pub mod reindex;

use rusqlite::Connection;
use rusqlite_migration::{Migrations, M};
use std::path::Path;
use std::sync::{Arc, Mutex};

/// Quantidade de migrations conhecidas por este binário — usada pro gate de
/// versão da seção 3.4 ("o app recusa iniciar se a versão do binário for
/// menor que a versão de schema já aplicada").
const SCHEMA_VERSION_CONHECIDA: i64 = 4;

fn migrations() -> Migrations<'static> {
    Migrations::new(vec![
        M::up(include_str!("../../migrations/0001_init_up.sql")).down(include_str!("../../migrations/0001_init_down.sql")),
        M::up(include_str!("../../migrations/0002_tarefa_extras_up.sql")).down(include_str!("../../migrations/0002_tarefa_extras_down.sql")),
        M::up(include_str!("../../migrations/0003_criado_por_up.sql")).down(include_str!("../../migrations/0003_criado_por_down.sql")),
        M::up(include_str!("../../migrations/0004_usuario_nome_up.sql")).down(include_str!("../../migrations/0004_usuario_nome_down.sql")),
    ])
}

#[derive(Clone)]
pub struct IndexDb(Arc<Mutex<Connection>>);

impl IndexDb {
    pub fn open(path: &Path) -> anyhow::Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;

        let versao_atual: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if versao_atual > SCHEMA_VERSION_CONHECIDA {
            anyhow::bail!(
                "o índice local está na versão de schema {versao_atual}, mais nova que a que este \
                 binário do ecos-app conhece ({SCHEMA_VERSION_CONHECIDA}) — atualize o ecos-app antes \
                 de continuar (seção 3.4 da arquitetura: nunca rodar código velho sobre dado novo)"
            );
        }

        migrations().to_latest(&mut conn)?;
        Ok(Self(Arc::new(Mutex::new(conn))))
    }

    /// Executa `f` numa thread bloqueante dedicada, com a conexão travada só
    /// pela duração da chamada.
    pub async fn with<F, T>(&self, f: F) -> Result<T, rusqlite::Error>
    where
        F: FnOnce(&Connection) -> rusqlite::Result<T> + Send + 'static,
        T: Send + 'static,
    {
        let conn = self.0.clone();
        tokio::task::spawn_blocking(move || {
            let guard = conn.lock().expect("mutex do índice local nunca deve ser envenenado");
            f(&guard)
        })
        .await
        .expect("tarefa de banco de dados não deve entrar em pânico")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn abre_aplica_migrations_e_aceita_leitura() {
        let dir = tempfile_dir();
        let db = IndexDb::open(&dir.join("index.db")).unwrap();
        let contagem: i64 = db
            .with(|conn| conn.query_row("SELECT COUNT(*) FROM nota", [], |row| row.get(0)))
            .await
            .unwrap();
        assert_eq!(contagem, 0);
        std::fs::remove_dir_all(dir).ok();
    }

    fn tempfile_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("ecos-index-test-{}", ecos_core::new_id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }
}
