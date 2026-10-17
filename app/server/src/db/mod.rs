//! Índice local (`ecos-index.db`) — SQLite puro, cache reconstruível (seção
//! 1.1). Uma única conexão protegida por mutex é suficiente pro perfil de
//! carga de um app pessoal/familiar; chamadas de banco rodam em
//! `spawn_blocking` pra nunca travar o executor async do Axum.

pub mod reindex;

use rusqlite::Connection;
use rusqlite_migration::{Migrations, M};
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Quantidade de migrations conhecidas por este binário — usada pro gate de
/// versão da seção 3.4 ("o app recusa iniciar se a versão do binário for
/// menor que a versão de schema já aplicada").
const SCHEMA_VERSION_CONHECIDA: i64 = 24;

fn migrations() -> Migrations<'static> {
    Migrations::new(vec![
        M::up(include_str!("../../migrations/0001_init_up.sql")).down(include_str!("../../migrations/0001_init_down.sql")),
        M::up(include_str!("../../migrations/0002_tarefa_extras_up.sql")).down(include_str!("../../migrations/0002_tarefa_extras_down.sql")),
        M::up(include_str!("../../migrations/0003_criado_por_up.sql")).down(include_str!("../../migrations/0003_criado_por_down.sql")),
        M::up(include_str!("../../migrations/0004_usuario_nome_up.sql")).down(include_str!("../../migrations/0004_usuario_nome_down.sql")),
        M::up(include_str!("../../migrations/0005_tarefa_atualizado_em_up.sql")).down(include_str!("../../migrations/0005_tarefa_atualizado_em_down.sql")),
        M::up(include_str!("../../migrations/0006_time_entries_up.sql")).down(include_str!("../../migrations/0006_time_entries_down.sql")),
        M::up(include_str!("../../migrations/0007_pasta_por_espaco_up.sql")).down(include_str!("../../migrations/0007_pasta_por_espaco_down.sql")),
        M::up(include_str!("../../migrations/0008_tarefa_concluida_em_up.sql")).down(include_str!("../../migrations/0008_tarefa_concluida_em_down.sql")),
        M::up(include_str!("../../migrations/0009_eventos_up.sql")).down(include_str!("../../migrations/0009_eventos_down.sql")),
        M::up(include_str!("../../migrations/0010_calendario_google_up.sql")).down(include_str!("../../migrations/0010_calendario_google_down.sql")),
        M::up(include_str!("../../migrations/0010_consentimento_up.sql")).down(include_str!("../../migrations/0010_consentimento_down.sql")),
        M::up(include_str!("../../migrations/0011_evento_exclusao_google_up.sql")).down(include_str!("../../migrations/0011_evento_exclusao_google_down.sql")),
        M::up(include_str!("../../migrations/0012_evento_excecoes_up.sql")).down(include_str!("../../migrations/0012_evento_excecoes_down.sql")),
        M::up(include_str!("../../migrations/0013_evento_cor_up.sql")).down(include_str!("../../migrations/0013_evento_cor_down.sql")),
        M::up(include_str!("../../migrations/0014_feed_usuario_up.sql")).down(include_str!("../../migrations/0014_feed_usuario_down.sql")),
        M::up(include_str!("../../migrations/0015_usuario_nome_nocase_up.sql")).down(include_str!("../../migrations/0015_usuario_nome_nocase_down.sql")),
        M::up(include_str!("../../migrations/0016_usuario_papel_up.sql")).down(include_str!("../../migrations/0016_usuario_papel_down.sql")),
        M::up(include_str!("../../migrations/0017_equipe_tipo_up.sql")).down(include_str!("../../migrations/0017_equipe_tipo_down.sql")),
        M::up(include_str!("../../migrations/0018_equipe_cor_up.sql")).down(include_str!("../../migrations/0018_equipe_cor_down.sql")),
        M::up(include_str!("../../migrations/0019_preferencia_calendario_up.sql")).down(include_str!("../../migrations/0019_preferencia_calendario_down.sql")),
        M::up(include_str!("../../migrations/0020_tarefa_serie_up.sql")).down(include_str!("../../migrations/0020_tarefa_serie_down.sql")),
        M::up(include_str!("../../migrations/0021_notificacao_chave_up.sql")).down(include_str!("../../migrations/0021_notificacao_chave_down.sql")),
        M::up(include_str!("../../migrations/0022_push_up.sql")).down(include_str!("../../migrations/0022_push_down.sql")),
        M::up(include_str!("../../migrations/0023_sync_problemas_up.sql")).down(include_str!("../../migrations/0023_sync_problemas_down.sql")),
    ])
}

/// Acima disto (espera pela trava ou tempo segurando-a) a chamada vira um aviso no log com a origem.
pub const LIMITE_LENTO: Duration = Duration::from_millis(150);
/// Conexões somente-leitura (WAL permite leitores concorrentes com o escritor).
const LEITORES: usize = 4;

struct Interno {
    /// Escrita, reindex e tudo que não é leitura pura.
    escrita: Mutex<Connection>,
    /// Pequeno pool de leitores; vazio quando não deu para abrir (aí a leitura usa a conexão de escrita).
    leitores: Vec<Mutex<Connection>>,
    proximo: AtomicUsize,
    /// Resumo (SHA-256) do que a última reindexação completa gravou; `None` = desconhecido (boot ou em andamento).
    digest_aplicado: Arc<Mutex<Option<[u8; 32]>>>,
}

#[derive(Clone)]
pub struct IndexDb(Arc<Interno>);

#[derive(Clone, Copy, PartialEq, Eq)]
enum Via {
    Escrita,
    Leitura,
}

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
        // Leitores abertos depois das migrations: enxergam o schema final. Se falhar, tudo segue pela conexão única.
        let mut leitores = Vec::new();
        for _ in 0..LEITORES {
            match Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX) {
                Ok(c) => {
                    let _ = c.pragma_update(None, "query_only", "ON");
                    leitores.push(Mutex::new(c));
                }
                Err(e) => {
                    tracing::warn!(error = %e, "não foi possível abrir conexão de leitura; leituras usarão a conexão única");
                    leitores.clear();
                    break;
                }
            }
        }
        Ok(Self(Arc::new(Interno { escrita: Mutex::new(conn), leitores, proximo: AtomicUsize::new(0), digest_aplicado: Arc::new(Mutex::new(None)) })))
    }

    /// Resumo do que a última reindexação gravou (para pular reindexações sem mudança real).
    pub(crate) fn digest_aplicado(&self) -> Option<[u8; 32]> {
        *self.0.digest_aplicado.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub(crate) fn memo_digest(&self) -> Arc<Mutex<Option<[u8; 32]>>> {
        self.0.digest_aplicado.clone()
    }

    pub(crate) fn digest_invalidar(&self) {
        *self.0.digest_aplicado.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }

    /// Executa `f` na conexão de ESCRITA (única), numa thread bloqueante. Use para escrita, reindex e qualquer
    /// consulta que precise ler o que acabou de escrever dentro da mesma chamada. A origem (arquivo:linha de quem
    /// chamou) entra nas métricas e no aviso de trava lenta.
    #[track_caller]
    pub fn with<F, T>(&self, f: F) -> impl std::future::Future<Output = Result<T, rusqlite::Error>> + Send + 'static
    where
        F: FnOnce(&Connection) -> rusqlite::Result<T> + Send + 'static,
        T: Send + 'static,
    {
        self.executar(Via::Escrita, std::panic::Location::caller(), f)
    }

    /// Executa `f` numa conexão SOMENTE-LEITURA do pool: não espera escrita nem reindex em andamento (WAL).
    /// Leitura-após-escrita continua valendo, pois cada chamada abre um snapshot novo e a escrita anterior já foi
    /// confirmada quando o handler chega aqui. `f` não pode escrever (a conexão é `query_only`).
    #[track_caller]
    pub fn with_read<F, T>(&self, f: F) -> impl std::future::Future<Output = Result<T, rusqlite::Error>> + Send + 'static
    where
        F: FnOnce(&Connection) -> rusqlite::Result<T> + Send + 'static,
        T: Send + 'static,
    {
        self.executar(Via::Leitura, std::panic::Location::caller(), f)
    }

    fn executar<F, T>(&self, via: Via, origem: &'static std::panic::Location<'static>, f: F) -> impl std::future::Future<Output = Result<T, rusqlite::Error>> + Send + 'static
    where
        F: FnOnce(&Connection) -> rusqlite::Result<T> + Send + 'static,
        T: Send + 'static,
    {
        let interno = self.0.clone();
        let pedido = Instant::now();
        async move {
            tokio::task::spawn_blocking(move || {
                let usar_leitor = via == Via::Leitura && !interno.leitores.is_empty();
                let guard = if usar_leitor {
                    let n = interno.leitores.len();
                    let inicio = interno.proximo.fetch_add(1, Ordering::Relaxed);
                    // Primeiro um leitor livre; se todos estiverem ocupados, espera o da vez.
                    (0..n)
                        .find_map(|i| interno.leitores[(inicio + i) % n].try_lock().ok())
                        .unwrap_or_else(|| interno.leitores[inicio % n].lock().expect("mutex de leitura do índice"))
                } else {
                    interno.escrita.lock().expect("mutex do índice local nunca deve ser envenenado")
                };
                let espera = pedido.elapsed();
                let inicio_uso = Instant::now();
                let r = f(&guard);
                let segurou = inicio_uso.elapsed();
                drop(guard);
                let rotulo = format!("{}:{}", origem.file().replace('\\', "/").trim_start_matches("src/"), origem.line());
                let via_nome = if usar_leitor { "leitura" } else { "escrita" };
                crate::observabilidade::registrar_db(&rotulo, via_nome, espera, segurou);
                if espera > LIMITE_LENTO || segurou > LIMITE_LENTO {
                    tracing::warn!(origem = %rotulo, via = via_nome, espera_ms = espera.as_millis() as u64, segurou_ms = segurou.as_millis() as u64, "banco: trava lenta");
                }
                r
            })
            .await
            .expect("tarefa de banco de dados não deve entrar em pânico")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Registrar uma migration sem subir `SCHEMA_VERSION_CONHECIDA` faz o app se recusar a reiniciar sobre o
    /// próprio banco (o primeiro boot migra, o segundo vê versão > constante). Este teste pega a esquecida.
    #[test]
    fn a_constante_do_gate_acompanha_o_numero_de_migrations_registradas() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrations().to_latest(&mut conn).unwrap();
        let aplicada: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0)).unwrap();
        assert_eq!(aplicada, SCHEMA_VERSION_CONHECIDA, "atualize SCHEMA_VERSION_CONHECIDA ao registrar uma migration");
    }

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
