//! Vault (`ecos-vault.db`) — schema da seção 1.3-A. **Um cofre por pessoa**: cada usuário tem o próprio
//! arquivo, o próprio salt e a própria senha; o processo guarda uma conexão aberta por usuário destrancado.
//! Quem é o usuário vem do `ecos-app` (cabeçalho interno) e chega aqui por `USUARIO`, um task-local definido
//! pelo middleware: sem ele, `with` nunca consulta nada (falha fechada). Sem a chave (senha do Cofre) o
//! usuário fica bloqueado (seção 5.3 — a chave só existe em memória do processo, descartada ao bloquear).

pub mod meta;

use rusqlite::Connection;
use rusqlite_migration::{Migrations, M};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

tokio::task_local! {
    /// Id do usuário da requisição em curso (ou do cofre que um job está percorrendo).
    pub static USUARIO: String;
}

/// Usuário do escopo atual; `None` fora de um `USUARIO.scope(..)`.
pub fn usuario_atual() -> Option<String> {
    USUARIO.try_with(|u| u.clone()).ok()
}

/// Id de usuário aceito como nome de pasta: só `[A-Za-z0-9_-]`, até 64 caracteres.
pub fn id_de_usuario_valido(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

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
pub struct VaultDb(Arc<Mutex<HashMap<String, Connection>>>);

impl VaultDb {
    /// Nenhum cofre aberto: todos os usuários começam bloqueados.
    pub fn trancado() -> Self {
        Self(Arc::new(Mutex::new(HashMap::new())))
    }

    /// O cofre do usuário do escopo atual está aberto?
    pub fn esta_destrancado(&self) -> bool {
        usuario_atual().is_some_and(|u| self.0.lock().expect("mutex do vault nunca deve ser envenenado").contains_key(&u))
    }

    /// Usuários com o cofre aberto agora (para os jobs).
    pub fn usuarios_destrancados(&self) -> Vec<String> {
        self.0.lock().expect("mutex do vault nunca deve ser envenenado").keys().cloned().collect()
    }

    /// Bloqueia só o cofre do usuário atual.
    pub fn trancar(&self) {
        if let Some(u) = usuario_atual() {
            self.0.lock().expect("mutex do vault nunca deve ser envenenado").remove(&u);
        }
    }

    /// Abre (ou cria) o arquivo do Vault do usuário atual com a chave derivada e aplica
    /// migrations. Chamado tanto na ativação quanto em todo desbloqueio.
    pub fn destrancar(&self, caminho: &Path, chave_hex: &str) -> anyhow::Result<()> {
        let usuario = usuario_atual().ok_or_else(|| anyhow::anyhow!("sem usuário no escopo"))?;
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
        self.0.lock().expect("mutex do vault nunca deve ser envenenado").insert(usuario, conn);
        Ok(())
    }

    pub async fn with<F, T>(&self, f: F) -> Result<T, VaultDbError>
    where
        F: FnOnce(&Connection) -> rusqlite::Result<T> + Send + 'static,
        T: Send + 'static,
    {
        let conn_arc = self.0.clone();
        let usuario = usuario_atual();
        tokio::task::spawn_blocking(move || {
            let guard = conn_arc.lock().expect("mutex do vault nunca deve ser envenenado");
            match usuario.as_ref().and_then(|u| guard.get(u)) {
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
