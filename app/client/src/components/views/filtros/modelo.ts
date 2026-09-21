import type { FeedItem } from "@/lib/types";

/** Filtros simples da lista, mais a ordem. Prioridade, "Atrasadas" e "Concluídas" só existem em tarefas. */

export type FiltroStatus = "pendente" | "atrasada" | "concluida" | "todos";
export type FiltroPrioridade = "todas" | "alta" | "media" | "baixa";
export type Ordem = "relevancia" | "edicao" | "criacao" | "titulo" | "prioridade" | "agenda" | "status" | "duracao" | "pasta" | "equipe" | "tags" | "dono";

export interface EstadoFiltros {
  status: FiltroStatus;
  prioridade: FiltroPrioridade;
  /** `todas`, `pessoal` ou `equipe:<id>` (o mesmo texto do `espaco` do item). */
  equipe: string;
  /** Pastas escolhidas (caminho relativo); `""` = itens sem pasta. Vazio = todas. */
  pastas: string[];
  /** Tags escolhidas. Vazio = todas; múltiplas usam correspondência inclusiva (qualquer uma). */
  tags: string[];
  /** Identificadores dos proprietários escolhidos. Vazio = todos. */
  donos: string[];
  ordem: Ordem;
  /** Direção compartilhada entre o menu Ordenar e os cabeçalhos da tabela. */
  ordemDirecao: 1 | -1;
  /** Texto da busca desta lista (vale junto com os demais filtros, só nesta configuração). Vazio = sem busca. */
  busca: string;
}

export const ESTADO_VAZIO: EstadoFiltros = { status: "todos", prioridade: "todas", equipe: "todas", pastas: [], tags: [], donos: [], ordem: "relevancia", ordemDirecao: 1, busca: "" };

/** Onde há tarefas, as concluídas ficam a um clique de distância em vez de poluir a lista. */
export const estadoInicial = (temTarefas: boolean): EstadoFiltros => (temTarefas ? { ...ESTADO_VAZIO, status: "pendente" } : ESTADO_VAZIO);

export const filtrosAtivos = (e: EstadoFiltros, temTarefas: boolean) =>
  (e.status !== estadoInicial(temTarefas).status ? 1 : 0) + (e.prioridade !== "todas" ? 1 : 0) + (e.equipe !== "todas" ? 1 : 0) + (e.pastas.length ? 1 : 0) + (e.tags.length ? 1 : 0) + (e.donos.length ? 1 : 0) + (e.busca?.trim() ? 1 : 0);

/** Pendente e já vencida: horário agendado no passado ou prazo (`dueDate`) antes de hoje. */
export function tarefaAtrasada(item: FeedItem, agora = new Date()): boolean {
  if (item.tipo !== "tarefa" || item.status !== "pendente") return false;
  if (item.scheduledAt) return new Date(item.scheduledAt).getTime() < agora.getTime();
  if (item.dueDate) {
    const hoje = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}-${String(agora.getDate()).padStart(2, "0")}`;
    return item.dueDate.slice(0, 10) < hoje;
  }
  return false;
}

export const pastaDoItem = (item: FeedItem): string => (item.tipo === "nota" ? item.pastaId : item.pasta) ?? "";
export const chaveDoDono = (item: FeedItem): string => item.dono.id ? `id:${item.dono.id}` : `nome:${item.dono.nome.trim().toLocaleLowerCase("pt-BR")}`;

/** Sem acento, sem diferença de maiúscula e sem espaço nas pontas: "Relatório" casa com "relatorio". */
export const normalizarBusca = (texto: string): string => texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();

/** Todos os termos digitados precisam aparecer, cada um em qualquer campo: título, tags, pasta, dono, equipe e, em notas, o texto. */
function correspondeBusca(item: FeedItem, termos: string[]): boolean {
  const campos = [item.titulo, ...(item.tags ?? []), pastaDoItem(item), item.dono.nome, item.origemEquipe?.nome ?? "", item.tipo === "nota" ? `${item.preview} ${item.corpo ?? ""}` : ""];
  const palheiro = normalizarBusca(campos.join("\n"));
  return termos.every((termo) => palheiro.includes(termo));
}

export function filtrar(itens: FeedItem[], e: EstadoFiltros): FeedItem[] {
  const agora = new Date();
  const termos = normalizarBusca(e.busca ?? "").split(/\s+/).filter(Boolean);
  return itens.filter((item) => {
    if (termos.length && !correspondeBusca(item, termos)) return false;
    if (e.equipe !== "todas" && item.espaco !== e.equipe) return false;
    if (e.pastas.length && !e.pastas.includes(pastaDoItem(item))) return false;
    if (e.tags.length && !e.tags.some((tag) => (item.tags ?? []).some((tagDoItem) => tagDoItem.trim().localeCompare(tag, "pt-BR", { sensitivity: "accent" }) === 0))) return false;
    if (e.donos.length && !e.donos.includes(chaveDoDono(item))) return false;
    // Notas não têm prioridade nem conclusão: escolher uma delas mostra só tarefas. "Pendentes" mantém as notas.
    if (e.prioridade !== "todas" && !(item.tipo === "tarefa" && item.prioridade === e.prioridade)) return false;
    if (e.status === "atrasada" && !tarefaAtrasada(item, agora)) return false;
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
      case "status": return item.tipo === "tarefa" ? item.status : null;
      case "duracao": return item.tipo === "tarefa" ? item.durationMin : null;
      case "pasta": return (item.tipo === "nota" ? item.pastaId : item.pasta) ?? "";
      case "equipe": return item.origemEquipe?.nome ?? "Pessoal";
      case "tags": return item.tags?.length ?? 0;
      case "dono": return item.dono.nome.toLocaleLowerCase("pt-BR");
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

export function ordenarComDirecao(itens: FeedItem[], ordem: Ordem, direcao: 1 | -1): FeedItem[] {
  const ordenados = ordenar(itens, ordem);
  if (ordem === "relevancia") return ordenados;
  const direcaoPadrao = ordem === "edicao" || ordem === "criacao" ? -1 : 1;
  return direcao === direcaoPadrao ? ordenados : [...ordenados].reverse();
}
