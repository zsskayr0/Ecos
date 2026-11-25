import { useRef } from "react";

/** Faixa de chips da ordenação: rola arrastando (dedo, S Pen ou mouse); tocar num chip escolhe o campo. */
export function OrdemChips<T extends string>({ opcoes, valor, aoMudar, ariaLabel }: {
  opcoes: { valor: T; rotulo: string }[]; valor: T; aoMudar: (v: T) => void; ariaLabel: string;
}) {
  const faixa = useRef<HTMLDivElement>(null);
  const g = useRef<{ x: number; rolagem: number; moveu: boolean } | null>(null);
  return <div className="cofre-ord-chips no-scrollbar" ref={faixa} role="listbox" aria-label={ariaLabel}
    onPointerDown={(e) => { if (e.pointerType === "touch" || e.button !== 0) return; g.current = { x: e.clientX, rolagem: faixa.current?.scrollLeft ?? 0, moveu: false }; }}
    onPointerMove={(e) => {
      const d = g.current; if (!d || !faixa.current) return;
      const dx = e.clientX - d.x;
      if (!d.moveu && Math.abs(dx) > 5) { d.moveu = true; faixa.current.setPointerCapture(e.pointerId); }
      if (d.moveu) faixa.current.scrollLeft = d.rolagem - dx;
    }}
    onPointerUp={() => { const d = g.current; g.current = null; if (d?.moveu) window.setTimeout(() => { g.current = null; }, 0); if (d?.moveu) suprimir.current = true, window.setTimeout(() => { suprimir.current = false; }, 0); }}
    onPointerCancel={() => { g.current = null; }}
    onClickCapture={(e) => { if (suprimir.current) { e.preventDefault(); e.stopPropagation(); } }}>
    {opcoes.map((o) => <button key={o.valor} type="button" role="option" aria-selected={o.valor === valor} onClick={() => aoMudar(o.valor)}>{o.rotulo}</button>)}
  </div>;
}
const suprimir = { current: false };
