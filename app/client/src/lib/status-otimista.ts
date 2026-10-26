import { useSyncExternalStore } from "react";
import type { FeedItem } from "@/lib/types";

export type StatusTarefa = "pendente" | "concluida" | "arquivada";

/**
 * Status "de mentira" aplicado na hora enquanto o servidor ainda não respondeu (Optimistic UI). As listas sobrepõem
 * isto ao que veio do servidor; quando o servidor passa a dizer o mesmo, a sobreposição sai sozinha, e se o pedido
 * falhar quem a criou devolve o `reverter`. Uma validade evita que uma sobreposição esquecida fique para sempre.
 */
const VALIDADE_MS = 15_000;
let mapa: ReadonlyMap<string, StatusTarefa> = new Map();
const ouvintes = new Set<() => void>();
const assinar = (o: () => void) => { ouvintes.add(o); return () => { ouvintes.delete(o); }; };
const publicar = (proximo: Map<string, StatusTarefa>) => { mapa = proximo; ouvintes.forEach((o) => o()); };

export function definirStatusOtimista(ids: readonly string[], status: StatusTarefa): () => void {
  const proximo = new Map(mapa);
  ids.forEach((id) => proximo.set(id, status));
  publicar(proximo);
  const reverter = () => {
    const atual = new Map(mapa);
    let mudou = false;
    ids.forEach((id) => { if (atual.get(id) === status) { atual.delete(id); mudou = true; } });
    if (mudou) publicar(atual);
  };
  window.setTimeout(reverter, VALIDADE_MS);
  return reverter;
}

export const useStatusOtimista = () => useSyncExternalStore(assinar, () => mapa);

/** Sobrepõe os status otimistas às tarefas vindas do servidor. */
export function comStatusOtimista<T extends FeedItem>(itens: readonly T[], sobrepostos: ReadonlyMap<string, StatusTarefa>): readonly T[] {
  if (!sobrepostos.size) return itens;
  return itens.map((item) => (item.tipo === "tarefa" && sobrepostos.has(item.id) && sobrepostos.get(item.id) !== item.status ? { ...item, status: sobrepostos.get(item.id)! } : item));
}

/** O servidor já diz o mesmo que a sobreposição: ela não é mais necessária. */
export function reconciliarStatusOtimista(itens: readonly FeedItem[]) {
  if (!mapa.size) return;
  const proximo = new Map(mapa);
  let mudou = false;
  for (const item of itens) if (item.tipo === "tarefa" && proximo.get(item.id) === item.status) { proximo.delete(item.id); mudou = true; }
  if (mudou) publicar(proximo);
}
