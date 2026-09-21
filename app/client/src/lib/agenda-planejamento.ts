import type { PrioridadeTarefa, TarefaResumo } from "@/lib/api";
import { diaEMinutosLocais, meioDiaLocal } from "@/lib/agenda-tempo";

/**
 * Regras da visão de planejamento da Quinzenal (cards por dia, sem horas): onde cada tarefa cai, em que ordem, quanto
 * pesa no dia e o que o filtro esconde. Sem React nem DOM, como `agenda-tempo.ts`.
 *
 * Uma tarefa pode ter dois sinais diferentes: `scheduled_at` (um bloco de tempo, com hora) e `due_date` (um prazo, só a
 * data). Ela aparece no dia do bloco e, se o prazo cair em outro dia, também no dia do prazo — mas pesa UMA vez só na
 * carga: no dia do bloco (é ali que o tempo será gasto) ou, sem bloco, no dia do prazo.
 */

export interface EntradaPlano {
  chave: string;
  tarefa: TarefaResumo;
  dia: string;
  /** `bloco` = tempo marcado (`scheduled_at`); `prazo` = só a data limite (`due_date`). */
  tipo: "bloco" | "prazo";
  /** Só em `bloco`: minutos desde 00:00 local. */
  inicioMin: number | null;
  /** O prazo cai no mesmo dia do bloco (marca no próprio card, sem um segundo card). */
  comPrazo: boolean;
  /** `false` na marca de prazo de uma tarefa que já pesa em outro dia. */
  contaNaCarga: boolean;
}

export interface FiltroPlano {
  mostrarConcluidas: boolean;
  prioridade: PrioridadeTarefa | null;
  tag: string | null;
  espaco?: string | null;
}

export const FILTRO_PADRAO: FiltroPlano = { mostrarConcluidas: false, prioridade: null, tag: null, espaco: null };

const PESO_PRIORIDADE: Record<PrioridadeTarefa, number> = { alta: 0, media: 1, baixa: 2 };

export const ROTULO_PRIORIDADE: Record<PrioridadeTarefa, string> = { alta: "Alta", media: "Média", baixa: "Baixa" };

/** Minutos de esforço da tarefa; `null` quando ela não tem estimativa (não entra na soma, é contada à parte). */
export function esforcoMin(t: Pick<TarefaResumo, "duration_min">): number | null {
  return t.duration_min && t.duration_min > 0 ? t.duration_min : null;
}

export function entradasDaTarefa(t: TarefaResumo): EntradaPlano[] {
  const entradas: EntradaPlano[] = [];
  let diaDoBloco: string | null = null;
  if (t.scheduled_at) {
    const { dia, minutos } = diaEMinutosLocais(t.scheduled_at);
    diaDoBloco = dia;
    entradas.push({ chave: `bloco:${t.id}`, tarefa: t, dia, tipo: "bloco", inicioMin: minutos, comPrazo: t.due_date === dia, contaNaCarga: true });
  }
  if (t.due_date && t.due_date !== diaDoBloco) {
    entradas.push({ chave: `prazo:${t.id}`, tarefa: t, dia: t.due_date, tipo: "prazo", inicioMin: null, comPrazo: false, contaNaCarga: diaDoBloco === null });
  }
  return entradas;
}

/** Alta → média → baixa; dentro da prioridade, a mais longa primeiro (é a que mais pesa no dia); depois o título. */
export function compararEntradas(a: EntradaPlano, b: EntradaPlano): number {
  return (
    PESO_PRIORIDADE[a.tarefa.prioridade] - PESO_PRIORIDADE[b.tarefa.prioridade] ||
    (esforcoMin(b.tarefa) ?? 0) - (esforcoMin(a.tarefa) ?? 0) ||
    a.tarefa.titulo.localeCompare(b.tarefa.titulo, "pt-BR")
  );
}

export function passaNoFiltro(t: TarefaResumo, f: FiltroPlano): boolean {
  if (!f.mostrarConcluidas && t.status === "concluida") return false;
  if (f.prioridade && t.prioridade !== f.prioridade) return false;
  if (f.tag && !(t.tags ?? []).includes(f.tag)) return false;
  if (f.espaco && t.espaco !== f.espaco) return false;
  return true;
}

/** Entradas de cada dia visível, já filtradas e ordenadas. Todo dia de `dias` tem uma lista (vazia se não há nada). */
export function agruparPorDia(tarefas: TarefaResumo[], dias: string[], filtro: FiltroPlano): Map<string, EntradaPlano[]> {
  const porDia = new Map<string, EntradaPlano[]>(dias.map((d) => [d, []]));
  for (const t of tarefas) {
    if (!passaNoFiltro(t, filtro)) continue;
    for (const e of entradasDaTarefa(t)) porDia.get(e.dia)?.push(e);
  }
  for (const lista of porDia.values()) lista.sort(compararEntradas);
  return porDia;
}

export interface Carga {
  /** Soma dos esforços estimados que pesam neste dia. */
  minutos: number;
  /** Quantas tarefas do dia não têm estimativa (não entram na soma). */
  semEstimativa: number;
}

/** Carga do dia: tarefas pendentes que pesam nele. Concluída não é trabalho que falta, então não conta (mesmo se visível). */
export function cargaDoDia(entradas: EntradaPlano[]): Carga {
  let minutos = 0;
  let semEstimativa = 0;
  for (const e of entradas) {
    if (!e.contaNaCarga || e.tarefa.status === "concluida") continue;
    const esforco = esforcoMin(e.tarefa);
    if (esforco === null) semEstimativa += 1;
    else minutos += esforco;
  }
  return { minutos, semEstimativa };
}

export type SituacaoCarga = "sem-capacidade" | "ok" | "sobrecarregado";

/**
 * `capacidadeMin === null`: a Rotina não está configurada (ou a capacidade não chegou) — só mostra a carga, sem julgar.
 * Com Rotina, um dia de capacidade 0 (fim de semana livre) que recebeu trabalho é sobrecarga.
 */
export function situacaoDaCarga(minutos: number, capacidadeMin: number | null): SituacaoCarga {
  if (capacidadeMin === null) return "sem-capacidade";
  return minutos > capacidadeMin ? "sobrecarregado" : "ok";
}

/** "10,5 h" (uma casa, vírgula) a partir de 1 h; abaixo disso "45 min". */
export function formatarHoras(min: number): string {
  if (min < 60) return `${Math.round(min)} min`;
  const horas = Math.round(min / 6) / 10;
  return `${String(horas).replace(".", ",")} h`;
}

/** Duração curta para o chip: "2h", "1h30", "45min" (a mesma do resto do app). */
export function duracaoCurta(min: number): string {
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  return resto === 0 ? `${h}h` : `${h}h${String(resto).padStart(2, "0")}`;
}

/** Capacidade de produção de cada dia da semana (0 = domingo) → capacidade do dia `YYYY-MM-DD`. */
export function capacidadeDoDia(dia: string, porDiaDaSemana: ReadonlyMap<number, number>): number | null {
  return porDiaDaSemana.get(meioDiaLocal(dia).getDay()) ?? null;
}

/** Tarefa com o prazo mudado, como o servidor a deixaria (atualização otimista). Mover para um dia nunca mexe em `scheduled_at`. */
export function comPrazoEm(t: TarefaResumo, dia: string | null): TarefaResumo {
  return { ...t, due_date: dia };
}

/** Tarefas para o painel lateral: pendentes que ainda não têm prazo nem bloco de tempo. */
export function tarefasSemData(tarefas: TarefaResumo[], filtro: Pick<FiltroPlano, "prioridade" | "tag" | "espaco">): TarefaResumo[] {
  return tarefas
    .filter((t) => t.status === "pendente" && !t.due_date && !t.scheduled_at && passaNoFiltro(t, { ...filtro, mostrarConcluidas: false }))
    .sort((a, b) => PESO_PRIORIDADE[a.prioridade] - PESO_PRIORIDADE[b.prioridade] || (esforcoMin(b) ?? 0) - (esforcoMin(a) ?? 0) || a.titulo.localeCompare(b.titulo, "pt-BR"));
}

export function tagsDasTarefas(tarefas: TarefaResumo[]): string[] {
  return [...new Set(tarefas.flatMap((t) => t.tags ?? []))].sort((a, b) => a.localeCompare(b, "pt-BR"));
}
