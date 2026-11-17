import type { CicloApi, EstadoCiclo, MensalidadeApi, RegraReajuste } from "@/lib/api";

export const dataBR = (iso: string) => iso.split("-").reverse().join("/");

/** Pontos-base → "10%", "6,52%". */
export function formatPercentual(bp: number): string {
  return `${(bp / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

/** "6,52" / "6.52" / "10" / "10%" → pontos-base; `null` se não for um percentual válido (≥ 0, até duas casas). */
export function bpDoCampo(texto: string): number | null {
  const limpo = texto.trim().replace(/\s*%$/, "");
  if (!/^\d{1,3}([.,]\d{1,2})?$/.test(limpo)) return null;
  const [inteiro, frac = ""] = limpo.replace(".", ",").split(",");
  return Number(inteiro) * 100 + Number(frac.padEnd(2, "0"));
}

export const bpParaCampo = (bp: number) => (bp / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 });

/** Dias inteiros de `de` até `ate` (negativo se `ate` já passou). Datas `AAAA-MM-DD`. */
export function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);
}

/** "Atrasado" é o aviso que passou do prazo, não o aniversário: o rótulo diz isso. Em `avisar`, use `rotuloDoEstado` (leva a data). */
export const ROTULO_ESTADO: Record<EstadoCiclo, string> = {
  atrasado: "Aviso atrasado",
  avisar: "Avisar",
  agendado: "Reajuste agendado",
  aplicado: "Reajustado",
  mantido: "Valor mantido",
  futuro: "Em dia",
};

export const ROTULO_REGRA: Record<RegraReajuste, string> = {
  minimo: "Reajuste mínimo",
  igpm: "IGP-M",
  negociado: "Negociado",
  mantido: "Valor mantido",
};

/** Rótulo do selo: em `avisar` leva o prazo ("Avisar até 26/11"). */
export function rotuloDoEstado(c: Pick<CicloApi, "estado" | "limite_aviso">): string {
  return c.estado === "avisar" ? `Avisar até ${dataBR(c.limite_aviso).slice(0, 5)}` : ROTULO_ESTADO[c.estado];
}

/** Avisando hoje, a partir de quando o novo valor pode valer: `aviso_dias` depois de hoje, nunca antes do aniversário. */
export function vigenciaSeAvisarHoje(hoje: string, ciclo: string, avisoDias: number): string {
  const d = new Date(`${hoje}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + avisoDias);
  const iso = d.toISOString().slice(0, 10);
  return iso > ciclo ? iso : ciclo;
}

/** Ciclos esperando decisão (aviso atrasado ou na janela de avisar) e a perda estimada somada. */
export function resumoDePendencias(lista: MensalidadeApi[]): { ciclos: number; perdaCentavos: number; atrasados: number } {
  let ciclos = 0, perdaCentavos = 0, atrasados = 0;
  for (const m of lista) {
    const e = m.ciclo_em_foco?.estado;
    if (e !== "atrasado" && e !== "avisar") continue;
    ciclos += Math.max(1, m.ciclos_sem_decisao);
    if (e === "atrasado") { atrasados += 1; perdaCentavos += m.ciclo_em_foco?.perda_estimada_centavos ?? 0; }
  }
  return { ciclos, perdaCentavos, atrasados };
}

/** Quem aparece na tela: o residente (pagador da recorrência); sem pagador, a descrição da recorrência. */
export const nomeDoResidente = (m: Pick<MensalidadeApi, "beneficiario_nome" | "descricao">) => m.beneficiario_nome?.trim() || m.descricao;

/** O ciclo ainda espera uma decisão do dono. */
export const semDecisao = (c: Pick<CicloApi, "estado" | "reajuste">) => !c.reajuste && (c.estado === "atrasado" || c.estado === "avisar" || c.estado === "futuro");

/** "faltam 3 dias" / "é hoje" / "venceu há 2 dias", para o prazo do aviso. */
export function prazoPorExtenso(hoje: string, limite: string): string {
  const d = diasEntre(hoje, limite);
  if (d === 0) return "é hoje";
  if (d > 0) return d === 1 ? "falta 1 dia" : `faltam ${d} dias`;
  return d === -1 ? "venceu ontem" : `venceu há ${-d} dias`;
}

/** "2026-10" → "out/26". */
export function mesCurto(mes: string): string {
  const [ano, m] = mes.split("-");
  const nomes = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${nomes[Number(m) - 1] ?? m}/${(ano ?? "").slice(2)}`;
}

/** Quantos meses o intervalo toca (o servidor aceita até 24). */
export function mesesNoIntervalo(de: string, ate: string): number {
  const [a1, m1] = de.split("-").map(Number), [a2, m2] = ate.split("-").map(Number);
  return ((a2 ?? 0) - (a1 ?? 0)) * 12 + ((m2 ?? 0) - (m1 ?? 0)) + 1;
}
