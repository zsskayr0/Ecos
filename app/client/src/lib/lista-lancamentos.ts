import { useSyncExternalStore } from "react";

/**
 * A lista de lançamentos que a pessoa está vendo (já na ordem e com os filtros escolhidos). O Modo Slide do
 * lançamento anda por ela com as setas. Fica no módulo, não na tela: a janela do lançamento é outra árvore React,
 * e a lista continua valendo mesmo depois que a tela de Transações é fechada.
 */
export interface ResumoDaLista {
  /** Soma (em centavos) das despesas previstas da lista. */
  pagar: number;
  /** Soma (em centavos) das receitas previstas da lista. */
  receber: number;
}

let ids: readonly string[] = [];
let resumo: ResumoDaLista = { pagar: 0, receber: 0 };
const ouvintes = new Set<() => void>();
const assinar = (o: () => void) => { ouvintes.add(o); return () => { ouvintes.delete(o); }; };

export function publicarListaDeLancamentos(proxima: readonly string[], proximoResumo: ResumoDaLista = resumo) {
  const mesmosIds = proxima.length === ids.length && proxima.every((id, i) => id === ids[i]);
  const mesmoResumo = proximoResumo.pagar === resumo.pagar && proximoResumo.receber === resumo.receber;
  if (mesmosIds && mesmoResumo) return;
  if (!mesmosIds) ids = proxima;
  if (!mesmoResumo) resumo = proximoResumo;
  ouvintes.forEach((o) => o());
}

export function useListaDeLancamentos(): readonly string[] {
  return useSyncExternalStore(assinar, () => ids);
}

export function useResumoDaLista(): ResumoDaLista {
  return useSyncExternalStore(assinar, () => resumo);
}
