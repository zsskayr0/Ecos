import { flushSync } from "react-dom";
import { EditorView } from "@codemirror/view";

/** Distância do topo da área rolável até a linha que serve de referência (abaixo de cabeçalho/barra fixos). */
const SONDA = 80;

interface Ponto { linha: number; fracao: number }

function ancestralRolavel(inicio: Element | null): HTMLElement {
  for (let el = inicio?.parentElement ?? null; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight) return el;
  }
  return (document.scrollingElement as HTMLElement) ?? document.documentElement;
}

const topoDaArea = (alvo: HTMLElement) => (alvo === document.scrollingElement || alvo === document.documentElement ? 0 : alvo.getBoundingClientRect().top);

function editorEm(raiz: Element): EditorView | null {
  const cm = raiz.querySelector(".cm-editor");
  return cm ? EditorView.findFromDOM(cm as HTMLElement) : null;
}

/** Qual linha do Markdown está na linha de referência, e em que ponto dela. `null` se a referência não está sobre o corpo (cabeçalho, título…). */
function lerPonto(raiz: Element, sondaY: number): Ponto | null {
  const view = editorEm(raiz);
  if (view) {
    const y = sondaY - view.documentTop;
    if (y < 0 || y > view.contentHeight) return null;
    const bloco = view.lineBlockAtHeight(y);
    return { linha: view.state.doc.lineAt(bloco.from).number, fracao: (y - bloco.top) / Math.max(bloco.height, 1) };
  }
  let achado: Ponto | null = null;
  raiz.querySelectorAll<HTMLElement>("[data-linha]").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.top <= sondaY && sondaY < r.bottom) achado = { linha: Number(el.dataset.linha), fracao: (sondaY - r.top) / Math.max(r.height, 1) };
  });
  return achado;
}

/** Posição (y na tela) onde `ponto` está agora, ou `null` se o corpo ainda não foi desenhado. */
function localizar(raiz: Element, ponto: Ponto): number | null {
  const view = editorEm(raiz);
  if (view) {
    const linha = Math.min(Math.max(ponto.linha, 1), view.state.doc.lines);
    const bloco = view.lineBlockAt(view.state.doc.line(linha).from);
    return view.documentTop + bloco.top + ponto.fracao * bloco.height;
  }
  let melhor: HTMLElement | null = null;
  raiz.querySelectorAll<HTMLElement>("[data-linha]").forEach((el) => { if (Number(el.dataset.linha) <= ponto.linha) melhor = el; });
  if (!melhor) return null;
  const r = (melhor as HTMLElement).getBoundingClientRect();
  return r.top + ponto.fracao * r.height;
}

/**
 * Troca de modo (ler ↔ editar) sem perder o ponto de leitura: aplica a mudança
 * de estado e rola até a mesma linha do Markdown na outra visão. Os dois modos
 * têm alturas diferentes, então guardar só os pixels deslocaria o texto; fora
 * do corpo (título, cabeçalho) cai nos pixels. `ancora` é qualquer elemento
 * dentro da tela (botão clicado, conteúdo da página).
 */
export function preservandoScroll(ancora: Element | null, mudar: () => void) {
  const base = ancora ?? document.querySelector(".ecos-detail-content");
  const raiz = base?.closest("[data-corpo-editor], .ecos-detail-content") ?? document.body;
  const alvo = ancestralRolavel(base);
  const topo = alvo.scrollTop;
  const ponto = lerPonto(raiz, topoDaArea(alvo) + SONDA);
  flushSync(mudar);
  if (!ponto) {
    alvo.scrollTop = topo;
    requestAnimationFrame(() => { alvo.scrollTop = topo; });
    return;
  }
  // Leitura: o DOM é estático, um único ajuste basta.
  const noPreview = raiz.querySelector("[data-linha]");
  if (noPreview && !editorEm(raiz)) {
    const y = localizar(raiz, ponto);
    if (y !== null) alvo.scrollTop += y - (topoDaArea(alvo) + SONDA);
    return;
  }
  // Edição: o CodeMirror estima a altura das linhas fora da tela e corrige ao medir, então calcular
  // pixels várias vezes faz a tela oscilar. Ele mesmo rola até a linha e se reajusta até estabilizar.
  let tentativas = 0;
  const ir = () => {
    const view = editorEm(raiz);
    if (!view) { if (tentativas++ < 20) requestAnimationFrame(ir); return; }
    const linha = Math.min(Math.max(ponto.linha, 1), view.state.doc.lines);
    view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.line(linha).from, { y: "start", yMargin: SONDA }) });
  };
  ir();
}
