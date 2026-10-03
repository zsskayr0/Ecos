/** Minúsculas, sem acento nem pontuação, palavras separadas por um espaço ("Açaí-do João" → "acai do joao"). */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Todas as palavras da consulta aparecem em algum dos campos, sem diferenciar acento, caixa ou pontuação.
 * Consulta vazia casa com tudo. É o filtro instantâneo das listas; a busca do Cofre (`vault.busca`) soma a ela
 * tolerância a erro de digitação e o texto lido dos comprovantes.
 */
export function casaBusca(consulta: string, ...campos: (string | null | undefined)[]): boolean {
  const q = normalizarTexto(consulta);
  if (!q) return true;
  const alvo = normalizarTexto(campos.filter(Boolean).join(" "));
  return q.split(" ").every((palavra) => alvo.includes(palavra));
}
