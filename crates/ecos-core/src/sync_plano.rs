//! Planejamento de sincronização entre dois aparelhos pareados (seção 6): a parte **pura** do transporte LAN.
//!
//! Recebe o inventário de cada lado (hash do conteúdo, instante, tombstone e o hash combinado na última sincronização)
//! e devolve o que enviar, receber, remover e o que é conflito. Não faz rede, disco nem criptografia: é o contrato
//! que o transporte futuro vai usar, e é onde estão as garantias que ele precisa:
//!
//! - **Idempotente**: inventários iguais não geram nenhuma ação; repetir um plano já aplicado dá plano vazio, e uma
//!   sincronização interrompida é retomada simplesmente replanejando (o que já chegou aparece como "igual").
//! - **Nada é descartado em silêncio**: se os dois lados mudaram o mesmo item desde a última sincronização, ou um
//!   removeu enquanto o outro editou, o item entra em `conflitos` e a regra é guardar as duas versões (a remota vira
//!   cópia "conflito", a edição vence a remoção). Remoção só é aplicada quando o outro lado **não mudou** o item
//!   (hash igual ao da última sincronização), e aplicada como "mover para a Lixeira", nunca apagar de vez.
//! - **Determinístico**: a saída segue a ordem das chaves, então o mesmo par de inventários dá sempre o mesmo plano.
//!
//! Fora de escopo aqui (decisões pendentes, ver o relatório da task): handshake autenticado e troca de chaves do
//! pareamento, cifra do canal, retomada de bytes parciais, mídia e configurações, e a resolução de conflito que o
//! usuário escolhe na tela (aqui só se sabe que existe).

use std::collections::BTreeMap;

/// Um item (nota, tarefa, mídia) no inventário de um aparelho. A chave do mapa é `espaco/caminho relativo`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EntradaInventario {
    /// Hash do conteúdo atual (ou o último hash conhecido, se `removido`).
    pub hash: String,
    /// Instante da última alteração (RFC 3339). Só informativo para a tela; as decisões usam hash e `base`.
    pub atualizado_em: String,
    /// Tombstone: o item foi removido (foi para a Lixeira) neste aparelho.
    pub removido: bool,
    /// Hash acordado na última sincronização com este par (`None` se nunca sincronizou o item).
    pub base: Option<String>,
}

pub type Inventario = BTreeMap<String, EntradaInventario>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MotivoConflito {
    /// Os dois lados alteraram o item desde a última sincronização (ou não há base para provar quem é mais novo).
    EditadoNosDoisLados,
    /// Um lado removeu e o outro editou: a edição prevalece.
    RemovidoEEditado,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Conflito {
    pub chave: String,
    pub motivo: MotivoConflito,
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Plano {
    /// Itens que só este lado (ou a versão deste lado) tem: mandar ao par.
    pub enviar: Vec<String>,
    /// Itens que só o par (ou a versão dele) tem: buscar no par.
    pub receber: Vec<String>,
    /// Remoção do par a aplicar aqui (mover para a Lixeira).
    pub remover_local: Vec<String>,
    /// Remoção daqui a aplicar no par (mover para a Lixeira).
    pub remover_remoto: Vec<String>,
    /// Itens que exigem guardar as duas versões.
    pub conflitos: Vec<Conflito>,
}

impl Plano {
    pub fn vazio(&self) -> bool {
        self.enviar.is_empty() && self.receber.is_empty() && self.remover_local.is_empty() && self.remover_remoto.is_empty() && self.conflitos.is_empty()
    }
}

/// `local` e `remoto` são os inventários dos dois aparelhos; `base` de cada entrada é lido do aparelho dono dela.
/// Para as decisões de 3 vias usa-se a `base` do lado **local**; o plano do par é o espelho (troca de papéis).
pub fn planejar(local: &Inventario, remoto: &Inventario) -> Plano {
    let mut plano = Plano::default();
    let chaves: std::collections::BTreeSet<&String> = local.keys().chain(remoto.keys()).collect();
    for chave in chaves {
        match (local.get(chave), remoto.get(chave)) {
            (Some(l), None) => {
                if !l.removido {
                    plano.enviar.push(chave.clone());
                }
            }
            (None, Some(r)) => {
                if !r.removido {
                    plano.receber.push(chave.clone());
                }
            }
            (Some(l), Some(r)) => decidir(chave, l, r, &mut plano),
            (None, None) => {}
        }
    }
    plano
}

fn decidir(chave: &str, l: &EntradaInventario, r: &EntradaInventario, plano: &mut Plano) {
    let chave = chave.to_string();
    match (l.removido, r.removido) {
        (true, true) => {}
        (false, false) => {
            if l.hash == r.hash {
                return;
            }
            let base = l.base.as_deref();
            if base == Some(l.hash.as_str()) {
                plano.receber.push(chave); // só o par mudou
            } else if base == Some(r.hash.as_str()) {
                plano.enviar.push(chave); // só este lado mudou
            } else {
                plano.conflitos.push(Conflito { chave, motivo: MotivoConflito::EditadoNosDoisLados });
            }
        }
        (true, false) => {
            // Removido aqui. Só propaga se o par não mexeu desde o acordo; senão a edição vence e vira conflito.
            if l.base.as_deref() == Some(r.hash.as_str()) {
                plano.remover_remoto.push(chave);
            } else {
                plano.conflitos.push(Conflito { chave: chave.clone(), motivo: MotivoConflito::RemovidoEEditado });
                plano.receber.push(chave); // a versão editada volta
            }
        }
        (false, true) => {
            // Removido no par. Aplicar aqui só se este lado não editou desde o acordo.
            if l.base.as_deref() == Some(l.hash.as_str()) {
                plano.remover_local.push(chave);
            } else {
                plano.conflitos.push(Conflito { chave: chave.clone(), motivo: MotivoConflito::RemovidoEEditado });
                plano.enviar.push(chave); // a versão editada volta para o par
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn e(hash: &str, base: Option<&str>) -> EntradaInventario {
        EntradaInventario { hash: hash.into(), atualizado_em: "2026-01-01T00:00:00+00:00".into(), removido: false, base: base.map(str::to_string) }
    }
    fn t(hash: &str, base: Option<&str>) -> EntradaInventario {
        EntradaInventario { removido: true, ..e(hash, base) }
    }
    fn inv(itens: &[(&str, EntradaInventario)]) -> Inventario {
        itens.iter().map(|(k, v)| (k.to_string(), v.clone())).collect()
    }

    #[test]
    fn inventarios_iguais_nao_geram_acao_e_repetir_e_idempotente() {
        let a = inv(&[("p/n1.md", e("h1", Some("h1"))), ("p/n2.md", e("h2", Some("h2")))]);
        assert!(planejar(&a, &a.clone()).vazio());
    }

    #[test]
    fn itens_que_so_um_lado_tem_sao_enviados_ou_recebidos_em_ordem() {
        let l = inv(&[("p/b.md", e("hb", None)), ("p/a.md", e("ha", None))]);
        let r = inv(&[("p/c.md", e("hc", None))]);
        let p = planejar(&l, &r);
        assert_eq!(p.enviar, ["p/a.md", "p/b.md"]);
        assert_eq!(p.receber, ["p/c.md"]);
    }

    #[test]
    fn mudanca_de_um_so_lado_segue_a_base_de_tres_vias() {
        let l = inv(&[("x.md", e("h1", Some("h1"))), ("y.md", e("h2", Some("h1")))]);
        let r = inv(&[("x.md", e("h2", Some("h1"))), ("y.md", e("h1", Some("h1")))]);
        let p = planejar(&l, &r);
        assert_eq!(p.receber, ["x.md"], "o par mudou, este lado não");
        assert_eq!(p.enviar, ["y.md"], "este lado mudou, o par não");
        assert!(p.conflitos.is_empty());
    }

    #[test]
    fn edicao_nos_dois_lados_ou_sem_base_e_conflito_e_nada_e_sobrescrito() {
        let l = inv(&[("x.md", e("hl", Some("h0"))), ("y.md", e("hl", None))]);
        let r = inv(&[("x.md", e("hr", Some("h0"))), ("y.md", e("hr", None))]);
        let p = planejar(&l, &r);
        assert_eq!(p.conflitos.len(), 2);
        assert!(p.conflitos.iter().all(|c| c.motivo == MotivoConflito::EditadoNosDoisLados));
        assert!(p.enviar.is_empty() && p.receber.is_empty() && p.remover_local.is_empty() && p.remover_remoto.is_empty());
    }

    #[test]
    fn remocao_so_propaga_quando_o_outro_lado_nao_mexeu() {
        // Removido aqui, par igual ao acordo: propaga para o par.
        let p = planejar(&inv(&[("x.md", t("h1", Some("h1")))]), &inv(&[("x.md", e("h1", Some("h1")))]));
        assert_eq!(p.remover_remoto, ["x.md"]);
        // Removido no par, este lado intacto: aplica aqui.
        let p = planejar(&inv(&[("x.md", e("h1", Some("h1")))]), &inv(&[("x.md", t("h1", Some("h1")))]));
        assert_eq!(p.remover_local, ["x.md"]);
        // Removido aqui, mas o par editou: a edição vence e é conflito explícito.
        let p = planejar(&inv(&[("x.md", t("h1", Some("h1")))]), &inv(&[("x.md", e("h9", Some("h1")))]));
        assert!(p.remover_remoto.is_empty());
        assert_eq!(p.receber, ["x.md"]);
        assert_eq!(p.conflitos, [Conflito { chave: "x.md".into(), motivo: MotivoConflito::RemovidoEEditado }]);
        // Removido no par, mas este lado editou: a edição volta ao par.
        let p = planejar(&inv(&[("x.md", e("h9", Some("h1")))]), &inv(&[("x.md", t("h1", Some("h1")))]));
        assert!(p.remover_local.is_empty());
        assert_eq!(p.enviar, ["x.md"]);
        assert_eq!(p.conflitos.len(), 1);
    }

    #[test]
    fn tombstone_dos_dois_lados_ou_sem_o_outro_lado_nao_faz_nada() {
        assert!(planejar(&inv(&[("x.md", t("h1", Some("h1")))]), &inv(&[("x.md", t("h1", Some("h1")))])).vazio());
        assert!(planejar(&inv(&[("x.md", t("h1", Some("h1")))]), &Inventario::new()).vazio());
        assert!(planejar(&Inventario::new(), &inv(&[("x.md", t("h1", None))])).vazio());
    }

    #[test]
    fn retomada_apos_interrupcao_replaneja_so_o_que_falta() {
        // Primeiro plano: três itens a receber. A conexão cai depois do primeiro.
        let local0 = inv(&[]);
        let remoto = inv(&[("a.md", e("ha", None)), ("b.md", e("hb", None)), ("c.md", e("hc", None))]);
        assert_eq!(planejar(&local0, &remoto).receber, ["a.md", "b.md", "c.md"]);
        // O que chegou passa a existir (com base acordada); o novo plano só pede o restante.
        let local1 = inv(&[("a.md", e("ha", Some("ha")))]);
        assert_eq!(planejar(&local1, &remoto).receber, ["b.md", "c.md"]);
        // Tudo aplicado: plano vazio.
        let local2 = inv(&[("a.md", e("ha", Some("ha"))), ("b.md", e("hb", Some("hb"))), ("c.md", e("hc", Some("hc")))]);
        assert!(planejar(&local2, &remoto).vazio());
    }
}
