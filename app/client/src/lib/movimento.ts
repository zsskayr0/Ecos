/**
 * Movimento reduzido: vale se a pessoa ligou "Reduzir movimento" nas preferências do Ecos ou, no modo "Sistema",
 * se o sistema operacional pede isso. Quem anima em JavaScript (globo, grades) consulta aqui em vez de `matchMedia`.
 */
export function movimentoReduzido(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.getAttribute("data-reduzir-movimento") === "true";
}
