/**
 * Expansão de recorrências (RRULE, RFC 5545) para a Agenda. Cobre o que o Google Calendar gera no dia a dia:
 * DAILY/WEEKLY/MONTHLY/YEARLY com INTERVAL, BYDAY (só semanal), WKST, COUNT e UNTIL. Qualquer outra parte da regra
 * (BYSETPOS, BYMONTHDAY, "2MO"…) devolve `null` em `lerRrule`: quem chama mostra só o evento original em vez de
 * inventar datas erradas.
 *
 * As datas são calculadas no horário LOCAL do navegador, preservando a hora do relógio (um evento das 10:00 continua às
 * 10:00 depois da virada do horário de verão).
 */

export interface RegraRecorrencia {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  intervalo: number;
  /** 0 = domingo. Vazio = o dia da semana do início. */
  diasSemana: number[];
  /** Primeiro dia da semana (0 = domingo); decide de qual semana um dia faz parte quando o intervalo é maior que 1. */
  wkst: number;
  count: number | null;
  /** Último instante (inclusive) em que uma ocorrência pode começar. */
  ate: Date | null;
}

const DIAS: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const SUPORTADAS = new Set(["FREQ", "INTERVAL", "BYDAY", "WKST", "COUNT", "UNTIL"]);
const DIA_MS = 86_400_000;
const MAX_ITERACOES = 6000;

function lerUntil(valor: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/.exec(valor);
  if (!m) return null;
  const [, a, mo, d, h, mi, s, z] = m;
  if (h === undefined) return new Date(Number(a), Number(mo) - 1, Number(d), 23, 59, 59, 999); // só a data: vale o dia todo
  return z ? new Date(Date.UTC(Number(a), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s))) : new Date(Number(a), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
}

/** `null` = regra que não sabemos expandir com segurança. */
export function lerRrule(rrule: string): RegraRecorrencia | null {
  const partes = new Map<string, string>();
  for (const trecho of rrule.trim().replace(/^RRULE:/i, "").split(";")) {
    const [k, v] = trecho.split("=");
    if (!k || v === undefined || v === "") return null;
    partes.set(k.toUpperCase(), v);
  }
  const freq = partes.get("FREQ");
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY" && freq !== "YEARLY") return null;
  for (const k of partes.keys()) if (!SUPORTADAS.has(k)) return null;

  const intervalo = partes.has("INTERVAL") ? Number(partes.get("INTERVAL")) : 1;
  if (!Number.isInteger(intervalo) || intervalo < 1) return null;

  let diasSemana: number[] = [];
  if (partes.has("BYDAY")) {
    if (freq !== "WEEKLY") return null; // "2MO", "-1FR" etc. ficam de fora
    for (const d of partes.get("BYDAY")!.split(",")) {
      if (!(d in DIAS)) return null;
      diasSemana.push(DIAS[d]);
    }
    diasSemana = [...new Set(diasSemana)];
  }

  const wkstTexto = partes.get("WKST") ?? "MO";
  if (!(wkstTexto in DIAS)) return null;

  if (partes.has("COUNT") && partes.has("UNTIL")) return null;
  const count = partes.has("COUNT") ? Number(partes.get("COUNT")) : null;
  if (count !== null && (!Number.isInteger(count) || count < 1)) return null;
  const ate = partes.has("UNTIL") ? lerUntil(partes.get("UNTIL")!) : null;
  if (partes.has("UNTIL") && !ate) return null;

  return { freq, intervalo, diasSemana, wkst: DIAS[wkstTexto], count, ate };
}

/**
 * Inícios das ocorrências que tocam `[de, ate)`, em ordem. Uma ocorrência com `duracaoMs` que começou antes de `de`
 * mas ainda está rolando também entra. `maximo` protege contra regras absurdas.
 */
export function expandir(inicio: Date, regra: RegraRecorrencia, de: Date, ate: Date, duracaoMs = 0, maximo = 1000): Date[] {
  const [ano, mes, dia, h, mi, s] = [inicio.getFullYear(), inicio.getMonth(), inicio.getDate(), inicio.getHours(), inicio.getMinutes(), inicio.getSeconds()];
  const em = (a: number, m: number, d: number) => new Date(a, m, d, h, mi, s);

  const deAjustado = new Date(de.getTime() - duracaoMs);
  const diasAteDe = Math.floor((deAjustado.getTime() - inicio.getTime()) / DIA_MS);
  // Sem COUNT dá para pular direto para perto de `de` (uma série anual de 1990 não precisa de 36 voltas em vão).
  const salto = (unidades: number) => (regra.count === null ? Math.max(0, Math.floor(unidades / regra.intervalo) - 1) : 0);
  let k = 0;
  if (regra.freq === "DAILY") k = salto(diasAteDe);
  else if (regra.freq === "WEEKLY") k = salto(Math.floor(diasAteDe / 7));
  else if (regra.freq === "MONTHLY") k = salto((deAjustado.getFullYear() - ano) * 12 + (deAjustado.getMonth() - mes));
  else k = salto(deAjustado.getFullYear() - ano);

  const offsets = (regra.diasSemana.length ? regra.diasSemana : [inicio.getDay()]).map((d) => (d - regra.wkst + 7) % 7).sort((a, b) => a - b);
  const domingoDaSemana = dia - ((inicio.getDay() - regra.wkst + 7) % 7);

  const doPeriodo = (n: number): Date[] => {
    if (regra.freq === "DAILY") return [em(ano, mes, dia + n * regra.intervalo)];
    if (regra.freq === "WEEKLY") return offsets.map((o) => em(ano, mes, domingoDaSemana + n * 7 * regra.intervalo + o));
    if (regra.freq === "MONTHLY") {
      const total = mes + n * regra.intervalo;
      const alvo = ((total % 12) + 12) % 12;
      const data = em(ano + Math.floor(total / 12), alvo, dia);
      return data.getMonth() === alvo ? [data] : []; // dia 31 num mês de 30: a regra pula o mês
    }
    const data = em(ano + n * regra.intervalo, mes, dia);
    return data.getMonth() === mes ? [data] : []; // 29/02 fora de ano bissexto
  };

  const saida: Date[] = [];
  let contadas = 0;
  for (let it = 0; it < MAX_ITERACOES && saida.length < maximo; it++, k++) {
    for (const o of doPeriodo(k)) {
      if (o < inicio) continue; // dias da primeira semana anteriores ao início não são ocorrências
      contadas++;
      if (regra.count !== null && contadas > regra.count) return saida;
      if (regra.ate && o > regra.ate) return saida;
      if (o >= ate) return saida;
      if (o.getTime() + duracaoMs > de.getTime()) saida.push(o);
    }
  }
  return saida;
}

/**
 * Datas excluídas da série (`EXDATE`). Aceita `EXDATE:20261012T130000Z` (UTC), `EXDATE;TZID=...:20261012T100000` e
 * `EXDATE;VALUE=DATE:20261012`. Sem fuso, vale o relógio LOCAL do navegador (o mesmo em que a série é expandida).
 */
export function lerExdates(linhas: readonly string[]): Date[] {
  const datas: Date[] = [];
  for (const linha of linhas) {
    if (!/^EXDATE[;:]/i.test(linha)) continue;
    const valores = linha.slice(linha.indexOf(":") + 1);
    for (const v of valores.split(",")) {
      const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/.exec(v.trim());
      if (!m) continue;
      const [, a, mo, d, h, mi, s, z] = m.map((x) => x ?? "");
      if (h === "") datas.push(new Date(Number(a), Number(mo) - 1, Number(d)));
      else datas.push(z ? new Date(Date.UTC(Number(a), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s))) : new Date(Number(a), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)));
    }
  }
  return datas;
}
