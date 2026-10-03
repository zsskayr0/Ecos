import type { OcorrenciaRecorrente, RecorrenciaApi, RecorrenciaPayload } from "@/lib/api";
import { MONTH_ABBR, daysInMonth, toISO, type Period } from "../nexus/period";

/** Uma linha da tela: a ocorrência de uma regra, já casada com a regra e (se houver) com o lançamento. */
export interface LinhaRecorrencia {
  chave: string;
  regra: RecorrenciaApi;
  data: string;
  parcela: number | null;
  transacaoId: string | null;
  efetivada: boolean;
  valorCentavos: number;
  /** Data do lançamento quando ele foi reagendado para outro dia que não o vencimento. */
  reagendadaPara: string | null;
}

export type FiltroTipo = "todas" | "entrada" | "saida";

export const chaveDaOcorrencia = (regraId: string, data: string) => `${regraId}:${data}`;

/** Une as ocorrências do período às regras; ocorrências de regras que sumiram da lista ficam de fora. */
export function montarLinhas(regras: RecorrenciaApi[], ocorrencias: OcorrenciaRecorrente[]): LinhaRecorrencia[] {
  const porId = new Map(regras.map((r) => [r.id, r]));
  const linhas: LinhaRecorrencia[] = [];
  for (const o of ocorrencias) {
    const regra = porId.get(o.recorrencia_id);
    if (!regra) continue;
    linhas.push({
      chave: chaveDaOcorrencia(o.recorrencia_id, o.data),
      regra,
      data: o.data,
      parcela: o.parcela,
      transacaoId: o.transacao_id,
      efetivada: o.status === "efetivada",
      valorCentavos: o.valor_centavos,
      reagendadaPara: o.data_lancamento && o.data_lancamento !== o.data ? o.data_lancamento : null,
    });
  }
  return linhas.sort((a, b) => (a.data === b.data ? a.regra.descricao.localeCompare(b.regra.descricao, "pt-BR") : a.data < b.data ? -1 : 1));
}

export function filtrarPorTipo(linhas: LinhaRecorrencia[], filtro: FiltroTipo): LinhaRecorrencia[] {
  return filtro === "todas" ? linhas : linhas.filter((l) => l.regra.tipo === filtro);
}

/** Dia que a pessoa enxerga na linha: o do lançamento, se foi reagendado, senão o vencimento. */
export const dataExibida = (l: LinhaRecorrencia) => l.reagendadaPara ?? l.data;

// ---------------------------------------------------------------------------
// Baldes do período: dia a dia (mês ou intervalo curto) ou mês a mês (ano ou intervalo longo).
// ---------------------------------------------------------------------------

export interface Balde {
  rotulo: string;
  de: string;
  ate: string;
}

const MS_DIA = 86_400_000;
const diasEntre = (de: string, ate: string) => Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / MS_DIA) + 1;

export function somarDias(iso: string, dias: number): string {
  const d = new Date(Date.parse(`${iso}T12:00:00Z`) + dias * MS_DIA);
  return d.toISOString().slice(0, 10);
}

export function baldesDoPeriodo(period: Period, de: string, ate: string): Balde[] {
  const porDia = period.kind === "month" || (period.kind === "range" && diasEntre(de, ate) <= 62);
  if (porDia) {
    return Array.from({ length: Math.max(0, diasEntre(de, ate)) }, (_, i) => {
      const dia = somarDias(de, i);
      return { rotulo: dia.slice(8), de: dia, ate: dia };
    });
  }
  const baldes: Balde[] = [];
  let [ano, mes] = de.split("-").map(Number) as [number, number];
  const [anoFim, mesFim] = ate.split("-").map(Number) as [number, number];
  while (ano < anoFim || (ano === anoFim && mes <= mesFim)) {
    const inicio = toISO(ano, mes, 1);
    const fim = toISO(ano, mes, daysInMonth(ano, mes));
    baldes.push({ rotulo: MONTH_ABBR[mes - 1]!, de: inicio < de ? de : inicio, ate: fim > ate ? ate : fim });
    if (++mes > 12) { mes = 1; ano++; }
  }
  return baldes;
}

export interface TotalDoBalde {
  rotulo: string;
  de: string;
  entradas: number;
  saidas: number;
}

export function totaisPorBalde(linhas: LinhaRecorrencia[], baldes: Balde[]): TotalDoBalde[] {
  return baldes.map((b) => {
    let entradas = 0;
    let saidas = 0;
    for (const l of linhas) {
      const d = dataExibida(l);
      if (d < b.de || d > b.ate) continue;
      if (l.regra.tipo === "entrada") entradas += l.valorCentavos;
      else saidas += l.valorCentavos;
    }
    return { rotulo: b.rotulo, de: b.de, entradas, saidas };
  });
}

// ---------------------------------------------------------------------------
// Rótulos
// ---------------------------------------------------------------------------

const FREQUENCIA: Record<RecorrenciaApi["frequencia"], [string, string]> = {
  semanal: ["semanal", "semanas"],
  mensal: ["mensal", "meses"],
  anual: ["anual", "anos"],
};

/** "mensal", "a cada 2 meses"… */
export function rotuloFrequencia(r: Pick<RecorrenciaApi, "frequencia" | "intervalo">): string {
  const [singular, plural] = FREQUENCIA[r.frequencia];
  return r.intervalo > 1 ? `a cada ${r.intervalo} ${plural}` : singular;
}

/** Segunda linha de cada ocorrência: "Parcela 3/12" ou "Fixa · mensal". */
export function rotuloDaRegra(l: Pick<LinhaRecorrencia, "regra" | "parcela">): string {
  return l.regra.tipo_recorrencia === "parcelada" ? `Parcela ${l.parcela ?? "?"}/${l.regra.total_parcelas ?? "?"}` : `Fixa · ${rotuloFrequencia(l.regra)}`;
}

/** Data local de hoje (o `hojeISO` do app usa UTC e vira o dia à noite no Brasil). */
export function hojeLocalISO(): string {
  const d = new Date();
  return toISO(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** "1.234,56" / "1234,5" / "12" → centavos; `null` se não for um valor válido (> 0). */
export function centavosDoCampo(texto: string): number | null {
  const limpo = texto.trim().replace(/^R\$\s*/, "");
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(limpo)) return null;
  const [inteiro, frac = ""] = limpo.replace(/\./g, "").split(",");
  const centavos = Number(inteiro) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(centavos) && centavos > 0 ? centavos : null;
}

export const centavosParaCampo = (centavos: number) => (centavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A regra como o servidor espera recebê-la de volta (edição parcial: pausar, reativar). */
export function payloadDaRegra(r: RecorrenciaApi, mudancas: Partial<RecorrenciaPayload> = {}): RecorrenciaPayload {
  return {
    tipo: r.tipo, descricao: r.descricao, valor_centavos: r.valor_centavos, categoria_id: r.categoria_id, conta_id: r.conta_id,
    beneficiario_id: r.beneficiario_id, forma_pagamento: r.forma_pagamento, tipo_recorrencia: r.tipo_recorrencia, frequencia: r.frequencia,
    intervalo: r.intervalo, dia_vencimento: r.dia_vencimento, data_inicio: r.data_inicio, data_fim: r.data_fim, total_parcelas: r.total_parcelas,
    observacoes: r.observacoes, ativa: r.ativa, ...mudancas,
  };
}
