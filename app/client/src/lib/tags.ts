/** Mesma regra de `ecos_core::tags::canonica` (servidor): sem `#`, minúscula, espaços viram `-`. */
export const TAMANHO_MAXIMO_TAG = 48;

export function canonicaTag(bruta: string): string | null {
  const tag = bruta.trim().replace(/^#+/, "").split(/\s+/).filter(Boolean).join("-").toLowerCase();
  if (!tag || [...tag].length > TAMANHO_MAXIMO_TAG || /[\u0000-\u001f\u007f,]/.test(tag)) return null;
  return tag;
}

/** Lista canônica, sem repetidas, na ordem de entrada. */
export function normalizarTags(brutas: string[]): string[] {
  const saida: string[] = [];
  for (const bruta of brutas) {
    const tag = canonicaTag(bruta);
    if (tag && !saida.includes(tag)) saida.push(tag);
  }
  return saida;
}
