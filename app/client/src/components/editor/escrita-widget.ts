import { StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { atinge } from "@/lib/tinta/geometria";
import { iniciarArrasto, type Arrasto } from "@/lib/tinta/inercia";
import type { PontoTinta } from "@/lib/tinta/tipos";
import {
  ALTURA_ESCRITA_MAX, ALTURA_ESCRITA_MIN, LARGURA_ESCRITA, PASSO_GRADE,
  criarTracoEscrita, desenharEscrita, ehLinguagemEscrita, escreverBlocoEscrita, lerBlocoEscrita, type BlocoEscrita,
} from "@/lib/escrita-bloco";

/**
 * Bloco de escrita no editor vivo: a cerca ```escrita vira uma folha quadriculada onde a caneta
 * (ou o mouse) escreve direto. O dedo rola a nota. A ponta de borracha da caneta apaga.
 * Cada traço terminado regrava o bloco no texto (entra no histórico do editor: Ctrl+Z desfaz).
 */

const ESPESSURA = 2;
const RAIO_BORRACHA = 9;

function tema(): { cor: string; escuro: boolean } {
  const rgb = getComputedStyle(document.documentElement).getPropertyValue("--ecos-text-primary-rgb").trim() || "15 23 41";
  const [r, g, b] = rgb.split(/[\s,]+/).map(Number);
  return { cor: `rgb(${r} ${g} ${b})`, escuro: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.5 };
}

/** Borracha ligada pela barrinha do bloco (vale para todos os blocos até desligar). */
/** Última vez que a caneta tocou ou pairou num bloco (fora da instância: cada traço gravado recria o bloco). */
let ultimaCaneta = 0;

/** Pincel da paleta do Modo escrita (ferramenta, cor e espessura): o bloco escreve com o mesmo. */
let pincelBloco: { ferramenta: string; cor: string; espessura: number } = { ferramenta: "caneta", cor: "auto", espessura: ESPESSURA };
/** Cor e espessura lembradas por ferramenta, para a barra do bloco trocar de caneta para marca-texto e voltar. */
const MEMORIA: Record<string, { cor: string; espessura: number }> = { caneta: { cor: "auto", espessura: 2.5 }, "marca-texto": { cor: "#facc15", espessura: 16 } };
const ouvintes = new Set<() => void>();
export function definirPincelBloco(p: { ferramenta: string; cor: string; espessura: number }) {
  pincelBloco = { ferramenta: p.ferramenta, cor: p.cor, espessura: p.espessura };
  if (p.ferramenta === "caneta" || p.ferramenta === "marca-texto") MEMORIA[p.ferramenta] = { cor: p.cor, espessura: p.espessura };
  for (const o of ouvintes) o();
}
const tracoDoPincel = (pts: PontoTinta[]) => pincelBloco.ferramenta === "marca-texto"
  ? criarTracoEscrita("marca-texto", pincelBloco.cor, pincelBloco.espessura, pts)
  : criarTracoEscrita("caneta", pincelBloco.cor, pincelBloco.ferramenta === "caneta" ? pincelBloco.espessura : ESPESSURA, pts);

function icone(caminho: string) {
  return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${caminho}</svg>`;
}
const ICONE_CANETA = icone('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>');
const ICONE_BORRACHA = icone('<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>');
const ICONE_MARCA = icone('<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>');
const ICONE_DESFAZER = icone('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>');
const ICONE_APAGAR = icone('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>');

class EscritaWidget extends WidgetType {
  constructor(readonly fonte: string) { super(); }
  eq(o: EscritaWidget) { return o.fonte === this.fonte; }
  get estimatedHeight() { return lerBlocoEscrita(this.fonte).altura; }

  toDOM(view: EditorView) {
    const bloco: BlocoEscrita = lerBlocoEscrita(this.fonte);
    const raiz = document.createElement("div");
    raiz.className = "cm-escrita";
    raiz.setAttribute("role", "img");
    raiz.setAttribute("aria-label", "Bloco de escrita à mão");
    const folha = document.createElement("div");
    folha.className = "cm-escrita-folha";
    const canvas = document.createElement("canvas");
    folha.appendChild(canvas);
    raiz.appendChild(folha);

    const barra = document.createElement("div");
    barra.className = "cm-escrita-barra";
    const botao = (svg: string, rotulo: string, aoClicar: () => void) => {
      const b = document.createElement("button");
      b.type = "button"; b.innerHTML = svg; b.title = rotulo; b.setAttribute("aria-label", rotulo);
      b.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); aoClicar(); });
      b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); });
      barra.appendChild(b);
      return b;
    };
    // Barra do bloco (modo texto): a mesma ferramenta da paleta geral; no Modo escrita ela some e vale a paleta.
    const ferramentas: [string, HTMLButtonElement][] = [];
    const escolher = (f: string) => { definirPincelBloco({ ...(MEMORIA[f] ?? pincelBloco), ferramenta: f }); };
    ferramentas.push(["caneta", botao(ICONE_CANETA, "Caneta", () => escolher("caneta"))]);
    ferramentas.push(["marca-texto", botao(ICONE_MARCA, "Marca-texto", () => escolher("marca-texto"))]);
    ferramentas.push(["borracha", botao(ICONE_BORRACHA, "Borracha", () => escolher("borracha"))]);
    const marcar = () => { for (const [f, b] of ferramentas) b.setAttribute("aria-pressed", String(pincelBloco.ferramenta === f)); };
    ouvintes.add(marcar);
    marcar();
    botao(ICONE_DESFAZER, "Desfazer último traço", () => { if (bloco.tracos.length) { bloco.tracos.pop(); gravar(); } });
    botao(ICONE_APAGAR, "Apagar bloco", () => {
      const de = posicao();
      if (de == null) return;
      // Leva junto a quebra de linha seguinte, para não sobrar linha vazia.
      const ate = Math.min(view.state.doc.length, de + this.fonte.length + (view.state.sliceDoc(de + this.fonte.length, de + this.fonte.length + 1) === "\n" ? 1 : 0));
      view.dispatch({ changes: { from: de, to: ate }, selection: { anchor: de }, userEvent: "delete" });
    });
    raiz.appendChild(barra);
    for (const tipo of ["touchstart", "touchend", "mousedown"] as const) raiz.addEventListener(tipo, (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });

    const alca = document.createElement("div");
    alca.className = "cm-escrita-alca";
    alca.title = "Arraste para mudar a altura";
    raiz.appendChild(alca);

    let escala = 1;
    const posicao = (): number | null => {
      try {
        const de = view.posAtDOM(raiz);
        return view.state.sliceDoc(de, de + this.fonte.length) === this.fonte ? de : null;
      } catch { return null; }
    };
    const gravar = () => {
      const de = posicao();
      if (de == null) return;
      const novo = escreverBlocoEscrita(bloco);
      if (novo === this.fonte) return;
      view.dispatch({ changes: { from: de, to: de + this.fonte.length, insert: novo }, userEvent: "input.escrita" });
    };

    let atual: PontoTinta[] | null = null;
    const desenhar = () => {
      const w = folha.clientWidth;
      if (!w) return;
      escala = w / LARGURA_ESCRITA;
      const h = bloco.altura * escala;
      folha.style.height = `${h}px`;
      folha.style.backgroundSize = `${PASSO_GRADE * escala}px ${PASSO_GRADE * escala}px`;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
        canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr * escala, 0, 0, dpr * escala, 0, 0);
      const { cor, escuro } = tema();
      desenharEscrita(ctx, bloco.tracos, cor, escuro);
      if (atual && atual.length) desenharEscrita(ctx, [tracoDoPincel(atual)], cor, escuro);
    };
    folha.style.height = `${bloco.altura}px`;
    requestAnimationFrame(desenhar);
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => desenhar()).observe(folha);

    const ponto = (e: PointerEvent): PontoTinta => {
      const r = folha.getBoundingClientRect();
      return { x: (e.clientX - r.left) / escala, y: (e.clientY - r.top) / escala, pressao: e.pointerType === "pen" ? (e.pressure || 0.5) : 0.5 };
    };
    let apagando = false, apagouAlgo = false, ativo: number | null = null;
    const apagarEm = (p: PontoTinta) => {
      const antes = bloco.tracos.length;
      bloco.tracos = bloco.tracos.filter((t) => !atinge(t, p.x, p.y, RAIO_BORRACHA / escala));
      if (bloco.tracos.length !== antes) { apagouAlgo = true; desenhar(); }
    };
    // Rejeição de palma: a folha não deixa o navegador rolar sozinho (senão ele "rouba" a caneta);
    // o dedo rola por aqui, a não ser que a caneta esteja na tela ou acabou de sair dela, ou o toque seja largo (palma).
    let rolagem: { id: number; arrasto: Arrasto } | null = null;
    const notarCaneta = (e: PointerEvent) => { if (e.pointerType === "pen") ultimaCaneta = Date.now(); };
    folha.addEventListener("pointerover", notarCaneta);
    folha.addEventListener("pointermove", notarCaneta);
    const rolavel = (): Element => {
      for (let n = raiz.parentElement; n; n = n.parentElement) {
        const oy = getComputedStyle(n).overflowY;
        if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight) return n;
      }
      return document.scrollingElement ?? document.documentElement;
    };
    folha.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "touch") {
        e.preventDefault(); e.stopPropagation();
        const palma = ativo !== null || Date.now() - ultimaCaneta < 1500 || e.width * e.height > 900;
        if (!palma && !rolagem) { rolagem = { id: e.pointerId, arrasto: iniciarArrasto(e.clientX, e.clientY, rolavel()) }; folha.setPointerCapture(e.pointerId); }
        return;
      }
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (ativo !== null) return;
      // Caneta encostou: cancela a rolagem que um toque da palma tenha começado.
      if (rolagem) { try { folha.releasePointerCapture(rolagem.id); } catch { /* já solto */ } rolagem = null; }
      notarCaneta(e);
      e.preventDefault(); e.stopPropagation();
      folha.setPointerCapture(e.pointerId);
      ativo = e.pointerId;
      apagando = pincelBloco.ferramenta === "borracha" || (e.buttons & 32) !== 0 || e.button === 5;
      apagouAlgo = false;
      if (apagando) apagarEm(ponto(e)); else { atual = [ponto(e)]; desenhar(); }
    });
    folha.addEventListener("pointermove", (e) => {
      if (rolagem && rolagem.id === e.pointerId) {
        rolagem.arrasto.mover(e.clientX, e.clientY);
        return;
      }
      if (ativo !== e.pointerId) return;
      e.preventDefault();
      const eventos = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [e];
      for (const ev of eventos.length ? eventos : [e]) {
        if (apagando) apagarEm(ponto(ev)); else atual?.push(ponto(ev));
      }
      if (!apagando) desenhar();
    });
    const soltar = (e: PointerEvent) => {
      if (rolagem && rolagem.id === e.pointerId) { rolagem.arrasto.soltar(); rolagem = null; return; }
      if (ativo !== e.pointerId) return;
      notarCaneta(e);
      ativo = null;
      if (apagando) { if (apagouAlgo) gravar(); return; }
      const pts = atual; atual = null;
      if (pts && pts.length) {
        bloco.tracos.push(tracoDoPincel(pts.length === 1 ? [pts[0], { ...pts[0], x: pts[0].x + 0.3 }] : pts));
        desenhar();
        gravar();
      }
    };
    folha.addEventListener("pointerup", soltar);
    folha.addEventListener("pointercancel", (e) => { if (rolagem?.id === e.pointerId) rolagem = null; if (ativo === e.pointerId) { ativo = null; atual = null; desenhar(); } });

    // Alça: muda a altura da folha (em px da folha, não da tela).
    alca.addEventListener("pointerdown", (e) => {
      e.preventDefault(); e.stopPropagation();
      alca.setPointerCapture(e.pointerId);
      const y0 = e.clientY, h0 = bloco.altura;
      const mover = (ev: PointerEvent) => {
        bloco.altura = Math.min(ALTURA_ESCRITA_MAX, Math.max(ALTURA_ESCRITA_MIN, Math.round(h0 + (ev.clientY - y0) / escala)));
        desenhar();
      };
      const fim = () => { alca.removeEventListener("pointermove", mover); alca.removeEventListener("pointerup", fim); alca.removeEventListener("pointercancel", fim); gravar(); };
      alca.addEventListener("pointermove", mover);
      alca.addEventListener("pointerup", fim);
      alca.addEventListener("pointercancel", fim);
    });
    return raiz;
  }
  ignoreEvent() { return true; }
}

function montar(state: EditorState): DecorationSet {
  if (!state.doc.toString().includes("```escrita")) return Decoration.none;
  const decos: Range<Decoration>[] = [];
  (ensureSyntaxTree(state, state.doc.length, 250) ?? syntaxTree(state)).iterate({
    enter: (no) => {
      if (no.name !== "FencedCode") return;
      const info = no.node.getChild("CodeInfo");
      if (info && ehLinguagemEscrita(state.sliceDoc(info.from, info.to))) {
        const fonte = state.sliceDoc(no.from, no.to);
        // Só o bloco fechado vira folha (enquanto digita a cerca, fica texto).
        if (/\n```[ \t]*$/.test(fonte)) decos.push(Decoration.replace({ widget: new EscritaWidget(fonte), block: true }).range(no.from, no.to));
      }
      return false;
    },
  });
  return Decoration.set(decos, true);
}

/** Decoração de bloco precisa vir de um StateField. A faixa é atômica: o cursor passa por cima do bloco. */
export const blocosEscrita = StateField.define<DecorationSet>({
  create: montar,
  update(v, tr) { return tr.docChanged ? montar(tr.state) : v; },
  provide: (f) => [
    EditorView.decorations.from(f), EditorView.atomicRanges.of((view) => view.state.field(f)),
    // Palma encostando no texto enquanto (ou logo depois que) a caneta escreve num bloco: ignora, senão abre o teclado.
    EditorView.domEventHandlers({
      touchstart: (e) => { if (Date.now() - ultimaCaneta < 1500) { if (e.cancelable) e.preventDefault(); return true; } return false; },
      mousedown: (e) => (Date.now() - ultimaCaneta < 1500 && !(e.target instanceof Element && e.target.closest(".cm-escrita")) ? (e.preventDefault(), true) : false),
    }),
  ],
});

export const temaEscrita = EditorView.theme({
  ".cm-escrita": { position: "relative", margin: "6px 0", userSelect: "none" },
  ".cm-escrita-folha": {
    position: "relative", width: "100%", borderRadius: "10px", overflow: "hidden", touchAction: "none", cursor: "crosshair",
    border: "1px solid rgb(var(--ecos-text-primary-rgb) / 0.12)",
    backgroundColor: "rgb(var(--ecos-surface-2-rgb) / 0.5)",
    backgroundImage: "linear-gradient(rgb(var(--ecos-text-primary-rgb) / 0.08) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--ecos-text-primary-rgb) / 0.08) 1px, transparent 1px)",
  },
  ".cm-escrita-folha canvas": { position: "absolute", inset: "0", display: "block" },
  ".cm-escrita-barra": {
    position: "absolute", top: "6px", right: "6px", display: "flex", gap: "2px", padding: "2px", borderRadius: "8px",
    background: "rgb(var(--ecos-surface-2-rgb) / 0.9)", border: "1px solid rgb(var(--ecos-text-primary-rgb) / 0.1)",
    opacity: "0", transition: "opacity 160ms ease",
  },
  ".cm-escrita:hover .cm-escrita-barra, .cm-escrita:focus-within .cm-escrita-barra": { opacity: "1" },
  "[data-escrevendo] & .cm-escrita-barra": { display: "none" },
  "@media (hover: none)": { ".cm-escrita-barra": { opacity: "1" } },
  ".cm-escrita-barra button": {
    display: "flex", alignItems: "center", justifyContent: "center", width: "28px", height: "28px", borderRadius: "6px",
    color: "rgb(var(--ecos-text-secondary-rgb))", background: "transparent", border: "0", cursor: "pointer",
  },
  ".cm-escrita-barra button:hover": { background: "rgb(var(--ecos-text-primary-rgb) / 0.08)", color: "rgb(var(--ecos-text-primary-rgb))" },
  ".cm-escrita-barra button[aria-pressed=true]": { background: "rgb(var(--ecos-steel-500-rgb) / 0.25)", color: "rgb(var(--ecos-text-primary-rgb))" },
  ".cm-escrita-alca": {
    position: "absolute", left: "50%", bottom: "-5px", width: "44px", height: "10px", marginLeft: "-22px", cursor: "ns-resize", touchAction: "none",
    borderRadius: "5px", background: "rgb(var(--ecos-text-primary-rgb) / 0.18)", opacity: "0", transition: "opacity 160ms ease",
  },
  ".cm-escrita:hover .cm-escrita-alca": { opacity: "1" },
  "@media (hover: none) ": { ".cm-escrita-alca": { opacity: "1" } },
});
