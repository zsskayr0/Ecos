import { createElement, type MutableRefObject } from "react";
import { createRoot } from "react-dom/client";
import type { AreaLike } from "@/components/editor/EditorVivo";
import { resolverSrcImagem } from "@/lib/markdown-mini";

/** Uma palavra da nota como a tela a mostra: posição em px da coluna (origem no topo esquerdo do texto) e estilo. */
export interface PalavraNota { t: string; x: number; y: number; w: number; h: number; px: number; negrito: boolean; italico: boolean; codigo: boolean; rgb: [number, number, number]; /** Emoji: vai como imagem (as fontes do PDF não têm). */ emoji?: boolean }
export interface ImagemNota { src: string; x: number; y: number; w: number; h: number }
/**
 * O que não é texto mas aparece na tela: caixa de tarefa, barra de citação, fundo de bloco/trecho de código e
 * linha horizontal. Posição em px da coluna, como as palavras.
 */
export interface DecoracaoNota { k: "caixa" | "barra" | "fundo" | "regua"; x: number; y: number; w: number; h: number; marcada?: boolean }
export interface LayoutNota { altura: number; palavras: PalavraNota[]; imagens: ImagemNota[]; decoracoes: DecoracaoNota[]; escuro: boolean }

/** Emojis (com modificadores, ZWJ e bandeiras): mesmo critério do PDF. */
const EMOJI = /(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*|[\u{1F1E6}-\u{1F1FF}]{2})/gu;
const ehEmoji = (s: string) => { const cp = s.codePointAt(0)!; return cp >= 0x2300 || s.includes("️"); };

/** Divide uma palavra em pedaços de texto e emojis, com o deslocamento de cada um dentro dela. */
export function pedacos(palavra: string): { t: string; i: number; emoji: boolean }[] {
  const saida: { t: string; i: number; emoji: boolean }[] = [];
  let ultimo = 0;
  for (const m of palavra.matchAll(EMOJI)) {
    if (!ehEmoji(m[0])) continue;
    if (m.index! > ultimo) saida.push({ t: palavra.slice(ultimo, m.index), i: ultimo, emoji: false });
    saida.push({ t: m[0], i: m.index!, emoji: true });
    ultimo = m.index! + m[0].length;
  }
  if (ultimo < palavra.length) saida.push({ t: palavra.slice(ultimo), i: ultimo, emoji: false });
  return saida;
}

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
      for (const inteira of texto.matchAll(/\S+/g)) for (const p of pedacos(inteira[0])) {
        const m = { 0: p.t, index: inteira.index! + p.i };
        if (p.emoji) {
          faixa.setStart(no, m.index); faixa.setEnd(no, m.index + p.t.length);
          const r = faixa.getBoundingClientRect();
          if (r.width > 0.5 && r.height > 0.5) palavras.push({ t: p.t, x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height, ...est, emoji: true });
          continue;
        }
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
    const caixaDe = (el: Element) => { const r = el.getBoundingClientRect(); return { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height }; };
    const decoracoes: DecoracaoNota[] = [];
    host.querySelectorAll<HTMLInputElement>("input.cm-caixa").forEach((c) => decoracoes.push({ k: "caixa", ...caixaDe(c), marcada: c.checked }));
    host.querySelectorAll(".cm-citacao").forEach((l) => { const b = caixaDe(l); decoracoes.push({ k: "barra", x: b.x, y: b.y, w: parseFloat(getComputedStyle(l).borderLeftWidth) || 3, h: b.h }); });
    host.querySelectorAll(".cm-bloco-cod, .cm-cod").forEach((el) => decoracoes.push({ k: "fundo", ...caixaDe(el) }));
    host.querySelectorAll(".cm-linha-regua").forEach((el) => { const b = caixaDe(el); decoracoes.push({ k: "regua", x: b.x, y: b.y + b.h / 2, w: b.w, h: 1 }); });
    const imagens: ImagemNota[] = imgs.map((im) => { const r = im.getBoundingClientRect(); return { src: im.currentSrc || im.src, x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height }; }).filter((i) => i.w > 1 && i.h > 1);
    return { altura: host.scrollHeight, palavras, imagens, decoracoes: decoracoes.filter((d) => d.w > 0.5 && d.h > 0.5), escuro };
  } finally {
    raiz.unmount();
    host.remove();
  }
}
