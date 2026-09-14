//! Materialização de ocorrências de `transacao_recorrente` (fixa ou
//! parcelada, seção 1.3) em datas concretas de vencimento. O job periódico
//! do servidor (seção 4.3) usa isto pra gerar linhas de `transacao` com
//! `origem='recorrencia_gerada'`, pulando datas presentes em
//! `recorrencia_exclusao`.

use crate::types::{Frequencia, TipoRecorrencia, TransacaoRecorrente};
use chrono::{Datelike, Months, NaiveDate};
use std::collections::HashSet;

/// Trava de segurança contra configuração inválida (ex. `intervalo <= 0`)
/// gerar um laço efetivamente infinito — nenhuma recorrência de uso pessoal
/// legítimo passa de 10 mil ocorrências.
const LIMITE_OCORRENCIAS: i64 = 10_000;

fn ultimo_dia_do_mes(ano: i32, mes: u32) -> u32 {
    let (prox_ano, prox_mes) = if mes == 12 { (ano + 1, 1) } else { (ano, mes + 1) };
    let primeiro_do_proximo = NaiveDate::from_ymd_opt(prox_ano, prox_mes, 1)
        .expect("ano/mês computados a partir de uma NaiveDate válida sempre são válidos");
    primeiro_do_proximo
        .pred_opt()
        .expect("dia anterior ao dia 1 sempre existe")
        .day()
}

/// Aplica `dia_vencimento` (1–31) ao mês/ano de `data`, saturando pro
/// último dia do mês quando ele não tem esse dia (ex. 31 em fevereiro).
fn ajustar_dia_vencimento(data: NaiveDate, dia_vencimento: Option<i64>) -> NaiveDate {
    let Some(dia) = dia_vencimento else {
        return data;
    };
    let dia = (dia.clamp(1, 31) as u32).min(ultimo_dia_do_mes(data.year(), data.month()));
    NaiveDate::from_ymd_opt(data.year(), data.month(), dia).unwrap_or(data)
}

fn proxima_data(atual: NaiveDate, frequencia: Frequencia, intervalo: i64, dia_vencimento: Option<i64>) -> NaiveDate {
    let passos = intervalo.max(1) as u32;
    let bruta = match frequencia {
        Frequencia::Semanal => atual + chrono::Duration::weeks(passos as i64),
        Frequencia::Mensal => atual.checked_add_months(Months::new(passos)).unwrap_or(atual),
        Frequencia::Anual => atual.checked_add_months(Months::new(passos * 12)).unwrap_or(atual),
    };
    ajustar_dia_vencimento(bruta, dia_vencimento)
}

/// Datas de vencimento de `rec` que já chegaram (`<= ate`) e ainda não foram
/// materializadas (`indice >= parcelas_geradas`), excluindo as que estão em
/// `exclusoes` (seção `recorrencia_exclusao`). Não avança
/// `parcelas_geradas` — isso é responsabilidade de quem persiste o
/// resultado, depois de gravar a `transacao` correspondente.
pub fn ocorrencias_vencidas(
    rec: &TransacaoRecorrente,
    ate: NaiveDate,
    exclusoes: &HashSet<NaiveDate>,
) -> Vec<NaiveDate> {
    if !rec.ativa || rec.intervalo <= 0 {
        return Vec::new();
    }

    let mut resultado = Vec::new();
    let mut indice: i64 = 0;
    let mut atual = ajustar_dia_vencimento(rec.data_inicio, rec.dia_vencimento);

    while indice < LIMITE_OCORRENCIAS {
        if atual > ate {
            break;
        }
        if let Some(fim) = rec.data_fim {
            if atual > fim {
                break;
            }
        }
        if rec.tipo_recorrencia == TipoRecorrencia::Parcelada {
            if let Some(total) = rec.total_parcelas {
                if indice >= total {
                    break;
                }
            }
        }

        if indice >= rec.parcelas_geradas && !exclusoes.contains(&atual) {
            resultado.push(atual);
        }

        indice += 1;
        atual = proxima_data(atual, rec.frequencia, rec.intervalo, rec.dia_vencimento);
    }

    resultado
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Espaco, FormaPagamento, TransacaoTipo};
    use chrono::Utc;

    fn base(frequencia: Frequencia, intervalo: i64, dia_vencimento: Option<i64>) -> TransacaoRecorrente {
        TransacaoRecorrente {
            id: "rec_1".into(),
            tipo: TransacaoTipo::Saida,
            descricao: "Aluguel".into(),
            valor_centavos: 150000,
            categoria_id: None,
            conta_id: None,
            beneficiario_id: None,
            forma_pagamento: Some(FormaPagamento::Pix),
            tipo_recorrencia: TipoRecorrencia::Fixa,
            frequencia,
            intervalo,
            dia_vencimento,
            data_inicio: NaiveDate::from_ymd_opt(2026, 1, 10).unwrap(),
            data_fim: None,
            total_parcelas: None,
            parcelas_geradas: 0,
            observacoes: None,
            espaco: Espaco::Pessoal,
            ativa: true,
            criado_em: Utc::now(),
            atualizado_em: Utc::now(),
        }
    }

    #[test]
    fn mensal_simples_gera_uma_por_mes() {
        let rec = base(Frequencia::Mensal, 1, None);
        let ate = NaiveDate::from_ymd_opt(2026, 4, 1).unwrap();
        let ocorrencias = ocorrencias_vencidas(&rec, ate, &HashSet::new());
        assert_eq!(
            ocorrencias,
            vec![
                NaiveDate::from_ymd_opt(2026, 1, 10).unwrap(),
                NaiveDate::from_ymd_opt(2026, 2, 10).unwrap(),
                NaiveDate::from_ymd_opt(2026, 3, 10).unwrap(),
            ]
        );
    }

    #[test]
    fn dia_vencimento_31_satura_no_ultimo_dia_de_fevereiro() {
        let mut rec = base(Frequencia::Mensal, 1, Some(31));
        rec.data_inicio = NaiveDate::from_ymd_opt(2026, 1, 31).unwrap();
        let ate = NaiveDate::from_ymd_opt(2026, 3, 1).unwrap();
        let ocorrencias = ocorrencias_vencidas(&rec, ate, &HashSet::new());
        assert_eq!(
            ocorrencias,
            vec![
                NaiveDate::from_ymd_opt(2026, 1, 31).unwrap(),
                NaiveDate::from_ymd_opt(2026, 2, 28).unwrap(),
            ]
        );
    }

    #[test]
    fn semanal_com_intervalo_2() {
        let mut rec = base(Frequencia::Semanal, 2, None);
        rec.data_inicio = NaiveDate::from_ymd_opt(2026, 1, 5).unwrap();
        let ate = NaiveDate::from_ymd_opt(2026, 2, 1).unwrap();
        let ocorrencias = ocorrencias_vencidas(&rec, ate, &HashSet::new());
        assert_eq!(
            ocorrencias,
            vec![
                NaiveDate::from_ymd_opt(2026, 1, 5).unwrap(),
                NaiveDate::from_ymd_opt(2026, 1, 19).unwrap(),
            ]
        );
    }

    #[test]
    fn respeita_exclusao_pontual() {
        let rec = base(Frequencia::Mensal, 1, None);
        let ate = NaiveDate::from_ymd_opt(2026, 3, 1).unwrap();
        let mut exclusoes = HashSet::new();
        exclusoes.insert(NaiveDate::from_ymd_opt(2026, 2, 10).unwrap());
        let ocorrencias = ocorrencias_vencidas(&rec, ate, &exclusoes);
        assert_eq!(ocorrencias, vec![NaiveDate::from_ymd_opt(2026, 1, 10).unwrap()]);
    }

    #[test]
    fn pula_ocorrencias_ja_materializadas_via_parcelas_geradas() {
        let mut rec = base(Frequencia::Mensal, 1, None);
        rec.parcelas_geradas = 2; // jan e fev já viraram transacao
        let ate = NaiveDate::from_ymd_opt(2026, 4, 1).unwrap();
        let ocorrencias = ocorrencias_vencidas(&rec, ate, &HashSet::new());
        assert_eq!(ocorrencias, vec![NaiveDate::from_ymd_opt(2026, 3, 10).unwrap()]);
    }

    #[test]
    fn parcelada_para_no_total_de_parcelas() {
        let mut rec = base(Frequencia::Mensal, 1, None);
        rec.tipo_recorrencia = TipoRecorrencia::Parcelada;
        rec.total_parcelas = Some(2);
        let ate = NaiveDate::from_ymd_opt(2026, 12, 1).unwrap();
        let ocorrencias = ocorrencias_vencidas(&rec, ate, &HashSet::new());
        assert_eq!(
            ocorrencias,
            vec![
                NaiveDate::from_ymd_opt(2026, 1, 10).unwrap(),
                NaiveDate::from_ymd_opt(2026, 2, 10).unwrap(),
            ]
        );
    }

    #[test]
    fn recorrencia_inativa_nao_gera_nada() {
        let mut rec = base(Frequencia::Mensal, 1, None);
        rec.ativa = false;
        let ate = NaiveDate::from_ymd_opt(2026, 12, 1).unwrap();
        assert!(ocorrencias_vencidas(&rec, ate, &HashSet::new()).is_empty());
    }
}
