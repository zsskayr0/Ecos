/** Duração das animações de saída (aba e janela). Mantenha em sincronia com `global.css` (.ecos-aba-saindo, .ecos-janela-saindo). */
export const DURACAO_SAIDA_ABA_MS = 180;
export const DURACAO_SAIDA_JANELA_MS = 160;

/** Quem pediu "reduzir movimento" no sistema fecha na hora, sem animação. */
export function reduzMovimento(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
