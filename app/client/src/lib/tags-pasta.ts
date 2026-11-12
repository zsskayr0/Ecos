/** Como uma tarefa/nota nova recebe tags: herdando das pastas, só da própria pasta ou de uma lista manual. */
export type ModoTagsPadrao = "hierarquia" | "pasta" | "manual";

interface PastaComTags { caminho: string; tags?: string[] | null }

/** Caminhos da raiz até a própria pasta: `A/B/C` → `A`, `A/B`, `A/B/C`. */
function cadeia(pasta: string): string[] {
  const partes = pasta.split("/").filter(Boolean);
  return partes.map((_, i) => partes.slice(0, i + 1).join("/"));
}

/** Une sem repetir, mantendo a ordem (e comparando sem diferenciar maiúsculas, como o catálogo de tags). */
export function unirTags(...listas: (readonly string[])[]): string[] {
  const vistas = new Set<string>();
  const saida: string[] = [];
  for (const tag of listas.flat()) {
    const chave = tag.trim().replace(/^#/, "").toLowerCase();
    if (!chave || vistas.has(chave)) continue;
    vistas.add(chave);
    saida.push(tag.trim().replace(/^#/, ""));
  }
  return saida;
}

/**
 * Tags que vêm das pastas. `hierarquia`: as da pasta e de todas as de cima (da raiz para baixo);
 * `pasta`: só as da própria pasta. O modo `manual` não passa por aqui (usa a lista das preferências).
 */
export function tagsPadraoDaPasta(pasta: string | null, modo: Exclude<ModoTagsPadrao, "manual">, pastas: readonly PastaComTags[]): string[] {
  if (!pasta) return [];
  const caminhos = modo === "hierarquia" ? cadeia(pasta) : [pasta];
  const porCaminho = new Map(pastas.map((p) => [p.caminho, p.tags ?? []] as const));
  return unirTags(...caminhos.map((c) => porCaminho.get(c) ?? []));
}
