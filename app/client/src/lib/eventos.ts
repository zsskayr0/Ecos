import { primeiroDiaDaSemana } from "./formato-data";
import type { Evento } from "@/lib/api";

export type Periodo = "semana" | "mes";

function zerarHora(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Janela `[de, ate)` em horário local: semana de 7 dias (começa no domingo ou na segunda, conforme a preferência), ou o mês inteiro. */
export function intervaloDoPeriodo(periodo: Periodo, ancora: Date): { de: Date; ate: Date } {
  if (periodo === "semana") {
    const de = zerarHora(ancora);
    de.setDate(de.getDate() - ((de.getDay() - primeiroDiaDaSemana() + 7) % 7));
    const ate = new Date(de);
    ate.setDate(ate.getDate() + 7);
    return { de, ate };
  }
  return { de: new Date(ancora.getFullYear(), ancora.getMonth(), 1), ate: new Date(ancora.getFullYear(), ancora.getMonth() + 1, 1) };
}

export function deslocarAncora(periodo: Periodo, ancora: Date, passo: 1 | -1): Date {
  const proxima = zerarHora(ancora);
  if (periodo === "semana") proxima.setDate(proxima.getDate() + 7 * passo);
  else {
    // Dia 1 antes de mudar o mês: 31/03 -> "mês anterior" não pode cair em 03/03.
    proxima.setDate(1);
    proxima.setMonth(proxima.getMonth() + passo);
  }
  return proxima;
}

/** `0 -> "0 min"`, `45 -> "45 min"`, `60 -> "1h"`, `150 -> "2h 30min"`. */
export function formatarDuracao(minutos: number): string {
  const total = Math.max(0, Math.round(minutos));
  const horas = Math.floor(total / 60);
  const resto = total % 60;
  if (horas === 0) return `${resto} min`;
  return resto === 0 ? `${horas}h` : `${horas}h ${resto}min`;
}

const DOIS = (n: number) => String(n).padStart(2, "0");

/** Dia local (`YYYY-MM-DD`) de um instante ISO. */
export function chaveDia(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${DOIS(d.getMonth() + 1)}-${DOIS(d.getDate())}`;
}

/** Agrupa pelo dia local de início, dias em ordem e eventos por horário. */
export function agruparPorDia(eventos: Evento[]): { dia: string; eventos: Evento[] }[] {
  const grupos = new Map<string, Evento[]>();
  for (const e of [...eventos].sort((a, b) => a.inicio.localeCompare(b.inicio))) {
    const dia = chaveDia(e.inicio);
    grupos.set(dia, [...(grupos.get(dia) ?? []), e]);
  }
  return [...grupos.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dia, lista]) => ({ dia, eventos: lista }));
}

/** ISO/UTC -> valor de `<input type="datetime-local">` (`YYYY-MM-DDTHH:mm`, horário local). */
export function paraInputLocal(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${DOIS(d.getMonth() + 1)}-${DOIS(d.getDate())}T${DOIS(d.getHours())}:${DOIS(d.getMinutes())}`;
}

/** Valor de `<input type="datetime-local">` -> ISO/UTC. */
export function deInputLocal(valor: string): string {
  return new Date(valor).toISOString();
}

/** ISO/UTC -> `YYYY-MM-DD` local, para `<input type="date">`. */
export function paraInputData(iso: string): string {
  return paraInputLocal(iso).slice(0, 10);
}

/** `YYYY-MM-DD` local -> meia-noite local em ISO/UTC, somando `dias` (fim de um evento de dia inteiro = dia seguinte). */
export function deInputData(valor: string, dias = 0): string {
  const [a, m, d] = valor.split("-").map(Number);
  return new Date(a, m - 1, d + dias).toISOString();
}

/** Percentual de cada item sobre o maior (para as barras; o maior ocupa 100%). */
export function larguraRelativa(minutos: number, maximo: number): number {
  if (maximo <= 0) return 0;
  return Math.max(2, Math.round((minutos / maximo) * 100));
}
