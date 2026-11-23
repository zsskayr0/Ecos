import type { Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { extrairTitulos, numerarTitulos } from "@/lib/sumario";

/**
 * Numeração dos títulos no editor vivo: só marca a linha com `data-num`; o número
 * aparece por CSS (`html[data-numerar-titulos] .cm-line[data-num]::before`), então
 * ligar/desligar a preferência não precisa recriar o editor.
 */
function numerar(view: EditorView): DecorationSet {
  const doc = view.state.doc;
  const titulos = extrairTitulos(doc.toString());
  if (!titulos.length) return Decoration.none;
  const numeros = numerarTitulos(titulos);
  return Decoration.set(titulos.map((t, i) => Decoration.line({ attributes: { "data-num": numeros[i] } }).range(doc.line(t.linha).from)));
}

const numeracaoTitulos = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = numerar(view); }
  update(u: ViewUpdate) { if (u.docChanged) this.decorations = numerar(u.view); }
}, { decorations: (p) => p.decorations });

/** Primeiro ancestral que rola (janela da nota, página do Focus); senão a própria página. */
export function areaDeRolagem(el: HTMLElement | null): HTMLElement {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return document.scrollingElement as HTMLElement ?? document.documentElement;
}

let animacao = 0;

/**
 * Rola `area` até o alvo em exatamente `duracao` ms (0,5 s), acelerando e freando
 * (ease-in-out): perto ou longe, a viagem leva o mesmo tempo. `alvo()` é lido a cada quadro,
 * porque as alturas fora da tela são estimadas e se acertam no caminho.
 * Uma nova chamada interrompe a anterior e parte de onde a tela está.
 */
export function rolarSuave(area: HTMLElement, alvo: () => number, duracao = 500) {
  cancelAnimationFrame(animacao);
  if (duracao <= 0) { area.style.scrollBehavior = "auto"; area.scrollTop = alvo(); area.style.scrollBehavior = ""; return; }
  const inicio = area.scrollTop;
  const t0 = performance.now();
  const comportamento = area.style.scrollBehavior;
  area.style.scrollBehavior = "auto";
  // O alvo é lido no início e corrigido só algumas vezes (a cada ~120 ms e no fim): ler a
  // posição a cada quadro força o navegador a refazer o layout no meio da rolagem e trava.
  let destino = alvo();
  let ultimaLeitura = t0;
  const passo = (agora: number) => {
    const p = Math.min(1, (agora - t0) / duracao);
    if (p === 1 || agora - ultimaLeitura > 120) { destino = alvo(); ultimaLeitura = agora; }
    const e = p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
    area.scrollTop = inicio + (destino - inicio) * e;
    if (p < 1) animacao = requestAnimationFrame(passo);
    else area.style.scrollBehavior = comportamento;
  };
  animacao = requestAnimationFrame(passo);
}

const topoDaArea = (area: HTMLElement) => (area === document.scrollingElement ? 0 : area.getBoundingClientRect().top);

/** Rola a área da nota até a linha `linha` (1, 2, 3…), deixando `margem` px acima dela. */
export function rolarAteLinha(view: EditorView, linha: number, margem = 90, duracao = 500) {
  if (linha > view.state.doc.lines) return;
  const pos = view.state.doc.line(linha).from;
  const area = areaDeRolagem(view.dom);
  // documentTop + scrollTop é constante: o alvo em scrollTop não depende de onde a tela está.
  rolarSuave(area, () => view.lineBlockAt(pos).top + view.documentTop - topoDaArea(area) + area.scrollTop - margem, duracao);
}

/** Mesmo que `rolarAteLinha`, para a leitura (elemento já renderizado). */
export function rolarAteElemento(el: HTMLElement, margem = 90, duracao = 500) {
  const area = areaDeRolagem(el);
  rolarSuave(area, () => el.getBoundingClientRect().top - topoDaArea(area) + area.scrollTop - margem, duracao);
}

export const sumarioEditor: Extension = [numeracaoTitulos];
