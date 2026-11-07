/**
 * Coluna de largura fixa com a camada de tinta por cima do texto da Nota.
 *
 * - A coluna tem sempre `largura` px de conteúdo (folha A4); em tela mais estreita é reduzida por
 *   `scale` até caber na largura, então as coordenadas absolutas valem igual em qualquer aparelho.
 *   A pinça (dois dedos) amplia a partir daí, e a coluna rola na horizontal quando passa da tela.
 * - O canvas cobre só a parte visível da coluna (não a Nota inteira: textura de 760×20000 estoura
 *   memória no Android) e é redesenhado na rolagem, só com os traços que cruzam a área visível.
 * - Modo de escrita: `touch-action: none`; caneta e mouse desenham, dedo rola (rolagem feita aqui),
 *   a não ser com "desenhar com o dedo". Toque durante um traço de caneta, ou com área de contato
 *   grande, é palma e é ignorado. O botão da caneta (ou a ponta de borracha) apaga.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { atinge, caixa, gerarD, intersecta, novoTraco } from "@/lib/tinta/geometria";
import type { Operacao } from "@/lib/tinta/historico";
import type { Ferramenta, PontoTinta, Traco } from "@/lib/tinta/tipos";

export type FerramentaUI = Ferramenta | "borracha";

export interface Pincel { ferramenta: FerramentaUI; cor: string; espessura: number }

interface Props {
  largura: number;
  tracos: readonly Traco[];
  escrevendo: boolean;
  pincel: Pincel;
  dedoDesenha: boolean;
  onOperacao: (op: Operacao) => void;
  children: ReactNode;
}

const RAIO_BORRACHA = 10;

/** Recuo do texto dentro da coluna: igual em toda tela (editor, Focus, leitura no celular), senão a tinta desalinha. */
export const CLASSE_TEXTO_COLUNA = "p-4";

/** Maior ampliação pela pinça (escala final da coluna). */
export const ESCALA_MAXIMA = 3;
/** Lado máximo do canvas em px do aparelho: acima disso, em zoom alto, a tinta perde nitidez em vez de estourar memória. */
const LADO_MAXIMO_CANVAS = 4096;
/** Altura mínima da coluna (px da coluna): sempre há espaço para escrever, mesmo em Nota curta. */
export const ALTURA_MINIMA_COLUNA = 720;
/** Espaço livre abaixo do texto e da última anotação enquanto se escreve. */
export const ESPACO_ESCRITA = 360;
const caminhos = new WeakMap<Traco, Path2D>();
const caminho = (t: Traco) => { let p = caminhos.get(t); if (!p) { p = new Path2D(t.d); caminhos.set(t, p); } return p; };

function corTexto(): { cor: string; escuro: boolean } {
  const rgb = getComputedStyle(document.documentElement).getPropertyValue("--ecos-text-primary-rgb").trim() || "15 23 41";
  const [r, g, b] = rgb.split(/[\s,]+/).map(Number);
  // Texto claro = tema escuro.
  return { cor: `rgb(${r} ${g} ${b})`, escuro: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.5 };
}

function desenharTraco(ctx: CanvasRenderingContext2D, t: Pick<Traco, "ferramenta" | "cor" | "espessura" | "d">, tema: { cor: string; escuro: boolean }, p: Path2D) {
  const cor = t.cor === "auto" ? tema.cor : t.cor;
  if (t.ferramenta === "caneta") {
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = cor;
    ctx.fill(p);
  } else {
    // Marca-texto não apaga o texto: multiplica no claro, "clareia" no escuro.
    ctx.globalCompositeOperation = tema.escuro ? "screen" : "multiply";
    ctx.globalAlpha = tema.escuro ? 0.4 : 0.45;
    ctx.strokeStyle = cor;
    ctx.lineWidth = t.espessura;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke(p);
  }
}

function rolavel(el: HTMLElement | null): HTMLElement | Element {
  for (let n = el?.parentElement; n; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight) return n;
  }
  return document.scrollingElement ?? document.documentElement;
}

type Gesto =
  | { tipo: "desenho"; id: number; pontos: PontoTinta[]; caneta: boolean }
  | { tipo: "borracha"; id: number; ids: Set<string> }
  | { tipo: "rolagem"; id: number; x: number; y: number; alvo: HTMLElement | Element; lateral: HTMLElement | null };

export function ColunaTinta({ largura, tracos, escrevendo, pincel, dedoDesenha, onOperacao, children }: Props) {
  const fora = useRef<HTMLDivElement>(null);
  const dentro = useRef<HTMLDivElement>(null);
  const tela = useRef<HTMLCanvasElement>(null);
  /** Escala que faz a coluna caber na largura disponível (nunca amplia). */
  const [ajuste, setAjuste] = useState(1);
  /** Ampliação da pinça sobre o ajuste (1 = ajustada à largura). */
  const [zoom, setZoom] = useState(1);
  const escala = ajuste * zoom;
  const pinca = useRef<{ d0: number; z0: number } | null>(null);
  /** Ponto da coluna que deve ficar sob o meio da pinça depois de aplicar o novo zoom. */
  const ancora = useRef<{ cx: number; cy: number; mx: number; my: number } | null>(null);
  const [larguraFora, setLarguraFora] = useState(largura);
  const [alturaDentro, setAlturaDentro] = useState(0);
  const [fontesProntas, setFontesProntas] = useState(false);
  const gesto = useRef<Gesto | null>(null);
  const penAtiva = useRef(false);
  const quadro = useRef(0);
  const tema = useRef(corTexto());
  /** Fundo da anotação mais baixa: a coluna nunca corta tinta escrita abaixo do texto. */
  const fundoTinta = useMemo(() => tracos.reduce((m, t) => (t.apagado_em ? m : Math.max(m, caixa(t).y1)), 0), [tracos]);
  const alturaMinima = Math.max(ALTURA_MINIMA_COLUNA, Math.ceil(fundoTinta) + (escrevendo ? ESPACO_ESCRITA : 48));
  const estado = useRef({ tracos, escala, ajuste, zoom, pincel });
  estado.current = { tracos, escala, ajuste, zoom, pincel };

  useLayoutEffect(() => {
    const f = fora.current, d = dentro.current;
    if (!f || !d) return;
    const medir = () => {
      const w = f.clientWidth || largura;
      setLarguraFora(w);
      setAjuste(Math.min(1, w / largura));
      setAlturaDentro(d.offsetHeight);
    };
    medir();
    const obs = new ResizeObserver(medir);
    obs.observe(f);
    obs.observe(d);
    return () => obs.disconnect();
  }, [largura]);

  useEffect(() => {
    let ativo = true;
    // A tinta só aparece com as fontes carregadas: antes disso o texto ainda vai mudar de lugar.
    void document.fonts.ready.then(() => { if (ativo) setFontesProntas(true); });
    return () => { ativo = false; };
  }, []);

  const desenhar = useCallback(() => {
    quadro.current = 0;
    const c = tela.current, d = dentro.current;
    if (!c || !d) return;
    const { tracos: lista, escala: s, pincel: p } = estado.current;
    const r = d.getBoundingClientRect();
    const altura = d.offsetHeight;
    const topo = Math.max(0, Math.min(altura, -r.top / s));
    const fundo = Math.max(topo, Math.min(altura, (window.innerHeight - r.top) / s));
    const h = Math.ceil(fundo - topo);
    const dpr = window.devicePixelRatio || 1;
    c.style.top = `${topo}px`;
    c.style.height = `${h}px`;
    // px do canvas por px da coluna; limitado para o canvas não estourar memória em zoom alto.
    const k = Math.min(s * dpr, LADO_MAXIMO_CANVAS / largura);
    const bw = Math.max(1, Math.round(largura * k)), bh = Math.max(1, Math.round(Math.min(h * k, LADO_MAXIMO_CANVAS)));
    if (c.width !== bw) c.width = bw;
    if (c.height !== bh) c.height = bh;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    if (!h) return;
    ctx.setTransform(k, 0, 0, k, 0, -topo * k);
    const visivel = { x0: -largura, y0: topo, x1: largura * 2, y1: fundo };
    const g = gesto.current;
    const apagando = g?.tipo === "borracha" ? g.ids : null;
    for (const t of lista) {
      if (t.apagado_em || apagando?.has(t.id) || !intersecta(caixa(t), visivel)) continue;
      desenharTraco(ctx, t, tema.current, caminho(t));
    }
    if (g?.tipo === "desenho" && p.ferramenta !== "borracha" && g.pontos.length) {
      desenharTraco(ctx, { ferramenta: p.ferramenta, cor: p.cor, espessura: p.espessura, d: "" }, tema.current, new Path2D(gerarD(p.ferramenta, g.pontos, p.espessura)));
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }, [largura]);

  const agendar = useCallback(() => { if (!quadro.current) quadro.current = requestAnimationFrame(desenhar); }, [desenhar]);

  useEffect(() => { agendar(); }, [tracos, escala, alturaDentro, fontesProntas, agendar]);

  useEffect(() => {
    window.addEventListener("scroll", agendar, { capture: true, passive: true });
    window.addEventListener("resize", agendar);
    // Troca de tema muda a cor "auto" e o modo do marca-texto.
    const obs = new MutationObserver(() => { tema.current = corTexto(); agendar(); });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "data-tema", "style"] });
    return () => {
      window.removeEventListener("scroll", agendar, { capture: true });
      window.removeEventListener("resize", agendar);
      obs.disconnect();
      if (quadro.current) cancelAnimationFrame(quadro.current);
      quadro.current = 0;
    };
  }, [agendar]);

  // Pinça: eventos de toque (não de ponteiro), porque o navegador cancela o ponteiro do 1º dedo
  // quando começa a rolar. A coluna tem `touch-action: pan-x pan-y`: o navegador rola, a pinça é daqui.
  useEffect(() => {
    const f = fora.current;
    if (!f) return;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const inicio = (e: TouchEvent) => {
      if (e.touches.length !== 2 || penAtiva.current) return;
      // O 2º dedo transforma rolagem ou traço de dedo em pinça; traço de caneta continua.
      const g = gesto.current;
      if (g && !(g.tipo === "desenho" && g.caneta)) gesto.current = null;
      if (gesto.current) return;
      pinca.current = { d0: dist(e.touches) || 1, z0: estado.current.zoom };
      agendar();
    };
    const mover = (e: TouchEvent) => {
      const p = pinca.current, d = dentro.current;
      if (!p || !d || e.touches.length !== 2) return;
      if (e.cancelable) e.preventDefault();
      const { ajuste: a, escala: s } = estado.current;
      const z = Math.max(1, Math.min(ESCALA_MAXIMA / a, p.z0 * dist(e.touches) / p.d0));
      const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2, my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const r = d.getBoundingClientRect();
      ancora.current = { cx: (mx - r.left) / s, cy: (my - r.top) / s, mx, my };
      setZoom(z);
    };
    const fim = (e: TouchEvent) => { if (e.touches.length < 2) pinca.current = null; };
    f.addEventListener("touchstart", inicio, { passive: true });
    f.addEventListener("touchmove", mover, { passive: false });
    f.addEventListener("touchend", fim, { passive: true });
    f.addEventListener("touchcancel", fim, { passive: true });
    return () => {
      f.removeEventListener("touchstart", inicio);
      f.removeEventListener("touchmove", mover);
      f.removeEventListener("touchend", fim);
      f.removeEventListener("touchcancel", fim);
    };
  }, [agendar]);

  // Depois do novo zoom, rola para o ponto sob a pinça continuar sob os dedos.
  useLayoutEffect(() => {
    const a = ancora.current, f = fora.current, d = dentro.current;
    ancora.current = null;
    if (!a || !f || !d) return;
    const r = d.getBoundingClientRect();
    f.scrollLeft += r.left + a.cx * escala - a.mx;
    rolavel(f).scrollBy({ top: r.top + a.cy * escala - a.my });
    agendar();
  }, [escala, agendar]);

  const ponto = (e: PointerEvent): PontoTinta => {
    const r = dentro.current!.getBoundingClientRect();
    const s = estado.current.escala;
    return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s, pressao: e.pointerType === "pen" ? (e.pressure || 0.5) : 0.5 };
  };

  const apagarEm = (g: Extract<Gesto, { tipo: "borracha" }>, e: PointerEvent) => {
    const { x, y } = ponto(e);
    const raio = RAIO_BORRACHA / estado.current.escala;
    for (const t of estado.current.tracos) if (!t.apagado_em && !g.ids.has(t.id) && atinge(t, x, y, raio)) g.ids.add(t.id);
  };

  function aoTocar(ev: React.PointerEvent<HTMLCanvasElement>) {
    if (!escrevendo) return;
    const e = ev.nativeEvent;
    if (gesto.current) return;
    const toque = e.pointerType === "touch";
    if (toque && (penAtiva.current || e.width * e.height > 1600)) return; // palma
    if (e.pointerType === "mouse" && e.button !== 0) return;
    ev.preventDefault();
    ev.currentTarget.setPointerCapture(e.pointerId);
    if (toque && !dedoDesenha) {
      const f = fora.current;
      gesto.current = { tipo: "rolagem", id: e.pointerId, x: e.clientX, y: e.clientY, alvo: rolavel(f), lateral: f && f.scrollWidth > f.clientWidth ? f : null };
      return;
    }
    if (e.pointerType === "pen") penAtiva.current = true;
    const borrachaDaCaneta = e.pointerType === "pen" && (e.button === 5 || (e.buttons & 32) !== 0 || (e.button === 2));
    if (borrachaDaCaneta || estado.current.pincel.ferramenta === "borracha") {
      const g: Extract<Gesto, { tipo: "borracha" }> = { tipo: "borracha", id: e.pointerId, ids: new Set() };
      gesto.current = g;
      apagarEm(g, e);
    } else {
      gesto.current = { tipo: "desenho", id: e.pointerId, pontos: [ponto(e)], caneta: e.pointerType === "pen" };
    }
    agendar();
  }

  function aoMover(ev: React.PointerEvent<HTMLCanvasElement>) {
    const g = gesto.current;
    const e = ev.nativeEvent;
    if (!g || g.id !== e.pointerId) return;
    ev.preventDefault();
    if (g.tipo === "rolagem") {
      g.lateral?.scrollBy({ left: g.x - e.clientX });
      g.alvo.scrollBy({ top: g.y - e.clientY });
      g.x = e.clientX; g.y = e.clientY;
      return;
    }
    const eventos = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
    for (const sub of eventos.length ? eventos : [e]) {
      if (g.tipo === "desenho") g.pontos.push(ponto(sub));
      else apagarEm(g, sub);
    }
    agendar();
  }

  function aoSoltar(ev: React.PointerEvent<HTMLCanvasElement>) {
    const g = gesto.current;
    const e = ev.nativeEvent;
    if (!g || g.id !== e.pointerId) return;
    gesto.current = null;
    if (e.pointerType === "pen") penAtiva.current = false;
    const cancelado = e.type === "pointercancel";
    if (g.tipo === "desenho" && !cancelado && g.pontos.length) {
      const { ferramenta, cor, espessura } = estado.current.pincel;
      if (ferramenta !== "borracha") onOperacao({ tipo: "adicionar", traco: novoTraco(ferramenta, cor, espessura, g.pontos) });
    } else if (g.tipo === "borracha" && !cancelado && g.ids.size) {
      onOperacao({ tipo: "apagar", ids: [...g.ids], em: new Date().toISOString() });
    }
    agendar();
  }

  const esquerda = Math.max(0, (larguraFora - largura * escala) / 2);
  return (
    <div ref={fora} className="relative w-full min-w-0 overflow-y-hidden" style={{ height: alturaDentro * escala || undefined, overflowX: largura * escala > larguraFora + 1 ? "auto" : "hidden", touchAction: "pan-x pan-y" }} data-coluna-tinta>
      <div ref={dentro} className="absolute top-0" style={{ width: largura, minHeight: alturaMinima, left: esquerda, transform: escala !== 1 ? `scale(${escala})` : undefined, transformOrigin: "top left" }}>
        {children}
        {escrevendo && <div aria-hidden style={{ height: ESPACO_ESCRITA }} />}
        <canvas ref={tela} aria-hidden={!escrevendo} aria-label={escrevendo ? "Área de escrita à mão" : undefined}
          className={`absolute left-0 z-10 transition-opacity duration-200 motion-reduce:transition-none ${fontesProntas ? "opacity-100" : "opacity-0"} ${escrevendo ? (pincel.ferramenta === "borracha" ? "cursor-cell" : "cursor-crosshair") : ""}`}
          style={{ width: largura, top: 0, height: 0, pointerEvents: escrevendo ? "auto" : "none", touchAction: escrevendo ? "none" : "auto" }}
          onPointerDown={aoTocar} onPointerMove={aoMover} onPointerUp={aoSoltar} onPointerCancel={aoSoltar} onContextMenu={(e) => { if (escrevendo) e.preventDefault(); }} />
      </div>
    </div>
  );
}
