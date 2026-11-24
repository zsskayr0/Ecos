import { useEffect, useState, type CSSProperties } from "react";
import { lerPreferenciasAplicativo, type MargemPagina, type PapelNota, type PreferenciasAplicativo } from "@/lib/preferencias-aplicativo";
import { linhaDasPreferencias } from "@/lib/linha-nota";

/** Linha que força nova página no modo página e no PDF. Fica sozinha na linha. */
export const QUEBRA_PAGINA = /^[ \t]*---pagebreak[ \t]*$/i;
export const TEXTO_QUEBRA_PAGINA = "---pagebreak";

const FAMILIAS = {
  padrao: undefined,
  serifa: "Georgia, \"Times New Roman\", serif",
  sistema: "system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif",
  mono: "\"JetBrains Mono\", \"IBM Plex Mono\", monospace",
} as const;

// "padrao" = coluna de leitura (~80 caracteres por linha); "toda" = ocupa a janela inteira.

/** Papel em pontos PDF (1/72 pol). */
export const PAPEIS: Record<Exclude<PapelNota, "desligado">, { largura: number; altura: number; rotulo: string }> = {
  a4: { largura: 595.28, altura: 841.89, rotulo: "A4" },
  carta: { largura: 612, altura: 792, rotulo: "Carta" },
};
/** Margens em pontos PDF: 1,27 cm, 2,5 cm, 3,5 cm. */
export const MARGENS: Record<MargemPagina, number> = { estreita: 36, normal: 70.87, larga: 99.21 };
const PX_POR_PT = 96 / 72;

/** Variáveis CSS do texto da nota (fonte, tamanho, entrelinha) e a largura da coluna. `base` é o tamanho automático. */
export function linhaDaNota(p: PreferenciasAplicativo, base: number): number {
  // A entrelinha é sempre o número central (uma linha); só cresce se o texto for tão grande que não caberia nela.
  return Math.max(linhaDasPreferencias(p), Math.ceil((p.notaTamanho || base) * 1.3));
}

export function estiloTextoNota(p: PreferenciasAplicativo, base: number): CSSProperties {
  const tamanho = p.notaTamanho || base;
  const linha = linhaDaNota(p, base);
  const estilo: Record<string, string> = { "--ecos-fonte-nota": `${tamanho}px`, "--ecos-linha-nota": `${linha}px` };
  const familia = FAMILIAS[p.notaFonte];
  if (familia) estilo.fontFamily = familia;
  return estilo as CSSProperties;
}

/** Estilo da coluna: largura máxima centralizada ou, no modo página, a folha com as margens. */
export function estiloColunaNota(p: PreferenciasAplicativo): CSSProperties | undefined {
  if (p.notaPapel !== "desligado") {
    const papel = PAPEIS[p.notaPapel];
    const margem = MARGENS[p.notaMargem] * PX_POR_PT;
    return { maxWidth: `${papel.largura * PX_POR_PT}px`, marginInline: "auto", paddingInline: `min(${margem}px, 8vw)`, paddingBlock: `min(${margem}px, 8vw)` };
  }
  // Fora do modo página, o texto ocupa a largura toda da nota.
  return undefined;
}

/** Altura útil da folha em px (para desenhar a régua de página no modo página). */
export function alturaUtilPagina(p: PreferenciasAplicativo): number | null {
  if (p.notaPapel === "desligado") return null;
  return (PAPEIS[p.notaPapel].altura - 2 * MARGENS[p.notaMargem]) * PX_POR_PT;
}

/** Preferências atuais, atualizadas quando mudam em Configurações. */
export function usePreferenciasNota(): PreferenciasAplicativo {
  const [p, setP] = useState(lerPreferenciasAplicativo);
  useEffect(() => {
    const atualizar = () => setP(lerPreferenciasAplicativo());
    window.addEventListener("ecos:preferencias-aplicativo", atualizar);
    return () => window.removeEventListener("ecos:preferencias-aplicativo", atualizar);
  }, []);
  return p;
}

/** Folha do modo página: fundo de papel, sombra e uma linha tracejada onde cada página termina (aproximada). */
export function estiloFolhaPagina(p: PreferenciasAplicativo): CSSProperties | undefined {
  if (p.notaPapel === "desligado") return undefined;
  const altura = PAPEIS[p.notaPapel].altura * PX_POR_PT;
  return {
    boxShadow: "0 1px 3px rgb(0 0 0 / 0.25), 0 0 0 1px rgb(var(--ecos-border-rgb, 128 128 128) / 0.4)",
    borderRadius: "4px",
    backgroundImage: `repeating-linear-gradient(to bottom, transparent 0 ${altura - 1}px, rgb(var(--ecos-text-muted-rgb, 128 128 128) / 0.45) ${altura - 1}px ${altura}px)`,
    minHeight: `${altura}px`,
  };
}

/** Páginas que a nota ocupa no modo página (estimativa pelo texto; cada `---pagebreak` começa outra). null sem modo página. */
export function estimarPaginas(texto: string, p: PreferenciasAplicativo): number | null {
  if (p.notaPapel === "desligado") return null;
  const papel = PAPEIS[p.notaPapel];
  const margem = MARGENS[p.notaMargem];
  const tamanhoPt = (p.notaTamanho || 14) * 0.75;
  const linhaPt = Math.max(linhaDasPreferencias(p), Math.ceil((p.notaTamanho || 14) * 1.3)) * 0.75;
  const linhasPorPagina = Math.max(1, Math.floor((papel.altura - 2 * margem) / linhaPt));
  const caracteresPorLinha = Math.max(10, Math.floor((papel.largura - 2 * margem) / (tamanhoPt * 0.5)));
  let paginas = 0;
  for (const secao of texto.split(/^[ \t]*---pagebreak[ \t]*$/gim)) {
    const linhas = secao.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / caracteresPorLinha)), 0);
    paginas += Math.max(1, Math.ceil(linhas / linhasPorPagina));
  }
  return paginas;
}
