import { analisarWikilink } from "./wikilinks";

/**
 * "Ver onde está": pede para um documento (nota ou tarefa) rolar até um trecho do próprio texto — um link externo ou um
 * `[[wikilink]]`. O pedido fica em memória, por item: a janela pode ainda nem existir (abre e consome ao montar) ou já
 * estar aberta (só vem para a frente; o evento a avisa).
 */
export type AlvoIr = { url: string } | { wikilink: string };

interface Pedido { alvo: AlvoIr; em: number }

const VALIDADE_MS = 15_000;
const EVENTO = "ecos:ir-para-trecho";
const pendentes = new Map<string, Pedido>();

export function pedirIr(itemId: string, alvo: AlvoIr) {
  pendentes.set(itemId, { alvo, em: Date.now() });
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: { itemId } }));
}

/** Entrega (uma vez) o pedido pendente do item, se ainda for recente. */
export function consumirPedido(itemId: string): AlvoIr | null {
  const p = pendentes.get(itemId);
  pendentes.delete(itemId);
  return p && Date.now() - p.em < VALIDADE_MS ? p.alvo : null;
}

/** Avisa quando chega um pedido para este item (janela já aberta). Devolve a função que desliga. */
export function aoPedirIr(itemId: string, aoChegar: () => void): () => void {
  const ouvinte = (e: Event) => { if ((e as CustomEvent<{ itemId: string }>).detail?.itemId === itemId) aoChegar(); };
  window.addEventListener(EVENTO, ouvinte);
  return () => window.removeEventListener(EVENTO, ouvinte);
}

/** Sem acento nem caixa: `[[Reuniao]]` acha "Reunião". */
export const normalizarTrecho = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

/** Linha (1, 2, 3…) da primeira ocorrência do alvo no corpo, fora de blocos de código; `null` se não houver. */
export function linhaDoAlvo(corpo: string, alvo: AlvoIr): number | null {
  const linhas = corpo.split("\n");
  const titulo = "wikilink" in alvo ? normalizarTrecho(alvo.wikilink) : "";
  let cerca: string | null = null;
  for (let i = 0; i < linhas.length; i++) {
    const t = linhas[i]!.trimStart();
    const marca = t.startsWith("```") ? "```" : t.startsWith("~~~") ? "~~~" : null;
    if (marca) { cerca = cerca === marca ? null : cerca ?? marca; continue; }
    if (cerca) continue;
    if ("url" in alvo) { if (linhas[i]!.includes(alvo.url)) return i + 1; continue; }
    for (const m of linhas[i]!.matchAll(/\[\[([^\]\n]+?)\]\]/g)) {
      const interno = m[1]!.split("|")[0]!;
      if (normalizarTrecho(analisarWikilink(interno).titulo) === titulo) return i + 1;
    }
  }
  return null;
}
