/**
 * Aparência única de nota e tarefa arquivadas, em todas as vistas (lista, cartões, grade, tabela, quadro) e no
 * explorador de arquivos: esmaecida (volta ao normal sob o ponteiro ou foco), título em itálico e o ícone de
 * arquivo no lugar do círculo de concluir — arquivada não se conclui pela lista.
 */
export const CLASSE_ITEM_ARQUIVADO = "opacity-55 transition-opacity hover:opacity-100 focus-within:opacity-100 focus-visible:opacity-100";
export const CLASSE_TITULO_ARQUIVADO = "italic text-text-muted";

export const estaArquivado = (item: { tipo?: string; status?: string; arquivada?: boolean }) =>
  item.status === "arquivada" || item.arquivada === true;
