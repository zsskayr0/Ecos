/**
 * "Meus calendários" da Agenda híbrida (desktop): o que aparece na grade e na Timeline, por tipo. Fica neste aparelho.
 * A atividade (registro do que foi feito) mora aqui também e começa desligada; o resto começa ligado.
 */
export type TipoAgenda = "eventos" | "tarefas" | "prazos" | "contas" | "lancamentos" | "atividade";

export type FiltrosAgenda = Record<TipoAgenda, boolean>;

export const TIPOS_AGENDA: { tipo: TipoAgenda; rotulo: string; cor: string }[] = [
  { tipo: "eventos", rotulo: "Eventos", cor: "rgb(var(--ecos-cyan-rgb, 34 211 238))" },
  { tipo: "tarefas", rotulo: "Tarefas", cor: "rgb(var(--ecos-text-secondary-rgb, 160 170 185))" },
  { tipo: "prazos", rotulo: "Prazos", cor: "rgb(var(--ecos-warning-rgb, 234 179 8))" },
  { tipo: "contas", rotulo: "Contas a vencer", cor: "#a78bfa" },
  { tipo: "lancamentos", rotulo: "Lançamentos do Cofre", cor: "#8b5cf6" },
  { tipo: "atividade", rotulo: "Atividade", cor: "rgb(var(--ecos-cyan-rgb, 34 211 238) / 0.5)" },
];

const CHAVE = "ecos.agenda.filtros";
const PADRAO: FiltrosAgenda = { eventos: true, tarefas: true, prazos: true, contas: true, lancamentos: true, atividade: false };

export function lerFiltrosAgenda(): FiltrosAgenda {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE) ?? "null") as Partial<FiltrosAgenda> | null;
    // Quem já tinha ligado a atividade pelo botão antigo continua com ela ligada.
    const atividadeAntiga = localStorage.getItem("ecos.agenda.mostrarAtividade") === "1";
    return { ...PADRAO, atividade: atividadeAntiga, ...(salvo && typeof salvo === "object" ? salvo : {}) };
  } catch { return { ...PADRAO }; }
}

export function gravarFiltrosAgenda(filtros: FiltrosAgenda) {
  try { localStorage.setItem(CHAVE, JSON.stringify(filtros)); } catch { /* sem armazenamento: só nesta sessão */ }
}

/** Item da grade/Timeline → tipo do filtro. */
export function tipoDoItem(item: { tipo?: string; transacao?: boolean; transacaoId?: string; recorrenciaId?: string; icone?: string; natureza?: string; alvo?: { tipo: string } | null }): TipoAgenda {
  if (item.natureza === "registro") return "atividade";
  if (item.recorrenciaId || item.alvo?.tipo === "recorrencia") return "contas";
  if (item.transacaoId || item.alvo?.tipo === "transacao" || item.icone === "transacao") return "lancamentos";
  if (item.tipo === "prazo" || item.icone === "prazo") return "prazos";
  if (item.tipo === "evento" || item.icone === "evento") return "eventos";
  return "tarefas";
}
