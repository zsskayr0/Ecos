//! Vault (`ecos-vault.db`) — schema da seção 1.3-A. **Um cofre por pessoa**: cada usuário tem o próprio
//! arquivo, o próprio salt e a própria senha; o processo guarda uma conexão aberta por usuário destrancado.
//! Quem é o usuário vem do `ecos-app` (cabeçalho interno) e chega aqui por `USUARIO`, um task-local definido
//! pelo middleware: sem ele, `with` nunca consulta nada (falha fechada). Sem a chave (senha do Cofre) o
//! usuário fica bloqueado (seção 5.3 — a chave só existe em memória do processo, descartada ao bloquear).

pub mod meta;

use rusqlite::Connection;
use rusqlite_migration::{HookResult, Migrations, M};
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
    Migrations::new(lista_de_migracoes())
}

fn lista_de_migracoes() -> Vec<M<'static>> {
    vec![M::up(include_str!("../../migrations/0001_init_up.sql"))
        .down(include_str!("../../migrations/0001_init_down.sql")),
        M::up(include_str!("../../migrations/0002_financeiro.sql")),
        M::up(include_str!("../../migrations/0003_categorias_nexus.sql")),
        M::up(include_str!("../../migrations/0004_autoria.sql")),
        M::up(include_str!("../../migrations/0005_comprovantes.sql")),
        M::up(include_str!("../../migrations/0006_ocr_miniatura.sql")),
        M::up(include_str!("../../migrations/0007_conta_detalhes.sql")),
        M::up(include_str!("../../migrations/0008_preferencias_nota_fiscal.sql")),
        M::up(include_str!("../../migrations/0009_conta_sigla.sql")),
        M::up_with_hook(include_str!("../../migrations/0010_formas_pagamento.sql"), soltar_lista_fixa_de_formas),
        M::up(include_str!("../../migrations/0011_subcategorias.sql")),
        M::up(include_str!("../../migrations/0012_categoria_arquivada.sql")),
        M::up(include_str!("../../migrations/0013_migracao_origem.sql")),
        M::up(include_str!("../../migrations/0014_mensalidades.sql"))
            .down(include_str!("../../migrations/0014_mensalidades_down.sql")),
        M::up_with_hook(include_str!("../../migrations/0015_fechamento.sql"), ampliar_tipos_de_anexo)
            .down(include_str!("../../migrations/0015_fechamento_down.sql")),
        M::up(include_str!("../../migrations/0016_fechamento_abertura.sql"))
            .down(include_str!("../../migrations/0016_fechamento_abertura_down.sql"))]
}

/// Última versão de esquema que este binário conhece.
pub fn ultima_versao() -> usize {
    lista_de_migracoes().len()
}

/// Nome do snapshot tirado antes de mexer no esquema. Não casa com `vault-AAAA-MM-DD.enc`, então a poda do
/// backup diário nunca o apaga.
fn nome_do_snapshot_pre_migracao(versao: usize, quando: chrono::DateTime<chrono::Utc>) -> String {
    format!("pre-migracao-v{versao}-{}.enc", quando.format("%Y%m%dT%H%M%SZ"))
}

/// Leva um banco de teste para uma versão anterior do esquema, como se tivesse sido deixado por um binário antigo.
#[cfg(test)]
pub(crate) fn rebaixar_para_teste(conn: &mut Connection, versao: usize) {
    migrations().to_version(conn, versao).unwrap();
}

/// Esquema completo num banco de teste em memória.
#[cfg(test)]
pub(crate) fn migrar_para_teste(conn: &mut Connection) {
    migrations().to_latest(conn).unwrap();
}

/// Tira de `transacao` e `transacao_recorrente` o `CHECK (forma_pagamento IN (...))` com as sete formas fixas: a lista
/// agora é a tabela `forma_pagamento`, validada pelas rotas. SQLite não tem `DROP CONSTRAINT`; recriar as tabelas
/// arriscaria os anexos (BLOBs), então se edita o texto do schema pelo procedimento oficial (`writable_schema` +
/// `schema_version`), que não toca nos dados. Idempotente: se já não houver o CHECK, não faz nada.
fn soltar_lista_fixa_de_formas(tx: &rusqlite::Transaction) -> HookResult {
    tx.execute_batch("PRAGMA writable_schema = ON")?;
    let mut mudou = false;
    for tabela in ["transacao", "transacao_recorrente"] {
        let sql: String = tx.query_row("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?1", [tabela], |r| r.get(0))?;
        if let Some(novo) = sem_check_de_forma(&sql) {
            tx.execute("UPDATE sqlite_master SET sql = ?1 WHERE type = 'table' AND name = ?2", rusqlite::params![novo, tabela])?;
            mudou = true;
        }
    }
    if mudou {
        let versao: i64 = tx.query_row("PRAGMA schema_version", [], |r| r.get(0))?;
        tx.execute_batch(&format!("PRAGMA schema_version = {}", versao + 1))?;
    }
    tx.execute_batch("PRAGMA writable_schema = OFF")?;
    Ok(())
}

/// Faz `anexo.tipo` aceitar 'recibo_lucros' (recibo de distribuição de lucros, pedido pela contabilidade). O `CHECK` nasceu
/// por `ALTER TABLE ... ADD COLUMN` (0008); recriar `anexo` arriscaria os BLOBs, então se edita o texto do schema pelo mesmo
/// procedimento oficial de `soltar_lista_fixa_de_formas`. Idempotente: se o texto antigo não está lá, não faz nada.
/// Só `anexo`: `comprovante_rascunho` não recebe recibos (não há leitura por OCR para eles).
fn ampliar_tipos_de_anexo(tx: &rusqlite::Transaction) -> HookResult {
    const ANTIGO: &str = "CHECK (tipo IN ('comprovante', 'nota_fiscal'))";
    const NOVO: &str = "CHECK (tipo IN ('comprovante', 'nota_fiscal', 'recibo_lucros'))";
    let sql: String = tx.query_row("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'anexo'", [], |r| r.get(0))?;
    if sql.contains(ANTIGO) {
        tx.execute_batch("PRAGMA writable_schema = ON")?;
        tx.execute("UPDATE sqlite_master SET sql = ?1 WHERE type = 'table' AND name = 'anexo'", [sql.replace(ANTIGO, NOVO)])?;
        let versao: i64 = tx.query_row("PRAGMA schema_version", [], |r| r.get(0))?;
        tx.execute_batch(&format!("PRAGMA schema_version = {}", versao + 1))?;
        tx.execute_batch("PRAGMA writable_schema = OFF")?;
    }
    Ok(())
}

/// `CREATE TABLE ...` sem o `CHECK (forma_pagamento IN (...))`; `None` se ele não existe.
fn sem_check_de_forma(sql: &str) -> Option<String> {
    for (inicio, _) in sql.match_indices("CHECK") {
        let resto = &sql[inicio + "CHECK".len()..];
        let abre = resto.find('(')?;
        if !resto[..abre].trim().is_empty() || !resto[abre + 1..].trim_start().starts_with("forma_pagamento") {
            continue;
        }
        let mut nivel = 0;
        for (i, c) in resto[abre..].char_indices() {
            match c {
                '(' => nivel += 1,
                ')' => {
                    nivel -= 1;
                    if nivel == 0 {
                        let fim = inicio + "CHECK".len() + abre + i + 1;
                        return Some(format!("{}{}", sql[..inicio].trim_end(), &sql[fim..]));
                    }
                }
                _ => {}
            }
        }
    }
    None
}

#[derive(Debug, thiserror::Error)]
pub enum VaultDbError {
    #[error("cofre bloqueado")]
    Bloqueado,
    #[error("erro de banco de dados: {0}")]
    Sql(#[from] rusqlite::Error),
}

/// A chave derivada da senha não abre o arquivo. É o único erro de `destrancar` que significa "senha errada";
/// qualquer outro (snapshot, migração, disco) é falha de preparo e não pode ser mostrado como senha incorreta.
#[derive(Debug, thiserror::Error)]
#[error("chave incorreta ou arquivo do Vault corrompido")]
pub struct ChaveIncorreta;

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
    ///
    /// Antes de mexer no esquema de um banco que já tem dados, grava um snapshot
    /// `pre-migracao-v<versão atual>-<data-hora UTC>.enc` em `backups` (a pasta de backups do dono). Se o snapshot
    /// falhar, o desbloqueio falha e o banco não é tocado. `migrar_ate` (`ECOS_VAULT_MIGRAR_ATE`) leva o esquema
    /// para uma versão anterior em vez da última, para o binário antigo voltar a abrir o arquivo.
    ///
    /// Chave errada devolve [`ChaveIncorreta`] (via `downcast_ref`); todo outro erro é falha de preparo.
    pub fn destrancar(&self, caminho: &Path, chave_hex: &str, backups: &Path, migrar_ate: Option<usize>) -> anyhow::Result<()> {
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
            .map_err(|_| ChaveIncorreta)?;

        let ultima = ultima_versao();
        let alvo = migrar_ate.unwrap_or(ultima);
        if alvo == 0 || alvo > ultima {
            anyhow::bail!("versão de esquema pedida ({alvo}) fora do que este binário conhece (1 a {ultima})");
        }
        let atual: usize = conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))?.try_into()?;
        // Banco recém-criado (versão 0) não tem o que copiar; banco mais novo que o binário é recusado logo abaixo
        // pela própria biblioteca, sem ser tocado.
        if atual != 0 && atual != alvo && atual <= ultima {
            std::fs::create_dir_all(backups)?;
            let destino = backups.join(nome_do_snapshot_pre_migracao(atual, chrono::Utc::now()));
            conn.execute("VACUUM INTO ?1", [destino.to_string_lossy().as_ref()])
                .map_err(|e| anyhow::anyhow!("snapshot antes da migração falhou; o banco não foi alterado: {e}"))?;
            tracing::info!(de = atual, para = alvo, arquivo = %destino.display(), "snapshot do Cofre antes de migrar o esquema");
        }
        if alvo == ultima {
            migrations().to_latest(&mut conn)?;
        } else {
            tracing::warn!(de = atual, para = alvo, "ECOS_VAULT_MIGRAR_ATE: levando o esquema do Cofre para uma versão anterior");
            migrations().to_version(&mut conn, alvo)?;
        }
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
                    db.destrancar(&caminho, &chave, &raiz.join("backups"), None).unwrap();
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
                    db.destrancar(&caminho, &chave, &raiz.join("backups"), None).unwrap();
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

#[cfg(test)]
mod testes_de_migracao {
    use super::*;

    /// Cofre real na versão 10 (a da imagem de 09/10) sobe para a última: as migrations são só aditivas, nada se
    /// perde, as categorias antigas viram principais e não arquivadas, e repetir a subida não muda nada.
    #[test]
    fn subcategorias_arquivadas_e_rastro_de_migracao_sao_aditivos() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        Migrations::new(lista_de_migracoes()[..10].to_vec()).to_latest(&mut conn).unwrap();
        conn.execute("INSERT INTO categoria (id, nome, tipo, cor, espaco) VALUES ('c1','Mercado','saida','#fff','pessoal')", []).unwrap();
        conn.execute("INSERT INTO transacao (id, tipo, valor_centavos, data, descricao, categoria_id, espaco, criado_por) VALUES ('t1','saida',1000,'2026-10-01','Feira','c1','pessoal','ana')", []).unwrap();
        let antes: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(antes, 10);

        migrations().to_latest(&mut conn).unwrap();
        assert_eq!(conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0)).unwrap(), ultima_versao() as i64);
        let (pai, arquivada, lancamentos): (Option<String>, i64, i64) = conn
            .query_row("SELECT pai_id, arquivada, (SELECT COUNT(*) FROM transacao WHERE categoria_id = 'c1') FROM categoria WHERE id = 'c1'", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap();
        assert_eq!((pai, arquivada, lancamentos), (None, 0, 1));
        conn.execute("INSERT INTO categoria (id, nome, tipo, cor, espaco, pai_id) VALUES ('c2','Feira','saida','#fff','pessoal','c1')", []).unwrap();
        conn.execute("INSERT INTO migracao_origem (origem, tabela, origem_id, destino_id) VALUES ('nexus','categorias','x','c1')", []).unwrap();
        let total_categorias: i64 = conn.query_row("SELECT COUNT(*) FROM categoria", [], |r| r.get(0)).unwrap();

        migrations().to_latest(&mut conn).unwrap();
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM categoria", [], |r| r.get::<_, i64>(0)).unwrap(), total_categorias);
        assert_eq!(conn.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0)).unwrap(), "ok");
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
    }

    /// Banco já na versão 9 (com dados e um anexo) sobe para a última: nada se perde e a lista fixa de formas some.
    #[test]
    fn formas_de_pagamento_livres_sem_perder_dados() {
        let mut conn = Connection::open_in_memory().unwrap();
        Migrations::new(lista_de_migracoes()[..9].to_vec()).to_latest(&mut conn).unwrap();
        conn.execute("INSERT INTO transacao (id, tipo, valor_centavos, data, descricao, forma_pagamento, espaco, criado_por) VALUES ('t1','saida',1000,'2026-10-01','Mercado','pix','pessoal','ana')", []).unwrap();
        conn.execute("INSERT INTO anexo (id, transacao_id, nome_arquivo, mime_type, tamanho_bytes, checksum_sha256, conteudo) VALUES ('a1','t1','x.png','image/png',3,'abc',x'010203')", []).unwrap();
        assert!(conn.execute("INSERT INTO transacao (id, tipo, valor_centavos, data, descricao, forma_pagamento, espaco, criado_por) VALUES ('t2','saida',1,'2026-10-01','X','debito','pessoal','ana')", []).is_err(), "antes da migração a lista é fixa");

        migrations().to_latest(&mut conn).unwrap();

        let (forma, anexos): (String, i64) = conn.query_row("SELECT t.forma_pagamento, (SELECT COUNT(*) FROM anexo WHERE transacao_id = t.id) FROM transacao t WHERE t.id = 't1'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((forma.as_str(), anexos), ("pix", 1));
        let fabrica: i64 = conn.query_row("SELECT COUNT(*) FROM forma_pagamento WHERE padrao = 1", [], |r| r.get(0)).unwrap();
        assert_eq!(fabrica, 7);
        conn.execute("INSERT INTO transacao (id, tipo, valor_centavos, data, descricao, forma_pagamento, espaco, criado_por) VALUES ('t2','saida',1,'2026-10-01','X','debito','pessoal','ana')", []).expect("forma livre depois da migração");
        conn.execute("INSERT INTO transacao_recorrente (id, tipo, descricao, valor_centavos, forma_pagamento, tipo_recorrencia, data_inicio, espaco) VALUES ('r1','saida','Aluguel',1,'debito','fixa','2026-10-01','pessoal')", []).expect("recorrência com forma livre");
        // O resto do schema segue valendo (outros CHECKs e a integridade do arquivo).
        assert!(conn.execute("INSERT INTO transacao (id, tipo, valor_centavos, data, descricao, espaco, criado_por) VALUES ('t3','invalido',1,'2026-10-01','X','pessoal','ana')", []).is_err());
        let integridade: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0)).unwrap();
        assert_eq!(integridade, "ok");
    }

    const TABELAS_ANTIGAS: [&str; 8] = ["transacao", "anexo", "transacao_recorrente", "beneficiario", "categoria", "conta", "ocorrencia_processada", "pendencia_avulsa"];

    fn versao(conn: &Connection) -> i64 {
        conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap()
    }

    fn contagens(conn: &Connection) -> Vec<i64> {
        TABELAS_ANTIGAS.iter().map(|t| conn.query_row(&format!("SELECT COUNT(*) FROM {t}"), [], |r| r.get(0)).unwrap()).collect()
    }

    fn tem_tabela(conn: &Connection, nome: &str) -> bool {
        conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)", [nome], |r| r.get(0)).unwrap()
    }

    /// Conteúdo de um Cofre em uso na versão 13: beneficiário, recorrência, lançamento gerado por ela e um anexo.
    fn semear_v13(conn: &Connection) {
        conn.execute("INSERT INTO beneficiario (id, nome) VALUES ('b1','Residente Um')", []).unwrap();
        conn.execute("INSERT INTO transacao_recorrente (id, tipo, descricao, valor_centavos, beneficiario_id, forma_pagamento, tipo_recorrencia, data_inicio, espaco) VALUES ('r1','entrada','Mensalidade',350000,'b1','pix','fixa','2024-11-20','pessoal')", []).unwrap();
        conn.execute("INSERT INTO transacao (id, tipo, valor_centavos, data, descricao, beneficiario_id, transacao_recorrente_id, espaco, criado_por) VALUES ('t1','entrada',350000,'2026-10-20','Mensalidade','b1','r1','pessoal','ana')", []).unwrap();
        conn.execute("INSERT INTO anexo (id, transacao_id, nome_arquivo, mime_type, tamanho_bytes, checksum_sha256, conteudo) VALUES ('a1','t1','recibo.png','image/png',3,'abc',x'010203')", []).unwrap();
    }

    /// Migrações como eram na versão 14, antes do Fechamento (0015).
    fn migracoes_ate_14() -> Migrations<'static> {
        Migrations::new(lista_de_migracoes()[..14].to_vec())
    }

    fn banco_v13() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        Migrations::new(lista_de_migracoes()[..13].to_vec()).to_latest(&mut conn).unwrap();
        semear_v13(&conn);
        assert_eq!(versao(&conn), 13);
        conn
    }

    /// Banco na versão 13 com dados e anexo sobe para 14: a 0014 só cria tabelas, nada antigo muda, e repetir a
    /// subida não faz nada.
    #[test]
    fn mensalidades_sobe_de_13_para_14_sem_tocar_no_que_existe() {
        let mut conn = banco_v13();
        let antes = contagens(&conn);
        let esquema_antes: Vec<String> = conn.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name").unwrap().query_map([], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap();

        migracoes_ate_14().to_latest(&mut conn).unwrap();
        assert_eq!(versao(&conn), 14);
        assert_eq!(contagens(&conn), antes);
        assert_eq!(conn.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0)).unwrap(), "ok");
        let anexo: Vec<u8> = conn.query_row("SELECT conteudo FROM anexo WHERE id = 'a1'", [], |r| r.get(0)).unwrap();
        assert_eq!(anexo, [1, 2, 3]);
        assert_eq!(conn.query_row("SELECT valor_centavos FROM transacao_recorrente WHERE id = 'r1'", [], |r| r.get::<_, i64>(0)).unwrap(), 350000);
        // Tabelas novas nascem vazias (nenhum backfill) e as antigas mantêm o mesmo texto de esquema.
        assert_eq!(conn.query_row("SELECT (SELECT COUNT(*) FROM mensalidade) + (SELECT COUNT(*) FROM mensalidade_reajuste)", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
        let esquema_depois: Vec<String> = conn
            .prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND tbl_name NOT IN ('mensalidade', 'mensalidade_reajuste') ORDER BY name")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(esquema_depois, esquema_antes);
        assert!(conn.execute("INSERT INTO mensalidade_reajuste (id, recorrencia_id, ciclo, valor_anterior_centavos, valor_novo_centavos, regra) VALUES ('x','r1','2026-11-20',1,2,'inventada')", []).is_err(), "regra fora da lista é recusada");

        conn.execute("INSERT INTO mensalidade (recorrencia_id, data_base, ciclos_desde) VALUES ('r1','2024-11-20','2026-11-20')", []).unwrap();
        migracoes_ate_14().to_latest(&mut conn).unwrap();
        assert_eq!(versao(&conn), 14);
        assert_eq!(contagens(&conn), antes);
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM mensalidade", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
        assert_eq!(conn.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0)).unwrap(), "ok");
    }

    /// 14 desce para 13 perdendo só as duas tabelas novas, e um binário que só conhece as 13 primeiras abre o
    /// resultado (antes da descida ele recusa o arquivo).
    #[test]
    fn mensalidades_desce_de_14_para_13_sem_perda_nas_tabelas_antigas() {
        let mut conn = banco_v13();
        migracoes_ate_14().to_latest(&mut conn).unwrap();
        // Lançamento feito depois da migração: tem de sobreviver à descida.
        conn.execute("INSERT INTO transacao (id, tipo, valor_centavos, data, descricao, espaco, criado_por) VALUES ('t2','saida',900,'2026-11-16','Depois','pessoal','ana')", []).unwrap();
        conn.execute("INSERT INTO mensalidade (recorrencia_id, data_base, ciclos_desde) VALUES ('r1','2024-11-20','2026-11-20')", []).unwrap();
        conn.execute("INSERT INTO mensalidade_reajuste (id, recorrencia_id, ciclo, valor_anterior_centavos, valor_novo_centavos, regra, vigente_desde) VALUES ('j1','r1','2026-11-20',350000,385000,'minimo','2026-12-20')", []).unwrap();
        let antes = contagens(&conn);

        let binario_antigo = Migrations::new(lista_de_migracoes()[..13].to_vec());
        assert!(binario_antigo.to_latest(&mut conn).is_err(), "o binário antigo recusa um banco na versão 14");
        assert_eq!(versao(&conn), 14);

        migracoes_ate_14().to_version(&mut conn, 13).unwrap();
        assert_eq!(versao(&conn), 13);
        assert_eq!(contagens(&conn), antes);
        assert!(!tem_tabela(&conn, "mensalidade") && !tem_tabela(&conn, "mensalidade_reajuste"));
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM sqlite_master WHERE name = 'idx_reajuste_vigencia'", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
        let anexo: Vec<u8> = conn.query_row("SELECT conteudo FROM anexo WHERE id = 'a1'", [], |r| r.get(0)).unwrap();
        assert_eq!(anexo, [1, 2, 3]);
        assert_eq!(conn.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0)).unwrap(), "ok");

        binario_antigo.to_latest(&mut conn).expect("o binário antigo abre o banco depois da descida");
        assert_eq!(versao(&conn), 13);
        assert_eq!(contagens(&conn), antes);

        // E o binário novo volta a subir o mesmo arquivo, com as tabelas vazias.
        migracoes_ate_14().to_latest(&mut conn).unwrap();
        assert_eq!((versao(&conn), contagens(&conn)), (14, antes));
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM mensalidade_reajuste", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
    }

    fn banco_v14() -> Connection {
        let mut conn = banco_v13();
        migracoes_ate_14().to_latest(&mut conn).unwrap();
        assert_eq!(versao(&conn), 14);
        conn
    }

    /// Banco na versão 14 sobe para a 15: criam-se as duas tabelas do Fechamento, o anexo existente (BLOB) fica intacto e
    /// `anexo.tipo` passa a aceitar 'recibo_lucros' sem aceitar qualquer coisa. Repetir a subida não muda nada.
    #[test]
    fn fechamento_sobe_de_14_para_15_e_amplia_o_tipo_do_anexo_sem_tocar_nos_dados() {
        let mut conn = banco_v14();
        let antes = contagens(&conn);
        assert!(conn.execute("INSERT INTO anexo (id, transacao_id, nome_arquivo, mime_type, tamanho_bytes, checksum_sha256, conteudo, tipo) VALUES ('x','t1','r.pdf','application/pdf',1,'z',x'00','recibo_lucros')", []).is_err(), "antes da 15 o tipo não existe");

        migrations().to_latest(&mut conn).unwrap();
        assert_eq!(versao(&conn), ultima_versao() as i64);
        assert_eq!(contagens(&conn), antes);
        assert_eq!(conn.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0)).unwrap(), "ok");
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
        let anexo: Vec<u8> = conn.query_row("SELECT conteudo FROM anexo WHERE id = 'a1'", [], |r| r.get(0)).unwrap();
        assert_eq!(anexo, [1, 2, 3]);
        assert!(tem_tabela(&conn, "fechamento_conferencia") && tem_tabela(&conn, "fechamento_config") && tem_tabela(&conn, "fechamento_abertura"));
        assert_eq!(conn.query_row("SELECT (SELECT COUNT(*) FROM fechamento_conferencia) + (SELECT COUNT(*) FROM fechamento_config)", [], |r| r.get::<_, i64>(0)).unwrap(), 0);

        conn.execute("INSERT INTO anexo (id, transacao_id, nome_arquivo, mime_type, tamanho_bytes, checksum_sha256, conteudo, tipo) VALUES ('r1x','t1','recibo.pdf','application/pdf',1,'z',x'00','recibo_lucros')", []).expect("recibo de lucros é aceito");
        conn.execute("INSERT INTO anexo (id, transacao_id, nome_arquivo, mime_type, tamanho_bytes, checksum_sha256, conteudo, tipo) VALUES ('nf','t1','nf.pdf','application/pdf',1,'y',x'00','nota_fiscal')", []).expect("os tipos antigos continuam valendo");
        assert!(conn.execute("INSERT INTO anexo (id, transacao_id, nome_arquivo, mime_type, tamanho_bytes, checksum_sha256, conteudo, tipo) VALUES ('ruim','t1','x.pdf','application/pdf',1,'w',x'00','inventado')", []).is_err(), "tipo fora da lista segue recusado");
        // O rascunho de comprovante não ganha o tipo novo.
        assert!(conn.execute("INSERT INTO comprovante_rascunho (id, nome_arquivo, mime_type, tamanho_bytes, checksum_sha256, conteudo, tipo) VALUES ('rs','x.pdf','application/pdf',1,'v',x'00','recibo_lucros')", []).is_err());

        let depois = contagens(&conn);
        migrations().to_latest(&mut conn).unwrap();
        assert_eq!((versao(&conn), contagens(&conn)), (ultima_versao() as i64, depois));
        assert_eq!(conn.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0)).unwrap(), "ok");
    }

    /// 16 acrescenta só a tabela do saldo de abertura; 15 e 16 convivem sem perder nada, e descer remove só ela.
    #[test]
    fn abertura_sobe_de_15_para_16_e_desce_sem_tocar_nos_dados() {
        let mut conn = banco_v14();
        Migrations::new(lista_de_migracoes()[..15].to_vec()).to_latest(&mut conn).unwrap();
        assert_eq!(versao(&conn), 15);
        assert!(!tem_tabela(&conn, "fechamento_abertura"));
        conn.execute("INSERT INTO fechamento_conferencia (mes, conta_id, saldo_banco_centavos) VALUES ('2026-10','c1',500)", []).unwrap();
        let antes = contagens(&conn);

        migrations().to_latest(&mut conn).unwrap();
        assert_eq!((versao(&conn), contagens(&conn)), (ultima_versao() as i64, antes));
        conn.execute("INSERT INTO fechamento_abertura (conta_id, data, saldo_centavos) VALUES ('c1','2026-10-01',12345)", []).unwrap();
        assert!(conn.execute("INSERT INTO fechamento_abertura (conta_id, data, saldo_centavos) VALUES ('c1','2026-10-01',1)", []).is_err(), "uma abertura por conta e dia");

        migrations().to_version(&mut conn, 15).unwrap();
        assert_eq!(versao(&conn), 15);
        assert!(!tem_tabela(&conn, "fechamento_abertura"));
        assert_eq!(conn.query_row("SELECT saldo_banco_centavos FROM fechamento_conferencia", [], |r| r.get::<_, i64>(0)).unwrap(), 500);
        assert_eq!(conn.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0)).unwrap(), "ok");
    }

    /// 15 desce para 14 perdendo só as tabelas do Fechamento; os anexos (inclusive o recibo) ficam, e um binário que só
    /// conhece as 14 primeiras abre o arquivo depois da descida.
    #[test]
    fn fechamento_desce_de_15_para_14_sem_perda_nos_anexos() {
        let mut conn = banco_v14();
        migrations().to_latest(&mut conn).unwrap();
        conn.execute("INSERT INTO anexo (id, transacao_id, nome_arquivo, mime_type, tamanho_bytes, checksum_sha256, conteudo, tipo) VALUES ('r1x','t1','recibo.pdf','application/pdf',1,'z',x'0a','recibo_lucros')", []).unwrap();
        conn.execute("INSERT INTO fechamento_conferencia (mes, conta_id, saldo_banco_centavos) VALUES ('2026-10','c1',12345)", []).unwrap();
        let antes = contagens(&conn);

        assert!(migracoes_ate_14().to_latest(&mut conn).is_err(), "o binário antigo recusa um banco na versão 15");
        migrations().to_version(&mut conn, 14).unwrap();
        assert_eq!(versao(&conn), 14);
        assert_eq!(contagens(&conn), antes);
        assert!(!tem_tabela(&conn, "fechamento_conferencia") && !tem_tabela(&conn, "fechamento_config") && !tem_tabela(&conn, "fechamento_abertura"));
        let recibo: Vec<u8> = conn.query_row("SELECT conteudo FROM anexo WHERE id = 'r1x'", [], |r| r.get(0)).unwrap();
        assert_eq!(recibo, [0x0a]);
        assert_eq!(conn.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0)).unwrap(), "ok");
        migracoes_ate_14().to_latest(&mut conn).expect("o binário antigo abre o banco depois da descida");

        migrations().to_latest(&mut conn).unwrap();
        assert_eq!((versao(&conn), contagens(&conn)), (ultima_versao() as i64, antes));
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM fechamento_conferencia", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
    }

    const CHAVE: &str = "abababababababababababababababababababababababababababababababab";

    /// Arquivo de Cofre na versão 13, com dados, cifrado com `CHAVE` quando a build tem SQLCipher.
    fn arquivo_v13(raiz: &Path) -> std::path::PathBuf {
        std::fs::create_dir_all(raiz).unwrap();
        let caminho = raiz.join("ecos-vault.db");
        let mut conn = Connection::open(&caminho).unwrap();
        #[cfg(feature = "real-sqlcipher")]
        conn.pragma_update(None, "key", format!("x'{CHAVE}'")).unwrap();
        Migrations::new(lista_de_migracoes()[..13].to_vec()).to_latest(&mut conn).unwrap();
        semear_v13(&conn);
        caminho
    }

    fn abrir(caminho: &Path) -> Connection {
        let conn = Connection::open(caminho).unwrap();
        #[cfg(feature = "real-sqlcipher")]
        conn.pragma_update(None, "key", format!("x'{CHAVE}'")).unwrap();
        conn
    }

    fn snapshots(pasta: &Path) -> Vec<String> {
        let mut nomes: Vec<String> = std::fs::read_dir(pasta).map(|d| d.flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect()).unwrap_or_default();
        nomes.sort();
        nomes
    }

    fn destrancar_como(usuario: &str, caminho: &Path, backups: &Path, migrar_ate: Option<usize>) -> anyhow::Result<()> {
        let db = VaultDb::trancado();
        USUARIO.sync_scope(usuario.to_string(), || db.destrancar(caminho, CHAVE, backups, migrar_ate))
    }

    /// Destrancar um Cofre na versão 13 grava o snapshot antes de migrar; destrancar de novo (já na última) não
    /// grava outro; Cofre recém-criado não grava nenhum.
    #[test]
    fn snapshot_pre_migracao_so_quando_o_esquema_vai_mudar() {
        let raiz = std::env::temp_dir().join(format!("ecos-pre-migracao-{}", ecos_core::new_id()));
        let caminho = arquivo_v13(&raiz);
        let backups = raiz.join("backups").join("ana");

        destrancar_como("ana", &caminho, &backups, None).unwrap();
        let nomes = snapshots(&backups);
        assert_eq!(nomes.len(), 1, "um snapshot: {nomes:?}");
        assert!(nomes[0].starts_with("pre-migracao-v13-") && nomes[0].ends_with(".enc"), "nome inesperado: {}", nomes[0]);
        assert_eq!(versao(&abrir(&caminho)), ultima_versao() as i64);

        // O snapshot é o banco de antes: versão 13, com os dados e sem as tabelas novas.
        let copia = abrir(&backups.join(&nomes[0]));
        assert_eq!(versao(&copia), 13);
        assert_eq!(contagens(&copia), contagens(&abrir(&caminho)));
        assert!(!tem_tabela(&copia, "mensalidade"));
        assert_eq!(copia.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0)).unwrap(), "ok");
        #[cfg(feature = "real-sqlcipher")]
        assert!(!std::fs::read(backups.join(&nomes[0])).unwrap().starts_with(b"SQLite format 3"), "snapshot sai cifrado");
        drop(copia);

        destrancar_como("ana", &caminho, &backups, None).unwrap();
        assert_eq!(snapshots(&backups), nomes, "já na última versão: nenhum snapshot novo");

        let novo = raiz.join("novo").join("ecos-vault.db");
        let backups_novo = raiz.join("backups").join("bia");
        destrancar_como("bia", &novo, &backups_novo, None).unwrap();
        assert!(snapshots(&backups_novo).is_empty(), "Cofre recém-criado não tem o que copiar");
        assert_eq!(versao(&abrir(&novo)), ultima_versao() as i64);
        let _ = std::fs::remove_dir_all(raiz);
    }

    /// Falha fechada: se o snapshot não pode ser gravado, o desbloqueio falha e o banco continua na versão 13.
    #[test]
    fn snapshot_que_falha_impede_o_desbloqueio_e_nao_toca_no_banco() {
        let raiz = std::env::temp_dir().join(format!("ecos-pre-migracao-{}", ecos_core::new_id()));
        let caminho = arquivo_v13(&raiz);
        // A "pasta" de backups é um arquivo: nada pode ser criado dentro dela.
        let backups = raiz.join("backups-nao-e-pasta");
        std::fs::write(&backups, b"x").unwrap();
        let antes = contagens(&abrir(&caminho));

        let db = VaultDb::trancado();
        let resultado = USUARIO.sync_scope("ana".to_string(), || {
            let r = db.destrancar(&caminho, CHAVE, &backups, None);
            assert!(!db.esta_destrancado());
            r
        });
        let erro = resultado.unwrap_err();
        assert!(erro.downcast_ref::<ChaveIncorreta>().is_none(), "falha de snapshot não é chave errada: {erro}");
        let conn = abrir(&caminho);
        assert_eq!((versao(&conn), contagens(&conn)), (13, antes));
        assert!(!tem_tabela(&conn, "mensalidade"));
        let _ = std::fs::remove_dir_all(raiz);
    }

    /// Com a cifra de verdade, a chave errada é reconhecida como tal, não grava snapshot e não mexe no arquivo.
    #[cfg(feature = "real-sqlcipher")]
    #[test]
    fn chave_errada_e_erro_proprio_e_nao_gera_snapshot() {
        let raiz = std::env::temp_dir().join(format!("ecos-pre-migracao-{}", ecos_core::new_id()));
        let caminho = arquivo_v13(&raiz);
        let backups = raiz.join("backups").join("ana");
        let db = VaultDb::trancado();
        let erro = USUARIO.sync_scope("ana".to_string(), || db.destrancar(&caminho, &"00".repeat(32), &backups, None)).unwrap_err();
        assert!(erro.downcast_ref::<ChaveIncorreta>().is_some(), "{erro}");
        assert!(snapshots(&backups).is_empty());
        assert_eq!(versao(&abrir(&caminho)), 13);
        let _ = std::fs::remove_dir_all(raiz);
    }

    /// `ECOS_VAULT_MIGRAR_ATE=13`: o desbloqueio desce o esquema (com snapshot da versão 16 antes) e o binário
    /// antigo abre o arquivo. Repetir com o banco já na 13 não faz nada.
    #[test]
    fn migrar_ate_desce_o_esquema_com_snapshot_antes() {
        let raiz = std::env::temp_dir().join(format!("ecos-pre-migracao-{}", ecos_core::new_id()));
        let caminho = arquivo_v13(&raiz);
        let backups = raiz.join("backups").join("ana");
        destrancar_como("ana", &caminho, &backups, None).unwrap();
        abrir(&caminho).execute("INSERT INTO mensalidade (recorrencia_id, data_base, ciclos_desde) VALUES ('r1','2024-11-20','2026-11-20')", []).unwrap();
        let antes = contagens(&abrir(&caminho));

        destrancar_como("ana", &caminho, &backups, Some(13)).unwrap();
        let nomes = snapshots(&backups);
        assert_eq!(nomes.iter().filter(|n| n.starts_with("pre-migracao-v16-")).count(), 1, "{nomes:?}");
        assert_eq!(nomes.len(), 2);
        let mut conn = abrir(&caminho);
        assert_eq!((versao(&conn), contagens(&conn)), (13, antes));
        assert!(!tem_tabela(&conn, "mensalidade"));
        Migrations::new(lista_de_migracoes()[..13].to_vec()).to_latest(&mut conn).expect("binário antigo abre");
        drop(conn);
        // O que estava nas tabelas novas fica guardado no snapshot da versão 16.
        let v14 = abrir(&backups.join(nomes.iter().find(|n| n.starts_with("pre-migracao-v16-")).unwrap()));
        assert_eq!(v14.query_row("SELECT COUNT(*) FROM mensalidade", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
        drop(v14);

        destrancar_como("ana", &caminho, &backups, Some(13)).unwrap();
        assert_eq!(snapshots(&backups).len(), 2, "já na versão pedida: nada a fazer");
        assert!(destrancar_como("ana", &caminho, &backups, Some(16)).is_err(), "versão que o binário não conhece é recusada");
        assert!(destrancar_como("ana", &caminho, &backups, Some(0)).is_err());
        assert_eq!(versao(&abrir(&caminho)), 13);
        let _ = std::fs::remove_dir_all(raiz);
    }
}
