import type { FeedItem } from "@/lib/types";

/** Filtros simples da lista: Status, Prioridade e Equipe, mais a ordem. Prioridade e "Concluídas" só existem em tarefas. */

export type FiltroStatus = "pendente" | "concluida" | "todos";
export type FiltroPrioridade = "todas" | "alta" | "media" | "baixa";
export type Ordem = "relevancia" | "edicao" | "criacao" | "titulo" | "prioridade" | "agenda";

export interface EstadoFiltros {
  status: FiltroStatus;
  prioridade: FiltroPrioridade;
  /** `todas`, `pessoal` ou `equipe:<id>` (o mesmo texto do `espaco` do item). */
  equipe: string;
  ordem: Ordem;
}

export const ESTADO_VAZIO: EstadoFiltros = { status: "todos", prioridade: "todas", equipe: "todas", ordem: "relevancia" };

/** Onde há tarefas, as concluídas ficam a um clique de distância em vez de poluir a lista. */
export const estadoInicial = (temTarefas: boolean): EstadoFiltros => (temTarefas ? { ...ESTADO_VAZIO, status: "pendente" } : ESTADO_VAZIO);

export const filtrosAtivos = (e: EstadoFiltros, temTarefas: boolean) =>
  (e.status !== estadoInicial(temTarefas).status ? 1 : 0) + (e.prioridade !== "todas" ? 1 : 0) + (e.equipe !== "todas" ? 1 : 0);

export function filtrar(itens: FeedItem[], e: EstadoFiltros): FeedItem[] {
  return itens.filter((item) => {
    if (e.equipe !== "todas" && item.espaco !== e.equipe) return false;
    // Notas não têm prioridade nem conclusão: escolher uma delas mostra só tarefas. "Pendentes" mantém as notas.
    if (e.prioridade !== "todas" && !(item.tipo === "tarefa" && item.prioridade === e.prioridade)) return false;
    if (e.status === "concluida" && !(item.tipo === "tarefa" && item.status === "concluida")) return false;
    if (e.status === "pendente" && item.tipo === "tarefa" && item.status !== "pendente") return false;
    return true;
  });
}

const PESO_PRIORIDADE = { alta: 0, media: 1, baixa: 2 } as const;
const data = (s?: string | null) => (s ? new Date(s).getTime() || 0 : 0);

/** `relevancia` mantém a ordem que veio (a do ranking do Feed ou a do servidor). Item sem valor vai sempre para o fim. */
export function ordenar(itens: FeedItem[], ordem: Ordem): FeedItem[] {
  if (ordem === "relevancia") return itens;
  const chave = (item: FeedItem): number | string | null => {
    switch (ordem) {
      case "edicao": return data(item.atualizadoEm) || null;
      case "criacao": return data(item.criadoEm) || null;
      case "titulo": return item.titulo.toLocaleLowerCase("pt-BR");
      case "prioridade": return item.tipo === "tarefa" ? PESO_PRIORIDADE[item.prioridade] : null;
      case "agenda": return item.tipo === "tarefa" ? data(item.scheduledAt ?? item.dueDate) || null : null;
    }
  };
  const decrescente = ordem === "edicao" || ordem === "criacao";
  return itens
    .map((item, i) => ({ item, i, k: chave(item) }))
    .sort((a, b) => {
      if (a.k === null || b.k === null) return a.k === b.k ? a.i - b.i : a.k === null ? 1 : -1;
      const c = typeof a.k === "string" ? a.k.localeCompare(b.k as string, "pt-BR") : (a.k as number) - (b.k as number);
      return c === 0 ? a.i - b.i : decrescente ? -c : c;
    })
    .map((x) => x.item);
}
