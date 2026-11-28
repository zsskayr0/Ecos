import type { DragEvent } from "react";

/** Tipo do arrasto nativo (desktop) de um item da Agenda/Timeline para um dia da grade do mês. */
export const TIPO_ARRASTE_MES = "application/x-ecos-item-agenda";

/** O que viaja no arrasto: a chave do item (a mesma na grade e na Timeline) e, de tarefa, o que é preciso para remarcá-la. */
export interface ItemArrastadoMes {
  chave: string;
  /** Tarefa agendada: o instante atual (a hora é mantida no dia novo). */
  scheduledAt?: string | null;
  /** Tarefa só com prazo: o prazo atual. */
  dueDate?: string | null;
}

export function iniciarArrasteMes(e: DragEvent, item: ItemArrastadoMes) {
  e.dataTransfer.setData(TIPO_ARRASTE_MES, JSON.stringify(item));
  e.dataTransfer.effectAllowed = "move";
}

export const temArrasteMes = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes(TIPO_ARRASTE_MES);

export function lerArrasteMes(e: DragEvent): ItemArrastadoMes | null {
  try {
    const bruto = JSON.parse(e.dataTransfer.getData(TIPO_ARRASTE_MES)) as ItemArrastadoMes;
    return typeof bruto?.chave === "string" ? bruto : null;
  } catch { return null; }
}
