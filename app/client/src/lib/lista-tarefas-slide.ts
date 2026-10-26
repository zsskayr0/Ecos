import { useSyncExternalStore } from "react";
import type { Tarefa } from "@/lib/types";

/**
 * As tarefas que a lista da tela mostra agora (na ordem e com os filtros escolhidos). O Modo Slide, aberto pelo
 * cabeçalho da janela da tarefa, anda por elas. Fica no módulo porque a janela é outra árvore React.
 */
let atuais: readonly Tarefa[] = [];
const ouvintes = new Set<() => void>();
const assinar = (o: () => void) => { ouvintes.add(o); return () => { ouvintes.delete(o); }; };

export function publicarTarefasDoSlide(proximas: readonly Tarefa[]) {
  if (proximas.length === atuais.length && proximas.every((t, i) => t === atuais[i])) return;
  atuais = proximas;
  ouvintes.forEach((o) => o());
}

export function useTarefasDoSlide(): readonly Tarefa[] {
  return useSyncExternalStore(assinar, () => atuais);
}
