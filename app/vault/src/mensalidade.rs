//! Mensalidades: o valor de uma recorrência numa data, considerando o histórico de reajustes
//! (`mensalidade_reajuste`, migração 0014). Recorrência sem reajuste aplicado segue valendo
//! `transacao_recorrente.valor_centavos`, como sempre foi.

use rusqlite::{Connection, OptionalExtension};

/// As tabelas da 0014 existem neste arquivo? Não existem quando o esquema foi levado de volta à versão 13
/// (`ECOS_VAULT_MIGRAR_ATE`); aí tudo se comporta como antes das mensalidades.
pub(crate) fn esquema_presente(conn: &Connection) -> rusqlite::Result<bool> {
    conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'mensalidade_reajuste')", [], |r| r.get(0))
}

/// Valor da recorrência na data da ocorrência (`AAAA-MM-DD`), e não na data em que o lançamento é gerado:
/// 1. há reajuste com `vigente_desde <= data`: vale o `valor_novo` do mais recente;
/// 2. há reajustes aplicados, todos posteriores à data: vale o `valor_anterior` do mais antigo;
/// 3. não há reajuste aplicado: vale `transacao_recorrente.valor_centavos`.
///
/// Reajuste só avisado (`vigente_desde` nulo) ainda não tem valor em vigor e não entra na conta.
/// Recorrência inexistente devolve `QueryReturnedNoRows`.
pub fn valor_em(conn: &Connection, recorrencia_id: &str, data: &str) -> rusqlite::Result<i64> {
    if esquema_presente(conn)? {
        let vigente: Option<i64> = conn
            .query_row(
                "SELECT valor_novo_centavos FROM mensalidade_reajuste WHERE recorrencia_id = ?1 AND vigente_desde IS NOT NULL AND vigente_desde <= ?2 \
                 ORDER BY vigente_desde DESC, ciclo DESC LIMIT 1",
                [recorrencia_id, data],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(valor) = vigente {
            return Ok(valor);
        }
        let antes_do_primeiro: Option<i64> = conn
            .query_row(
                "SELECT valor_anterior_centavos FROM mensalidade_reajuste WHERE recorrencia_id = ?1 AND vigente_desde IS NOT NULL \
                 ORDER BY vigente_desde ASC, ciclo ASC LIMIT 1",
                [recorrencia_id],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(valor) = antes_do_primeiro {
            return Ok(valor);
        }
    }
    conn.query_row("SELECT valor_centavos FROM transacao_recorrente WHERE id = ?1", [recorrencia_id], |r| r.get(0))
}

/// O valor desta recorrência é controlado pelo histórico de reajustes (há reajuste com vigência)? Nesse caso a
/// regra guarda sempre `valor_em(hoje)` e não pode ser editada à mão.
pub fn valor_controlado(conn: &Connection, recorrencia_id: &str) -> rusqlite::Result<bool> {
    if !esquema_presente(conn)? {
        return Ok(false);
    }
    conn.query_row("SELECT EXISTS(SELECT 1 FROM mensalidade_reajuste WHERE recorrencia_id = ?1 AND vigente_desde IS NOT NULL)", [recorrencia_id], |r| r.get(0))
}

/// Leva `transacao_recorrente.valor_centavos` ao valor em vigor em `hoje`, só para recorrência com reajuste
/// aplicável (com vigência). Devolve se mudou. Lançamentos já gerados nunca são tocados.
pub fn aplicar_vigencia(conn: &Connection, recorrencia_id: &str, hoje: &str) -> rusqlite::Result<bool> {
    if !esquema_presente(conn)? {
        return Ok(false);
    }
    if !valor_controlado(conn, recorrencia_id)? {
        return Ok(false);
    }
    let Some(valor) = valor_em(conn, recorrencia_id, hoje).optional()? else { return Ok(false) };
    let mudou = conn.execute("UPDATE transacao_recorrente SET valor_centavos = ?1, atualizado_em = datetime('now') WHERE id = ?2 AND valor_centavos <> ?1", rusqlite::params![valor, recorrencia_id])?;
    Ok(mudou > 0)
}

/// O mesmo para todas as recorrências com reajuste (job de recorrências): aplica as vigências que já chegaram.
pub fn aplicar_vigencias(conn: &Connection, hoje: &str) -> rusqlite::Result<usize> {
    if !esquema_presente(conn)? {
        return Ok(0);
    }
    let ids: Vec<String> = conn.prepare("SELECT DISTINCT recorrencia_id FROM mensalidade_reajuste WHERE vigente_desde IS NOT NULL")?.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?;
    let mut mudaram = 0;
    for id in ids {
        if aplicar_vigencia(conn, &id, hoje)? {
            mudaram += 1;
        }
    }
    Ok(mudaram)
}

/// Apaga o contrato e o histórico de reajustes de uma recorrência. O Cofre não liga `foreign_keys`, então não há
/// cascata: quem exclui a recorrência chama isto na mesma transação.
pub fn apagar_da_recorrencia(conn: &Connection, recorrencia_id: &str) -> rusqlite::Result<()> {
    if esquema_presente(conn)? {
        conn.execute("DELETE FROM mensalidade_reajuste WHERE recorrencia_id = ?1", [recorrencia_id])?;
        conn.execute("DELETE FROM mensalidade WHERE recorrencia_id = ?1", [recorrencia_id])?;
    }
    Ok(())
}

#[cfg(test)]
mod testes {
    use super::*;
    use crate::routes::fluxo::{materializar, ocorrencias};
    use chrono::NaiveDate;

    /// Esquema completo (todas as migrations) com uma mensalidade de R$ 1.000,00 todo dia 10, desde 10/09/2026.
    fn banco() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        crate::db::migrar_para_teste(&mut c);
        c.execute("INSERT INTO transacao_recorrente(id,tipo,descricao,valor_centavos,tipo_recorrencia,data_inicio,espaco) VALUES('r','entrada','Mensalidade',100000,'fixa','2026-09-10','pessoal')", []).unwrap();
        c
    }

    fn reajuste(c: &Connection, id: &str, ciclo: &str, anterior: i64, novo: i64, vigente: Option<&str>) {
        c.execute(
            "INSERT INTO mensalidade_reajuste(id,recorrencia_id,ciclo,valor_anterior_centavos,valor_novo_centavos,regra,vigente_desde) VALUES(?1,'r',?2,?3,?4,'minimo',?5)",
            rusqlite::params![id, ciclo, anterior, novo, vigente],
        )
        .unwrap();
    }

    fn dia(s: &str) -> NaiveDate {
        s.parse().unwrap()
    }

    #[test]
    fn sem_reajuste_vale_o_valor_da_recorrencia() {
        let c = banco();
        assert_eq!(valor_em(&c, "r", "2026-09-10").unwrap(), 100000);
        assert_eq!(valor_em(&c, "r", "2030-01-10").unwrap(), 100000);
        // Reajuste só avisado (sem vigência) ainda não muda nada.
        reajuste(&c, "a", "2026-11-20", 100000, 110000, None);
        assert_eq!(valor_em(&c, "r", "2027-01-10").unwrap(), 100000);
        assert!(matches!(valor_em(&c, "nao-existe", "2026-09-10"), Err(rusqlite::Error::QueryReturnedNoRows)));
    }

    #[test]
    fn com_reajuste_vigente_vale_o_valor_novo_do_mais_recente() {
        let c = banco();
        reajuste(&c, "a", "2026-11-20", 100000, 110000, Some("2026-12-01"));
        reajuste(&c, "b", "2027-11-20", 110000, 125000, Some("2027-12-01"));
        // A recorrência já guarda "o valor em vigor hoje"; o histórico é que decide por data.
        c.execute("UPDATE transacao_recorrente SET valor_centavos = 125000 WHERE id = 'r'", []).unwrap();
        assert_eq!(valor_em(&c, "r", "2026-12-01").unwrap(), 110000, "a vigência inclui o próprio dia");
        assert_eq!(valor_em(&c, "r", "2027-11-10").unwrap(), 110000);
        assert_eq!(valor_em(&c, "r", "2027-12-10").unwrap(), 125000);
        assert_eq!(valor_em(&c, "r", "2031-01-10").unwrap(), 125000);
    }

    #[test]
    fn com_reajuste_so_futuro_vale_o_valor_anterior_do_mais_antigo() {
        let c = banco();
        reajuste(&c, "b", "2027-11-20", 110000, 125000, Some("2027-12-01"));
        reajuste(&c, "a", "2026-11-20", 100000, 110000, Some("2026-12-01"));
        c.execute("UPDATE transacao_recorrente SET valor_centavos = 125000 WHERE id = 'r'", []).unwrap();
        assert_eq!(valor_em(&c, "r", "2026-11-30").unwrap(), 100000);
        assert_eq!(valor_em(&c, "r", "2026-09-10").unwrap(), 100000);
    }

    /// Cofre trancado ao cruzar a vigência: as ocorrências antigas são geradas depois, e saem com o valor da data delas.
    #[test]
    fn ocorrencia_anterior_a_vigencia_gerada_depois_dela_sai_com_o_valor_antigo() {
        let c = banco();
        reajuste(&c, "a", "2026-11-20", 100000, 110000, Some("2026-12-01"));
        c.execute("UPDATE transacao_recorrente SET valor_centavos = 110000 WHERE id = 'r'", []).unwrap();

        let previstas = ocorrencias(&c, dia("2026-11-01"), dia("2026-12-31")).unwrap();
        assert_eq!(previstas.iter().map(|o| (o.data.as_str(), o.valor_centavos)).collect::<Vec<_>>(), [("2026-11-10", 100000), ("2026-12-10", 110000)]);

        // O job roda em janeiro e lança as duas de uma vez.
        let tx = c.unchecked_transaction().unwrap();
        let novembro = materializar(&tx, "r", "2026-11-10", "2026-11-10", false).unwrap();
        let dezembro = materializar(&tx, "r", "2026-12-10", "2026-12-10", false).unwrap();
        tx.commit().unwrap();
        let valor = |id: &str| c.query_row("SELECT valor_centavos FROM transacao WHERE id = ?1", [id], |r| r.get::<_, i64>(0)).unwrap();
        assert_eq!((valor(&novembro), valor(&dezembro)), (100000, 110000));

        // Lançamento já gerado nunca é recalculado: um reajuste novo não mexe nele.
        reajuste(&c, "b", "2025-11-20", 90000, 100000, Some("2025-12-01"));
        assert_eq!(valor(&novembro), 100000);
    }

    /// Recebimento parcial de uma ocorrência anterior à vigência: o restante é calculado sobre o valor daquela data,
    /// não sobre o valor em vigor hoje.
    #[tokio::test]
    async fn concluir_parcial_calcula_o_restante_pelo_valor_da_data_da_ocorrencia() {
        use axum::extract::{Path, State};
        use axum::Json;
        let raiz = std::env::temp_dir().join(format!("ecos-mensalidade-{}", ecos_core::new_id()));
        let config = std::sync::Arc::new(crate::config::Config { porta: 0, db_path: raiz.join("vault.db"), meta_path: raiz.join("meta.json"), backups_dir: raiz.join("backups") });
        let state = crate::state::AppState { db: crate::db::VaultDb::trancado(), config };
        crate::db::USUARIO
            .scope("ana".into(), async {
                state.db.destrancar(&raiz.join("vault.db"), &"ab".repeat(32), &raiz.join("backups"), None).unwrap();
                state
                    .db
                    .with(|c| {
                        c.execute("INSERT INTO transacao_recorrente(id,tipo,descricao,valor_centavos,tipo_recorrencia,data_inicio,espaco) VALUES('r','entrada','Mensalidade',110000,'fixa','2025-09-10','pessoal')", [])?;
                        c.execute("INSERT INTO mensalidade_reajuste(id,recorrencia_id,ciclo,valor_anterior_centavos,valor_novo_centavos,regra,vigente_desde) VALUES('a','r','2025-11-20',100000,110000,'minimo','2025-12-01')", [])
                    })
                    .await
                    .unwrap();
                let pedido = |ocorrencia: &str| crate::routes::fluxo::Agendar { data_ocorrencia: dia(ocorrencia), data: dia(ocorrencia), valor_centavos: Some(40000), confirmar: true };
                let _ = crate::routes::fluxo::concluir(State(state.clone()), Path("r".to_string()), Json(pedido("2025-11-10"))).await.unwrap();
                let _ = crate::routes::fluxo::concluir(State(state.clone()), Path("r".to_string()), Json(pedido("2025-12-10"))).await.unwrap();
                let restantes: Vec<i64> = state
                    .db
                    .with(|c| c.prepare("SELECT valor_centavos FROM pendencia_avulsa WHERE transacao_recorrente_id = 'r' ORDER BY valor_centavos")?.query_map([], |r| r.get(0))?.collect())
                    .await
                    .unwrap();
                assert_eq!(restantes, [60000, 70000], "novembro sobre R$ 1.000,00 e dezembro sobre R$ 1.100,00");
            })
            .await;
        let _ = std::fs::remove_dir_all(raiz);
    }

    /// Tela de Recorrências: a ocorrência ainda não lançada sai com o valor da data dela; a já lançada mantém o
    /// valor do lançamento, mesmo que um reajuste posterior diga outra coisa.
    #[test]
    fn listagem_completa_preve_pelo_reajuste_e_nao_recalcula_o_que_ja_foi_lancado() {
        let c = banco();
        let tx = c.unchecked_transaction().unwrap();
        materializar(&tx, "r", "2026-10-10", "2026-10-10", true).unwrap();
        tx.commit().unwrap();
        // Reajuste retroativo a setembro: outubro já foi lançado a R$ 1.000,00 e fica como está.
        reajuste(&c, "a", "2026-09-20", 100000, 110000, Some("2026-09-20"));
        reajuste(&c, "b", "2026-11-20", 110000, 121000, Some("2026-12-01"));
        c.execute("UPDATE transacao_recorrente SET valor_centavos = 110000 WHERE id = 'r'", []).unwrap();

        let linhas = crate::routes::fluxo::ocorrencias_completas(&c, dia("2026-09-01"), dia("2026-12-31")).unwrap();
        let resumo: Vec<_> = linhas.iter().map(|l| (l.data.as_str(), l.valor_centavos, l.transacao_id.is_some())).collect();
        assert_eq!(resumo, [("2026-09-10", 100000, false), ("2026-10-10", 100000, true), ("2026-11-10", 110000, false), ("2026-12-10", 121000, false)]);
    }

    /// Esquema levado de volta à versão 13: sem as tabelas, tudo vale como antes e a limpeza não falha.
    #[test]
    fn sem_as_tabelas_de_mensalidade_o_comportamento_e_o_de_antes() {
        let c = banco();
        c.execute_batch(include_str!("../migrations/0014_mensalidades_down.sql")).unwrap();
        assert_eq!(valor_em(&c, "r", "2026-12-10").unwrap(), 100000);
        apagar_da_recorrencia(&c, "r").unwrap();
    }

    #[test]
    fn apagar_remove_contrato_e_historico_so_daquela_recorrencia() {
        let c = banco();
        c.execute("INSERT INTO mensalidade(recorrencia_id,data_base,ciclos_desde) VALUES('r','2024-11-20','2026-11-20'),('outra','2025-01-05','2026-01-05')", []).unwrap();
        reajuste(&c, "a", "2026-11-20", 100000, 110000, Some("2026-12-01"));
        c.execute("INSERT INTO mensalidade_reajuste(id,recorrencia_id,ciclo,valor_anterior_centavos,valor_novo_centavos,regra) VALUES('z','outra','2026-01-05',1,2,'igpm')", []).unwrap();
        apagar_da_recorrencia(&c, "r").unwrap();
        let conta = |sql: &str| c.query_row(sql, [], |r| r.get::<_, i64>(0)).unwrap();
        assert_eq!(conta("SELECT COUNT(*) FROM mensalidade WHERE recorrencia_id = 'r'"), 0);
        assert_eq!(conta("SELECT COUNT(*) FROM mensalidade_reajuste WHERE recorrencia_id = 'r'"), 0);
        assert_eq!(conta("SELECT COUNT(*) FROM mensalidade"), 1);
        assert_eq!(conta("SELECT COUNT(*) FROM mensalidade_reajuste"), 1);
    }
}
