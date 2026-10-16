import type { ContagemNexus, PacoteNexus, RelatorioNexus } from "./types";

/** O corpo de um pedido ao Cofre vai até 10 MB; deixa folga para o envelope JSON. */
export const ORCAMENTO_LOTE_BYTES = 6 * 1024 * 1024;

const LISTAS = ["categories", "payees", "accounts", "recurringTransactions", "transactions", "pendingItems", "recurringExclusions", "attachments"] as const;

/** Lê o JSON gerado por `scripts/nexus-exportar.mjs`; recusa o que não parece um pacote. */
export function lerPacote(texto: string): PacoteNexus {
  let bruto: unknown;
  try { bruto = JSON.parse(texto); } catch { throw new Error("O arquivo não é um JSON válido."); }
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) throw new Error("O arquivo não é um pacote do Nexus.");
  const obj = bruto as Record<string, unknown>;
  const pacote: PacoteNexus = {};
  let algum = false;
  for (const k of LISTAS) {
    const v = obj[k];
    if (v === undefined) continue;
    if (!Array.isArray(v)) throw new Error(`O campo "${k}" deveria ser uma lista.`);
    (pacote as Record<string, unknown>)[k] = v;
    if (v.length) algum = true;
  }
  if (!algum) throw new Error("O pacote não tem nenhum registro do Nexus.");
  return pacote;
}

export function contarPacote(p: PacoteNexus) {
  const n = (l?: unknown[]) => l?.length ?? 0;
  const tx = (p.transactions ?? []) as { type?: string; amountCents?: number }[];
  const soma = (tipo: string) => tx.filter((t) => t.type === tipo).reduce((s, t) => s + (t.amountCents ?? 0), 0);
  return {
    categorias: n(p.categories), pagadores: n(p.payees), contas: n(p.accounts), recorrencias: n(p.recurringTransactions),
    lancamentos: n(p.transactions), pendencias: n(p.pendingItems), exclusoes: n(p.recurringExclusions),
    anexos: n(p.attachments), anexosComArquivo: (p.attachments ?? []).filter((a) => !!a.contentBase64).length,
    receitasCentavos: soma("income"), despesasCentavos: soma("expense"),
  };
}

/**
 * Separa o pacote em pedidos que cabem no limite do Cofre. O primeiro leva todos os dados e os anexos que couberem no
 * orçamento; os arquivos restantes seguem em pedidos próprios (só anexos) e dependem do primeiro já ter sido aplicado.
 * `naoSimulados` = anexos com arquivo que ficaram fora da simulação (ela só enxerga o primeiro lote).
 */
export function dividirEmLotes(p: PacoteNexus, orcamento = ORCAMENTO_LOTE_BYTES): { lotes: PacoteNexus[]; naoSimulados: number } {
  const anexos = p.attachments ?? [];
  const base: PacoteNexus = { ...p, attachments: [] };
  const lotes: PacoteNexus[] = [base];
  let atual = 0;
  let naoSimulados = 0;
  let resto: PacoteNexus | null = null;
  let restoBytes = 0;
  for (const a of anexos) {
    const tamanho = a.contentBase64?.length ?? 0;
    if (tamanho === 0) { base.attachments!.push(a); continue; }
    if (resto === null && atual + tamanho <= orcamento) { base.attachments!.push(a); atual += tamanho; continue; }
    naoSimulados++;
    if (resto === null || restoBytes + tamanho > orcamento) { resto = { attachments: [] }; lotes.push(resto); restoBytes = 0; }
    resto.attachments!.push(a);
    restoBytes += tamanho;
  }
  return { lotes, naoSimulados };
}

/** Junta os relatórios dos lotes: soma contagens, concatena erros e avisos e mantém a conferência do primeiro e do último. */
export function juntarRelatorios(rs: RelatorioNexus[]): RelatorioNexus {
  if (rs.length === 1) return rs[0];
  const [primeiro] = rs;
  const ultimo = rs[rs.length - 1];
  const entidades: Record<string, ContagemNexus> = {};
  for (const r of rs) {
    for (const [k, c] of Object.entries(r.entidades)) {
      const e = (entidades[k] ??= { recebidas: 0, criadas: 0, reaproveitadas: 0, ja_migradas: 0, ignoradas: 0, com_erro: 0 });
      for (const campo of Object.keys(e) as (keyof ContagemNexus)[]) e[campo] += c[campo];
    }
  }
  return {
    dry_run: primeiro.dry_run,
    aplicado: rs.every((r) => r.aplicado),
    backup: primeiro.backup,
    entidades,
    erros: rs.flatMap((r) => r.erros),
    avisos: rs.flatMap((r) => r.avisos),
    verificacao: {
      antes: primeiro.verificacao.antes,
      depois: ultimo.verificacao.depois,
      origem: primeiro.verificacao.origem,
      criados: {
        lancamentos: rs.reduce((s, r) => s + r.verificacao.criados.lancamentos, 0),
        entradas_centavos: rs.reduce((s, r) => s + r.verificacao.criados.entradas_centavos, 0),
        saidas_centavos: rs.reduce((s, r) => s + r.verificacao.criados.saidas_centavos, 0),
      },
      confere: rs.every((r) => r.verificacao.confere),
      projetado: primeiro.verificacao.projetado,
    },
  };
}
