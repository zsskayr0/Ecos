import { createElement, type MutableRefObject } from "react";
import { createRoot } from "react-dom/client";
import type { AreaLike } from "@/components/editor/EditorVivo";
import { resolverSrcImagem } from "@/lib/markdown-mini";

/** Uma palavra da nota como a tela a mostra: posição em px da coluna (origem no topo esquerdo do texto) e estilo. */
export interface PalavraNota { t: string; x: number; y: number; w: number; h: number; px: number; negrito: boolean; italico: boolean; codigo: boolean; rgb: [number, number, number] }
export interface ImagemNota { src: string; x: number; y: number; w: number; h: number }
export interface LayoutNota { altura: number; palavras: PalavraNota[]; imagens: ImagemNota[]; escuro: boolean }

const aguardar = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));
const quadro = () => Promise.race([new Promise<void>((ok) => requestAnimationFrame(() => ok())), aguardar(120)]); // abas em segundo plano não disparam rAF

/**
 * Monta a nota fora da tela, com o mesmo editor da edição e a largura da coluna da tinta, e lê onde cada palavra
 * e imagem caiu. É o que permite pôr a tinta no PDF exatamente sobre o texto em que foi escrita.
 */
export async function medirNota(corpo: string, notaId: string, largura: number): Promise<LayoutNota> {
  const { EditorVivo } = await import("@/components/editor/EditorVivo");
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${largura}px;pointer-events:none`;
  document.body.appendChild(host);
  const raiz = createRoot(host);
  const areaRef: MutableRefObject<AreaLike | null> = { current: null };
  try {
    raiz.render(createElement(EditorVivo, {
      corpo, onCorpoChange: () => {}, areaRef, ariaLabel: "Conteúdo da nota", alturaMinima: "1rem", className: "p-4", somenteLeitura: true,
      resolverImagem: (src: string) => resolverSrcImagem(src, notaId, "nota"),
    }));
    await aguardar(80);
    await Promise.race([document.fonts?.ready ?? Promise.resolve(), aguardar(2500)]);
    const imgs = Array.from(host.querySelectorAll("img"));
    await Promise.race([Promise.all(imgs.map((im) => (im.complete ? null : new Promise((ok) => { im.onload = im.onerror = ok; })))), aguardar(3000)]);
    await quadro(); await quadro();

    const base = host.getBoundingClientRect();
    const escuro = document.documentElement.getAttribute("data-theme") !== "light";
    const palavras: PalavraNota[] = [];
    const estilos = new Map<Element, { px: number; negrito: boolean; italico: boolean; codigo: boolean; rgb: [number, number, number]; oculto: boolean }>();
    const estiloDe = (el: Element) => {
      let e = estilos.get(el);
      if (!e) {
        const cs = getComputedStyle(el);
        const px = parseFloat(cs.fontSize) || 16;
        const m = cs.color.match(/[\d.]+/g)?.map(Number) ?? [15, 23, 41];
        e = {
          px, negrito: Number(cs.fontWeight) >= 600 || cs.fontWeight === "bold", italico: cs.fontStyle === "italic", codigo: /mono|courier|consolas/i.test(cs.fontFamily),
          rgb: [m[0], m[1], m[2]], oculto: px < 1 || cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0,
        };
        estilos.set(el, e);
      }
      return e;
    };
    const caminhada = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    const faixa = document.createRange();
    for (let no = caminhada.nextNode(); no; no = caminhada.nextNode()) {
      const pai = no.parentElement;
      if (!pai) continue;
      const est = estiloDe(pai);
      if (est.oculto) continue;
      const texto = no.textContent ?? "";
      for (const m of texto.matchAll(/\S+/g)) {
        faixa.setStart(no, m.index!); faixa.setEnd(no, m.index! + m[0].length);
        const retas = Array.from(faixa.getClientRects()).filter((r) => r.width > 0.5 && r.height > 0.5);
        if (!retas.length) continue;
        if (retas.length === 1) {
          const r = retas[0];
          palavras.push({ t: m[0], x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height, ...est });
        } else {
          // palavra quebrada em duas linhas: cada caractere vai para onde caiu
          for (let k = 0; k < m[0].length; k++) {
            faixa.setStart(no, m.index! + k); faixa.setEnd(no, m.index! + k + 1);
            const r = faixa.getClientRects()[0];
            if (r && r.width > 0.3) palavras.push({ t: m[0][k], x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height, ...est });
          }
        }
      }
    }
    const imagens: ImagemNota[] = imgs.map((im) => { const r = im.getBoundingClientRect(); return { src: im.currentSrc || im.src, x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height }; }).filter((i) => i.w > 1 && i.h > 1);
    return { altura: host.scrollHeight, palavras, imagens, escuro };
  } finally {
    raiz.unmount();
    host.remove();
  }
}
