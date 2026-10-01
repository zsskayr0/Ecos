import { useState } from "react";
import { EmptyChart } from "./EmptyChart";

export interface RadarSeries {
  label: string;
  color: string;
  /** Um valor por eixo, na mesma ordem de `axes`, em escala bruta (a normalização é por eixo). */
  values: number[];
}

// viewBox único e uniforme: X e Y têm a mesma escala, então o radar nunca vira elipse, em qualquer largura.
const W = 460;
const H = 360;
const CX = W / 2;
const CY = H / 2 + 4;
const RAIO = 118;
const ANEIS = 4;
/** Série com valor > 0 nunca some no centro: mesmo 3% ainda desenha uma ponta visível. */
const PISO = 0.07;

/**
 * Radar para comparar poucas séries em vários eixos normalizados (cada eixo
 * vai de 0 ao maior valor entre as séries). Passar o mouse numa legenda ou num
 * polígono destaca a série; os valores reais ficam no tooltip dos pontos.
 */
export function RadarChart({ axes, series }: { axes: string[]; series: RadarSeries[] }) {
  const [foco, setFoco] = useState<number | null>(null);
  if (axes.length < 3 || series.length === 0) return <EmptyChart />;

  const maximos = axes.map((_, i) => Math.max(1, ...series.map((s) => s.values[i] ?? 0)));
  const angulo = (i: number) => (Math.PI * 2 * i) / axes.length - Math.PI / 2;
  const ponto = (eixo: number, valor: number): [number, number] => {
    const bruto = valor / maximos[eixo]!;
    const r = RAIO * (valor > 0 ? Math.max(PISO, Math.min(1, bruto)) : 0);
    return [CX + r * Math.cos(angulo(eixo)), CY + r * Math.sin(angulo(eixo))];
  };
  const anel = (ratio: number) => axes.map((_, i) => `${CX + RAIO * ratio * Math.cos(angulo(i))},${CY + RAIO * ratio * Math.sin(angulo(i))}`).join(" ");

  return (
    <div className="cofre-radar">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Comparativo entre ${series.map((s) => s.label).join(", ")}`}>
        {Array.from({ length: ANEIS }, (_, i) => (
          <polygon key={i} points={anel((i + 1) / ANEIS)} fill={i === ANEIS - 1 ? "color-mix(in srgb,var(--text) 3%,transparent)" : "none"} stroke="var(--border)" strokeWidth={1} opacity={0.7} />
        ))}
        {axes.map((_, i) => (
          <line key={i} x1={CX} y1={CY} x2={CX + RAIO * Math.cos(angulo(i))} y2={CY + RAIO * Math.sin(angulo(i))} stroke="var(--border)" strokeWidth={1} opacity={0.7} />
        ))}

        {series.map((s, si) => (
          <g key={si} className="cofre-radar-serie" data-dim={foco !== null && foco !== si ? "true" : undefined} style={{ animationDelay: `${si * 90}ms` }} onMouseEnter={() => setFoco(si)} onMouseLeave={() => setFoco(null)}>
            <polygon points={s.values.map((v, i) => ponto(i, v).join(",")).join(" ")} fill={s.color} fillOpacity={foco === si ? 0.3 : 0.16} stroke={s.color} strokeWidth={foco === si ? 2.4 : 1.8} strokeLinejoin="round" />
            {s.values.map((v, i) => {
              const [x, y] = ponto(i, v);
              return (
                <circle key={i} cx={x} cy={y} r={foco === si ? 4 : 3} fill={s.color} stroke="var(--panel)" strokeWidth={1.5}>
                  <title>{`${s.label} · ${axes[i]}: ${i === 0 || i === 2 ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : v}`}</title>
                </circle>
              );
            })}
          </g>
        ))}

        {axes.map((rotulo, i) => {
          const a = angulo(i);
          const cos = Math.cos(a);
          return (
            <text key={i} x={CX + (RAIO + 16) * cos} y={CY + (RAIO + 18) * Math.sin(a)} textAnchor={cos > 0.3 ? "start" : cos < -0.3 ? "end" : "middle"} dominantBaseline="middle" fontSize={11} fontWeight={600} fontFamily="Poppins, sans-serif" fill="var(--text-muted)">
              {rotulo}
            </text>
          );
        })}
      </svg>

      <div className="cofre-radar-legenda">
        {series.map((s, si) => (
          <button key={si} type="button" data-ativo={foco === si ? "true" : undefined} onMouseEnter={() => setFoco(si)} onMouseLeave={() => setFoco(null)} onFocus={() => setFoco(si)} onBlur={() => setFoco(null)}>
            <i style={{ background: s.color }} />{s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
