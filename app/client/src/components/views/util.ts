import type { FeedItem, Nota, PrioridadeTarefa, Tarefa } from "@/lib/types";

export const ehTarefa = (item: FeedItem): item is Tarefa => item.tipo === "tarefa";
export const ehNota = (item: FeedItem): item is Nota => item.tipo === "nota";

export const caminhoDoItem = (item: FeedItem) => (item.tipo === "nota" ? `/notas/nota/${item.id}` : `/tarefa/${item.id}`);

export const pastaDoItem = (item: FeedItem): string | null => (item.tipo === "nota" ? item.pastaId : item.pasta ?? null);
export const tagsDoItem = (item: FeedItem): string[] => (item.tipo === "nota" ? item.tags : item.tags ?? []);

/** Último segmento do caminho da pasta — o nome que a pessoa reconhece. */
export const nomeDaPasta = (pasta: string) => pasta.split("/").filter(Boolean).pop() ?? pasta;

export const ROTULO_PRIORIDADE: Record<PrioridadeTarefa, string> = { baixa: "Baixa", media: "Média", alta: "Alta" };
export const RANKING_PRIORIDADE: Record<PrioridadeTarefa, number> = { alta: 0, media: 1, baixa: 2 };
export const CLASSE_PRIORIDADE: Record<PrioridadeTarefa, string> = {
  alta: "bg-error/15 text-error",
  media: "bg-warning/15 text-warning",
  baixa: "bg-cyan/15 text-cyan",
};

const dois = (n: number) => String(n).padStart(2, "0");

/** Quando a tarefa acontece: data e hora se estiver encaixada na agenda; senão só o prazo. `null` sem nenhum dos dois. */
export function prazoDaTarefa(t: Tarefa): { texto: string; ms: number } | null {
  const agora = new Date();
  if (t.scheduledAt) {
    const d = new Date(t.scheduledAt);
    const dia = `${dois(d.getDate())}/${dois(d.getMonth() + 1)}${d.getFullYear() === agora.getFullYear() ? "" : `/${d.getFullYear()}`}`;
    return { texto: `${dia} - ${dois(d.getHours())}:${dois(d.getMinutes())}`, ms: d.getTime() };
  }
  if (t.dueDate) {
    const [a, m, dia] = t.dueDate.split("-").map(Number);
    if (!a || !m || !dia) return null;
    return { texto: `${dois(dia)}/${dois(m)}${a === agora.getFullYear() ? "" : `/${a}`}`, ms: new Date(a, m - 1, dia).getTime() };
  }
  return null;
}

export const dataCurta = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${d.getFullYear()}`;
};
