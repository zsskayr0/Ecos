/** Desfazer/refazer da tinta por operação (desenhar, apagar, limpar). Puro, testado em `historico.test.ts`. */
import type { Traco } from "./tipos";

export type Operacao =
  | { tipo: "adicionar"; traco: Traco }
  | { tipo: "apagar"; ids: string[]; em: string }
  /** Borracha por trecho: apaga `ids` e os substitui pelos pedaços que sobraram (`novos`). */
  | { tipo: "substituir"; ids: string[]; novos: Traco[]; em: string };

export interface Historico { feitas: Operacao[]; desfeitas: Operacao[] }

export const LIMITE_HISTORICO = 200;
export const historicoVazio = (): Historico => ({ feitas: [], desfeitas: [] });

export function aplicar(tracos: readonly Traco[], op: Operacao): Traco[] {
  if (op.tipo === "adicionar") return [...tracos, op.traco];
  const alvo = new Set(op.ids);
  const marcados = tracos.map((t) => (alvo.has(t.id) && !t.apagado_em ? { ...t, apagado_em: op.em } : t));
  return op.tipo === "substituir" ? [...marcados, ...op.novos] : marcados;
}

export function reverter(tracos: readonly Traco[], op: Operacao): Traco[] {
  if (op.tipo === "adicionar") return tracos.filter((t) => t.id !== op.traco.id);
  const alvo = new Set(op.ids);
  const novos = op.tipo === "substituir" ? new Set(op.novos.map((t) => t.id)) : null;
  return tracos.filter((t) => !novos?.has(t.id)).map((t) => (alvo.has(t.id) && t.apagado_em === op.em ? { ...t, apagado_em: null } : t));
}

export function registrar(h: Historico, op: Operacao): Historico {
  return { feitas: [...h.feitas, op].slice(-LIMITE_HISTORICO), desfeitas: [] };
}

export function desfazer(h: Historico, tracos: readonly Traco[]): { h: Historico; tracos: Traco[] } | null {
  const op = h.feitas[h.feitas.length - 1];
  if (!op) return null;
  return { h: { feitas: h.feitas.slice(0, -1), desfeitas: [...h.desfeitas, op] }, tracos: reverter(tracos, op) };
}

export function refazer(h: Historico, tracos: readonly Traco[]): { h: Historico; tracos: Traco[] } | null {
  const op = h.desfeitas[h.desfeitas.length - 1];
  if (!op) return null;
  return { h: { feitas: [...h.feitas, op], desfeitas: h.desfeitas.slice(0, -1) }, tracos: aplicar(tracos, op) };
}
