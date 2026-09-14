//! Vault (`ecos-vault.db`) — schema da seção 1.3-A. Uma conexão protegida
//! por mutex, trancável: sem a chave (senha do Cofre), `with` nunca chega a
//! tentar consultar nada (seção 5.3 — sessão do Cofre mantém a chave só em
//! memória do processo, descartada ao expirar/bloquear).

pub mod meta;

use rusqlite::Connection;
use rusqlite_migration::{Migrations, M};
use std::path::Path;
use std::sync::{Arc, Mutex};

fn migrations() -> Migrations<'static> {
    Migrations::new(vec![M::up(include_str!("../../migrations/0001_init_up.sql"))
        .down(include_str!("../../migrations/0001_init_down.sql"))])
}

#[derive(Debug, thiserror::Error)]
pub enum VaultDbError {
    #[error("cofre bloqueado")]
    Bloqueado,
    #[error("erro de banco de dados: {0}")]
    Sql(#[from] rusqlite::Error),
}

#[derive(Clone)]
pub struct VaultDb(Arc<Mutex<Option<Connection>>>);

impl VaultDb {
    pub fn trancado() -> Self {
        Self(Arc::new(Mutex::new(None)))
    }

    pub fn esta_destrancado(&self) -> bool {
        self.0.lock().expect("mutex do vault nunca deve ser envenenado").is_some()
    }

    pub fn trancar(&self) {
        *self.0.lock().expect("mutex do vault nunca deve ser envenenado") = None;
    }

    /// Abre (ou cria) o arquivo do Vault com a chave derivada e aplica
    /// migrations. Chamado tanto na ativação quanto em todo desbloqueio.
    pub fn destrancar(&self, caminho: &Path, chave_hex: &str) -> anyhow::Result<()> {
        if let Some(pai) = caminho.parent() {
            std::fs::create_dir_all(pai)?;
        }
        let mut conn = Connection::open(caminho)?;

        #[cfg(feature = "real-sqlcipher")]
        {
            conn.pragma_update(None, "key", format!("x'{chave_hex}'"))?;
        }
        #[cfg(not(feature = "real-sqlcipher"))]
        {
            let _ = chave_hex; // build sem cifra real (ver crypto.rs) — chave calculada mas não usada
        }

        // Uma chave errada com SQLCipher de verdade só se revela na
        // primeira leitura de verdade (o arquivo parece "corrompido") — get
        // isso agora, não na primeira query de um handler.
        conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0))
            .map_err(|_| anyhow::anyhow!("chave incorreta ou arquivo do Vault corrompido"))?;

        migrations().to_latest(&mut conn)?;
        *self.0.lock().expect("mutex do vault nunca deve ser envenenado") = Some(conn);
        Ok(())
    }

    pub async fn with<F, T>(&self, f: F) -> Result<T, VaultDbError>
    where
        F: FnOnce(&Connection) -> rusqlite::Result<T> + Send + 'static,
        T: Send + 'static,
    {
        let conn_arc = self.0.clone();
        tokio::task::spawn_blocking(move || {
            let guard = conn_arc.lock().expect("mutex do vault nunca deve ser envenenado");
            match guard.as_ref() {
                Some(conn) => f(conn).map_err(VaultDbError::Sql),
                None => Err(VaultDbError::Bloqueado),
            }
        })
        .await
        .expect("tarefa de banco de dados não deve entrar em pânico")
    }

    /// Snapshot consistente do arquivo aberto (usado pelo backup diário —
    /// seção 3.5). Sem `real-sqlcipher`, o snapshot também sai sem cifra;
    /// com a feature ligada, `sqlite3_backup` copia o arquivo já cifrado
    /// byte a byte (a chave nunca é reescrita em outro formato).
    pub async fn snapshot_para(&self, destino: &Path) -> Result<(), VaultDbError> {
        let destino = destino.to_path_buf();
        self.with(move |conn| {
            let mut destino_conn = Connection::open(&destino)?;
            let backup = rusqlite::backup::Backup::new(conn, &mut destino_conn)?;
            backup.run_to_completion(5, std::time::Duration::from_millis(50), None)
        })
        .await
    }
}
