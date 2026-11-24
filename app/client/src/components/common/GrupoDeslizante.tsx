import { useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";

/**
 * Grupo de botões com o realce que desliza até a opção marcada (o mesmo movimento do seletor de tema), para opções de
 * largura qualquer. O botão ativo é o que tem `aria-pressed="true"` ou `aria-checked="true"`; os botões devem ter `relative z-10`
 * e nenhum fundo próprio. A primeira posição é sem animação; depois o realce anda (e muda de largura) em 500ms.
 */
export function GrupoDeslizante({ className = "", classeRealce = "rounded-md bg-surface-3", children, ...resto }: { className?: string; classeRealce?: string; children: ReactNode } & Omit<HTMLAttributes<HTMLDivElement>, "className" | "children">) {
  const raiz = useRef<HTMLDivElement>(null);
  const [caixa, setCaixa] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [anima, setAnima] = useState(false);
  useLayoutEffect(() => {
    const medir = () => {
      const el = raiz.current?.querySelector<HTMLElement>('[aria-pressed="true"],[aria-checked="true"]');
      if (!el) { setCaixa((c) => (c ? null : c)); return; }
      const n = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
      setCaixa((c) => (c && c.x === n.x && c.y === n.y && c.w === n.w && c.h === n.h ? c : n));
    };
    medir();
    const obs = typeof ResizeObserver === "function" && raiz.current ? new ResizeObserver(medir) : null;
    if (obs && raiz.current) obs.observe(raiz.current);
    return () => obs?.disconnect();
  });
  // Liga a transição só depois da primeira medida, para o realce não "voar" da origem ao abrir a tela.
  useLayoutEffect(() => { if (caixa && !anima) { const t = window.requestAnimationFrame(() => setAnima(true)); return () => window.cancelAnimationFrame(t); } }, [caixa, anima]);
  return (
    <div ref={raiz} className={`relative ${className}`} {...resto}>
      {caixa && <span aria-hidden className={`pointer-events-none absolute left-0 top-0 ${anima ? "transition-[transform,width,height] duration-500 ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none" : ""} ${classeRealce}`} style={{ width: caixa.w, height: caixa.h, transform: `translate(${caixa.x}px, ${caixa.y}px)` }} />}
      {children}
    </div>
  );
}
