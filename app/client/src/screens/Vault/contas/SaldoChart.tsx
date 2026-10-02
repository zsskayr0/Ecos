import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatMoeda } from "@/lib/format";
import { compactBRL, niceMax, scaleLinear } from "../nexus/scale";
import { EmptyChart } from "../nexus/EmptyChart";
import type { PontoSaldo } from "./analise";

const H = 240;
const PAD = { top: 20, right: 18, bottom: 28, left: 58 };
const TOOLTIP_W = 190;

/** Linha do saldo ao longo do período (mesma gramática visual do gráfico de receitas × despesas do painel). */
export function SaldoChart({ pontos, cor }: { pontos: PontoSaldo[]; cor: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(700);
  const [hover, setHover] = useState<number | null>(null);
  const [tip, setTip] = useState<{ left: number; top: number } | null>(null);
  const uid = useId().replace(/:/g, "");

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const o = new ResizeObserver(([e]) => setW(Math.max(280, e!.contentRect.width)));
    o.observe(el);
    return () => o.disconnect();
  }, []);

  if (pontos.length === 0) return <EmptyChart />;

  const valores = pontos.map((p) => p.saldo / 100);
  const maxV = Math.max(0, ...valores);
  const minV = Math.min(0, ...valores);
  const topo = niceMax(maxV || 1);
  const base = minV < 0 ? -niceMax(-minV) : 0;
  const plotTop = PAD.top;
  const plotBottom = H - PAD.bottom;
  const y = scaleLinear([base, topo], [plotBottom, plotTop]);
  const x = scaleLinear([0, Math.max(1, pontos.length - 1)], [PAD.left, W - PAD.right]);
  const zeroY = y(0);

  const linha = pontos.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.saldo / 100)}`).join(" ");
  const area = `${linha} L${x(pontos.length - 1)},${zeroY} L${x(0)},${zeroY} Z`;
  const passos = base < 0 ? [base, base / 2, 0, topo / 2, topo] : [0, topo / 3, (topo * 2) / 3, topo];
  const stride = Math.max(1, Math.ceil(pontos.length / 7));

  function mover(e: PointerEvent<SVGRectElement>) {
    const el = ref.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const px = e.clientX - box.left;
    const relX = (px / box.width) * W;
    const idx = Math.round(((relX - PAD.left) / (W - PAD.left - PAD.right)) * (pontos.length - 1));
    setHover(Math.max(0, Math.min(pontos.length - 1, idx)));
    const left = Math.min(Math.max(px - TOOLTIP_W / 2, (PAD.left / W) * box.width), box.width - (PAD.right / W) * box.width - TOOLTIP_W);
    setTip({ left, top: ((plotTop + 4) / H) * box.height });
  }

  function teclado(e: KeyboardEvent<SVGRectElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    setHover(e.key === "Home" ? 0 : e.key === "End" ? pontos.length - 1 : Math.max(0, Math.min(pontos.length - 1, (hover ?? 0) + (e.key === "ArrowRight" ? 1 : -1))));
    setTip({ left: Math.max(0, (W - TOOLTIP_W) / 2), top: 8 });
  }

  const ativo = hover !== null ? pontos[hover] ?? null : null;

  return (
    <div ref={ref} className="relative cofre-area-chart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ overflow: "visible" }}>
        <defs>
          <linearGradient id={`${uid}-saldo`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={cor} stopOpacity={0.42} />
            <stop offset="100%" stopColor={cor} stopOpacity={0.03} />
          </linearGradient>
        </defs>
        {passos.map((v) => (
          <g key={v}>
            <line x1={PAD.left} y1={y(v)} x2={W - PAD.right} y2={y(v)} stroke="var(--border)" strokeWidth={v === 0 ? 1.4 : 1} opacity={v === 0 ? 1 : 0.5} />
            <text x={PAD.left - 8} y={y(v) + 3} textAnchor="end" fontSize={10} fontFamily="Inter, sans-serif" fill="var(--text-faint)">
              {v === 0 ? "R$0" : `${v < 0 ? "−" : ""}${compactBRL(Math.abs(v))}`}
            </text>
          </g>
        ))}
        <path d={area} fill={`url(#${uid}-saldo)`} />
        <path d={linha} fill="none" stroke={cor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {pontos.map((p, i) => (i === pontos.length - 1 || i % stride === 0) && (
          <text key={p.chave} x={x(i)} y={H - 9} textAnchor="middle" fontSize={10} fontWeight={600} fontFamily="Inter, sans-serif" fill="var(--text-faint)">{p.rotulo}</text>
        ))}
        <rect
          x={PAD.left} y={plotTop} width={W - PAD.left - PAD.right} height={plotBottom - plotTop} fill="transparent"
          onPointerMove={mover} onPointerDown={mover} onMouseLeave={() => setHover(null)} onKeyDown={teclado}
          tabIndex={0} role="slider" aria-label="Saldo da conta ao longo do período. Use as setas para percorrer."
          aria-valuemin={0} aria-valuemax={pontos.length - 1} aria-valuenow={hover ?? 0}
          aria-valuetext={ativo ? `${ativo.rotulo}: saldo ${formatMoeda(ativo.saldo)}` : `${pontos[0]!.rotulo}: saldo ${formatMoeda(pontos[0]!.saldo)}`}
        />
        {ativo && hover !== null && (
          <g style={{ pointerEvents: "none" }}>
            <line x1={x(hover)} y1={plotTop} x2={x(hover)} y2={plotBottom} stroke="var(--text-faint)" strokeWidth={1} strokeDasharray="3 3" opacity={0.6} />
            <circle cx={x(hover)} cy={y(ativo.saldo / 100)} r={4} fill={cor} stroke="var(--bg)" strokeWidth={1.5} />
          </g>
        )}
      </svg>
      {ativo && tip && (
        <div className="pointer-events-none absolute rounded-[10px] border border-[var(--border-strong)] px-3 py-2.5 shadow-[var(--shadow-card)]" style={{ left: tip.left, top: tip.top, width: TOOLTIP_W, background: "var(--panel-elevated)" }}>
          <div className="text-[0.78rem] font-bold">{ativo.rotulo}</div>
          <div className="cofre-mono mt-1 text-[0.8rem] font-bold" style={{ color: ativo.saldo < 0 ? "var(--cofre-expense)" : "var(--text)" }}>{formatMoeda(ativo.saldo)}</div>
          <div className="text-[0.7rem] text-[var(--text-muted)]">+{formatMoeda(ativo.entradas)} · −{formatMoeda(ativo.saidas)}</div>
        </div>
      )}
    </div>
  );
}
