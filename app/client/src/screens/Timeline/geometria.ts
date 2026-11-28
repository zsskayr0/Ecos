/*
 * Geometria do trilho da Timeline (px, a partir da borda esquerda da lista).
 *
 *   TRONCO    liga os dias (o ponto do dia fica nele; o título vem logo depois)
 *   RAMO      trilho da programação de cada dia — sai do tronco numa curva
 *   REGISTRO  ramo paralelo com o que a pessoa fez, como um ramo de commits
 *
 * Os itens começam em RECUO_LISTA, mais à direita que o título do dia — como uma lista.
 */
export const TRONCO = 8;
export const RAMO = 28;
export const REGISTRO = RAMO + 16;
export const RECUO_LISTA = REGISTRO + 14;
export const ALTURA_CURVA = 16;
export const ALTURA_CABECALHO = 40;
/** Cabeçalho do dia no celular: alvo de toque maior e título maior. */
export const ALTURA_CABECALHO_MOVEL = 48;
/** O botão do item começa antes dos trilhos para o realce do hover abraçar os pontos, como na referência. */
export const RECUO_ITEM = RECUO_LISTA - 16;

/** Cor dos trilhos: um pouco mais visível que a borda comum. */
export const COR_TRILHO = "border-text-muted/30";
export const COR_TRILHO_SVG = "text-text-muted/30";
