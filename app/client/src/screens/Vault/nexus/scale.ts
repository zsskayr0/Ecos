// Portado do Nexus: components/charts/scale.ts. Mantém a composição e as interações originais.
/** Escala linear simples: mapeia um valor de `domain` para `range`. */
export function scaleLinear(domain: [number, number], range: [number, number]) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

/** Arredonda um máximo de eixo para um número "redondo" (1/2/5 × 10^n), como as ferramentas de BI fazem. */
export function niceMax(value: number): number {
  if (value <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return niceNormalized * magnitude;
}

/** "R$ 12.500" → "12,5k" para rótulos compactos de eixo. */
export function compactBRL(value: number): string {
  if (value === 0) return "R$0";
  if (value >= 1000) {
    const k = value / 1000;
    return `${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1).replace(".", ",")}k`;
  }
  return value.toFixed(0);
}
