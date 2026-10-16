//! Recorrência de Tarefas: a **regra** (que mora num arquivo de série, separado das ocorrências) e a referência que
//! cada ocorrência (um `.md` de Tarefa comum) guarda no front-matter. Só datas de calendário: o fuso é aplicado por
//! quem converte a data da série em `scheduled_at`. Cada ocorrência é uma Tarefa de verdade, então Tarefas, Agenda e
//! Hoje a enxergam sem nenhum tratamento especial.

use chrono::{Datelike, Duration, NaiveDate, NaiveTime};
use serde::{Deserialize, Serialize};

use crate::types::TarefaPrioridade;

/// Trava contra regra degenerada gerar laço longo demais ao procurar a próxima data.
const LIMITE_BUSCA: i64 = 4000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Frequencia {
    Diaria,
    Semanal,
    Mensal,
    Anual,
}

/// O que fazer num mês que não tem o dia da regra (31 em fevereiro, 29/02 em ano comum).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FimDeMes {
    /// Usa o último dia do mês (padrão).
    #[default]
    Ajustar,
    /// Não gera ocorrência nesse mês.
    Pular,
    /// Sempre o último dia do mês, qualquer que seja o dia inicial.
    UltimoDia,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RegraRecorrencia {
    pub frequencia: Frequencia,
    /// A cada N dias/semanas/meses/anos (>= 1).
    #[serde(default = "um")]
    pub intervalo: u32,
    /// Dias da semana (1 = segunda ... 7 = domingo); só na frequência semanal. Vazio = o dia da data inicial.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub dias_semana: Vec<u8>,
    #[serde(default)]
    pub fim_de_mes: FimDeMes,
    /// Data da primeira ocorrência; as demais são contadas a partir dela.
    pub data_inicio: NaiveDate,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_fim: Option<NaiveDate>,
    /// Total de ocorrências da série (a primeira conta).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_ocorrencias: Option<u32>,
    /// Fuso IANA em que as datas e a hora da série valem.
    pub timezone: String,
}

fn um() -> u32 {
    1
}

impl RegraRecorrencia {
    /// Mensagem do primeiro problema, para o 422 da API.
    pub fn validar(&self) -> Result<(), String> {
        if self.intervalo == 0 || self.intervalo > 999 {
            return Err("o intervalo deve estar entre 1 e 999".into());
        }
        if self.dias_semana.iter().any(|d| !(1..=7).contains(d)) {
            return Err("dias da semana devem ir de 1 (segunda) a 7 (domingo)".into());
        }
        if self.frequencia != Frequencia::Semanal && !self.dias_semana.is_empty() {
            return Err("dias da semana só valem na frequência semanal".into());
        }
        if self.data_fim.is_some_and(|f| f < self.data_inicio) {
            return Err("a data final não pode ser anterior à inicial".into());
        }
        if self.max_ocorrencias == Some(0) {
            return Err("o número máximo de ocorrências deve ser maior que zero".into());
        }
        Ok(())
    }

    /// A data de ocorrência estritamente posterior a `depois`, ou `None` se a regra acabou (`data_fim`). Não olha
    /// `max_ocorrencias`: contar o que já foi gerado é com a série.
    pub fn proxima_depois_de(&self, depois: NaiveDate) -> Option<NaiveDate> {
        let n = self.intervalo.max(1) as i64;
        let ini = self.data_inicio;
        let candidata = match self.frequencia {
            Frequencia::Diaria => {
                let alvo = depois + Duration::days(1);
                if alvo <= ini {
                    Some(ini)
                } else {
                    let passos = ((alvo - ini).num_days() + n - 1) / n;
                    ini.checked_add_signed(Duration::days(passos * n))
                }
            }
            Frequencia::Semanal => self.proxima_semanal(depois, n),
            Frequencia::Mensal => self.proxima_mensal(depois, n, 1),
            Frequencia::Anual => self.proxima_mensal(depois, n, 12),
        }?;
        match self.data_fim {
            Some(fim) if candidata > fim => None,
            _ => Some(candidata),
        }
    }

    fn proxima_semanal(&self, depois: NaiveDate, n: i64) -> Option<NaiveDate> {
        let dias: Vec<u32> = if self.dias_semana.is_empty() {
            vec![self.data_inicio.weekday().number_from_monday()]
        } else {
            self.dias_semana.iter().map(|d| *d as u32).collect()
        };
        let segunda = |d: NaiveDate| d - Duration::days(d.weekday().num_days_from_monday() as i64);
        let base = segunda(self.data_inicio);
        let mut d = std::cmp::max(depois, self.data_inicio - Duration::days(1)) + Duration::days(1);
        for _ in 0..LIMITE_BUSCA {
            let semanas = (segunda(d) - base).num_days() / 7;
            if semanas >= 0 && semanas % n == 0 && dias.contains(&d.weekday().number_from_monday()) {
                return Some(d);
            }
            d += Duration::days(1);
        }
        None
    }

    /// `passo_meses`: 1 (mensal) ou 12 (anual). Os deslocamentos são múltiplos de `n * passo_meses` meses a partir do
    /// mês inicial.
    fn proxima_mensal(&self, depois: NaiveDate, n: i64, passo_meses: i64) -> Option<NaiveDate> {
        let ini = self.data_inicio;
        let indice = |d: NaiveDate| d.year() as i64 * 12 + d.month0() as i64;
        let base = indice(ini);
        let salto = n * passo_meses;
        let desde = (indice(depois) - base).max(0);
        let mut k = (desde / salto) * salto;
        for _ in 0..LIMITE_BUSCA {
            let absoluto = base + k;
            let (ano, mes) = ((absoluto / 12) as i32, (absoluto % 12) as u32 + 1);
            let ultimo = ultimo_dia(ano, mes);
            let dia = match self.fim_de_mes {
                FimDeMes::UltimoDia => Some(ultimo),
                FimDeMes::Ajustar => Some(ini.day().min(ultimo)),
                FimDeMes::Pular => (ini.day() <= ultimo).then_some(ini.day()),
            };
            if let Some(data) = dia.and_then(|d| NaiveDate::from_ymd_opt(ano, mes, d)) {
                if data > depois && data >= ini {
                    return Some(data);
                }
            }
            k += salto;
        }
        None
    }
}

fn ultimo_dia(ano: i32, mes: u32) -> u32 {
    let (a, m) = if mes == 12 { (ano + 1, 1) } else { (ano, mes + 1) };
    NaiveDate::from_ymd_opt(a, m, 1).and_then(|d| d.pred_opt()).map(|d| d.day()).unwrap_or(28)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EstadoSerie {
    #[default]
    Ativa,
    Pausada,
    Encerrada,
}

/// Campos que cada ocorrência nova copia (o "molde" da série). Mudar "esta e as próximas" ou "toda a série" muda o
/// molde; mudar só "esta" ocorrência não.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ModeloSerie {
    pub titulo: String,
    #[serde(default)]
    pub corpo: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_min: Option<i64>,
    #[serde(default)]
    pub prioridade: TarefaPrioridade,
    #[serde(default)]
    pub tags: Vec<String>,
    /// Títulos das subtarefas (cada ocorrência nasce com todas por fazer).
    #[serde(default)]
    pub subtarefas: Vec<String>,
    /// Hora local (no fuso da regra) do `scheduled_at`; ausente = a ocorrência não tem horário.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hora: Option<NaiveTime>,
    /// Dias entre a data da ocorrência e o prazo (`due_date`); ausente = sem prazo.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prazo_apos_dias: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SerieTarefa {
    pub id: String,
    pub regra: RegraRecorrencia,
    #[serde(default)]
    pub estado: EstadoSerie,
    pub modelo: ModeloSerie,
    /// Datas de ocorrência já criadas como Tarefa: é o que torna a geração idempotente — uma data nunca é criada duas
    /// vezes, mesmo que a Tarefa tenha sido concluída, excluída ou reagendada depois.
    #[serde(default)]
    pub geradas: Vec<NaiveDate>,
    /// Datas descartadas: a ocorrência foi pulada/excluída, ou ficou para trás enquanto a série esteve pausada.
    #[serde(default)]
    pub puladas: Vec<NaiveDate>,
}

impl SerieTarefa {
    /// Próxima data a gerar depois de `depois`, respeitando série ativa, `data_fim` e `max_ocorrencias`.
    pub fn proxima_a_gerar(&self, depois: NaiveDate) -> Option<NaiveDate> {
        if self.estado != EstadoSerie::Ativa {
            return None;
        }
        if let Some(max) = self.regra.max_ocorrencias {
            if self.geradas.len() as u32 >= max {
                return None;
            }
        }
        self.regra.proxima_depois_de(depois)
    }
}

/// O que a ocorrência guarda no próprio front-matter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OcorrenciaRef {
    pub serie_id: String,
    /// Data original da ocorrência na série (não muda se a Tarefa for reagendada).
    pub data: NaiveDate,
    /// Editada só "esta": diverge do molde da série.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub excecao: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(a: i32, m: u32, dia: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(a, m, dia).unwrap()
    }

    fn regra(frequencia: Frequencia, inicio: NaiveDate) -> RegraRecorrencia {
        RegraRecorrencia {
            frequencia, intervalo: 1, dias_semana: vec![], fim_de_mes: FimDeMes::Ajustar, data_inicio: inicio,
            data_fim: None, max_ocorrencias: None, timezone: "America/Sao_Paulo".into(),
        }
    }

    fn seq(r: &RegraRecorrencia, n: usize) -> Vec<NaiveDate> {
        let mut out = vec![r.data_inicio];
        while out.len() < n {
            match r.proxima_depois_de(*out.last().unwrap()) {
                Some(p) => out.push(p),
                None => break,
            }
        }
        out
    }

    #[test]
    fn diaria_com_intervalo() {
        let mut r = regra(Frequencia::Diaria, d(2026, 10, 1));
        r.intervalo = 3;
        assert_eq!(seq(&r, 3), vec![d(2026, 10, 1), d(2026, 10, 4), d(2026, 10, 7)]);
    }

    #[test]
    fn semanal_com_varios_dias_e_intervalo_de_duas_semanas() {
        let mut r = regra(Frequencia::Semanal, d(2026, 10, 5)); // segunda
        r.dias_semana = vec![1, 3];
        r.intervalo = 2;
        assert_eq!(seq(&r, 4), vec![d(2026, 10, 5), d(2026, 10, 7), d(2026, 10, 19), d(2026, 10, 21)]);
    }

    #[test]
    fn semanal_sem_dias_usa_o_dia_da_data_inicial() {
        let r = regra(Frequencia::Semanal, d(2026, 10, 8)); // quinta
        assert_eq!(seq(&r, 3), vec![d(2026, 10, 8), d(2026, 10, 15), d(2026, 10, 22)]);
    }

    #[test]
    fn mensal_dia_31_ajusta_pula_ou_usa_ultimo_dia() {
        let mut r = regra(Frequencia::Mensal, d(2026, 1, 31));
        assert_eq!(seq(&r, 4), vec![d(2026, 1, 31), d(2026, 2, 28), d(2026, 3, 31), d(2026, 4, 30)]);
        r.fim_de_mes = FimDeMes::Pular;
        assert_eq!(seq(&r, 3), vec![d(2026, 1, 31), d(2026, 3, 31), d(2026, 5, 31)]);
        r.fim_de_mes = FimDeMes::UltimoDia;
        r.data_inicio = d(2026, 2, 28);
        assert_eq!(seq(&r, 3), vec![d(2026, 2, 28), d(2026, 3, 31), d(2026, 4, 30)]);
    }

    #[test]
    fn anual_29_de_fevereiro() {
        let mut r = regra(Frequencia::Anual, d(2028, 2, 29));
        assert_eq!(seq(&r, 3), vec![d(2028, 2, 29), d(2029, 2, 28), d(2030, 2, 28)]);
        r.fim_de_mes = FimDeMes::Pular;
        assert_eq!(seq(&r, 2), vec![d(2028, 2, 29), d(2032, 2, 29)]);
    }

    #[test]
    fn data_fim_encerra_e_max_ocorrencias_limita_a_serie() {
        let mut r = regra(Frequencia::Diaria, d(2026, 10, 1));
        r.data_fim = Some(d(2026, 10, 3));
        assert_eq!(seq(&r, 10).len(), 3);
        assert_eq!(r.proxima_depois_de(d(2026, 10, 3)), None);

        let mut serie = SerieTarefa {
            id: "s".into(), regra: regra(Frequencia::Diaria, d(2026, 10, 1)), estado: EstadoSerie::Ativa,
            modelo: ModeloSerie { titulo: "x".into(), corpo: String::new(), duration_min: None, prioridade: Default::default(), tags: vec![], subtarefas: vec![], hora: None, prazo_apos_dias: None },
            geradas: vec![d(2026, 10, 1), d(2026, 10, 2)], puladas: vec![],
        };
        serie.regra.max_ocorrencias = Some(2);
        assert_eq!(serie.proxima_a_gerar(d(2026, 10, 2)), None);
        serie.regra.max_ocorrencias = Some(3);
        assert_eq!(serie.proxima_a_gerar(d(2026, 10, 2)), Some(d(2026, 10, 3)));
        serie.estado = EstadoSerie::Pausada;
        assert_eq!(serie.proxima_a_gerar(d(2026, 10, 2)), None);
    }

    #[test]
    fn validacao_recusa_regra_invalida() {
        let mut r = regra(Frequencia::Diaria, d(2026, 10, 1));
        r.intervalo = 0;
        assert!(r.validar().is_err());
        r.intervalo = 1;
        r.dias_semana = vec![8];
        assert!(r.validar().is_err());
        r.dias_semana = vec![];
        r.data_fim = Some(d(2026, 9, 1));
        assert!(r.validar().is_err());
    }
}
