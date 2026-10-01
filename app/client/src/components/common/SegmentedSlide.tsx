import { useEffect, useRef, type PointerEvent, type ReactNode } from "react";

export interface OpcaoSlide<T extends string> {
  value: T;
  label: ReactNode;
  /** Nome do token de cor sem o sufixo, ex.: "ecos-success" → usa `--ecos-success-rgb`. */
  cor: string;
  ariaLabel?: string;
}

/**
 * Controle segmentado com um indicador que desliza até a opção escolhida
 * (mola curta) e muda de cor junto. O arraste é o mesmo do seletor de
 * prioridade (`TaskPriority`): segurar e mover seleciona a opção sob o
 * ponteiro e o indicador desliza até ela; um gesto mais vertical que
 * horizontal é deixado para a rolagem.
 */
export function SegmentedSlide<T extends string>({ opcoes, value, onChange, ariaLabel, className = "", tamanho = "md" }: {
  opcoes: OpcaoSlide<T>[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel?: string;
  className?: string;
  tamanho?: "md" | "lg";
}) {
  const n = opcoes.length;
  const indice = Math.max(0, opcoes.findIndex((o) => o.value === value));
  const gesto = useRef<{ id: number; x: number; y: number; arrastando: boolean } | null>(null);
  const ignorarClique = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  const rgb = `var(--${opcoes[indice].cor}-rgb)`;

  function escolherEm(e: PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - r.left) / r.width) * n)));
    if (opcoes[i].value !== value) onChange(opcoes[i].value);
  }

  return (
    <div role="group" aria-label={ariaLabel} className={`rounded-pill bg-surface-2 p-1 ${className}`}>
      <div
        className="ecos-slide-trilho relative grid"
        style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
        onPointerDown={(e) => { if (e.isPrimary && e.button === 0) gesto.current = { id: e.pointerId, x: e.clientX, y: e.clientY, arrastando: false }; }}
        onPointerMove={(e) => {
          const g = gesto.current;
          if (!g || g.id !== e.pointerId) return;
          const dx = Math.abs(e.clientX - g.x), dy = Math.abs(e.clientY - g.y);
          if (!g.arrastando && dy > 10 && dy > dx) { gesto.current = null; return; }
          if (!g.arrastando && dx > 8 && dx > dy) { g.arrastando = true; e.currentTarget.setPointerCapture(e.pointerId); }
          if (g.arrastando) { e.preventDefault(); escolherEm(e); }
        }}
        onPointerUp={(e) => {
          if (gesto.current?.id !== e.pointerId) return;
          if (gesto.current.arrastando) {
            escolherEm(e);
            ignorarClique.current = true;
            clearTimeout(timer.current);
            timer.current = setTimeout(() => { ignorarClique.current = false; }, 0);
          }
          gesto.current = null;
        }}
        onPointerCancel={() => { gesto.current = null; }}
        onClickCapture={(e) => { if (ignorarClique.current) { e.preventDefault(); e.stopPropagation(); } }}
      >
        <span
          aria-hidden="true"
          className="ecos-slide-indicador"
          style={{
            width: `${100 / n}%`,
            transform: `translateX(${indice * 100}%)`,
            ["--slide-rgb" as string]: rgb,
          }}
        />
        {opcoes.map((o, i) => {
          const ativo = i === indice;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={o.value === value}
              aria-label={o.ariaLabel}
              onClick={() => { if (!ignorarClique.current) onChange(o.value); }}
              className={`ecos-slide-botao relative z-10 whitespace-nowrap rounded-pill text-sm font-medium ${tamanho === "lg" ? "min-h-11 px-3 py-1.5" : "px-4 py-1.5"}`}
              style={{ color: ativo ? `rgb(var(--${o.cor}-rgb))` : undefined, cursor: "inherit" }}
              data-ativo={ativo}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
