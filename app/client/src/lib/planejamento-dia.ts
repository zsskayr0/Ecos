import type { BlocoPlanejado, TarefaResumo } from "@/lib/api";
import { DURACAO_SEM_DADO_MIN, diaEMinutosLocais } from "@/lib/agenda-tempo";
import type { EventoLocal } from "@/lib/eventos-locais";

/** Uma linha do planejamento do dia. `tarefa` existe quando o item pertence a uma Tarefa (agendada, prazo ou bloco de tempo). */
export interface ItemDoDia {
  chave: string;
  tipo: "tarefa" | "bloco" | "evento" | "prazo";
  titulo: string;
  /** `null` = sem horário (dia todo / só prazo). */
  inicioMin: number | null;
  duracaoMin: number;
  tarefa?: TarefaResumo;
  /** Só em tarefa agendada hoje cujo prazo também é hoje: marca no mesmo item, nunca um segundo item. */
  comPrazo?: boolean;
  /** Só em atrasadas: o dia em que venceu/estava agendada. */
  desde?: string;
  /** Só em `bloco`: o bloco de tempo. Nele, `tarefa` (quando pendente na lista) habilita as ações rápidas. */
  blocoId?: string;
  /** Só em `evento`: a ocorrência local, para abrir o evento correto (inclusive em séries). */
  evento?: EventoLocal;
}

export interface PlanejamentoDoDia {
  atrasadas: ItemDoDia[];
  diaTodo: ItemDoDia[];
  cronograma: ItemDoDia[];
  semHorario: ItemDoDia[];
  total: number;
}

const pesoPrioridade = (t?: TarefaResumo) => (t?.prioridade === "alta" ? 0 : t?.prioridade === "media" ? 1 : 2);

/**
 * Junta tudo o que pesa no dia, cada Tarefa em UM só grupo:
 *  atrasadas (prazo/agendamento antes de hoje) > agendadas hoje (cronograma) > prazo hoje sem horário.
 * Eventos e blocos de tempo entram no cronograma (ou "dia todo"). Prazo hoje + tempo alocado hoje = um item só: o bloco
 * (no cronograma) leva a marca de prazo e o prazo não se repete em "sem horário". Pura: sem relógio, sem rede.
 */
export function montarPlanejamento({ hoje, tarefas, blocos, eventos }: { hoje: string; tarefas: TarefaResumo[]; blocos: BlocoPlanejado[]; eventos: EventoLocal[] }): PlanejamentoDoDia {
  const atrasadas: ItemDoDia[] = [];
  const diaTodo: ItemDoDia[] = [];
  const cronograma: ItemDoDia[] = [];
  const semHorario: ItemDoDia[] = [];
  const pendentes = new Map(tarefas.filter((t) => t.status === "pendente").map((t) => [t.id, t]));
  const blocosDeHoje = blocos.filter((b) => b.tipo === "planejado" && b.status !== "concluida" && diaEMinutosLocais(b.inicio_em).dia === hoje);
  const comTempoHoje = new Set(blocosDeHoje.map((b) => b.tarefa_id));

  for (const t of tarefas) {
    if (t.status !== "pendente") continue;
    const agendada = t.scheduled_at ? diaEMinutosLocais(t.scheduled_at) : null;
    const duracaoMin = t.duration_min && t.duration_min > 0 ? t.duration_min : DURACAO_SEM_DADO_MIN;
    const base = { chave: `tarefa:${t.id}`, titulo: t.titulo, duracaoMin, tarefa: t };
    const vencida = t.due_date && t.due_date < hoje ? t.due_date : null;
    const agendadaAntes = agendada && agendada.dia < hoje ? agendada.dia : null;
    const desde = [vencida, agendadaAntes].filter((d): d is string => !!d).sort()[0];
    if (desde) atrasadas.push({ ...base, tipo: agendada ? "tarefa" : "prazo", inicioMin: agendada?.minutos ?? null, desde });
    else if (agendada && agendada.dia === hoje) cronograma.push({ ...base, tipo: "tarefa", inicioMin: agendada.minutos, comPrazo: t.due_date === hoje });
    else if (t.due_date === hoje && !comTempoHoje.has(t.id)) semHorario.push({ ...base, tipo: "prazo", inicioMin: null });
  }

  for (const b of blocosDeHoje) {
    const tarefa = pendentes.get(b.tarefa_id);
    cronograma.push({
      chave: `bloco:${b.id}`, tipo: "bloco", titulo: b.titulo, inicioMin: diaEMinutosLocais(b.inicio_em).minutos, duracaoMin: b.duracao_min, blocoId: b.id,
      tarefa, comPrazo: tarefa?.due_date === hoje,
    });
  }

  for (const e of eventos) {
    if (e.inicio !== hoje) continue;
    const item: ItemDoDia = { chave: `evento:${e.id}`, tipo: "evento", titulo: e.titulo, inicioMin: e.minutos, duracaoMin: e.duracaoMin, evento: e };
    (e.minutos === null ? diaTodo : cronograma).push(item);
  }

  const porHorario = (a: ItemDoDia, b: ItemDoDia) => (a.inicioMin ?? 0) - (b.inicioMin ?? 0) || a.titulo.localeCompare(b.titulo, "pt-BR");
  const porUrgencia = (a: ItemDoDia, b: ItemDoDia) => pesoPrioridade(a.tarefa) - pesoPrioridade(b.tarefa) || a.titulo.localeCompare(b.titulo, "pt-BR");
  cronograma.sort(porHorario);
  diaTodo.sort((a, b) => a.titulo.localeCompare(b.titulo, "pt-BR"));
  semHorario.sort(porUrgencia);
  atrasadas.sort((a, b) => (a.desde! < b.desde! ? -1 : a.desde! > b.desde! ? 1 : porUrgencia(a, b)));
  return { atrasadas, diaTodo, cronograma, semHorario, total: atrasadas.length + diaTodo.length + cronograma.length + semHorario.length };
}

/**
 * Primeiro horário livre (múltiplo de `passo`) a partir de `apartirDe`, com `duracao` sem encostar em `ocupados`.
 * Devolve `null` se não couber antes da meia-noite.
 */
export function proximoHorarioLivre(ocupados: { inicioMin: number; duracaoMin: number }[], apartirDe: number, duracao: number, passo = 15): number | null {
  const ordenados = [...ocupados].sort((a, b) => a.inicioMin - b.inicioMin);
  let candidato = Math.ceil(apartirDe / passo) * passo;
  for (const o of ordenados) {
    if (o.inicioMin + o.duracaoMin <= candidato) continue;
    if (o.inicioMin >= candidato + duracao) break;
    candidato = Math.ceil((o.inicioMin + o.duracaoMin) / passo) * passo;
  }
  return candidato + duracao <= 24 * 60 ? candidato : null;
}
