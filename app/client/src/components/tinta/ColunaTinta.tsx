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
import { Trash2, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { atinge, caixa, caixaDoConjunto, cortar, densificar, gerarD, intersecta, novoTraco, reconhecerForma, selecionadosPeloLaco, transformarTraco } from "@/lib/tinta/geometria";
import type { Operacao } from "@/lib/tinta/historico";
import { lerPreferenciasAplicativo } from "@/lib/preferencias-aplicativo";
import type { Ferramenta, PontoTinta, Traco } from "@/lib/tinta/tipos";
import { desenhoFolha, type EstiloFolha } from "@/lib/tinta/folha";

export type FerramentaUI = Ferramenta | "borracha" | "laco";

export type ModoBorracha = "traco" | "trecho";

export interface Pincel { ferramenta: FerramentaUI; cor: string; espessura: number; /** Borracha: apaga o traço inteiro ou só o trecho tocado. */ modoBorracha?: ModoBorracha }

interface Props {
  largura: number;
  tracos: readonly Traco[];
  escrevendo: boolean;
  pincel: Pincel;
  dedoDesenha: boolean;
  onOperacao: (op: Operacao) => void;
  /** Duplo clique no botão da S Pen (sem tocar a tela): alterna caneta e marca-texto. */
  onAlternarCaneta?: () => void;
  /** Desenho da folha atrás da tinta (só no Modo de escrita). */
  estiloFolha?: EstiloFolha;
  children: ReactNode;
}

const RAIO_BORRACHA = 10;
/** Raio (px da tela) da alça de ampliar da seleção e folga da caixa em volta dos traços. */
const RAIO_ALCA = 14;
/** Dois cliques no botão da caneta dentro deste intervalo = duplo clique. */
const DUPLO_CLIQUE_MS = 500;
/** Estabilizador: fração do caminho até a ponta da caneta que cada ponto novo percorre (1 = sem filtro). */
const SUAVIDADE = 0.7;

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
  | { tipo: "desenho"; id: number; pontos: PontoTinta[]; caneta: boolean; forma: boolean }
  | { tipo: "borracha"; id: number; ids: Set<string>; parcial: boolean; caminho: { x: number; y: number }[] }
  | { tipo: "laco"; id: number; pontos: { x: number; y: number }[] }
  | { tipo: "mover"; id: number; x0: number; y0: number; dx: number; dy: number }
  | { tipo: "escalar"; id: number; ox: number; oy: number; r0: number; fator: number }
  | { tipo: "rolagem"; id: number; x: number; y: number; alvo: HTMLElement | Element; lateral: HTMLElement | null };

export function ColunaTinta({ largura, tracos, escrevendo, pincel, dedoDesenha, onOperacao, onAlternarCaneta, estiloFolha = "lisa", children }: Props) {
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
  const espera = useRef({ timer: 0, ancora: { x: 0, y: 0 } });
  /** Botão lateral da caneta: estado anterior e instante do último clique (duplo clique sem tocar a tela). */
  const botaoLateral = useRef({ apertado: false, quando: 0 });
  /** Traços selecionados pelo laço. */
  const [selecao, setSelecao] = useState<string[]>([]);
  const [editandoSelecao, setEditandoSelecao] = useState(false);
  const quadro = useRef(0);
  const tema = useRef(corTexto());
  /** Fundo da anotação mais baixa: a coluna nunca corta tinta escrita abaixo do texto. */
  const fundoTinta = useMemo(() => tracos.reduce((m, t) => (t.apagado_em ? m : Math.max(m, caixa(t).y1)), 0), [tracos]);
  // Escrevendo, a folha cobre pelo menos a tela inteira (sem faixa preta embaixo, e dá para escrever até o fim).
  const alturaMinima = Math.max(ALTURA_MINIMA_COLUNA, Math.ceil(fundoTinta) + (escrevendo ? ESPACO_ESCRITA : 48), escrevendo ? Math.ceil(window.innerHeight / escala) : 0);
  const idsAtivos = useMemo(() => new Set(tracos.filter((t) => !t.apagado_em).map((t) => t.id)), [tracos]);
  const selAtiva = useMemo(() => selecao.filter((id) => idsAtivos.has(id)), [selecao, idsAtivos]);
  const estado = useRef({ tracos, escala, ajuste, zoom, pincel, selecao: selAtiva });
  estado.current = { tracos, escala, ajuste, zoom, pincel, selecao: selAtiva };
  // Trocar de ferramenta (ou sair do modo de escrita) larga a seleção.
  useEffect(() => { if (!escrevendo || pincel.ferramenta !== "laco") setSelecao([]); }, [escrevendo, pincel.ferramenta]);

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
    const { tracos: lista, escala: s, pincel: p, selecao: sel } = estado.current;
    const r = d.getBoundingClientRect();
    const altura = d.offsetHeight;
    const topo = Math.max(0, Math.min(altura, -r.top / s));
    const fundo = Math.max(topo, Math.min(altura, (window.innerHeight - r.top) / s));
    const h = Math.ceil(fundo - topo);
    const dpr = window.devicePixelRatio || 1;
    c.style.top = `${topo}px`;
    c.style.height = `${h}px`;
    // px do canvas por px da coluna; limitado para o canvas não estourar memória em zoom alto.
    // A tela de desenho vai de borda a borda da área visível: dá para escrever fora da coluna (coordenadas negativas ou além da largura).
    const m = Math.max(0, ((fora.current?.clientWidth ?? largura) - largura * s) / 2 / s);
    const k = Math.min(s * dpr, LADO_MAXIMO_CANVAS / (largura + 2 * m));
    const bw = Math.max(1, Math.round((largura + 2 * m) * k)), bh = Math.max(1, Math.round(Math.min(h * k, LADO_MAXIMO_CANVAS)));
    if (c.width !== bw) c.width = bw;
    if (c.height !== bh) c.height = bh;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    if (!h) return;
    ctx.setTransform(k, 0, 0, k, m * k, -topo * k);
    const visivel = { x0: -m, y0: topo, x1: largura + m, y1: fundo };
    const g = gesto.current;
    const apagando = g?.tipo === "borracha" ? g.ids : null;
    for (const t of lista) {
      if (t.apagado_em || !intersecta(caixa(t), visivel)) continue;
      if (apagando?.has(t.id)) {
        // Por trecho: mostra já só o que vai sobrar; por traço: some inteiro.
        if (g?.tipo === "borracha" && g.parcial) {
          for (const pedaco of cortar(t, g.caminho, RAIO_BORRACHA / s)) desenharTraco(ctx, t, tema.current, new Path2D(gerarD(t.ferramenta, pedaco, t.espessura)));
        }
        continue;
      }
      if (g && (g.tipo === "mover" || g.tipo === "escalar") && sel.includes(t.id)) {
        ctx.save();
        if (g.tipo === "mover") ctx.translate(g.dx, g.dy);
        else { ctx.translate(g.ox, g.oy); ctx.scale(g.fator, g.fator); ctx.translate(-g.ox, -g.oy); }
        desenharTraco(ctx, t, tema.current, caminho(t));
        ctx.restore();
        continue;
      }
      desenharTraco(ctx, t, tema.current, caminho(t));
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    // Laço em andamento e caixa da seleção (tracejadas), com a alça de ampliar no canto.
    ctx.strokeStyle = "rgb(147 197 253)";
    ctx.lineWidth = 1.5 / s;
    ctx.setLineDash([6 / s, 5 / s]);
    if (g?.tipo === "laco" && g.pontos.length > 1) {
      ctx.beginPath();
      g.pontos.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.stroke();
    }
    const caixaSel = caixaDoConjunto(lista.filter((t) => sel.includes(t.id)));
    if (caixaSel) {
      const b = { ...caixaSel };
      if (g?.tipo === "mover") { b.x0 += g.dx; b.x1 += g.dx; b.y0 += g.dy; b.y1 += g.dy; }
      else if (g?.tipo === "escalar") { b.x0 = g.ox + (b.x0 - g.ox) * g.fator; b.x1 = g.ox + (b.x1 - g.ox) * g.fator; b.y0 = g.oy + (b.y0 - g.oy) * g.fator; b.y1 = g.oy + (b.y1 - g.oy) * g.fator; }
      ctx.strokeRect(b.x0 - 4, b.y0 - 4, b.x1 - b.x0 + 8, b.y1 - b.y0 + 8);
      ctx.setLineDash([]);
      ctx.fillStyle = "rgb(147 197 253)";
      ctx.beginPath();
      ctx.arc(b.x1 + 4, b.y1 + 4, 7 / s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.setLineDash([]);
    if (g?.tipo === "desenho" && p.ferramenta !== "borracha" && p.ferramenta !== "laco" && g.pontos.length) {
      desenharTraco(ctx, { ferramenta: p.ferramenta, cor: p.cor, espessura: p.espessura, d: "" }, tema.current, new Path2D(gerarD(p.ferramenta, g.pontos, p.espessura)));
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }, [largura]);

  const agendar = useCallback(() => { if (!quadro.current) quadro.current = requestAnimationFrame(desenhar); }, [desenhar]);

  useEffect(() => { agendar(); }, [tracos, escala, alturaDentro, fontesProntas, selAtiva, agendar]);

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
    const u = g.caminho[g.caminho.length - 1];
    if (!u || Math.hypot(u.x - x, u.y - y) >= raio / 2) g.caminho.push({ x, y });
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
    botaoLateral.current = { apertado: false, quando: 0 }; // tocar a tela cancela um duplo clique em andamento
    const borrachaDaCaneta = e.pointerType === "pen" && (e.button === 5 || (e.buttons & 34) !== 0 || e.button === 2); // 2 = botão lateral (S Pen no Android/WebView), 32 = ponta de borracha
    if (!borrachaDaCaneta && estado.current.pincel.ferramenta === "laco") {
      const p = ponto(e);
      const cx = caixaDoConjunto(estado.current.tracos.filter((t) => estado.current.selecao.includes(t.id)));
      const s = estado.current.escala;
      if (cx && Math.hypot(p.x - (cx.x1 + 4), p.y - (cx.y1 + 4)) * s <= RAIO_ALCA + 8) {
        gesto.current = { tipo: "escalar", id: e.pointerId, ox: cx.x0, oy: cx.y0, r0: Math.max(8, Math.hypot(p.x - cx.x0, p.y - cx.y0)), fator: 1 };
        setEditandoSelecao(true);
      } else if (cx && p.x >= cx.x0 - 4 && p.x <= cx.x1 + 4 && p.y >= cx.y0 - 4 && p.y <= cx.y1 + 4) {
        gesto.current = { tipo: "mover", id: e.pointerId, x0: p.x, y0: p.y, dx: 0, dy: 0 };
        setEditandoSelecao(true);
      } else {
        setSelecao([]);
        gesto.current = { tipo: "laco", id: e.pointerId, pontos: [{ x: p.x, y: p.y }] };
      }
    } else if (borrachaDaCaneta || estado.current.pincel.ferramenta === "borracha") {
      const g: Extract<Gesto, { tipo: "borracha" }> = { tipo: "borracha", id: e.pointerId, ids: new Set(), parcial: estado.current.pincel.modoBorracha === "trecho", caminho: [] };
      gesto.current = g;
      apagarEm(g, e);
    } else {
      gesto.current = { tipo: "desenho", id: e.pointerId, pontos: [ponto(e)], caneta: e.pointerType === "pen", forma: false };
      espera.current.ancora = ponto(e);
    }
    agendar();
  }

  function aoMover(ev: React.PointerEvent<HTMLCanvasElement>) {
    const g = gesto.current;
    const e = ev.nativeEvent;
    if (!g && escrevendo && e.pointerType === "pen" && !e.pressure) vigiarBotaoLateral(e);
    if (!g || g.id !== e.pointerId) return;
    ev.preventDefault();
    if (g.tipo === "rolagem") {
      g.lateral?.scrollBy({ left: g.x - e.clientX });
      g.alvo.scrollBy({ top: g.y - e.clientY });
      g.x = e.clientX; g.y = e.clientY;
      return;
    }
    if (g.tipo === "laco" || g.tipo === "mover" || g.tipo === "escalar") {
      const q = ponto(e);
      if (g.tipo === "laco") g.pontos.push({ x: q.x, y: q.y });
      else if (g.tipo === "mover") { g.dx = q.x - g.x0; g.dy = q.y - g.y0; }
      else g.fator = Math.min(6, Math.max(0.2, Math.hypot(q.x - g.ox, q.y - g.oy) / g.r0));
      agendar();
      return;
    }
    const eventos = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
    for (const sub of eventos.length ? eventos : [e]) {
      if (g.tipo === "desenho") {
        if (g.forma) continue; // figura já encaixada: o resto do movimento até soltar é ignorado
        const novo = ponto(sub), u = g.pontos[g.pontos.length - 1];
        g.pontos.push(u && g.pontos.length > 1 ? { x: u.x + (novo.x - u.x) * SUAVIDADE, y: u.y + (novo.y - u.y) * SUAVIDADE, pressao: novo.pressao } : novo);
      } else apagarEm(g, sub);
    }
    if (g.tipo === "desenho" && !g.forma && lerPreferenciasAplicativo().escritaFormas === "segurar") esperarForma(g, e);
    agendar();
  }

  /** Duplo clique no botão lateral da caneta, com ela no ar (a borda de subida de `buttons & 2` vira um clique). */
  function vigiarBotaoLateral(e: PointerEvent) {
    const b = botaoLateral.current;
    const apertado = (e.buttons & 2) !== 0;
    if (apertado && !b.apertado) {
      const agora = performance.now();
      if (agora - b.quando < DUPLO_CLIQUE_MS) { botaoLateral.current = { apertado, quando: 0 }; onAlternarCaneta?.(); return; }
      b.quando = agora;
    }
    b.apertado = apertado;
  }

  /** Segurar a caneta parada ao fim de um traço encaixa a figura geométrica (linha, círculo, retângulo, triângulo). */
  function esperarForma(g: Extract<Gesto, { tipo: "desenho" }>, e: PointerEvent) {
    const p = ponto(e), a = espera.current;
    if (Math.hypot(p.x - a.ancora.x, p.y - a.ancora.y) * estado.current.escala <= 4 && a.timer) return;
    a.ancora = p;
    window.clearTimeout(a.timer);
    a.timer = window.setTimeout(() => {
      a.timer = 0;
      if (gesto.current !== g || g.forma) return;
      const r = reconhecerForma(g.pontos);
      if (!r) return;
      g.pontos = r.pontos;
      g.forma = true;
      navigator.vibrate?.(12);
      agendar();
    }, lerPreferenciasAplicativo().escritaEsperaFormaMs);
  }

  function aoSoltar(ev: React.PointerEvent<HTMLCanvasElement>) {
    const g = gesto.current;
    const e = ev.nativeEvent;
    if (!g || g.id !== e.pointerId) return;
    gesto.current = null;
    window.clearTimeout(espera.current.timer);
    espera.current.timer = 0;
    if (e.pointerType === "pen") penAtiva.current = false;
    const cancelado = e.type === "pointercancel";
    if (g.tipo === "laco") {
      if (!cancelado) setSelecao(selecionadosPeloLaco(estado.current.tracos, g.pontos));
      agendar();
      return;
    }
    if (g.tipo === "mover" || g.tipo === "escalar") {
      setEditandoSelecao(false);
      const alterou = g.tipo === "mover" ? Math.hypot(g.dx, g.dy) > 2 : Math.abs(g.fator - 1) > 0.02;
      if (!cancelado && alterou) {
        const alvos = estado.current.tracos.filter((t) => estado.current.selecao.includes(t.id));
        const novos = alvos.map((t) => (g.tipo === "mover" ? transformarTraco(t, { x: 0, y: 0 }, 1, g.dx, g.dy) : transformarTraco(t, { x: g.ox, y: g.oy }, g.fator, 0, 0)));
        onOperacao({ tipo: "substituir", ids: alvos.map((t) => t.id), novos, em: new Date().toISOString() });
        setSelecao(novos.map((t) => t.id));
      }
      agendar();
      return;
    }
    if (g.tipo === "desenho" && !cancelado && !g.forma && g.pontos.length && lerPreferenciasAplicativo().escritaFormas === "ao-soltar") {
      const r = reconhecerForma(g.pontos);
      if (r) g.pontos = r.pontos;
    }
    if (g.tipo === "desenho" && !cancelado && g.pontos.length) {
      const { ferramenta, cor, espessura } = estado.current.pincel;
      if (ferramenta !== "borracha" && ferramenta !== "laco") onOperacao({ tipo: "adicionar", traco: novoTraco(ferramenta, cor, espessura, g.pontos) });
    } else if (g.tipo === "borracha" && !cancelado && g.ids.size) {
      const em = new Date().toISOString();
      if (!g.parcial) onOperacao({ tipo: "apagar", ids: [...g.ids], em });
      else {
        const raio = RAIO_BORRACHA / estado.current.escala;
        const ids: string[] = [], novos: Traco[] = [];
        for (const t of estado.current.tracos) {
          if (!g.ids.has(t.id) || t.apagado_em) continue;
          const pedacos = cortar(t, g.caminho, raio);
          if (pedacos.length === 1 && pedacos[0].length === densificar(t.pontos, 2).length) continue; // nada mudou
          ids.push(t.id);
          for (const pedaco of pedacos) novos.push(novoTraco(t.ferramenta, t.cor, t.espessura, pedaco));
        }
        if (ids.length) onOperacao({ tipo: "substituir", ids, novos, em });
      }
    }
    agendar();
  }

  const caixaSelecao = escrevendo && selAtiva.length ? caixaDoConjunto(tracos.filter((t) => selAtiva.includes(t.id))) : null;
  const acimaCabe = caixaSelecao ? caixaSelecao.y0 * escala > 64 : false;
  const barraSelecao = caixaSelecao && (
    <div className="absolute z-20" style={{ left: (caixaSelecao.x0 + caixaSelecao.x1) / 2, top: acimaCabe ? caixaSelecao.y0 - 10 : caixaSelecao.y1 + 14, width: 0, height: 0, transform: `scale(${1 / escala})`, transformOrigin: "0 0" }}>
      <div role="toolbar" aria-label="Seleção" className={`absolute flex -translate-x-1/2 items-center gap-0.5 rounded-xl border border-border bg-surface-2 p-1 shadow-nav ${acimaCabe ? "-translate-y-full" : ""}`}>
        <button type="button" aria-label="Apagar seleção" title="Apagar seleção" onClick={() => { onOperacao({ tipo: "apagar", ids: selAtiva, em: new Date().toISOString() }); setSelecao([]); }} className="flex h-9 w-9 items-center justify-center rounded-lg text-error hover:bg-error/15"><Trash2 size={17} strokeWidth={1.75} /></button>
        <button type="button" aria-label="Soltar seleção" title="Soltar seleção" onClick={() => setSelecao([])} className="flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-3 hover:text-text-primary"><X size={17} strokeWidth={1.75} /></button>
      </div>
    </div>
  );
  const esquerda = Math.max(0, (larguraFora - largura * escala) / 2);
  const margem = esquerda / escala;
  return (
    <div ref={fora} className="relative w-full min-w-0 overflow-y-hidden" style={{ ...(escrevendo ? { background: "var(--ecos-folha, rgb(var(--ecos-surface-1-rgb)))" } : {}), height: alturaDentro * escala || undefined, overflowX: largura * escala > larguraFora + 1 ? "auto" : "hidden", touchAction: "pan-x pan-y" }} data-coluna-tinta>
      {escrevendo && estiloFolha !== "lisa" && <div aria-hidden className="pointer-events-none absolute inset-0" style={{ ...desenhoFolha(estiloFolha, escala), backgroundPosition: `${esquerda}px 0` }} />}
      <div ref={dentro} className="absolute top-0" style={{ width: largura, minHeight: alturaMinima, left: esquerda, transform: escala !== 1 ? `scale(${escala})` : undefined, transformOrigin: "top left" }}>
        {children}
        {escrevendo && <div aria-hidden style={{ height: ESPACO_ESCRITA }} />}
        {escrevendo && selAtiva.length > 0 && !editandoSelecao && barraSelecao}
        <canvas ref={tela} aria-hidden={!escrevendo} aria-label={escrevendo ? "Área de escrita à mão" : undefined}
          className={`absolute z-10 transition-opacity duration-200 motion-reduce:transition-none ${fontesProntas ? "opacity-100" : "opacity-0"} ${escrevendo ? (pincel.ferramenta === "borracha" ? "cursor-cell" : "cursor-crosshair") : ""}`}
          style={{ width: largura + 2 * margem, left: -margem, top: 0, height: 0, pointerEvents: escrevendo ? "auto" : "none", touchAction: escrevendo ? "none" : "auto" }}
          onPointerDown={aoTocar} onPointerMove={aoMover} onPointerUp={aoSoltar} onPointerCancel={aoSoltar} onContextMenu={(e) => { if (escrevendo) e.preventDefault(); }} />
      </div>
    </div>
  );
}
