// Portado do Nexus: lib/period.ts. Mantém a composição e as interações originais.
/**
 * Seletor de período do topo do app — três formas de escolher um intervalo:
 * mês, ano, ou um intervalo livre (dois pontos num calendário, ou digitado
 * direto). Tudo se resolve para um range de datas ISO (`periodRange`) usado
 * pelas agregações do painel.
 */

export type Period =
  | { kind: "month"; year: number; month: number } // month: 1-12
  | { kind: "year"; year: number }
  | { kind: "range"; from: string; to: string }; // ISO (YYYY-MM-DD)

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];
export const MONTH_ABBR = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
export const WEEKDAY_ABBR = ["D", "S", "T", "Q", "Q", "S", "S"];

export function today(): Date {
  return new Date();
}

export function defaultPeriod(): Period {
  const d = today();
  return { kind: "month", year: d.getFullYear(), month: d.getMonth() + 1 };
}

/** Atalho "Hoje": intervalo de um único dia (data local). */
export function todayPeriod(): Period {
  const d = today();
  const iso = toISO(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return { kind: "range", from: iso, to: iso };
}

export function isTodayPeriod(period: Period): boolean {
  if (period.kind !== "range") return false;
  const t = todayPeriod() as { from: string; to: string };
  return period.from === t.from && period.to === t.to;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function toISO(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function formatBR(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** Converte um Period em {from, to} ISO — usado para filtrar transações. */
export function periodRange(period: Period): { from: string; to: string } {
  if (period.kind === "month") {
    return { from: toISO(period.year, period.month, 1), to: toISO(period.year, period.month, daysInMonth(period.year, period.month)) };
  }
  if (period.kind === "year") {
    return { from: `${period.year}-01-01`, to: `${period.year}-12-31` };
  }
  return { from: period.from, to: period.to };
}

export function periodLabel(period: Period): string {
  if (period.kind === "month") return `${MONTH_NAMES[period.month - 1]} ${period.year}`;
  if (period.kind === "year") return `${period.year}`;
  if (isTodayPeriod(period)) return "Hoje";
  if (period.from === period.to) return formatBR(period.from);
  return `${formatBR(period.from)} – ${formatBR(period.to)}`;
}

/** Rótulo curto usado em textos tipo "Receitas do mês" / "do ano" / "no período". */
export function periodNoun(period: Period): string {
  if (period.kind === "month") return "do mês";
  if (period.kind === "year") return "do ano";
  return "no período";
}

/** "04/09/2026" → "2026-09-04", tolerante (retorna null em vez de lançar). */
export function parseBRDateLenient(value: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!m) return null;
  const [, d, mo, y] = m;
  const day = Number(d), month = Number(mo), year = Number(y);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return toISO(year, month, day);
}

export interface MonthCell {
  iso: string;
  day: number;
  inMonth: boolean;
}

/** Grade de semanas (6x7) pro calendário — inclui os dias de borda do mês anterior/seguinte. */
export function buildMonthGrid(year: number, month: number): MonthCell[] {
  const firstWeekday = new Date(year, month - 1, 1).getDay(); // 0=Dom
  const total = daysInMonth(year, month);
  const prevTotal = daysInMonth(month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1);

  const cells: MonthCell[] = [];
  for (let i = 0; i < firstWeekday; i++) {
    const d = prevTotal - firstWeekday + 1 + i;
    const y = month === 1 ? year - 1 : year;
    const m = month === 1 ? 12 : month - 1;
    cells.push({ iso: toISO(y, m, d), day: d, inMonth: false });
  }
  for (let d = 1; d <= total; d++) {
    cells.push({ iso: toISO(year, month, d), day: d, inMonth: true });
  }
  while (cells.length % 7 !== 0 || cells.length < 42) {
    const last = cells[cells.length - 1]!;
    const [y, m, d] = last.iso.split("-").map(Number);
    const next = new Date(y!, m! - 1, d! + 1);
    cells.push({ iso: toISO(next.getFullYear(), next.getMonth() + 1, next.getDate()), day: next.getDate(), inMonth: false });
    if (cells.length >= 42) break;
  }
  return cells;
}

export interface RowSegment {
  row: number; // 0-5
  colStart: number; // 0-6
  colEnd: number; // 0-6
}

/**
 * Para um range [start, end] sobre uma grade de 42 células (6 semanas x 7
 * dias), devolve um segmento por linha que o range toca — usado pra
 * desenhar uma única barra arredondada por semana, em vez de célula a
 * célula. `start`/`end` podem vir em qualquer ordem.
 */
export function computeRangeRowSegments(grid: MonthCell[], start: string | null, end: string | null): RowSegment[] {
  if (!start || !end) return [];
  const [lo, hi] = start <= end ? [start, end] : [end, start];

  const segments: RowSegment[] = [];
  for (let row = 0; row < 6; row++) {
    let colStart = -1;
    let colEnd = -1;
    for (let col = 0; col < 7; col++) {
      const cell = grid[row * 7 + col];
      if (cell && cell.iso >= lo && cell.iso <= hi) {
        if (colStart === -1) colStart = col;
        colEnd = col;
      }
    }
    if (colStart !== -1) segments.push({ row, colStart, colEnd });
  }
  return segments;
}
