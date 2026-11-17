//! Mensalidades: as regras com "hoje" fixo (banco em memória) e as rotas pelo roteador real (relógio de verdade,
//! datas montadas em relação a hoje).

use super::mensalidades::*;
use crate::routes::fluxo::materializar;
use crate::{config::Config, db::VaultDb, db::USUARIO, routes, state::AppState};
use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
    Router,
};
use chrono::{Days, Months, NaiveDate};
use ecos_core::new_id;
use rusqlite::Connection;
use serde_json::{json, Value};
use std::sync::Arc;
use tower::Service;

// ------------------------------------------------------------------------------------------------------------
// Regras, com data fixa
// ------------------------------------------------------------------------------------------------------------

fn dia(s: &str) -> NaiveDate {
    s.parse().unwrap()
}

/// Esquema completo com a mensalidade "r": R$ 3.500,00 todo dia 20 desde 20/11/2024 (a entrada do residente),
/// controlada a partir de 2026. O ciclo em jogo é 20/11/2026: limite do aviso 21/10, alerta desde 06/10.
fn banco() -> Connection {
    let mut c = Connection::open_in_memory().unwrap();
    crate::db::migrar_para_teste(&mut c);
    c.execute("INSERT INTO beneficiario (id, nome) VALUES ('b1', 'Dona Marta')", []).unwrap();
    recorrencia(&c, "r", "Mensalidade Marta", 350000, "2024-11-20");
    c.execute("UPDATE transacao_recorrente SET beneficiario_id = 'b1' WHERE id = 'r'", []).unwrap();
    contrato(&c, "r", "2024-11-20", "2026-01-01");
    c
}

fn recorrencia(c: &Connection, id: &str, descricao: &str, valor: i64, inicio: &str) {
    c.execute("INSERT INTO transacao_recorrente(id,tipo,descricao,valor_centavos,tipo_recorrencia,data_inicio,espaco) VALUES(?1,'entrada',?2,?3,'fixa',?4,'pessoal')", rusqlite::params![id, descricao, valor, inicio]).unwrap();
}

fn contrato(c: &Connection, id: &str, base: &str, desde: &str) {
    let p = ContratoPedido { data_base: dia(base), ciclos_desde: Some(dia(desde)), percentual_minimo_bp: None, aviso_dias: None };
    salvar_contrato(c, id, &p, dia("2026-01-01"), Some("ana")).unwrap();
}

fn pedido(corpo: Value) -> ReajustePedido {
    serde_json::from_value(corpo).unwrap()
}

fn reajustar(c: &Connection, hoje: &str, corpo: Value) -> Result<Value, Falha> {
    registrar_reajuste(c, "r", &pedido(corpo), dia(hoje), Some("ana"))
}

/// "ok", "422", "409", "404", "esquema" ou "sql".
fn desfecho<T>(r: &Result<T, Falha>) -> &'static str {
    match r {
        Ok(_) => "ok",
        Err(Falha::Recusa(Recusa::Invalido(_))) => "422",
        Err(Falha::Recusa(Recusa::Conflito(_))) => "409",
        Err(Falha::Recusa(Recusa::NaoEncontrado(_))) => "404",
        Err(Falha::Recusa(Recusa::EsquemaAusente)) => "esquema",
        Err(Falha::Sql(_)) => "sql",
    }
}

fn valor_da_regra(c: &Connection, id: &str) -> i64 {
    c.query_row("SELECT valor_centavos FROM transacao_recorrente WHERE id = ?1", [id], |r| r.get(0)).unwrap()
}

fn foco(c: &Connection, hoje: &str) -> Value {
    detalhar(c, "r", dia(hoje), false).unwrap()["ciclo_em_foco"].clone()
}

#[test]
fn estado_do_ciclo_sem_decisao_muda_nas_fronteiras_do_aviso() {
    let c = banco();
    for (hoje, estado, sem_decisao) in [("2026-10-05", "futuro", 0), ("2026-10-06", "avisar", 1), ("2026-10-21", "avisar", 1), ("2026-10-22", "atrasado", 1), ("2027-03-01", "atrasado", 1)] {
        let item = detalhar(&c, "r", dia(hoje), false).unwrap();
        assert_eq!((item["ciclo_em_foco"]["ciclo"].as_str(), item["ciclo_em_foco"]["estado"].as_str()), (Some("2026-11-20"), Some(estado)), "em {hoje}");
        assert_eq!(item["ciclos_sem_decisao"], sem_decisao, "em {hoje}");
        assert_eq!(item["ciclo_em_foco"]["limite_aviso"], "2026-10-21");
        assert_eq!(item["ciclo_em_foco"]["valor_minimo_centavos"], 385000);
        assert_eq!(item["ciclo_em_foco"]["perda_estimada_centavos"].is_null(), estado != "atrasado", "perda só no atrasado, em {hoje}");
    }
}

#[test]
fn estado_do_ciclo_decidido_agendado_aplicado_e_mantido() {
    let c = banco();
    reajustar(&c, "2026-11-15", json!({ "ciclo": "2026-11-20", "modo": "automatico" })).unwrap();
    assert_eq!(foco(&c, "2026-12-14")["estado"], "agendado");
    assert_eq!(foco(&c, "2026-12-14")["reajuste"]["vigente_desde"], "2026-12-15");
    // No dia da vigência o ciclo passa a aplicado e o foco vai para o próximo, ainda futuro.
    let item = detalhar(&c, "r", dia("2026-12-15"), true).unwrap();
    assert_eq!((item["ciclo_em_foco"]["ciclo"].as_str(), item["ciclo_em_foco"]["estado"].as_str()), (Some("2027-11-20"), Some("futuro")));
    let estados: Vec<_> = item["ciclos"].as_array().unwrap().iter().map(|x| (x["ciclo"].as_str().unwrap(), x["estado"].as_str().unwrap())).collect();
    assert_eq!(estados, [("2027-11-20", "futuro"), ("2026-11-20", "aplicado")], "do mais recente para o mais antigo");

    let m = banco();
    reajustar(&m, "2026-10-10", json!({ "ciclo": "2026-11-20", "modo": "mantido", "motivo": "Combinado com a família" })).unwrap();
    let item = detalhar(&m, "r", dia("2026-10-10"), true).unwrap();
    assert_eq!(item["ciclos"][1]["estado"], "mantido", "mantido mesmo antes da data do ciclo");
    assert_eq!(item["ciclos_sem_decisao"], 0);
}

#[test]
fn ciclos_seguem_o_aniversario_inclusive_em_29_de_fevereiro_e_ignoram_os_anteriores_ao_controle() {
    let c = banco();
    recorrencia(&c, "f", "Bissexta", 100000, "2024-02-29");
    contrato(&c, "f", "2024-02-29", "2024-03-01");
    let item = detalhar(&c, "f", dia("2028-06-01"), true).unwrap();
    let ciclos: Vec<_> = item["ciclos"].as_array().unwrap().iter().map(|x| x["ciclo"].as_str().unwrap().to_string()).collect();
    assert_eq!(ciclos, ["2029-02-28", "2028-02-29", "2027-02-28", "2026-02-28", "2025-02-28"]);
    assert_eq!(item["ciclos_sem_decisao"], 4);
    assert_eq!(item["ciclo_em_foco"]["ciclo"], "2025-02-28", "o mais antigo sem decisão");

    // "r" entrou em 2024 mas é controlada desde 2026: o aniversário de 2025 não existe para o sistema.
    let r = detalhar(&c, "r", dia("2026-12-01"), true).unwrap();
    assert!(r["ciclos"].as_array().unwrap().iter().all(|x| x["ciclo"] != "2025-11-20"));
    assert_eq!(desfecho(&reajustar(&c, "2026-12-01", json!({ "ciclo": "2025-11-20", "modo": "automatico" }))), "422");
}

#[test]
fn automatico_usa_o_maior_entre_o_minimo_e_o_igpm() {
    let c = banco();
    let menor = reajustar(&c, "2026-10-10", json!({ "ciclo": "2026-11-20", "modo": "automatico", "igpm_bp": 652, "simular": true })).unwrap();
    assert_eq!((menor["regra"].as_str(), menor["valor_anterior_centavos"].as_i64(), menor["valor_novo_centavos"].as_i64(), menor["percentual_bp"].as_i64()), (Some("minimo"), Some(350000), Some(385000), Some(1000)));
    assert_eq!((menor["igpm_bp"].as_i64(), menor["id"].is_null(), menor["criado_em"].is_null()), (Some(652), true, true), "simulação não grava");
    assert_eq!((menor["aviso_em"].as_str(), menor["vigente_desde"].as_str(), menor["vigencia_minima"].as_str(), menor["perda_centavos"].as_i64()), (Some("2026-10-10"), Some("2026-11-20"), Some("2026-11-20"), Some(0)));
    assert_eq!(c.query_row("SELECT COUNT(*) FROM mensalidade_reajuste", [], |r| r.get::<_, i64>(0)).unwrap(), 0);

    let sem_igpm = reajustar(&c, "2026-10-10", json!({ "ciclo": "2026-11-20", "modo": "automatico", "simular": true })).unwrap();
    assert_eq!((sem_igpm["regra"].as_str(), sem_igpm["valor_novo_centavos"].as_i64(), sem_igpm["igpm_bp"].is_null()), (Some("minimo"), Some(385000), true));
    let empate = reajustar(&c, "2026-10-10", json!({ "ciclo": "2026-11-20", "modo": "automatico", "igpm_bp": 1000, "simular": true })).unwrap();
    assert_eq!(empate["regra"], "minimo");

    let maior = reajustar(&c, "2026-10-10", json!({ "ciclo": "2026-11-20", "modo": "automatico", "igpm_bp": 1234 })).unwrap();
    assert_eq!((maior["regra"].as_str(), maior["valor_novo_centavos"].as_i64(), maior["percentual_bp"].as_i64()), (Some("igpm"), Some(393190), Some(1234)));
    assert!(maior["id"].is_string() && maior["criado_em"].is_string());
    assert_eq!(maior["criado_por"], "ana");
    assert_eq!(valor_da_regra(&c, "r"), 350000, "vigência futura não mexe na regra");
    // Ciclo já decidido: nem gravar de novo, nem simular.
    assert_eq!(desfecho(&reajustar(&c, "2026-10-10", json!({ "ciclo": "2026-11-20", "modo": "automatico" }))), "409");
    assert_eq!(desfecho(&reajustar(&c, "2026-10-10", json!({ "ciclo": "2026-11-20", "modo": "mantido", "motivo": "x", "simular": true }))), "409");
}

#[test]
fn arredonda_ao_centavo_com_metade_para_cima() {
    let c = banco();
    for (valor, igpm, esperado) in [(5, 0, 6), (33333, 0, 36666), (12345, 1652, 14384), (99995, 0, 109995)] {
        c.execute("UPDATE transacao_recorrente SET valor_centavos = ?1 WHERE id = 'r'", [valor]).unwrap();
        let r = reajustar(&c, "2026-10-10", json!({ "ciclo": "2026-11-20", "modo": "automatico", "igpm_bp": igpm, "simular": true })).unwrap();
        assert_eq!(r["valor_novo_centavos"], esperado, "{valor} com IGP-M {igpm}");
    }
}

#[test]
fn negociado_por_percentual_ou_por_valor_exige_motivo_e_exatamente_um_dos_dois() {
    let c = banco();
    let base = |extra: Value| {
        let mut corpo = json!({ "ciclo": "2026-11-20", "modo": "negociado", "motivo": "Acordo com o responsável", "simular": true });
        corpo.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        reajustar(&c, "2026-10-10", corpo)
    };
    let por_percentual = base(json!({ "percentual_bp": 800 })).unwrap();
    assert_eq!((por_percentual["regra"].as_str(), por_percentual["valor_novo_centavos"].as_i64(), por_percentual["percentual_bp"].as_i64()), (Some("negociado"), Some(378000), Some(800)));
    let por_valor = base(json!({ "valor_novo_centavos": 380000 })).unwrap();
    assert_eq!((por_valor["valor_novo_centavos"].as_i64(), por_valor["percentual_bp"].as_i64(), por_valor["motivo"].as_str()), (Some(380000), Some(857), Some("Acordo com o responsável")));
    let para_baixo = base(json!({ "valor_novo_centavos": 340000 })).unwrap();
    assert_eq!((para_baixo["valor_novo_centavos"].as_i64(), para_baixo["percentual_bp"].as_i64(), para_baixo["perda_centavos"].as_i64()), (Some(340000), Some(-286), Some(0)), "pode ser menor que o anterior");

    assert_eq!(desfecho(&base(json!({ "percentual_bp": 800, "valor_novo_centavos": 380000 }))), "422", "os dois");
    assert_eq!(desfecho(&base(json!({}))), "422", "nenhum");
    assert_eq!(desfecho(&base(json!({ "valor_novo_centavos": 0 }))), "422", "valor novo tem de ser positivo");
    assert_eq!(desfecho(&base(json!({ "percentual_bp": -10000 }))), "422", "percentual que zera o valor");
    // Motivo: obrigatório para gravar, dispensado na prévia (a tela ainda está sendo preenchida).
    let gravar = |extra: Value| {
        let mut corpo = json!({ "ciclo": "2026-11-20", "modo": "negociado", "percentual_bp": 800 });
        corpo.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        reajustar(&c, "2026-10-10", corpo)
    };
    assert_eq!(desfecho(&gravar(json!({ "motivo": "   " }))), "422", "motivo em branco");
    assert_eq!(desfecho(&gravar(json!({}))), "422", "sem motivo");
    let previa = gravar(json!({ "simular": true })).unwrap();
    assert_eq!((previa["valor_novo_centavos"].as_i64(), previa["motivo"].is_null(), previa["id"].is_null()), (Some(378000), true, true));
    assert_eq!(gravar(json!({ "simular": true, "motivo": "  " })).unwrap()["motivo"], Value::Null);
    // As outras regras continuam valendo na prévia.
    assert_eq!(desfecho(&gravar(json!({ "simular": true, "valor_novo_centavos": 1 }))), "422");
    assert_eq!(c.query_row("SELECT COUNT(*) FROM mensalidade_reajuste", [], |r| r.get::<_, i64>(0)).unwrap(), 0, "recusa não grava nada");
}

#[test]
fn mantido_exige_motivo_vale_no_proprio_ciclo_e_nao_muda_o_valor() {
    let c = banco();
    assert_eq!(desfecho(&reajustar(&c, "2026-11-25", json!({ "ciclo": "2026-11-20", "modo": "mantido" }))), "422");
    let previa = reajustar(&c, "2026-11-25", json!({ "ciclo": "2026-11-20", "modo": "mantido", "simular": true })).unwrap();
    assert_eq!((previa["regra"].as_str(), previa["valor_novo_centavos"].as_i64(), previa["motivo"].is_null()), (Some("mantido"), Some(350000), true), "a prévia dispensa o motivo");
    assert_eq!(c.query_row("SELECT COUNT(*) FROM mensalidade_reajuste", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
    let r = reajustar(&c, "2026-11-25", json!({ "ciclo": "2026-11-20", "modo": "mantido", "motivo": "Residente em período de adaptação", "vigente_desde": "2027-01-01" })).unwrap();
    assert_eq!((r["regra"].as_str(), r["valor_anterior_centavos"].as_i64(), r["valor_novo_centavos"].as_i64(), r["percentual_bp"].as_i64()), (Some("mantido"), Some(350000), Some(350000), Some(0)));
    assert_eq!((r["vigente_desde"].as_str(), r["vigencia_minima"].as_str(), r["aviso_em"].as_str(), r["perda_centavos"].as_i64()), (Some("2026-11-20"), Some("2026-11-20"), Some("2026-11-25"), Some(0)));
    assert_eq!(valor_da_regra(&c, "r"), 350000);
    assert_eq!(foco(&c, "2026-11-25")["ciclo"], "2027-11-20");
}

#[test]
fn vigencia_minima_respeita_o_aviso_e_o_atraso_vira_perda() {
    let c = banco();
    // Em 25/11 o ciclo de 20/11 está atrasado. Avisando hoje, o valor novo só vale em 25/12: duas mensalidades
    // (20/11 e 20/12) saem pelo valor antigo.
    let estimado = foco(&c, "2026-11-25");
    assert_eq!((estimado["estado"].as_str(), estimado["valor_minimo_centavos"].as_i64(), estimado["perda_estimada_centavos"].as_i64()), (Some("atrasado"), Some(385000), Some(70000)));
    // No exemplo da especificação (hoje 15/11): vigência possível em 15/12, uma mensalidade perdida.
    assert_eq!(foco(&c, "2026-11-15")["perda_estimada_centavos"], 35000);

    assert_eq!(desfecho(&reajustar(&c, "2026-11-25", json!({ "ciclo": "2026-11-20", "modo": "automatico", "vigente_desde": "2026-12-24" }))), "422", "antes da mínima");
    assert_eq!(desfecho(&reajustar(&c, "2026-11-25", json!({ "ciclo": "2026-11-20", "modo": "automatico", "aviso_em": "2026-11-26" }))), "422", "aviso futuro");
    let simulado = reajustar(&c, "2026-11-25", json!({ "ciclo": "2026-11-20", "modo": "automatico", "simular": true })).unwrap();
    assert_eq!((simulado["aviso_em"].as_str(), simulado["vigencia_minima"].as_str(), simulado["vigente_desde"].as_str(), simulado["perda_centavos"].as_i64()), (Some("2026-11-25"), Some("2026-12-25"), Some("2026-12-25"), Some(70000)));
    // Vigência escolhida depois da mínima é aceita e aumenta a perda.
    let adiado = reajustar(&c, "2026-11-25", json!({ "ciclo": "2026-11-20", "modo": "automatico", "vigente_desde": "2027-01-21", "simular": true })).unwrap();
    assert_eq!((adiado["vigente_desde"].as_str(), adiado["vigencia_minima"].as_str(), adiado["perda_centavos"].as_i64()), (Some("2027-01-21"), Some("2026-12-25"), Some(105000)));
    // Ocorrência pulada não conta como perda.
    c.execute("INSERT INTO recorrencia_exclusao(transacao_recorrente_id,data_ocorrencia) VALUES('r','2026-12-20')", []).unwrap();
    assert_eq!(foco(&c, "2026-11-25")["perda_estimada_centavos"], 35000);
    c.execute("DELETE FROM recorrencia_exclusao", []).unwrap();

    // Aviso dado a tempo, registrado depois: a vigência é o próprio ciclo, sem perda, e a regra já muda.
    let a_tempo = reajustar(&c, "2026-11-25", json!({ "ciclo": "2026-11-20", "modo": "automatico", "aviso_em": "2026-10-15" })).unwrap();
    assert_eq!((a_tempo["vigente_desde"].as_str(), a_tempo["vigencia_minima"].as_str(), a_tempo["perda_centavos"].as_i64()), (Some("2026-11-20"), Some("2026-11-20"), Some(0)));
    assert_eq!(valor_da_regra(&c, "r"), 385000, "vigência já passada atualiza o valor da regra");
}

#[test]
fn vigencia_futura_so_muda_a_regra_quando_chega_e_so_para_quem_tem_reajuste() {
    let c = banco();
    recorrencia(&c, "aluguel", "Aluguel recebido", 200000, "2025-01-05");
    reajustar(&c, "2026-11-15", json!({ "ciclo": "2026-11-20", "modo": "automatico" })).unwrap();
    assert_eq!(valor_da_regra(&c, "r"), 350000);
    assert_eq!(crate::mensalidade::aplicar_vigencias(&c, "2026-12-14").unwrap(), 0);
    assert_eq!(valor_da_regra(&c, "r"), 350000);
    assert_eq!(crate::mensalidade::aplicar_vigencias(&c, "2026-12-15").unwrap(), 1);
    assert_eq!((valor_da_regra(&c, "r"), valor_da_regra(&c, "aluguel")), (385000, 200000));
    assert_eq!(crate::mensalidade::aplicar_vigencias(&c, "2026-12-16").unwrap(), 0, "repetir não muda nada");
    // O valor anterior do ciclo seguinte já parte do reajustado.
    let seguinte = reajustar(&c, "2027-10-10", json!({ "ciclo": "2027-11-20", "modo": "automatico", "simular": true })).unwrap();
    assert_eq!((seguinte["valor_anterior_centavos"].as_i64(), seguinte["valor_novo_centavos"].as_i64()), (Some(385000), Some(423500)));
}

#[test]
fn reajuste_recusa_ciclo_invalido_modo_desconhecido_e_recorrencia_sem_contrato() {
    let c = banco();
    recorrencia(&c, "solta", "Sem contrato", 1000, "2025-01-05");
    assert_eq!(desfecho(&reajustar(&c, "2026-11-25", json!({ "ciclo": "2026-11-21", "modo": "automatico" }))), "422", "não é aniversário");
    assert_eq!(desfecho(&reajustar(&c, "2026-11-25", json!({ "ciclo": "2024-11-20", "modo": "automatico" }))), "422", "a própria data-base não é ciclo");
    assert_eq!(desfecho(&reajustar(&c, "2026-11-25", json!({ "ciclo": "2026-11-20", "modo": "desconto" }))), "422");
    assert_eq!(desfecho(&reajustar(&c, "2026-11-25", json!({ "ciclo": "2026-11-20", "modo": "automatico", "igpm_bp": 100001 }))), "422");
    assert_eq!(desfecho(&registrar_reajuste(&c, "solta", &pedido(json!({ "ciclo": "2026-01-05", "modo": "automatico" })), dia("2026-11-25"), None)), "404");
    assert_eq!(desfecho(&detalhar(&c, "solta", dia("2026-11-25"), true)), "404");
}

#[test]
fn remover_reajuste_desfaz_o_valor_e_e_recusado_depois_de_lancado() {
    let c = banco();
    assert_eq!(desfecho(&remover_reajuste(&c, "nao-existe", dia("2026-12-01"))), "404");
    // Aplicado e ainda sem lançamento com o valor novo: sai, e a regra volta ao valor de antes.
    let r = reajustar(&c, "2026-11-25", json!({ "ciclo": "2026-11-20", "modo": "automatico", "aviso_em": "2026-10-15" })).unwrap();
    assert_eq!(valor_da_regra(&c, "r"), 385000);
    remover_reajuste(&c, r["id"].as_str().unwrap(), dia("2026-11-25")).unwrap();
    assert_eq!(valor_da_regra(&c, "r"), 350000);
    assert_eq!(foco(&c, "2026-11-25")["estado"], "atrasado", "o ciclo volta a ficar sem decisão");

    // Agendado: sai sem mexer na regra.
    let agendado = reajustar(&c, "2026-11-25", json!({ "ciclo": "2026-11-20", "modo": "automatico" })).unwrap();
    remover_reajuste(&c, agendado["id"].as_str().unwrap(), dia("2026-11-25")).unwrap();
    assert_eq!(valor_da_regra(&c, "r"), 350000);

    // Com lançamento gerado na vigência: recusado, nada muda.
    let r = reajustar(&c, "2026-11-25", json!({ "ciclo": "2026-11-20", "modo": "automatico", "aviso_em": "2026-10-15" })).unwrap();
    let tx = c.unchecked_transaction().unwrap();
    materializar(&tx, "r", "2026-10-20", "2026-10-20", false).unwrap();
    tx.commit().unwrap();
    remover_reajuste(&c, r["id"].as_str().unwrap(), dia("2026-11-25")).expect("lançamento anterior à vigência não impede");
    let r = reajustar(&c, "2026-11-25", json!({ "ciclo": "2026-11-20", "modo": "automatico", "aviso_em": "2026-10-15" })).unwrap();
    let tx = c.unchecked_transaction().unwrap();
    materializar(&tx, "r", "2026-11-20", "2026-11-20", false).unwrap();
    tx.commit().unwrap();
    assert_eq!(desfecho(&remover_reajuste(&c, r["id"].as_str().unwrap(), dia("2026-11-25"))), "409");
    assert_eq!(valor_da_regra(&c, "r"), 385000);

    // Com outro reajuste restando, a regra fica com o valor em vigor hoje segundo o histórico.
    let segundo = reajustar(&c, "2027-12-01", json!({ "ciclo": "2027-11-20", "modo": "automatico", "aviso_em": "2027-10-01" })).unwrap();
    assert_eq!(valor_da_regra(&c, "r"), 423500);
    remover_reajuste(&c, segundo["id"].as_str().unwrap(), dia("2027-12-01")).unwrap();
    assert_eq!(valor_da_regra(&c, "r"), 385000);

    // "Mantido" sai mesmo com lançamentos depois dele.
    let mantido = reajustar(&c, "2027-12-01", json!({ "ciclo": "2027-11-20", "modo": "mantido", "motivo": "x" })).unwrap();
    let tx = c.unchecked_transaction().unwrap();
    materializar(&tx, "r", "2027-11-20", "2027-11-20", false).unwrap();
    tx.commit().unwrap();
    remover_reajuste(&c, mantido["id"].as_str().unwrap(), dia("2027-12-01")).unwrap();
    assert_eq!(valor_da_regra(&c, "r"), 385000);
}

#[test]
fn contrato_recusa_o_que_nao_e_recorrencia_de_entrada_fixa_e_limites_fora_da_faixa() {
    let c = banco();
    c.execute("INSERT INTO transacao_recorrente(id,tipo,descricao,valor_centavos,tipo_recorrencia,data_inicio,espaco) VALUES('saida','saida','Aluguel',1000,'fixa','2026-01-10','pessoal')", []).unwrap();
    c.execute("INSERT INTO transacao_recorrente(id,tipo,descricao,valor_centavos,tipo_recorrencia,total_parcelas,data_inicio,espaco) VALUES('parc','entrada','Venda',1000,'parcelada',3,'2026-01-10','pessoal')", []).unwrap();
    recorrencia(&c, "nova", "Mensalidade nova", 300000, "2026-06-10");
    let p = |aviso: Option<i64>, minimo: Option<i64>| ContratoPedido { data_base: dia("2025-06-10"), ciclos_desde: None, percentual_minimo_bp: minimo, aviso_dias: aviso };
    let hoje = dia("2026-07-01");
    for id in ["nao-existe", "saida", "parc"] {
        assert_eq!(desfecho(&salvar_contrato(&c, id, &p(None, None), hoje, None)), "422", "{id}");
    }
    for (aviso, minimo) in [(Some(-1), None), (Some(181), None), (None, Some(-1)), (None, Some(10001))] {
        assert_eq!(desfecho(&salvar_contrato(&c, "nova", &p(aviso, minimo), hoje, None)), "422", "{aviso:?} {minimo:?}");
    }
    assert_eq!(c.query_row("SELECT COUNT(*) FROM mensalidade WHERE recorrencia_id <> 'r'", [], |r| r.get::<_, i64>(0)).unwrap(), 0);

    let criado = salvar_contrato(&c, "nova", &p(None, None), hoje, Some("ana")).unwrap();
    assert_eq!((criado["ciclos_desde"].as_str(), criado["percentual_minimo_bp"].as_i64(), criado["aviso_dias"].as_i64()), (Some("2026-07-01"), Some(1000), Some(30)), "padrões: hoje, 10% e 30 dias");
    assert_eq!((criado["ciclo_em_foco"]["ciclo"].as_str(), criado["ciclo_em_foco"]["estado"].as_str()), (Some("2027-06-10"), Some("futuro")), "o aniversário de 2026 é anterior ao controle");
    let limites = salvar_contrato(&c, "nova", &p(Some(0), Some(0)), hoje, None).unwrap();
    assert_eq!((limites["aviso_dias"].as_i64(), limites["percentual_minimo_bp"].as_i64()), (Some(0), Some(0)));
    let limites = salvar_contrato(&c, "nova", &p(Some(180), Some(10000)), dia("2027-01-01"), None).unwrap();
    assert_eq!((limites["aviso_dias"].as_i64(), limites["percentual_minimo_bp"].as_i64(), limites["ciclos_desde"].as_str()), (Some(180), Some(10000), Some("2026-07-01")), "campo ausente na atualização mantém o que estava");
    let mantem = salvar_contrato(&c, "nova", &p(None, None), dia("2027-01-01"), None).unwrap();
    assert_eq!((mantem["aviso_dias"].as_i64(), mantem["percentual_minimo_bp"].as_i64()), (Some(180), Some(10000)));
}

#[test]
fn candidatas_sao_entradas_fixas_ativas_sem_mensalidade() {
    let c = banco();
    c.execute("INSERT INTO transacao_recorrente(id,tipo,descricao,valor_centavos,tipo_recorrencia,data_inicio,espaco) VALUES('saida','saida','Aluguel',1000,'fixa','2026-01-10','pessoal')", []).unwrap();
    c.execute("INSERT INTO transacao_recorrente(id,tipo,descricao,valor_centavos,tipo_recorrencia,total_parcelas,data_inicio,espaco) VALUES('parc','entrada','Venda',1000,'parcelada',3,'2026-01-10','pessoal')", []).unwrap();
    recorrencia(&c, "pausada", "Pausada", 1000, "2026-01-10");
    c.execute("UPDATE transacao_recorrente SET ativa = 0 WHERE id = 'pausada'", []).unwrap();
    recorrencia(&c, "livre", "Mensalidade José", 280000, "2026-03-05");
    assert_eq!(candidatas(&c).unwrap(), json!([{ "recorrencia_id": "livre", "descricao": "Mensalidade José", "beneficiario_nome": null, "valor_centavos": 280000, "data_inicio": "2026-03-05" }]));
    remover_contrato(&c, "r").unwrap();
    assert_eq!(candidatas(&c).unwrap().as_array().unwrap().len(), 2, "sem o contrato, 'r' volta a ser candidata");
    assert_eq!(candidatas(&c).unwrap()[0]["beneficiario_nome"], "Dona Marta");
    assert_eq!(desfecho(&remover_contrato(&c, "r")), "404");
}

#[test]
fn remover_o_contrato_preserva_o_historico_de_reajustes() {
    let c = banco();
    reajustar(&c, "2026-11-25", json!({ "ciclo": "2026-11-20", "modo": "automatico", "aviso_em": "2026-10-15" })).unwrap();
    remover_contrato(&c, "r").unwrap();
    assert_eq!(c.query_row("SELECT COUNT(*) FROM mensalidade_reajuste WHERE recorrencia_id = 'r'", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
    assert_eq!(crate::mensalidade::valor_em(&c, "r", "2026-10-20").unwrap(), 350000);
    assert_eq!(crate::mensalidade::valor_em(&c, "r", "2026-12-20").unwrap(), 385000);
    assert_eq!(listar_itens(&c, dia("2026-11-25")).unwrap(), json!([]));
}

#[test]
fn lista_ordena_por_urgencia_e_depois_pela_data_do_ciclo() {
    let c = banco(); // "r": ciclo 20/11/2026
    for (id, descricao, base) in [("avisar", "B avisar", "2024-12-10"), ("agendado", "C agendado", "2024-11-25"), ("futuro2", "E futuro", "2026-06-01"), ("futuro1", "D futuro", "2026-03-01"), ("atrasado2", "A2 atrasado", "2024-11-10")] {
        recorrencia(&c, id, descricao, 100000, "2025-01-05");
        contrato(&c, id, base, "2026-01-01");
    }
    let hoje = dia("2026-11-01"); // limite do aviso: 11/10 (atrasado2), 21/10 (r), 26/10 (agendado), 10/11 (avisar)
    registrar_reajuste(&c, "agendado", &pedido(json!({ "ciclo": "2026-11-25", "modo": "automatico" })), hoje, None).unwrap();
    let lista = listar_itens(&c, hoje).unwrap();
    let ordem: Vec<_> = lista.as_array().unwrap().iter().map(|i| (i["recorrencia_id"].as_str().unwrap(), i["ciclo_em_foco"]["estado"].as_str().unwrap(), i["ciclo_em_foco"]["ciclo"].as_str().unwrap())).collect();
    assert_eq!(
        ordem,
        [("atrasado2", "atrasado", "2026-11-10"), ("r", "atrasado", "2026-11-20"), ("avisar", "avisar", "2026-12-10"), ("agendado", "agendado", "2026-11-25"), ("futuro1", "futuro", "2027-03-01"), ("futuro2", "futuro", "2027-06-01")]
    );
    let r = &lista[1];
    assert_eq!((r["descricao"].as_str(), r["beneficiario_id"].as_str(), r["beneficiario_nome"].as_str(), r["valor_atual_centavos"].as_i64(), r["ativa"].as_bool()), (Some("Mensalidade Marta"), Some("b1"), Some("Dona Marta"), Some(350000), Some(true)));
    assert!(r.get("ciclos").is_none(), "a lista não traz o histórico de ciclos");
}

#[test]
fn previsto_recebido_com_reajuste_parcial_exclusao_e_pendente() {
    let c = banco();
    c.execute("UPDATE transacao_recorrente SET data_inicio = '2026-08-20' WHERE id = 'r'", []).unwrap();
    recorrencia(&c, "sem-contrato", "Aluguel recebido", 999, "2026-08-01");
    reajustar(&c, "2026-10-10", json!({ "ciclo": "2026-11-20", "modo": "automatico" })).unwrap();
    let tx = c.unchecked_transaction().unwrap();
    materializar(&tx, "r", "2026-08-20", "2026-08-22", true).unwrap(); // recebida inteira, dois dias depois
    let parcial = materializar(&tx, "r", "2026-09-20", "2026-09-20", true).unwrap();
    materializar(&tx, "r", "2026-10-20", "2026-10-20", false).unwrap(); // gerada, ainda pendente
    materializar(&tx, "sem-contrato", "2026-08-01", "2026-08-01", true).unwrap();
    tx.commit().unwrap();
    c.execute("UPDATE transacao SET valor_centavos = 200000 WHERE id = ?1", [&parcial]).unwrap();
    c.execute("INSERT INTO recorrencia_exclusao(transacao_recorrente_id,data_ocorrencia) VALUES('r','2026-12-20')", []).unwrap();

    let quadro = previsto_recebido(&c, dia("2026-08-01"), dia("2027-01-31")).unwrap();
    assert_eq!(quadro["meses"], json!(["2026-08", "2026-09", "2026-10", "2026-11", "2026-12", "2027-01"]));
    assert_eq!(quadro["linhas"].as_array().unwrap().len(), 1, "só recorrências com mensalidade");
    let linha = &quadro["linhas"][0];
    assert_eq!((linha["recorrencia_id"].as_str(), linha["descricao"].as_str(), linha["beneficiario_nome"].as_str()), (Some("r"), Some("Mensalidade Marta"), Some("Dona Marta")));
    let celulas: Vec<_> = linha["meses"].as_array().unwrap().iter().map(|m| (m["mes"].as_str().unwrap(), m["previsto_centavos"].as_i64().unwrap(), m["recebido_centavos"].as_i64().unwrap(), m["em_aberto_centavos"].as_i64().unwrap())).collect();
    assert_eq!(
        celulas,
        [
            ("2026-08", 350000, 350000, 0),      // recebida inteira; conta no mês da ocorrência
            ("2026-09", 350000, 200000, 150000), // recebimento parcial
            ("2026-10", 350000, 0, 350000),      // lançada mas pendente
            ("2026-11", 385000, 0, 385000),      // ainda não lançada, já com o valor reajustado
            ("2026-12", 0, 0, 0),                // ocorrência pulada
            ("2027-01", 385000, 0, 385000),
        ]
    );
    assert_eq!(quadro["totais"], linha["meses"], "com uma linha, os totais são a própria linha");

    // Corte no meio do mês: só entram as ocorrências dentro do período.
    let corte = previsto_recebido(&c, dia("2026-08-21"), dia("2026-09-19")).unwrap();
    assert_eq!(corte["totais"], json!([{ "mes": "2026-08", "previsto_centavos": 0, "recebido_centavos": 0, "em_aberto_centavos": 0 }, { "mes": "2026-09", "previsto_centavos": 0, "recebido_centavos": 0, "em_aberto_centavos": 0 }]));
    // Pausada: o que já foi lançado continua contando; nada novo é esperado.
    c.execute("UPDATE transacao_recorrente SET ativa = 0 WHERE id = 'r'", []).unwrap();
    let pausada = previsto_recebido(&c, dia("2026-08-01"), dia("2027-01-31")).unwrap();
    let previstos: Vec<_> = pausada["totais"].as_array().unwrap().iter().map(|m| m["previsto_centavos"].as_i64().unwrap()).collect();
    assert_eq!(previstos, [350000, 350000, 350000, 0, 0, 0]);

    assert_eq!(desfecho(&previsto_recebido(&c, dia("2026-01-01"), dia("2027-12-31"))), "ok", "24 meses cheios");
    assert_eq!(desfecho(&previsto_recebido(&c, dia("2026-01-01"), dia("2028-01-01"))), "422", "25 meses");
    assert_eq!(desfecho(&previsto_recebido(&c, dia("2026-02-01"), dia("2026-01-31"))), "422");
}

#[test]
fn bloqueio_vale_para_ocorrencia_a_partir_do_ciclo_sem_decisao() {
    let c = banco();
    assert_eq!(ciclo_pendente_ate(&c, "r", dia("2026-11-19")).unwrap(), None, "ocorrência anterior ao ciclo");
    assert_eq!(ciclo_pendente_ate(&c, "r", dia("2026-11-20")).unwrap(), Some(dia("2026-11-20")));
    assert_eq!(ciclo_pendente_ate(&c, "r", dia("2028-01-20")).unwrap(), Some(dia("2026-11-20")), "o mais antigo sem decisão");
    assert_eq!(ciclo_pendente_ate(&c, "r", dia("2025-12-20")).unwrap(), None, "aniversário de 2025 é anterior ao controle");
    recorrencia(&c, "solta", "Sem contrato", 1000, "2025-01-05");
    assert_eq!(ciclo_pendente_ate(&c, "solta", dia("2030-01-05")).unwrap(), None);

    let tx = c.unchecked_transaction().unwrap();
    let pendente = materializar(&tx, "r", "2026-11-20", "2026-11-20", false).unwrap();
    let efetivada = materializar(&tx, "r", "2026-12-20", "2026-12-20", true).unwrap();
    let anterior = materializar(&tx, "r", "2026-10-20", "2026-10-20", false).unwrap();
    tx.commit().unwrap();
    c.execute("INSERT INTO transacao (id, tipo, valor_centavos, data, descricao, espaco, criado_por, status) VALUES ('manual','entrada',100,'2026-11-25','Avulso','pessoal','ana','pendente')", []).unwrap();
    assert_eq!(pendencia_do_lancamento(&c, &pendente).unwrap(), Some(("r".to_string(), dia("2026-11-20"))));
    assert_eq!(pendencia_do_lancamento(&c, &efetivada).unwrap(), None, "já efetivado: nada a barrar");
    assert_eq!(pendencia_do_lancamento(&c, &anterior).unwrap(), None);
    assert_eq!(pendencia_do_lancamento(&c, "manual").unwrap(), None, "lançamento que não veio de recorrência");
    assert_eq!(pendencia_do_lancamento(&c, "nao-existe").unwrap(), None);

    // Reajuste gravado libera, mesmo só agendado; e o ciclo seguinte volta a barrar a partir da data dele.
    reajustar(&c, "2026-11-25", json!({ "ciclo": "2026-11-20", "modo": "automatico" })).unwrap();
    assert_eq!(foco(&c, "2026-11-25")["estado"], "agendado");
    assert_eq!(pendencia_do_lancamento(&c, &pendente).unwrap(), None);
    assert_eq!(ciclo_pendente_ate(&c, "r", dia("2027-11-19")).unwrap(), None);
    assert_eq!(ciclo_pendente_ate(&c, "r", dia("2027-11-20")).unwrap(), Some(dia("2027-11-20")));
    reajustar(&c, "2027-11-25", json!({ "ciclo": "2027-11-20", "modo": "mantido", "motivo": "x" })).unwrap();
    assert_eq!(ciclo_pendente_ate(&c, "r", dia("2027-12-20")).unwrap(), None, "mantido também é decisão");
    // Sem o contrato, nada bloqueia.
    remover_contrato(&c, "r").unwrap();
    assert_eq!(ciclo_pendente_ate(&c, "r", dia("2030-01-20")).unwrap(), None);
}

// ------------------------------------------------------------------------------------------------------------
// Rotas, pelo roteador real
// ------------------------------------------------------------------------------------------------------------

const PNG_1X1: [u8; 70] = [
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0D, 0x49,
    0x44, 0x41, 0x54, 0x78, 0xDA, 0x63, 0xFC, 0xCF, 0xC0, 0x50, 0x0F, 0x00, 0x04, 0x85, 0x01, 0x80, 0x84, 0xA9, 0x8C, 0x21, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
];

struct Ambiente {
    app: Router,
    state: AppState,
    raiz: std::path::PathBuf,
}

impl Drop for Ambiente {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.raiz);
    }
}

fn ambiente() -> Ambiente {
    let raiz = std::env::temp_dir().join(format!("ecos-mensalidades-{}", new_id()));
    let config = Arc::new(Config { porta: 0, db_path: raiz.join("vault/ecos-vault.db"), meta_path: raiz.join("vault/ecos-vault.meta.json"), backups_dir: raiz.join("backups") });
    std::fs::create_dir_all(raiz.join("vault")).unwrap();
    std::fs::create_dir_all(raiz.join("backups")).unwrap();
    let state = AppState { db: VaultDb::trancado(), config };
    Ambiente { app: routes::montar(state.clone()), state, raiz }
}

impl Ambiente {
    async fn pedir(&self, usuario: &str, metodo: &str, uri: &str, corpo: Option<Value>) -> (StatusCode, Value) {
        let mut pedido = Request::builder().method(metodo).uri(uri).header("x-ecos-usuario", usuario);
        let corpo = match corpo {
            Some(c) => {
                pedido = pedido.header("content-type", "application/json");
                Body::from(c.to_string())
            }
            None => Body::empty(),
        };
        self.responder(pedido.body(corpo).unwrap()).await
    }

    async fn responder(&self, pedido: Request<Body>) -> (StatusCode, Value) {
        let resposta = self.app.clone().call(pedido).await.unwrap();
        let status = resposta.status();
        let bytes = to_bytes(resposta.into_body(), 1 << 22).await.unwrap();
        (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
    }

    async fn ok(&self, usuario: &str, metodo: &str, uri: &str, corpo: Option<Value>) -> Value {
        let (status, corpo) = self.pedir(usuario, metodo, uri, corpo).await;
        assert_eq!(status, StatusCode::OK, "{metodo} {uri}: {corpo}");
        corpo
    }

    async fn enviar_comprovante(&self, usuario: &str, transacao_id: &str) -> (StatusCode, Value) {
        let mut corpo = b"--limite\r\nContent-Disposition: form-data; name=\"arquivo\"; filename=\"recibo.png\"\r\nContent-Type: image/png\r\n\r\n".to_vec();
        corpo.extend_from_slice(&PNG_1X1);
        corpo.extend_from_slice(b"\r\n--limite--\r\n");
        let pedido = Request::builder().method("POST").uri(format!("/vault/transacoes/{transacao_id}/anexos")).header("x-ecos-usuario", usuario).header("content-type", "multipart/form-data; boundary=limite");
        self.responder(pedido.body(Body::from(corpo)).unwrap()).await
    }

    async fn ativar(&self, usuario: &str) {
        self.ok(usuario, "POST", "/vault/ativar", Some(json!({ "senha": format!("senha-de-teste-{usuario}-123") }))).await;
    }

    /// Recorrência de entrada mensal e, se pedido, o contrato de mensalidade. Devolve o id da recorrência.
    async fn mensalidade(&self, usuario: &str, descricao: &str, inicio: NaiveDate, contrato: Option<(NaiveDate, NaiveDate)>) -> String {
        let beneficiario = self.ok(usuario, "POST", "/vault/beneficiarios", Some(json!({ "nome": format!("Residente de {descricao}") }))).await;
        let rec = self.ok(usuario, "POST", "/vault/recorrencias", Some(json!({ "tipo": "entrada", "descricao": descricao, "valor_centavos": 350000, "beneficiario_id": beneficiario["id"], "forma_pagamento": "pix", "tipo_recorrencia": "fixa", "data_inicio": inicio.to_string() }))).await;
        let id = rec["id"].as_str().unwrap().to_string();
        if let Some((base, desde)) = contrato {
            self.ok(usuario, "PUT", &format!("/vault/mensalidades/{id}"), Some(json!({ "data_base": base.to_string(), "ciclos_desde": desde.to_string() }))).await;
        }
        id
    }

    async fn sql<T: Send + 'static>(&self, usuario: &str, f: impl FnOnce(&Connection) -> rusqlite::Result<T> + Send + 'static) -> T {
        USUARIO.scope(usuario.to_string(), self.state.db.with(f)).await.unwrap()
    }
}

fn menos_dias(d: NaiveDate, n: u64) -> NaiveDate {
    d.checked_sub_days(Days::new(n)).unwrap()
}

/// Mensalidade cujo ciclo caiu há dez dias e ficou sem decisão, com uma ocorrência há cinco dias (depois do ciclo).
/// Devolve (recorrência, data do ciclo, data da ocorrência).
async fn mensalidade_atrasada(a: &Ambiente, usuario: &str, descricao: &str) -> (String, NaiveDate, NaiveDate) {
    let hoje = hoje_utc();
    let ciclo = menos_dias(hoje, 10);
    let base = ciclo.checked_sub_months(Months::new(24)).unwrap();
    let ocorrencia = menos_dias(hoje, 5);
    let id = a.mensalidade(usuario, descricao, ocorrencia, Some((base, menos_dias(ciclo, 3)))).await;
    (id, ciclo, ocorrencia)
}

fn bloqueado(resposta: &(StatusCode, Value), recorrencia_id: &str, ciclo: NaiveDate) -> bool {
    resposta.0 == StatusCode::CONFLICT && resposta.1["error"] == "MENSALIDADE_REAJUSTE_PENDENTE" && resposta.1["details"] == json!({ "recorrencia_id": recorrencia_id, "ciclo": ciclo.to_string() })
}

#[tokio::test]
async fn rotas_no_caminho_feliz_e_rotas_fixas_nao_sao_engolidas_pela_dinamica() {
    let a = ambiente();
    a.ativar("ana").await;
    assert_eq!(a.ok("ana", "GET", "/vault/mensalidades", None).await, json!([]));
    let hoje = hoje_utc();
    let livre = a.mensalidade("ana", "Mensalidade livre", menos_dias(hoje, 40), None).await;
    let candidatas = a.ok("ana", "GET", "/vault/mensalidades/candidatas", None).await;
    assert_eq!(candidatas.as_array().unwrap().len(), 1);
    assert_eq!((candidatas[0]["recorrencia_id"].as_str(), candidatas[0]["valor_centavos"].as_i64(), candidatas[0]["beneficiario_nome"].as_str()), (Some(livre.as_str()), Some(350000), Some("Residente de Mensalidade livre")));

    // PUT cria; o ciclo de daqui a 100 dias ainda é futuro.
    let ciclo = hoje.checked_add_days(Days::new(100)).unwrap();
    let base = ciclo.checked_sub_months(Months::new(12)).unwrap();
    let criado = a.ok("ana", "PUT", &format!("/vault/mensalidades/{livre}"), Some(json!({ "data_base": base.to_string() }))).await;
    assert_eq!((criado["recorrencia_id"].as_str(), criado["ciclos_desde"].as_str(), criado["ciclo_em_foco"]["estado"].as_str(), criado["ciclo_em_foco"]["ciclo"].as_str()), (Some(livre.as_str()), Some(hoje.to_string().as_str()), Some("futuro"), Some(ciclo.to_string().as_str())));
    assert_eq!(a.ok("ana", "GET", "/vault/mensalidades/candidatas", None).await, json!([]));
    let lista = a.ok("ana", "GET", "/vault/mensalidades", None).await;
    assert_eq!(lista, json!([criado]), "a lista devolve o mesmo item do PUT");
    let detalhe = a.ok("ana", "GET", &format!("/vault/mensalidades/{livre}"), None).await;
    assert_eq!(detalhe["ciclos"].as_array().unwrap().len(), 1);

    // Simular não grava; gravar devolve o id; o detalhe passa a mostrar o reajuste agendado.
    let corpo = json!({ "ciclo": ciclo.to_string(), "modo": "automatico", "igpm_bp": 1234 });
    let mut simulacao = corpo.clone();
    simulacao["simular"] = json!(true);
    let previa = a.ok("ana", "POST", &format!("/vault/mensalidades/{livre}/reajustes"), Some(simulacao)).await;
    assert!(previa["id"].is_null());
    assert_eq!((previa["regra"].as_str(), previa["valor_novo_centavos"].as_i64(), previa["vigente_desde"].as_str()), (Some("igpm"), Some(393190), Some(ciclo.to_string().as_str())));
    let gravado = a.ok("ana", "POST", &format!("/vault/mensalidades/{livre}/reajustes"), Some(corpo.clone())).await;
    assert_eq!((gravado["criado_por"].as_str(), gravado["valor_novo_centavos"].as_i64()), (Some("ana"), Some(393190)));
    assert_eq!(a.pedir("ana", "POST", &format!("/vault/mensalidades/{livre}/reajustes"), Some(corpo)).await.0, StatusCode::CONFLICT);
    let detalhe = a.ok("ana", "GET", &format!("/vault/mensalidades/{livre}"), None).await;
    assert_eq!((detalhe["ciclo_em_foco"]["estado"].as_str(), detalhe["ciclo_em_foco"]["reajuste"]["id"].as_str()), (Some("agendado"), gravado["id"].as_str()));

    let de = hoje.checked_sub_months(Months::new(2)).unwrap();
    let quadro = a.ok("ana", "GET", &format!("/vault/mensalidades/previsto-recebido?data_de={de}&data_ate={hoje}"), None).await;
    assert_eq!((quadro["linhas"].as_array().unwrap().len(), quadro["linhas"][0]["recorrencia_id"].as_str()), (1, Some(livre.as_str())));
    assert_eq!(quadro["meses"].as_array().unwrap().len(), quadro["totais"].as_array().unwrap().len());
    let longe = hoje.checked_add_months(Months::new(30)).unwrap();
    assert_eq!(a.pedir("ana", "GET", &format!("/vault/mensalidades/previsto-recebido?data_de={de}&data_ate={longe}"), None).await.0, StatusCode::UNPROCESSABLE_ENTITY);

    // Recusas do contrato pela rota.
    assert_eq!(a.pedir("ana", "PUT", "/vault/mensalidades/nao-existe", Some(json!({ "data_base": base.to_string() }))).await.0, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(a.pedir("ana", "PUT", &format!("/vault/mensalidades/{livre}"), Some(json!({ "data_base": base.to_string(), "aviso_dias": 181 }))).await.0, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(a.pedir("ana", "GET", "/vault/mensalidades/nao-existe", None).await.0, StatusCode::NOT_FOUND);

    // Remover o reajuste e depois o contrato.
    let id_reajuste = gravado["id"].as_str().unwrap();
    assert_eq!(a.ok("ana", "DELETE", &format!("/vault/mensalidades/reajustes/{id_reajuste}"), None).await, json!({ "ok": true }));
    assert_eq!(a.pedir("ana", "DELETE", &format!("/vault/mensalidades/reajustes/{id_reajuste}"), None).await.0, StatusCode::NOT_FOUND);
    assert_eq!(a.ok("ana", "DELETE", &format!("/vault/mensalidades/{livre}"), None).await, json!({ "ok": true }));
    assert_eq!(a.pedir("ana", "DELETE", &format!("/vault/mensalidades/{livre}"), None).await.0, StatusCode::NOT_FOUND);
    assert_eq!(a.ok("ana", "GET", "/vault/mensalidades", None).await, json!([]));
    // Cofre trancado: 401 como nas outras rotas.
    a.ok("ana", "POST", "/vault/bloquear", None).await;
    assert_eq!(a.pedir("ana", "GET", "/vault/mensalidades", None).await.0, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn bloqueio_em_todas_as_rotas_que_efetivam_e_liberacao_com_ciclo_mantido() {
    let a = ambiente();
    a.ativar("ana").await;
    let (rec, ciclo, ocorrencia) = mensalidade_atrasada(&a, "ana", "Mensalidade Marta").await;
    let item = a.ok("ana", "GET", &format!("/vault/mensalidades/{rec}"), None).await;
    assert_eq!((item["ciclo_em_foco"]["estado"].as_str(), item["ciclo_em_foco"]["ciclo"].as_str(), item["ciclos_sem_decisao"].as_i64()), (Some("atrasado"), Some(ciclo.to_string().as_str()), Some(1)));

    let concluir = json!({ "data_ocorrencia": ocorrencia.to_string(), "data": ocorrencia.to_string() });
    let resposta = a.pedir("ana", "POST", &format!("/vault/recorrencias/{rec}/concluir"), Some(concluir.clone())).await;
    assert!(bloqueado(&resposta, &rec, ciclo), "concluir: {resposta:?}");
    assert_eq!(resposta.1["message"], "Esta mensalidade tem um reajuste sem decisão. Registre o reajuste ou mantenha o valor antes de efetivar.");
    assert_eq!(a.sql("ana", |c| c.query_row("SELECT COUNT(*) FROM transacao", [], |r| r.get::<_, i64>(0))).await, 0, "a recusa não gera lançamento");

    // Só agendar (lançamento pendente) não é barrado; é o que o job faz.
    let mut agendar = concluir.clone();
    agendar["confirmar"] = json!(false);
    let tx = a.ok("ana", "POST", &format!("/vault/recorrencias/{rec}/concluir"), Some(agendar)).await["transacao_id"].as_str().unwrap().to_string();

    let r = a.pedir("ana", "POST", &format!("/vault/recorrencias/{rec}/concluir"), Some(concluir.clone())).await;
    assert!(bloqueado(&r, &rec, ciclo), "concluir lançamento pendente: {r:?}");
    let r = a.pedir("ana", "PATCH", &format!("/vault/transacoes/{tx}/status"), Some(json!({ "status": "efetivada" }))).await;
    assert!(bloqueado(&r, &rec, ciclo), "status: {r:?}");
    let edicao = json!({ "tipo": "entrada", "valor_centavos": 350000, "data": ocorrencia.to_string(), "descricao": "Mensalidade Marta", "forma_pagamento": "pix", "status": "efetivada" });
    let r = a.pedir("ana", "PATCH", &format!("/vault/transacoes/{tx}"), Some(edicao.clone())).await;
    assert!(bloqueado(&r, &rec, ciclo), "edição: {r:?}");
    let r = a.pedir("ana", "POST", "/vault/financeiro/lote", Some(json!({ "ids": [tx], "acao": "efetivar" }))).await;
    assert!(bloqueado(&r, &rec, ciclo), "lote: {r:?}");
    let r = a.enviar_comprovante("ana", &tx).await;
    assert!(bloqueado(&r, &rec, ciclo), "comprovante: {r:?}");
    let (status, anexos): (String, i64) = a.sql("ana", { let tx = tx.clone(); move |c| c.query_row("SELECT status, (SELECT COUNT(*) FROM anexo) FROM transacao WHERE id = ?1", [&tx], |r| Ok((r.get(0)?, r.get(1)?))) }).await;
    assert_eq!((status.as_str(), anexos), ("pendente", 0), "nada foi efetivado nem anexado");

    // O que não efetiva segue livre: manter pendente, editar sem efetivar, outras ações do lote.
    let mut pendente = edicao.clone();
    pendente["status"] = json!("pendente");
    a.ok("ana", "PATCH", &format!("/vault/transacoes/{tx}/status"), Some(json!({ "status": "pendente" }))).await;
    a.ok("ana", "PATCH", &format!("/vault/transacoes/{tx}"), Some(pendente)).await;
    assert_eq!(a.ok("ana", "POST", "/vault/financeiro/lote", Some(json!({ "ids": [tx], "acao": "conciliar" }))).await["aplicadas"], 1);

    // "Manter valor" é decisão: tudo passa.
    a.ok("ana", "POST", &format!("/vault/mensalidades/{rec}/reajustes"), Some(json!({ "ciclo": ciclo.to_string(), "modo": "mantido", "motivo": "Combinado com a família" }))).await;
    a.ok("ana", "PATCH", &format!("/vault/transacoes/{tx}/status"), Some(json!({ "status": "efetivada" }))).await;
    a.ok("ana", "PATCH", &format!("/vault/transacoes/{tx}/status"), Some(json!({ "status": "pendente" }))).await;
    assert_eq!(a.ok("ana", "POST", "/vault/financeiro/lote", Some(json!({ "ids": [tx], "acao": "efetivar" }))).await["aplicadas"], 1);
    a.ok("ana", "PATCH", &format!("/vault/transacoes/{tx}/status"), Some(json!({ "status": "pendente" }))).await;
    assert_eq!(a.enviar_comprovante("ana", &tx).await.0, StatusCode::OK);
    a.ok("ana", "POST", &format!("/vault/recorrencias/{rec}/concluir"), Some(concluir)).await;
}

#[tokio::test]
async fn ciclo_agendado_nao_bloqueia_e_recorrencia_sem_mensalidade_nunca_bloqueia() {
    let a = ambiente();
    a.ativar("ana").await;
    let (rec, ciclo, ocorrencia) = mensalidade_atrasada(&a, "ana", "Mensalidade José").await;
    let concluir = json!({ "data_ocorrencia": ocorrencia.to_string(), "data": ocorrencia.to_string() });
    assert_eq!(a.pedir("ana", "POST", &format!("/vault/recorrencias/{rec}/concluir"), Some(concluir.clone())).await.0, StatusCode::CONFLICT);
    // Aviso hoje: o valor novo só vale daqui a 30 dias. O ciclo fica agendado e já não barra.
    let reajuste = a.ok("ana", "POST", &format!("/vault/mensalidades/{rec}/reajustes"), Some(json!({ "ciclo": ciclo.to_string(), "modo": "automatico" }))).await;
    let item = a.ok("ana", "GET", &format!("/vault/mensalidades/{rec}"), None).await;
    assert_eq!((item["ciclo_em_foco"]["estado"].as_str(), item["valor_atual_centavos"].as_i64()), (Some("agendado"), Some(350000)));
    assert_eq!(reajuste["perda_centavos"], 35000 * item["ciclo_em_foco"]["reajuste"]["perda_centavos"].as_i64().unwrap() / 35000, "a perda do reajuste aparece igual no detalhe");
    let tx = a.ok("ana", "POST", &format!("/vault/recorrencias/{rec}/concluir"), Some(concluir)).await["transacao_id"].as_str().unwrap().to_string();
    let valor: i64 = a.sql("ana", move |c| c.query_row("SELECT valor_centavos FROM transacao WHERE id = ?1", [&tx], |r| r.get(0))).await;
    assert_eq!(valor, 350000, "ocorrência anterior à vigência sai pelo valor antigo");

    // Remover o contrato também tira o bloqueio; e recorrência comum nunca é barrada.
    let (outra, _, ocorrencia) = mensalidade_atrasada(&a, "ana", "Mensalidade Rosa").await;
    let concluir = json!({ "data_ocorrencia": ocorrencia.to_string(), "data": ocorrencia.to_string() });
    assert_eq!(a.pedir("ana", "POST", &format!("/vault/recorrencias/{outra}/concluir"), Some(concluir.clone())).await.0, StatusCode::CONFLICT);
    a.ok("ana", "DELETE", &format!("/vault/mensalidades/{outra}"), None).await;
    a.ok("ana", "POST", &format!("/vault/recorrencias/{outra}/concluir"), Some(concluir)).await;
    let comum = a.mensalidade("ana", "Aluguel recebido", ocorrencia, None).await;
    a.ok("ana", "POST", &format!("/vault/recorrencias/{comum}/concluir"), Some(json!({ "data_ocorrencia": ocorrencia.to_string(), "data": ocorrencia.to_string() }))).await;
}

#[tokio::test]
async fn reajuste_aplicado_muda_a_regra_e_remove_e_recusado_depois_de_lancado_pela_rota() {
    let a = ambiente();
    a.ativar("ana").await;
    let (rec, ciclo, ocorrencia) = mensalidade_atrasada(&a, "ana", "Mensalidade Marta").await;
    // Aviso dado 40 dias atrás: a vigência é o próprio ciclo (há dez dias) e a regra muda na hora.
    let aviso = menos_dias(hoje_utc(), 40);
    let reajuste = a.ok("ana", "POST", &format!("/vault/mensalidades/{rec}/reajustes"), Some(json!({ "ciclo": ciclo.to_string(), "modo": "negociado", "valor_novo_centavos": 380000, "aviso_em": aviso.to_string(), "motivo": "Acordo" }))).await;
    assert_eq!((reajuste["vigente_desde"].as_str(), reajuste["regra"].as_str(), reajuste["percentual_bp"].as_i64()), (Some(ciclo.to_string().as_str()), Some("negociado"), Some(857)));
    let item = a.ok("ana", "GET", &format!("/vault/mensalidades/{rec}"), None).await;
    assert_eq!(item["valor_atual_centavos"], 380000);
    assert_eq!(item["ciclos"][1]["estado"], "aplicado");
    // A ocorrência de cinco dias atrás já sai pelo valor novo; com ela lançada, o reajuste não sai mais.
    let tx = a.ok("ana", "POST", &format!("/vault/recorrencias/{rec}/concluir"), Some(json!({ "data_ocorrencia": ocorrencia.to_string(), "data": ocorrencia.to_string() }))).await["transacao_id"].as_str().unwrap().to_string();
    let valor: i64 = a.sql("ana", move |c| c.query_row("SELECT valor_centavos FROM transacao WHERE id = ?1", [&tx], |r| r.get(0))).await;
    assert_eq!(valor, 380000);
    let id = reajuste["id"].as_str().unwrap();
    let (status, corpo) = a.pedir("ana", "DELETE", &format!("/vault/mensalidades/reajustes/{id}"), None).await;
    assert_eq!((status, corpo["error"].as_str()), (StatusCode::CONFLICT, Some("CONFLICT")));
    // Recusas do POST pela rota: 422 com o código de validação.
    for corpo in [json!({ "ciclo": menos_dias(ciclo, 1).to_string(), "modo": "automatico" }), json!({ "ciclo": ciclo.to_string(), "modo": "negociado", "percentual_bp": 500 })] {
        let (status, r) = a.pedir("ana", "POST", &format!("/vault/mensalidades/{rec}/reajustes"), Some(corpo)).await;
        assert!(status == StatusCode::UNPROCESSABLE_ENTITY || status == StatusCode::CONFLICT, "{r}");
    }
    // Excluir a recorrência leva contrato e histórico.
    a.ok("ana", "DELETE", &format!("/vault/recorrencias/{rec}"), None).await;
    let restos: i64 = a.sql("ana", |c| c.query_row("SELECT (SELECT COUNT(*) FROM mensalidade) + (SELECT COUNT(*) FROM mensalidade_reajuste)", [], |r| r.get(0))).await;
    assert_eq!(restos, 0);
}

#[tokio::test]
async fn cada_dono_so_ve_e_mexe_nas_proprias_mensalidades() {
    let a = ambiente();
    a.ativar("ana").await;
    a.ativar("bia").await;
    let (rec, ciclo, _) = mensalidade_atrasada(&a, "ana", "Mensalidade Marta").await;
    let reajuste = a.ok("ana", "POST", &format!("/vault/mensalidades/{rec}/reajustes"), Some(json!({ "ciclo": ciclo.to_string(), "modo": "automatico" }))).await;
    assert_eq!(reajuste["criado_por"], "ana");
    let id = reajuste["id"].as_str().unwrap();

    assert_eq!(a.ok("bia", "GET", "/vault/mensalidades", None).await, json!([]));
    assert_eq!(a.ok("bia", "GET", "/vault/mensalidades/candidatas", None).await, json!([]));
    assert_eq!(a.pedir("bia", "GET", &format!("/vault/mensalidades/{rec}"), None).await.0, StatusCode::NOT_FOUND);
    assert_eq!(a.pedir("bia", "PUT", &format!("/vault/mensalidades/{rec}"), Some(json!({ "data_base": "2024-01-01" }))).await.0, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(a.pedir("bia", "POST", &format!("/vault/mensalidades/{rec}/reajustes"), Some(json!({ "ciclo": ciclo.to_string(), "modo": "automatico" }))).await.0, StatusCode::NOT_FOUND);
    assert_eq!(a.pedir("bia", "DELETE", &format!("/vault/mensalidades/reajustes/{id}"), None).await.0, StatusCode::NOT_FOUND);
    assert_eq!(a.pedir("bia", "DELETE", &format!("/vault/mensalidades/{rec}"), None).await.0, StatusCode::NOT_FOUND);
    let hoje = hoje_utc();
    assert_eq!(a.ok("bia", "GET", &format!("/vault/mensalidades/previsto-recebido?data_de={hoje}&data_ate={hoje}"), None).await["linhas"], json!([]));
    // Nada mudou no Cofre da Ana; sem cabeçalho de usuário, 401.
    assert_eq!(a.ok("ana", "GET", "/vault/mensalidades", None).await.as_array().unwrap().len(), 1);
    assert_eq!(a.ok("ana", "GET", &format!("/vault/mensalidades/{rec}"), None).await["ciclos"][1]["reajuste"]["id"], id);
    let sem_usuario = a.responder(Request::builder().uri("/vault/mensalidades").body(Body::empty()).unwrap()).await;
    assert_eq!(sem_usuario.0, StatusCode::UNAUTHORIZED);
    // No Cofre de equipe, o dono é a equipe e a autoria é da pessoa.
    a.ativar("eq_casa").await;
    let (rec_eq, ciclo_eq, _) = mensalidade_atrasada(&a, "eq_casa", "Mensalidade da casa").await;
    let pedido = Request::builder().method("POST").uri(format!("/vault/mensalidades/{rec_eq}/reajustes")).header("x-ecos-usuario", "eq_casa").header("x-ecos-autor", "bia").header("content-type", "application/json");
    let (status, r) = a.responder(pedido.body(Body::from(json!({ "ciclo": ciclo_eq.to_string(), "modo": "mantido", "motivo": "x" }).to_string())).unwrap()).await;
    assert_eq!((status, r["criado_por"].as_str()), (StatusCode::OK, Some("bia")));
}

#[tokio::test]
async fn esquema_descido_devolve_409_nas_rotas_de_mensalidade_e_nao_quebra_as_demais() {
    let a = ambiente();
    a.ativar("ana").await;
    let (rec, ciclo, ocorrencia) = mensalidade_atrasada(&a, "ana", "Mensalidade Marta").await;
    // O que `ECOS_VAULT_MIGRAR_ATE=13` deixa: o Cofre aberto, sem as tabelas da 0014.
    a.sql("ana", |c| c.execute_batch(include_str!("../../migrations/0014_mensalidades_down.sql"))).await;

    let corpo_reajuste = json!({ "ciclo": ciclo.to_string(), "modo": "automatico" });
    let hoje = hoje_utc();
    for (metodo, uri, corpo) in [
        ("GET", "/vault/mensalidades".to_string(), None),
        ("GET", "/vault/mensalidades/candidatas".to_string(), None),
        ("GET", format!("/vault/mensalidades/previsto-recebido?data_de={hoje}&data_ate={hoje}"), None),
        ("GET", format!("/vault/mensalidades/{rec}"), None),
        ("PUT", format!("/vault/mensalidades/{rec}"), Some(json!({ "data_base": "2024-01-01" }))),
        ("DELETE", format!("/vault/mensalidades/{rec}"), None),
        ("POST", format!("/vault/mensalidades/{rec}/reajustes"), Some(corpo_reajuste.clone())),
        ("DELETE", "/vault/mensalidades/reajustes/qualquer".to_string(), None),
    ] {
        let (status, corpo) = a.pedir("ana", metodo, &uri, corpo).await;
        assert_eq!((status, corpo["error"].as_str()), (StatusCode::CONFLICT, Some("CONFLICT")), "{metodo} {uri}");
        assert_eq!(corpo["message"], "O Cofre está numa versão anterior do esquema; Mensalidades fica indisponível até a atualização.", "{metodo} {uri}");
    }
    // O resto do Cofre segue como antes das mensalidades: nada bloqueia, o job roda, a recorrência pode ser apagada.
    a.ok("ana", "POST", &format!("/vault/recorrencias/{rec}/concluir"), Some(json!({ "data_ocorrencia": ocorrencia.to_string(), "data": ocorrencia.to_string() }))).await;
    USUARIO.scope("ana".to_string(), crate::jobs::recorrencia::executar(&a.state)).await.unwrap();
    a.ok("ana", "DELETE", &format!("/vault/recorrencias/{rec}"), None).await;
}

#[tokio::test]
async fn job_aplica_vigencia_vencida_gera_pendente_sem_bloqueio_e_reset_limpa_as_tabelas() {
    let a = ambiente();
    a.ativar("ana").await;
    let (rec, ciclo, _) = mensalidade_atrasada(&a, "ana", "Mensalidade Marta").await;
    let comum = a.mensalidade("ana", "Aluguel recebido", menos_dias(hoje_utc(), 5), None).await;
    // Reajuste gravado ontem com vigência hoje (como se o Cofre tivesse ficado trancado na virada).
    a.sql("ana", {
        let (rec, ciclo, hoje) = (rec.clone(), ciclo.to_string(), hoje_utc().to_string());
        move |c| c.execute("INSERT INTO mensalidade_reajuste (id, recorrencia_id, ciclo, valor_anterior_centavos, valor_novo_centavos, regra, aviso_em, vigente_desde) VALUES ('j1', ?1, ?2, 350000, 385000, 'minimo', ?2, ?3)", [rec, ciclo, hoje])
    })
    .await;
    USUARIO.scope("ana".to_string(), crate::jobs::recorrencia::executar(&a.state)).await.unwrap();
    let (valor, valor_comum, geradas, pendentes): (i64, i64, i64, i64) = a
        .sql("ana", {
            let (rec, comum) = (rec.clone(), comum.clone());
            move |c| {
                c.query_row(
                    "SELECT (SELECT valor_centavos FROM transacao_recorrente WHERE id = ?1), (SELECT valor_centavos FROM transacao_recorrente WHERE id = ?2), (SELECT COUNT(*) FROM transacao WHERE transacao_recorrente_id = ?1), (SELECT COUNT(*) FROM transacao WHERE status = 'pendente')",
                    [rec, comum],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                )
            }
        })
        .await;
    assert_eq!((valor, valor_comum), (385000, 350000), "só a recorrência com reajuste muda");
    assert_eq!((geradas, pendentes), (1, 2), "o job gera os lançamentos pendentes das duas");
    let gerado: i64 = a.sql("ana", move |c| c.query_row("SELECT valor_centavos FROM transacao WHERE transacao_recorrente_id = ?1", [rec], |r| r.get(0))).await;
    assert_eq!(gerado, 350000, "ocorrência de cinco dias atrás, anterior à vigência de hoje");

    // E com ciclo sem decisão o job continua gerando (nunca é bloqueado).
    let (pendente, _, _) = mensalidade_atrasada(&a, "ana", "Mensalidade Rosa").await;
    USUARIO.scope("ana".to_string(), crate::jobs::recorrencia::executar(&a.state)).await.unwrap();
    let gerados: i64 = a.sql("ana", move |c| c.query_row("SELECT COUNT(*) FROM transacao WHERE transacao_recorrente_id = ?1 AND status = 'pendente'", [pendente], |r| r.get(0))).await;
    assert_eq!(gerados, 1);

    a.ok("ana", "POST", "/vault/reset", Some(json!({ "confirm": crate::routes::reset::FRASE_CONFIRMACAO }))).await;
    let restos: i64 = a.sql("ana", |c| c.query_row("SELECT (SELECT COUNT(*) FROM mensalidade) + (SELECT COUNT(*) FROM mensalidade_reajuste) + (SELECT COUNT(*) FROM transacao_recorrente)", [], |r| r.get(0))).await;
    assert_eq!(restos, 0);
    assert_eq!(a.ok("ana", "GET", "/vault/mensalidades", None).await, json!([]));
}

#[tokio::test]
async fn valor_da_recorrencia_com_reajuste_nao_e_editavel_a_mao_mas_o_resto_e() {
    let a = ambiente();
    a.ativar("ana").await;
    let (rec, ciclo, _) = mensalidade_atrasada(&a, "ana", "Mensalidade Marta").await;
    let atual = a.ok("ana", "GET", &format!("/vault/recorrencias/{rec}"), None).await;
    let corpo = |valor: i64, descricao: &str| json!({ "tipo": "entrada", "descricao": descricao, "valor_centavos": valor, "beneficiario_id": atual["beneficiario_id"], "forma_pagamento": "pix", "tipo_recorrencia": "fixa", "data_inicio": atual["data_inicio"] });

    // Só com o contrato (sem reajuste), o valor ainda é o da regra e pode ser corrigido.
    assert_eq!(a.ok("ana", "PATCH", &format!("/vault/recorrencias/{rec}"), Some(corpo(360000, "Mensalidade Marta"))).await["valor_centavos"], 360000);
    a.ok("ana", "PATCH", &format!("/vault/recorrencias/{rec}"), Some(corpo(350000, "Mensalidade Marta"))).await;
    // "Mantido" também é reajuste com vigência: daí em diante o histórico manda no valor.
    let mantido = a.ok("ana", "POST", &format!("/vault/mensalidades/{rec}/reajustes"), Some(json!({ "ciclo": ciclo.to_string(), "modo": "mantido", "motivo": "Combinado" }))).await;

    let (status, erro) = a.pedir("ana", "PATCH", &format!("/vault/recorrencias/{rec}"), Some(corpo(400000, "Outro nome"))).await;
    assert_eq!((status, erro["error"].as_str()), (StatusCode::CONFLICT, Some("CONFLICT")));
    assert_eq!(erro["message"], "O valor desta recorrência é controlado pelas Mensalidades. Registre um reajuste para alterá-lo.");
    let depois = a.ok("ana", "GET", &format!("/vault/recorrencias/{rec}"), None).await;
    assert_eq!((depois["valor_centavos"].as_i64(), depois["descricao"].as_str()), (Some(350000), Some("Mensalidade Marta")), "a recusa não grava nenhum campo");

    // Com o valor igual ao atual, os demais campos seguem editáveis.
    let editada = a.ok("ana", "PATCH", &format!("/vault/recorrencias/{rec}"), Some(corpo(350000, "Mensalidade Marta Silva"))).await;
    assert_eq!((editada["valor_centavos"].as_i64(), editada["descricao"].as_str()), (Some(350000), Some("Mensalidade Marta Silva")));
    // Sem reajuste com vigência, volta a ser editável; recorrência comum nunca é afetada.
    a.ok("ana", "DELETE", &format!("/vault/mensalidades/reajustes/{}", mantido["id"].as_str().unwrap()), None).await;
    assert_eq!(a.ok("ana", "PATCH", &format!("/vault/recorrencias/{rec}"), Some(corpo(400000, "Mensalidade Marta"))).await["valor_centavos"], 400000);
    // Esquema descido: nada de mensalidade interfere na edição.
    a.ok("ana", "POST", &format!("/vault/mensalidades/{rec}/reajustes"), Some(json!({ "ciclo": ciclo.to_string(), "modo": "mantido", "motivo": "x" }))).await;
    a.sql("ana", |c| c.execute_batch(include_str!("../../migrations/0014_mensalidades_down.sql"))).await;
    assert_eq!(a.ok("ana", "PATCH", &format!("/vault/recorrencias/{rec}"), Some(corpo(410000, "Mensalidade Marta"))).await["valor_centavos"], 410000);
}

/// Respostas reais de cada rota, para o frontend conferir o contrato. Roda com
/// `cargo test -p ecos-vault-db exemplos_de_resposta -- --ignored --nocapture`.
#[tokio::test]
#[ignore = "gera os exemplos do relatório; não verifica nada"]
async fn exemplos_de_resposta() {
    let a = ambiente();
    a.ativar("ana").await;
    let hoje = hoje_utc();
    let mostrar = |titulo: &str, resposta: &(StatusCode, Value)| println!("\n### {titulo}\nHTTP {}\n{}", resposta.0.as_u16(), serde_json::to_string_pretty(&resposta.1).unwrap());

    let (rec, ciclo, ocorrencia) = mensalidade_atrasada(&a, "ana", "Mensalidade Marta").await;
    let candidata = a.mensalidade("ana", "Mensalidade José", menos_dias(hoje, 70), None).await;
    mostrar("GET /vault/mensalidades/candidatas", &a.pedir("ana", "GET", "/vault/mensalidades/candidatas", None).await);
    let proximo = hoje.checked_add_days(Days::new(40)).unwrap();
    let corpo = json!({ "data_base": proximo.checked_sub_months(Months::new(12)).unwrap().to_string(), "ciclos_desde": hoje.to_string(), "percentual_minimo_bp": 1000, "aviso_dias": 30 });
    println!("\ncorpo do PUT: {corpo}");
    mostrar("PUT /vault/mensalidades/:recorrencia_id (ciclo em 40 dias: estado avisar)", &a.pedir("ana", "PUT", &format!("/vault/mensalidades/{candidata}"), Some(corpo)).await);
    mostrar("GET /vault/mensalidades (um atrasado, um avisar)", &a.pedir("ana", "GET", "/vault/mensalidades", None).await);
    let concluir = json!({ "data_ocorrencia": ocorrencia.to_string(), "data": ocorrencia.to_string() });
    mostrar("POST /vault/recorrencias/:id/concluir com ciclo sem decisão (bloqueio)", &a.pedir("ana", "POST", &format!("/vault/recorrencias/{rec}/concluir"), Some(concluir)).await);
    let corpo = json!({ "ciclo": ciclo.to_string(), "modo": "automatico", "igpm_bp": 652, "simular": true });
    println!("\ncorpo da simulação: {corpo}");
    mostrar("POST /vault/mensalidades/:recorrencia_id/reajustes (simular: true)", &a.pedir("ana", "POST", &format!("/vault/mensalidades/{rec}/reajustes"), Some(corpo)).await);
    let corpo = json!({ "ciclo": ciclo.to_string(), "modo": "negociado", "valor_novo_centavos": 380000, "aviso_em": hoje.to_string(), "motivo": "Acordo com o responsável" });
    println!("\ncorpo do reajuste: {corpo}");
    let gravado = a.pedir("ana", "POST", &format!("/vault/mensalidades/{rec}/reajustes"), Some(corpo.clone())).await;
    mostrar("POST /vault/mensalidades/:recorrencia_id/reajustes (gravado, negociado por valor)", &gravado);
    mostrar("POST de novo no mesmo ciclo (409)", &a.pedir("ana", "POST", &format!("/vault/mensalidades/{rec}/reajustes"), Some(corpo)).await);
    mostrar("POST com motivo ausente (422)", &a.pedir("ana", "POST", &format!("/vault/mensalidades/{candidata}/reajustes"), Some(json!({ "ciclo": proximo.to_string(), "modo": "mantido" }))).await);
    mostrar("GET /vault/mensalidades/:recorrencia_id (com ciclos; reajuste agendado)", &a.pedir("ana", "GET", &format!("/vault/mensalidades/{rec}"), None).await);
    let de = hoje.checked_sub_months(Months::new(1)).unwrap().format("%Y-%m-01").to_string();
    mostrar("GET /vault/mensalidades/previsto-recebido", &a.pedir("ana", "GET", &format!("/vault/mensalidades/previsto-recebido?data_de={de}&data_ate={hoje}"), None).await);
    mostrar("DELETE /vault/mensalidades/reajustes/:id", &a.pedir("ana", "DELETE", &format!("/vault/mensalidades/reajustes/{}", gravado.1["id"].as_str().unwrap()), None).await);
    mostrar("DELETE /vault/mensalidades/:recorrencia_id", &a.pedir("ana", "DELETE", &format!("/vault/mensalidades/{candidata}"), None).await);
    mostrar("GET /vault/mensalidades/:recorrencia_id sem contrato (404)", &a.pedir("ana", "GET", &format!("/vault/mensalidades/{candidata}"), None).await);
    a.sql("ana", |c| c.execute_batch(include_str!("../../migrations/0014_mensalidades_down.sql"))).await;
    mostrar("Qualquer rota de mensalidade com o esquema descido (409)", &a.pedir("ana", "GET", "/vault/mensalidades", None).await);
}
