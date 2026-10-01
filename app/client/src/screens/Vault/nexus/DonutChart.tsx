// Portado do Nexus: components/charts/DonutChart.tsx. Mantém a composição e as interações originais.
import { formatMoeda as formatCentsToBRL } from "@/lib/format";
import { EmptyChart } from "./EmptyChart";

export interface DonutSegment {
  label: string;
  valueCents: number;
  color: string;
}

const R = 80;
const CIRCUMFERENCE = 2 * Math.PI * R;
const GAP = 3; // px de espaço entre fatias, na mesma unidade do stroke-dasharray

/**
 * Rosca com legenda numérica ao lado — a paleta monocromática usa uma escala
 * de cinza (branco → carvão) para as fatias, então cada uma também é
 * identificada por nome + valor na legenda, nunca só pela cor.
 */
export function DonutChart({ segments, size = 168, onSelect }: { segments: DonutSegment[]; size?: number; onSelect?: (index: number) => void }) {
  const total = segments.reduce((sum, s) => sum + s.valueCents, 0);
  if (total === 0 || segments.length === 0) return <EmptyChart />;

  const gapsTotal = GAP * segments.length;
  const drawable = Math.max(CIRCUMFERENCE * 0.75, CIRCUMFERENCE - gapsTotal);

  let cursor = 0;
  const arcs = segments.map((s) => {
    const length = (s.valueCents / total) * drawable;
    const arc = { ...s, length, offset: cursor, pct: (s.valueCents / total) * 100 };
    cursor += length + Math.min(GAP, CIRCUMFERENCE * 0.25 / segments.length);
    return arc;
  });

  const biggest = arcs[0]!;

  return (
    <div className="cofre-donut">
      <svg viewBox="0 0 240 240" width={size} height={size} className="shrink-0">
        <g transform="rotate(-90 120 120)">
          <circle cx="120" cy="120" r={R} fill="none" stroke="var(--border)" strokeWidth={26} opacity={0.35} />
          {arcs.map((arc) => (
            <circle
              key={arc.label}
              cx="120"
              cy="120"
              r={R}
              fill="none"
              stroke={arc.color}
              strokeWidth={26}
              strokeDasharray={`${arc.length} ${CIRCUMFERENCE - arc.length}`}
              strokeDashoffset={-arc.offset}
            >
              <title>
                {arc.label} — {formatCentsToBRL(arc.valueCents)} ({arc.pct.toFixed(1)}%)
              </title>
            </circle>
          ))}
        </g>
        <text x="120" y="116" textAnchor="middle" fontFamily="Inter, sans-serif" fontSize={17} fontWeight={600} fill="var(--text)">
          {biggest.pct.toFixed(0)}%
        </text>
        <text x="120" y="133" textAnchor="middle" fontFamily="Inter, sans-serif" fontSize={9} fill="var(--text-faint)">
          {biggest.label}
        </text>
      </svg>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {arcs.map((arc, index) => (
          <button type="button" onClick={()=>onSelect?.(index)} title={`${arc.label}: ${formatCentsToBRL(arc.valueCents)}`} key={`${index}:${arc.label}`} className="flex items-center gap-2 text-[0.73rem]">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: arc.color }} />
            <span className="flex-1 truncate font-semibold text-[var(--text-muted)]">{arc.label}</span>
            <span className="cofre-mono font-semibold text-[var(--text)]">{arc.pct.toFixed(1)}%</span>
          </button>
        ))}
      </div>
    </div>
  );
}
