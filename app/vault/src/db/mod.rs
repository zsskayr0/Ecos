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

tokio::task_local! {
    /// Quem está agindo de fato. No Cofre de uma equipe o dono (`USUARIO`) é a equipe; o autor é a pessoa.
    pub static AUTOR: String;
}

/// Autor da requisição em curso; sem ele (jobs), cai no dono do cofre.
pub fn autor_atual() -> Option<String> {
    AUTOR.try_with(|a| a.clone()).ok().or_else(usuario_atual)
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
        .down(include_str!("../../migrations/0001_init_down.sql")),
        M::up(include_str!("../../migrations/0002_financeiro.sql")),
        M::up(include_str!("../../migrations/0003_categorias_nexus.sql")),
        M::up(include_str!("../../migrations/0004_autoria.sql")),
        M::up(include_str!("../../migrations/0005_comprovantes.sql")),
        M::up(include_str!("../../migrations/0006_ocr_miniatura.sql")),
        M::up(include_str!("../../migrations/0007_conta_detalhes.sql"))])
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

    /// Snapshot consistente do arquivo aberto (usado pelo backup diário — seção 3.5). Usa `VACUUM INTO`: com
    /// `real-sqlcipher` a cópia sai cifrada com a mesma chave do original (a chave nunca é reescrita em outro
    /// formato). `sqlite3_backup` para um arquivo aberto sem chave falha com SQLCipher — foi o que quebrava o
    /// backup em produção. O destino não pode existir.
    pub async fn snapshot_para(&self, destino: &Path) -> Result<(), VaultDbError> {
        let destino = destino.to_string_lossy().to_string();
        self.with(move |conn| conn.execute("VACUUM INTO ?1", [&destino]).map(|_| ())).await
    }
}

/// Só compila com a cifra de verdade (`--features real-sqlcipher`, a build do Dockerfile). Prova que o arquivo do
/// Cofre — com comprovante dentro — não é legível sem a chave: nem pelo cabeçalho SQLite, nem abrindo sem senha,
/// nem com a chave errada.
#[cfg(all(test, feature = "real-sqlcipher"))]
mod testes_cifra {
    use super::*;

    #[tokio::test]
    async fn arquivo_do_cofre_nao_abre_sem_a_chave_certa() {
        let raiz = std::env::temp_dir().join(format!("ecos-cifra-{}", ecos_core::new_id()));
        let caminho = raiz.join("ecos-vault.db");
        let chave = crate::crypto::para_hex(&crate::crypto::derivar_chave("senha-certa-123", &crate::crypto::gerar_salt()));
        let segredo = b"COMPROVANTE-SIGILOSO-123456".to_vec();
        {
            let db = VaultDb::trancado();
            USUARIO
                .scope("ana".into(), async {
                    db.destrancar(&caminho, &chave).unwrap();
                    let s = segredo.clone();
                    db.with(move |c| {
                        c.execute("INSERT INTO comprovante_rascunho (id, nome_arquivo, mime_type, tamanho_bytes, checksum_sha256, conteudo) VALUES ('1','a.pdf','application/pdf',1,'x',?1)", [&s])
                    })
                    .await
                    .unwrap();
                })
                .await;
        }
        // O backup também sai cifrado, com a mesma chave, e restaura o conteúdo.
        let backup = raiz.join("backup.db");
        {
            let db = VaultDb::trancado();
            USUARIO
                .scope("ana".into(), async {
                    db.destrancar(&caminho, &chave).unwrap();
                    db.snapshot_para(&backup).await.unwrap();
                })
                .await;
        }
        let copia = std::fs::read(&backup).unwrap();
        assert!(!copia.starts_with(b"SQLite format 3") && !copia.windows(segredo.len()).any(|w| w == segredo.as_slice()), "backup não pode estar em claro");
        let aberta = Connection::open(&backup).unwrap();
        aberta.pragma_update(None, "key", format!("x'{chave}'")).unwrap();
        let conteudo: Vec<u8> = aberta.query_row("SELECT conteudo FROM comprovante_rascunho WHERE id='1'", [], |r| r.get(0)).unwrap();
        assert_eq!(conteudo, segredo, "o backup restaura o comprovante com a chave certa");
        assert!(Connection::open(&backup).unwrap().query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0)).is_err(), "backup sem chave não abre");

        let bytes = std::fs::read(&caminho).unwrap();
        assert!(!bytes.starts_with(b"SQLite format 3"), "o cabeçalho SQLite não pode aparecer em claro");
        assert!(!bytes.windows(segredo.len()).any(|w| w == segredo.as_slice()), "o conteúdo do comprovante não pode aparecer em claro");
        let sem_chave = Connection::open(&caminho).unwrap();
        assert!(sem_chave.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0)).is_err(), "sem chave não abre");
        let errada = Connection::open(&caminho).unwrap();
        errada.pragma_update(None, "key", format!("x'{}'", "00".repeat(32))).unwrap();
        assert!(errada.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0)).is_err(), "chave errada não abre");
        let _ = std::fs::remove_dir_all(raiz);
    }
}
