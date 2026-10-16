/** Altura de um chip de item na célula do mês (h-5 = 20px + 4px de respiro). */
export const ALTURA_CHIP_PX = 24;
/** Cabeçalho da célula: padding superior (8) + botão do dia (28) + padding inferior (8). */
export const RESERVA_CELULA_PX = 44;
/** Sem medida (primeira renderização, testes sem layout): mantém a regra antiga de 3 itens. */
const CAPACIDADE_PADRAO = 3;

/**
 * Quantos itens cabem numa célula do mês e quantos viram "+N itens".
 * Quando nem todos cabem, uma linha é reservada para o "+N itens", para ele nunca invadir a linha de baixo.
 */
export function calcularVisiveis(total: number, alturaLinha: number): { visiveis: number; resto: number } {
  const capacidade = alturaLinha > 0 ? Math.max(0, Math.floor((alturaLinha - RESERVA_CELULA_PX) / ALTURA_CHIP_PX)) : CAPACIDADE_PADRAO;
  if (total <= capacidade) return { visiveis: total, resto: 0 };
  const visiveis = Math.max(0, capacidade - 1);
  return { visiveis, resto: total - visiveis };
}

/**
 * Círculo do número do dia: só o dia de HOJE leva o círculo cheio de destaque; o dia selecionado (que pode ser
 * qualquer um, inclusive de outro mês navegado) só ganha um contorno discreto.
 */
export function classeDiaMes({ ehHoje, ativo }: { ehHoje: boolean; ativo: boolean }): string {
  if (ehHoje) return "bg-steel-500 font-semibold text-white";
  if (ativo) return "bg-surface-2 font-semibold text-text-primary ring-1 ring-border";
  return "text-text-secondary hover:bg-surface-2";
}
