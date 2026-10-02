import type { TransacaoApi } from "@/lib/api";
import { MONTH_ABBR } from "../nexus/period";

export type Tx = Pick<TransacaoApi, "id" | "tipo" | "valor_centavos" | "data" | "status" | "categoria_id" | "conta_id" | "forma_pagamento" | "descricao">;

/** "1.234,56", "-50" ou "0" → centavos. Aceita negativo e zero (saldo inicial pode ser devedor). `null` = texto inválido. */
export function centavosBR(raw: string): number | null {
  const s = raw.trim().replace(/^R\$\s*/, "").replace(/\s/g, "");
  if (s === "") return 0;
  if (!/^-?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(s)) return null;
  const negativo = s.startsWith("-");
  const [inteiro, fracao = ""] = s.replace(/\./g, "").replace(/^-/, "").split(",");
  const n = Number(inteiro) * 100 + Number(fracao.padEnd(2, "0"));
  if (!Number.isSafeInteger(n) || n > 999_999_999_999_999) return null;
  return negativo ? -n : n;
}

/** Centavos → texto editável ("1234,50"; vazio para zero). */
export function centavosParaCampo(c: number): string {
  if (c === 0) return "";
  const abs = Math.abs(c);
  return `${c < 0 ? "-" : ""}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

export interface Resumo {
  entradas: number;
  saidas: number;
  resultado: number;
  /** Lançamentos efetivados no período. */
  lancamentos: number;
  ticketSaida: number;
  maiorSaida: Tx | null;
  maiorEntrada: Tx | null;
  /** Pendentes (ainda não efetivados) no período. */
  pendentesEntrada: number;
  pendentesSaida: number;
  /** (entradas − saídas) / entradas, em %; `null` sem entradas. */
  taxaEconomia: number | null;
  mediaDiariaSaida: number;
}

function diasEntre(de: string, ate: string): number {
  return Math.max(1, Math.round((new Date(`${ate}T12:00:00`).getTime() - new Date(`${de}T12:00:00`).getTime()) / 86_400_000) + 1);
}

export function resumir(txs: Tx[], de: string, ate: string): Resumo {
  let entradas = 0, saidas = 0, nSaidas = 0, lancamentos = 0, pendentesEntrada = 0, pendentesSaida = 0;
  let maiorSaida: Tx | null = null, maiorEntrada: Tx | null = null;
  for (const t of txs) {
    if (t.data < de || t.data > ate) continue;
    if (t.status === "pendente") {
      if (t.tipo === "entrada") pendentesEntrada += t.valor_centavos; else pendentesSaida += t.valor_centavos;
      continue;
    }
    lancamentos++;
    if (t.tipo === "entrada") {
      entradas += t.valor_centavos;
      if (!maiorEntrada || t.valor_centavos > maiorEntrada.valor_centavos) maiorEntrada = t;
    } else {
      saidas += t.valor_centavos;
      nSaidas++;
      if (!maiorSaida || t.valor_centavos > maiorSaida.valor_centavos) maiorSaida = t;
    }
  }
  return {
    entradas, saidas, resultado: entradas - saidas, lancamentos,
    ticketSaida: nSaidas ? Math.round(saidas / nSaidas) : 0,
    maiorSaida, maiorEntrada, pendentesEntrada, pendentesSaida,
    taxaEconomia: entradas > 0 ? ((entradas - saidas) / entradas) * 100 : null,
    mediaDiariaSaida: Math.round(saidas / diasEntre(de, ate)),
  };
}

/** Variação percentual; `null` quando não há base de comparação. */
export function variacao(atual: number, anterior: number): number | null {
  return anterior > 0 ? ((atual - anterior) / anterior) * 100 : null;
}

export interface PontoSaldo {
  chave: string;
  rotulo: string;
  entradas: number;
  saidas: number;
  /** Saldo no fim do balde. */
  saldo: number;
}

const sinal = (t: Tx) => (t.tipo === "entrada" ? t.valor_centavos : -t.valor_centavos);

/**
 * Evolução do saldo no período. O saldo no início é o saldo atual menos tudo que foi efetivado de `de` em diante
 * (o servidor soma todas as efetivadas, inclusive as com data futura, então este cálculo bate com ele).
 * Até ~3 meses mostra um ponto por dia; acima disso, um por mês.
 */
export function serieSaldo(txs: Tx[], saldoAtual: number, de: string, ate: string): PontoSaldo[] {
  const efetivadas = txs.filter((t) => t.status !== "pendente");
  const aposInicio = efetivadas.filter((t) => t.data >= de).reduce((s, t) => s + sinal(t), 0);
  let saldo = saldoAtual - aposInicio;
  const mensal = diasEntre(de, ate) > 92;

  const chaveDe = (iso: string) => (mensal ? iso.slice(0, 7) : iso);
  const baldes = new Map<string, { entradas: number; saidas: number }>();
  const d = new Date(`${de}T12:00:00`);
  const fim = new Date(`${ate}T12:00:00`);
  for (; d <= fim; d.setDate(d.getDate() + 1)) {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const k = chaveDe(iso);
    if (!baldes.has(k)) baldes.set(k, { entradas: 0, saidas: 0 });
  }
  for (const t of efetivadas) {
    if (t.data < de || t.data > ate) continue;
    const b = baldes.get(chaveDe(t.data))!;
    if (t.tipo === "entrada") b.entradas += t.valor_centavos; else b.saidas += t.valor_centavos;
  }
  return [...baldes.entries()].map(([chave, b]) => {
    saldo += b.entradas - b.saidas;
    const rotulo = mensal ? `${MONTH_ABBR[Number(chave.slice(5, 7)) - 1]}/${chave.slice(2, 4)}` : chave.slice(8);
    return { chave, rotulo, entradas: b.entradas, saidas: b.saidas, saldo };
  });
}

/** Soma por chave (categoria, forma de pagamento…) só das saídas efetivadas no período, do maior para o menor. */
export function somarSaidasPor(txs: Tx[], de: string, ate: string, chave: (t: Tx) => string | null): { chave: string | null; valor: number }[] {
  const mapa = new Map<string | null, number>();
  for (const t of txs) {
    if (t.tipo !== "saida" || t.status === "pendente" || t.data < de || t.data > ate) continue;
    const k = chave(t);
    mapa.set(k, (mapa.get(k) ?? 0) + t.valor_centavos);
  }
  return [...mapa.entries()].map(([k, valor]) => ({ chave: k, valor })).sort((a, b) => b.valor - a.valor);
}
