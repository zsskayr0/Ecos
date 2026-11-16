import type { CSSProperties } from "react";

const MARGEM = 8;
const ESPACO = 6;
const LARGURA = 224;
const ALTURA_MAXIMA = 288;

/** Alinha ao filtro acionado e deixa livre a lista que contém os filtros. */
export function posicaoSubmenu(gatilho: HTMLElement, alturaDesejada: number): CSSProperties {
  const linha = gatilho.getBoundingClientRect();
  const painel = gatilho.closest(".ecos-menu")?.getBoundingClientRect() ?? linha;
  const larguraJanela = document.documentElement.clientWidth || window.innerWidth;
  const alturaJanela = Math.min(
    document.documentElement.clientHeight || window.innerHeight,
    window.visualViewport?.height ?? window.innerHeight,
  );
  const largura = Math.min(LARGURA, larguraJanela - MARGEM * 2);
  const maxHeight = Math.min(ALTURA_MAXIMA, alturaJanela - MARGEM * 2);
  const altura = Math.min(alturaDesejada, maxHeight);
  const cabeNaDireita = painel.right + ESPACO + largura <= larguraJanela - MARGEM;
  const cabeNaEsquerda = painel.left - ESPACO - largura >= MARGEM;
  const x = cabeNaDireita ? painel.right + ESPACO : cabeNaEsquerda ? painel.left - ESPACO - largura : linha.left;
  const abaixo = painel.bottom + ESPACO;
  const acima = painel.top - ESPACO - altura;
  const y = cabeNaDireita || cabeNaEsquerda ? linha.top
    : abaixo + altura <= alturaJanela - MARGEM || acima < MARGEM ? abaixo : acima;

  // Uma janela com transform vira a origem do posicionamento fixo.
  let ancestral = gatilho.parentElement;
  while (ancestral) {
    const transform = getComputedStyle(ancestral).transform;
    if (transform && transform !== "none") break;
    ancestral = ancestral.parentElement;
  }
  const origem = ancestral?.getBoundingClientRect();
  return {
    position: "fixed", marginTop: 0, width: largura, minWidth: 0, maxHeight,
    left: Math.max(MARGEM, Math.min(x, larguraJanela - largura - MARGEM)) - (origem?.left ?? 0),
    top: Math.max(MARGEM, Math.min(y, alturaJanela - altura - MARGEM)) - (origem?.top ?? 0),
    right: "auto", bottom: "auto",
  };
}
