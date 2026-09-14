//! As 4 fórmulas de ranking do Feed (seção 4.1), o desempate de motivo
//! dominante (seção 4.2) e o boost de recência usado por Transação (seção
//! 4.3). Puro cálculo — quem chama decide a cadência (job periódico,
//! seção 4) e onde persistir o resultado (`feed_item`, ver plano de dados).

use crate::types::FeedMotivo;
use chrono::{DateTime, Utc};

/// `max(0, 1 - horas_desde(atualizado_em) / 72)`, sujeita a nunca passar de
/// 1 mesmo com relógio de cliente adiantado.
pub fn frescor(atualizado_em: DateTime<Utc>, agora: DateTime<Utc>) -> f64 {
    let horas = (agora - atualizado_em).num_seconds() as f64 / 3600.0;
    (1.0 - horas / 72.0).clamp(0.0, 1.0)
}

/// `1` se não há nenhum link de entrada nem de saída, senão `0`.
pub fn orfa(contagem_links_entrada: i64, contagem_links_saida: i64) -> f64 {
    if contagem_links_entrada == 0 && contagem_links_saida == 0 {
        1.0
    } else {
        0.0
    }
}

/// `min(1, contagem_acessos_7d / 10)`.
pub fn interacao(contagem_acessos_7d: i64) -> f64 {
    (contagem_acessos_7d.max(0) as f64 / 10.0).min(1.0)
}

/// `min(1, dias_desde(max(ultima_revisao_em, atualizado_em)) / 30)`.
pub fn esquecimento(
    ultima_revisao_em: Option<DateTime<Utc>>,
    atualizado_em: DateTime<Utc>,
    agora: DateTime<Utc>,
) -> f64 {
    let referencia = match ultima_revisao_em {
        Some(revisao) => revisao.max(atualizado_em),
        None => atualizado_em,
    };
    let dias = (agora - referencia).num_seconds() as f64 / 86_400.0;
    (dias / 30.0).clamp(0.0, 1.0)
}

/// Boost de recência de Transação (seção 4.3): mesma fórmula do Frescor,
/// mas sobre `criado_em` — nunca sobre `data`, pra lançamento retroativo não
/// "pular" pro topo do Feed.
pub fn boost_transacao(criado_em: DateTime<Utc>, agora: DateTime<Utc>) -> f64 {
    frescor(criado_em, agora)
}

/// Os 4 scores calculados de uma vez para uma Nota/Tarefa.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Scores {
    pub frescor: f64,
    pub orfa: f64,
    pub interacao: f64,
    pub esquecimento: f64,
}

impl Scores {
    pub fn calcular(
        atualizado_em: DateTime<Utc>,
        ultima_revisao_em: Option<DateTime<Utc>>,
        contagem_links_entrada: i64,
        contagem_links_saida: i64,
        contagem_acessos_7d: i64,
        agora: DateTime<Utc>,
    ) -> Self {
        Self {
            frescor: frescor(atualizado_em, agora),
            orfa: orfa(contagem_links_entrada, contagem_links_saida),
            interacao: interacao(contagem_acessos_7d),
            esquecimento: esquecimento(ultima_revisao_em, atualizado_em, agora),
        }
    }

    /// `motivo = argmax(score)`, com empate resolvido pela prioridade fixa
    /// **Esquecimento > Órfã > Frescor > Interação** (seção 4.2).
    pub fn motivo_dominante(&self) -> (FeedMotivo, f64) {
        let candidatos = [
            (FeedMotivo::Esquecimento, self.esquecimento),
            (FeedMotivo::Orfa, self.orfa),
            (FeedMotivo::Frescor, self.frescor),
            (FeedMotivo::Interacao, self.interacao),
        ];
        candidatos
            .into_iter()
            .fold(candidatos[0], |melhor, atual| if atual.1 > melhor.1 { atual } else { melhor })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    fn agora() -> DateTime<Utc> {
        Utc::now()
    }

    #[test]
    fn frescor_decai_linearmente_ate_72h() {
        let base = agora();
        assert_eq!(frescor(base, base), 1.0);
        assert!((frescor(base - Duration::hours(36), base) - 0.5).abs() < 1e-9);
        assert_eq!(frescor(base - Duration::hours(200), base), 0.0);
    }

    #[test]
    fn orfa_exige_ausencia_dos_dois_lados() {
        assert_eq!(orfa(0, 0), 1.0);
        assert_eq!(orfa(1, 0), 0.0);
        assert_eq!(orfa(0, 1), 0.0);
    }

    #[test]
    fn interacao_satura_em_1() {
        assert_eq!(interacao(0), 0.0);
        assert_eq!(interacao(5), 0.5);
        assert_eq!(interacao(20), 1.0);
    }

    #[test]
    fn esquecimento_usa_revisao_mais_recente_que_atualizacao() {
        let base = agora();
        let atualizado = base - Duration::days(40);
        let revisado_recentemente = base - Duration::days(5);
        // revisão mais recente que a última atualização "reseta" o relógio
        assert!(esquecimento(Some(revisado_recentemente), atualizado, base) < 0.2);
        // sem revisão nenhuma, conta a partir da atualização
        assert_eq!(esquecimento(None, atualizado, base), 1.0);
    }

    #[test]
    fn motivo_dominante_desempata_por_prioridade_fixa() {
        // Frescor e Esquecimento empatados em 1.0 -> Esquecimento vence.
        let scores = Scores {
            frescor: 1.0,
            orfa: 0.0,
            interacao: 0.0,
            esquecimento: 1.0,
        };
        assert_eq!(scores.motivo_dominante().0, FeedMotivo::Esquecimento);

        // Órfã e Frescor empatados, sem Esquecimento -> Órfã vence.
        let scores = Scores {
            frescor: 0.8,
            orfa: 0.8,
            interacao: 0.1,
            esquecimento: 0.0,
        };
        assert_eq!(scores.motivo_dominante().0, FeedMotivo::Orfa);
    }

    #[test]
    fn boost_transacao_usa_a_mesma_curva_do_frescor() {
        let base = agora();
        assert_eq!(boost_transacao(base, base), frescor(base, base));
    }
}
