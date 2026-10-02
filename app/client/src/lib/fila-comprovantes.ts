import { useSyncExternalStore } from "react";

/**
 * Comprovantes que chegaram (menu Compartilhar do Android) e esperam o Cofre estar aberto para serem guardados.
 * Ficam **só em memória**: nunca vão para o disco em claro. Se o app for fechado antes do desbloqueio, é só
 * compartilhar de novo. A tela de comprovantes esvazia a fila assim que existe (Cofre aberto).
 */
let itens: File[] = [];
const ouvintes = new Set<() => void>();

function avisar() {
  ouvintes.forEach((o) => o());
}

export function enfileirarComprovantes(arquivos: File[]) {
  if (!arquivos.length) return;
  itens = [...itens, ...arquivos];
  avisar();
}

/** Entrega tudo o que está esperando e zera a fila. */
export function tomarComprovantes(): File[] {
  if (!itens.length) return [];
  const todos = itens;
  itens = [];
  avisar();
  return todos;
}

export function inscreverFila(ouvinte: () => void) {
  ouvintes.add(ouvinte);
  return () => { ouvintes.delete(ouvinte); };
}

export const quantosEsperando = () => itens.length;

/** Quantos comprovantes esperam; re-renderiza quando muda. */
export function useComprovantesEsperando(): number {
  return useSyncExternalStore(inscreverFila, quantosEsperando);
}

/** Só para testes. */
export function limparFilaDeComprovantes() {
  itens = [];
  ouvintes.clear();
}
