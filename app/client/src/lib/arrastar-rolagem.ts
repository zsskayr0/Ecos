import { useRef, type PointerEvent as PointerReact } from "react";

/**
 * Faixas que rolam de lado sem barra (abas, chips): no toque o navegador já arrasta com o dedo; aqui o mouse ganha o mesmo
 * gesto, com inércia (um toque rápido deixa a faixa deslizando até parar). O clique que sobra depois de um arraste é engolido,
 * para soltar em cima de uma aba não a abrir sem querer. Use espalhando o retorno no elemento que rola.
 */
export function useArrastarRolagem(eixo: "x" | "y" = "x") {
  const vertical = eixo === "y";
  const pos = (e: { clientX: number; clientY: number }) => (vertical ? e.clientY : e.clientX);
  const rolagemDe = (el: HTMLElement) => (vertical ? el.scrollTop : el.scrollLeft);
  const definir = (el: HTMLElement, v: number) => { if (vertical) el.scrollTop = v; else el.scrollLeft = v; };
  const estado = useRef<{ x: number; rolagem: number; moveu: boolean; ultimoX: number; ultimoT: number; v: number } | null>(null);
  const quadro = useRef(0);
  const parar = () => { cancelAnimationFrame(quadro.current); quadro.current = 0; };

  const soltar = (el: HTMLElement) => {
    const s = estado.current;
    estado.current = null;
    if (!s?.moveu) return;
    window.addEventListener("click", (ev) => { ev.stopPropagation(); ev.preventDefault(); }, { capture: true, once: true });
    let v = performance.now() - s.ultimoT > 80 ? 0 : s.v; // px/ms; parou antes de soltar: sem inércia
    let anterior = performance.now();
    const passo = (agora: number) => {
      const dt = Math.min(32, agora - anterior);
      anterior = agora;
      const antes = rolagemDe(el);
      definir(el, antes - v * dt);
      v *= Math.pow(0.94, dt / 16); // atrito
      quadro.current = Math.abs(v) > 0.02 && rolagemDe(el) !== antes ? requestAnimationFrame(passo) : 0;
    };
    if (Math.abs(v) > 0.05) quadro.current = requestAnimationFrame(passo);
  };

  return {
    onPointerDown: (e: PointerReact<HTMLElement>) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      parar();
      estado.current = { x: pos(e), rolagem: rolagemDe(e.currentTarget), moveu: false, ultimoX: pos(e), ultimoT: performance.now(), v: 0 };
    },
    onPointerMove: (e: PointerReact<HTMLElement>) => {
      const s = estado.current;
      if (!s) return;
      const dx = pos(e) - s.x;
      if (!s.moveu && Math.abs(dx) < 5) return;
      s.moveu = true;
      const agora = performance.now();
      const dt = Math.max(1, agora - s.ultimoT);
      s.v = 0.6 * ((pos(e) - s.ultimoX) / dt) + 0.4 * s.v;
      s.ultimoX = pos(e);
      s.ultimoT = agora;
      definir(e.currentTarget, s.rolagem - dx);
    },
    onPointerUp: (e: PointerReact<HTMLElement>) => soltar(e.currentTarget),
    onPointerLeave: (e: PointerReact<HTMLElement>) => soltar(e.currentTarget),
  };
}
