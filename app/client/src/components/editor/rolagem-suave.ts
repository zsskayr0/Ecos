import { EditorView } from "@codemirror/view";

/**
 * Rolagem suave do editor: quando o cursor sai da tela (setas, Page Up/Down, clique perto da borda, blocos altos como
 * imagens e tabelas), a página desliza até ele em vez de pular. Vale para a área que realmente rola, que no Ecos costuma
 * ser a janela da nota e não o próprio editor. Com "reduzir movimento" ligado, vai direto.
 */
const MARGEM_TOPO = 56; // a paleta de formatação flutua no alto
const MARGEM_BASE = 28;
const DURACAO_MS = 200;

function areaQueRola(el: HTMLElement): HTMLElement | null {
  for (let p: HTMLElement | null = el; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight + 1) return p;
  }
  return null;
}

let animacao = 0;
function deslizar(area: HTMLElement, alvo: number) {
  window.cancelAnimationFrame(animacao);
  const reduz = document.documentElement.hasAttribute("data-reduzir-movimento");
  const inicio = area.scrollTop;
  const delta = alvo - inicio;
  if (reduz || Math.abs(delta) < 2) { area.scrollTop = alvo; return; }
  const t0 = performance.now();
  const passo = (agora: number) => {
    const t = Math.min(1, (agora - t0) / DURACAO_MS);
    area.scrollTop = inicio + delta * (1 - Math.pow(1 - t, 3));
    if (t < 1) animacao = window.requestAnimationFrame(passo);
  };
  animacao = window.requestAnimationFrame(passo);
}

export const rolagemSuave = EditorView.scrollHandler.of((view, range) => {
  const area = areaQueRola(view.dom);
  if (!area) return false;
  const topo = view.coordsAtPos(range.head, range.empty ? 1 : -1) ?? view.coordsAtPos(range.head);
  if (!topo) return false;
  const caixa = area.getBoundingClientRect();
  const acima = caixa.top + MARGEM_TOPO - topo.top;
  const abaixo = topo.bottom - (caixa.bottom - MARGEM_BASE);
  if (acima > 0) deslizar(area, area.scrollTop - acima);
  else if (abaixo > 0) deslizar(area, area.scrollTop + abaixo);
  return true;
});
