import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

export interface Vista { x: number; y: number; s: number }
export interface Caixa { x: number; y: number; w: number; h: number }

const semMovimento = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

interface Opcoes {
  /** Desliga tudo (ex.: celular, onde o conteúdo rola normalmente). */
  ativo?: boolean;
  escalaMin?: number;
  escalaMax?: number;
  /** Chamado quando a pessoa começa a arrastar o fundo ou mexe no zoom. */
  aoMexer?: () => void;
  /** Toque no fundo sem arrastar. */
  aoToqueFundo?: () => void;
  /** Seletor dos elementos em que o arrasto NÃO começa (cartões, botões, controles). */
  ignorar?: string;
}

/**
 * Visor com zoom suave e arrasto para um "mundo" (um div grande, posicionado em 0,0 com `transform-origin: 0 0`).
 * A vista é escrita direto no DOM (sem re-render); `ms` > 0 anima com a curva suave do Ecos. Roda do mouse aproxima ao
 * redor do cursor; arrastar o fundo move; `centralizar` desliza e aproxima até uma caixa do mundo.
 */
export function useVisorZoom({ ativo = true, escalaMin = 0.12, escalaMax = 2.5, aoMexer, aoToqueFundo, ignorar = "button,a,[data-no],[data-controles]" }: Opcoes = {}) {
  const visor = useRef<HTMLDivElement>(null);
  const mundo = useRef<HTMLDivElement>(null);
  const vista = useRef<Vista>({ x: 0, y: 0, s: 1 });
  /** Depois que a pessoa mexe, o enquadramento automático para de refazer sozinho. */
  const mexeu = useRef(false);
  const fimTransicao = useRef(0);
  const arrasto = useRef<{ px: number; py: number; x: number; y: number; moveu: boolean } | null>(null);
  const [percentual, setPercentual] = useState(100);
  const retornos = useRef({ aoMexer, aoToqueFundo });
  retornos.current = { aoMexer, aoToqueFundo };

  const limitar = useCallback((s: number) => Math.min(escalaMax, Math.max(escalaMin, s)), [escalaMin, escalaMax]);

  const aplicar = useCallback((v: Vista, ms: number) => {
    const el = mundo.current;
    if (!el) return;
    const dur = semMovimento() ? 0 : ms;
    vista.current = v;
    el.style.transition = dur ? `transform ${dur}ms cubic-bezier(.22,1,.36,1)` : "none";
    // Camada própria só durante o movimento; depois o navegador redesenha o texto nítido na escala final.
    if (dur) el.style.willChange = "transform";
    el.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.s})`;
    window.clearTimeout(fimTransicao.current);
    if (dur) fimTransicao.current = window.setTimeout(() => { el.style.willChange = ""; }, dur + 80);
    setPercentual(Math.round(v.s * 100));
  }, []);

  /** Enquadra o mundo inteiro no visor (zoom para caber, centralizado), sem passar do tamanho natural nem de `piso`. */
  const ajustar = useCallback((ms: number, piso = escalaMin) => {
    const vp = visor.current, w = mundo.current;
    if (!vp || !w) return;
    const vw = vp.clientWidth, vh = vp.clientHeight, ww = w.offsetWidth, wh = w.offsetHeight;
    if (!vw || !vh || !ww || !wh) return;
    const s = limitar(Math.max(piso, Math.min(1, vw / ww, vh / wh)));
    aplicar({ s, x: (vw - ww * s) / 2, y: Math.max(0, (vh - wh * s) / 2) }, ms);
  }, [aplicar, limitar, escalaMin]);

  /** Desliza (e aproxima, se `escala` for dado) até deixar a caixa do mundo no meio do visor (`linha` = fração da altura). */
  const centralizar = useCallback((b: Caixa, { escala, linha = 0.5, ms = 560 }: { escala?: number; linha?: number; ms?: number } = {}) => {
    const vp = visor.current;
    if (!vp) return;
    const s = limitar(escala ?? vista.current.s);
    mexeu.current = true;
    aplicar({ s, x: vp.clientWidth / 2 - (b.x + b.w / 2) * s, y: vp.clientHeight * linha - (b.y + b.h / 2) * s }, ms);
  }, [aplicar, limitar]);

  /** Aproxima/afasta mantendo o ponto (px, py) do visor parado. */
  const zoomEm = useCallback((px: number, py: number, fator: number, ms: number) => {
    const { x, y, s } = vista.current;
    const s2 = limitar(s * fator);
    if (s2 === s) return;
    mexeu.current = true;
    retornos.current.aoMexer?.();
    aplicar({ s: s2, x: px - (px - x) * (s2 / s), y: py - (py - y) * (s2 / s) }, ms);
  }, [aplicar, limitar]);

  const zoomNoCentro = useCallback((fator: number) => {
    const v = visor.current;
    if (v) zoomEm(v.clientWidth / 2, v.clientHeight / 2, fator, 380);
  }, [zoomEm]);

  // A roda precisa de listener não passivo para impedir a rolagem da janela por baixo. Pinça do trackpad chega como roda com Ctrl.
  useEffect(() => {
    const vp = visor.current;
    if (!ativo || !vp) return;
    const roda = (e: WheelEvent) => {
      e.preventDefault();
      const r = vp.getBoundingClientRect();
      zoomEm(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)), 120);
    };
    vp.addEventListener("wheel", roda, { passive: false });
    return () => vp.removeEventListener("wheel", roda);
  }, [ativo, zoomEm]);

  // Ponteiros ativos (mouse, toque e caneta chegam todos como pointer events): um arrasta, dois fazem pinça.
  const ponteiros = useRef(new Map<number, { x: number; y: number }>());
  const pinca = useRef<{ d0: number; s0: number; cx: number; cy: number; x0: number; y0: number } | null>(null);

  const segurarMundo = (segurar: boolean) => {
    const m = mundo.current;
    if (!m) return;
    if (segurar) { window.clearTimeout(fimTransicao.current); m.style.pointerEvents = "none"; m.style.willChange = "transform"; m.dataset.arrastando = "1"; }
    else { m.style.pointerEvents = ""; m.style.willChange = ""; delete m.dataset.arrastando; }
  };
  const relativo = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const medidaPinca = () => {
    const [p, q] = [...ponteiros.current.values()];
    return { d: Math.max(1, Math.hypot(p.x - q.x, p.y - q.y)), cx: (p.x + q.x) / 2, cy: (p.y + q.y) / 2 };
  };

  const aoPressionar = (e: ReactPointerEvent<HTMLDivElement>) => {
    const alvo = e.target as HTMLElement;
    if (!ativo || alvo.closest("[data-controles]")) return;
    const naoArrasta = !!alvo.closest(ignorar);
    if (e.pointerType === "mouse" && e.button !== 0) return;
    ponteiros.current.set(e.pointerId, relativo(e));
    if (ponteiros.current.size >= 2) {
      // Segundo dedo: vira pinça (zoom ao redor do ponto médio, e o ponto médio também arrasta).
      arrasto.current = null;
      const m = medidaPinca();
      pinca.current = { d0: m.d, s0: vista.current.s, cx: m.cx, cy: m.cy, x0: vista.current.x, y0: vista.current.y };
      mexeu.current = true;
      retornos.current.aoMexer?.();
      segurarMundo(true);
      if (!naoArrasta) { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ponteiro já liberado */ } }
      return;
    }
    if (naoArrasta) return;
    arrasto.current = { px: e.clientX, py: e.clientY, x: vista.current.x, y: vista.current.y, moveu: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const aoMover = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (ponteiros.current.has(e.pointerId)) ponteiros.current.set(e.pointerId, relativo(e));
    const pc = pinca.current;
    if (pc && ponteiros.current.size >= 2) {
      const m = medidaPinca();
      const s = limitar(pc.s0 * (m.d / pc.d0));
      const wx = (pc.cx - pc.x0) / pc.s0, wy = (pc.cy - pc.y0) / pc.s0;
      aplicar({ s, x: m.cx - wx * s, y: m.cy - wy * s }, 0);
      return;
    }
    const a = arrasto.current;
    if (!a) return;
    const dx = e.clientX - a.px, dy = e.clientY - a.py;
    // Toque e caneta tremem mais que o mouse: tolerância maior antes de contar como arrasto.
    if (!a.moveu && Math.hypot(dx, dy) < (e.pointerType === "mouse" ? 4 : 8)) return;
    if (!a.moveu) {
      a.moveu = true; mexeu.current = true; retornos.current.aoMexer?.();
      // Arrastando, o mundo é só uma camada que se desloca: sem hover reagindo por baixo e sem redesenhar a cada passo.
      segurarMundo(true);
    }
    aplicar({ ...vista.current, x: a.x + dx, y: a.y + dy }, 0);
  };
  const aoSoltar = (e: ReactPointerEvent<HTMLDivElement>) => {
    const tinha = ponteiros.current.delete(e.pointerId);
    if (pinca.current) {
      if (ponteiros.current.size >= 2) return;
      pinca.current = null;
      const [resto] = [...ponteiros.current.entries()];
      if (resto) {
        // Sobrou um dedo: continua arrastando a partir dele, sem contar como toque.
        const r = e.currentTarget.getBoundingClientRect();
        arrasto.current = { px: resto[1].x + r.left, py: resto[1].y + r.top, x: vista.current.x, y: vista.current.y, moveu: true };
      } else { arrasto.current = null; segurarMundo(false); }
      return;
    }
    const a = arrasto.current;
    arrasto.current = null;
    if (a?.moveu) segurarMundo(false);
    else if (a && tinha) retornos.current.aoToqueFundo?.();
  };

  return { visor, mundo, vista, mexeu, percentual, aplicar, ajustar, centralizar, zoomEm, zoomNoCentro, aoPressionar, aoMover, aoSoltar };
}
