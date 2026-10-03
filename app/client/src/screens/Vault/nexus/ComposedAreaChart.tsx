// Portado do Nexus: components/charts/ComposedAreaChart.tsx. Mantém a composição e as interações originais.
import { useEffect, useId, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { formatMoeda as formatCentsToBRL } from "@/lib/format";
import { compactBRL, niceMax, scaleLinear } from "./scale";
import { EmptyChart } from "./EmptyChart";

export interface ComposedAreaPoint {
  label: string;
  /** Confirmado (efetivado) — área sólida. */
  incomeConfirmedCents: number;
  expenseConfirmedCents: number;
  /** Previsto — faixa adicional pontilhada, por cima do confirmado (não é o total). */
  incomeForecastCents: number;
  expenseForecastCents: number;
}

// Mesma escala grande da antiga "Evolução do saldo" — este gráfico também
// mora sozinho na linha de cima, bem mais largo que os outros cards.

const H = 280;
const PAD = { top: 26, right: 20, bottom: 30, left: 58 };

// Largura fixa em pixels REAIS (não em unidade do viewBox) — o popup é um
// <div> de HTML normal sobreposto ao SVG, não um <text> desenhado dentro
// dele. Isso é proposital: texto dentro do SVG escala junto com a largura
// renderizada do gráfico (a mesma lógica de "zoom" do desenho todo), então
// numa tela mais estreita o popupinteiro — moldura E letra — encolhia junto
// e ficava ilegível. Em HTML, o tamanho da fonte é sempre o mesmo em
// qualquer resolução, do jeito que um tooltip deveria se comportar.
const TOOLTIP_W = 210;

const suave = (t: number) => t * t * (3 - 2 * t);
/** Quanto a onda das previsões já chegou ao ponto `i` (0 = nada, 1 = tudo). A onda varre o gráfico da esquerda para a direita. */
const ESPALHA_ONDA = 0.65;
const ondaNoPonto = (progresso: number, i: number, total: number) => {
  const posicao = total > 1 ? i / (total - 1) : 0;
  return suave(Math.min(1, Math.max(0, progresso * (1 + ESPALHA_ONDA) - posicao * ESPALHA_ONDA)));
};

/**
 * Leva um número até `alvo` aos poucos (a cada mudança do alvo, a partir de onde ele está agora: virar o botão no meio
 * da animação não dá solavanco). Com "reduzir movimento" ligado, vai direto.
 */
function useAnimado(alvo: number, ms: number, curva: (t: number) => number = suave, inicial = alvo): number {
  const [valor, setValor] = useState(inicial);
  const atual = useRef(inicial);
  useEffect(() => {
    const de = atual.current;
    if (de === alvo) return;
    if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) { atual.current = alvo; setValor(alvo); return; }
    let raf = 0;
    const inicio = performance.now();
    const passo = (agora: number) => {
      const p = Math.min(1, (agora - inicio) / ms);
      atual.current = de + (alvo - de) * curva(p);
      setValor(atual.current);
      if (p < 1) raf = requestAnimationFrame(passo);
    };
    raf = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alvo, ms]);
  return valor;
}

/**
 * Receitas x despesas como um único gráfico de área divergente: receita
 * sobe em verde a partir da linha zero, despesa desce em vermelho. Cada
 * lado tem duas camadas — área sólida até o valor CONFIRMADO (efetivado) e
 * uma faixa pontilhada por cima até o valor PREVISTO (lançamento ainda não
 * efetivado + recorrências ainda não lançadas). A divisão é por status de
 * cada lançamento, não pela data do balde — um lançamento de mês passado
 * ainda não efetivado aparece pontilhado do mesmo jeito que um futuro.
 */
export function ComposedAreaChart({
  points,
  incomeColor,
  expenseColor,
  labelEvery,
  onSelect,
  showForecast = true,
}: {
  points: ComposedAreaPoint[];
  /** Liga/desliga a faixa das previsões. Ao virar, ela sobe (ou recolhe) numa onda e o eixo se ajusta junto. */
  showForecast?: boolean;
  incomeColor: string;
  expenseColor: string;
  /** Força mostrar um rótulo a cada N baldes (ex.: 1 = todo dia, na visão mensal). Sem isso, escolhe uma amostra automática. */
  labelEvery?: number;
  onSelect?: (index: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [W, setWidth] = useState(700);
  const uid = useId().replace(/:/g, "");
  useEffect(() => {
    const element=containerRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer=new ResizeObserver(([entry])=>setWidth(Math.max(280,entry.contentRect.width)));
    observer.observe(element); return ()=>observer.disconnect();
  }, []);
  const [hover, setHover] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ left: number; top: number } | null>(null);

  const previsto = (v: number) => (showForecast ? v : 0);
  const alvoMax = niceMax(
    Math.max(
      ...points.flatMap((p) => [
        p.incomeConfirmedCents + previsto(p.incomeForecastCents),
        p.expenseConfirmedCents + previsto(p.expenseForecastCents),
      ]),
      100,
    ) / 100,
  );
  // As previsões entram numa onda e o eixo vertical acompanha (também quando chegam dados novos).
  const progressoPrevisao = useAnimado(showForecast ? 1 : 0, 1100, (t) => t);
  const maxY = useAnimado(alvoMax, 700);
  // Ao abrir, o gráfico se revela da esquerda para a direita.
  const revelado = useAnimado(1, 900, suave, 0);

  if (points.length === 0) return <EmptyChart />;

  const plotTop = PAD.top;
  const plotBottom = H - PAD.bottom;
  const zeroY = plotTop + (plotBottom - plotTop) / 2;
  const halfHeight = (plotBottom - plotTop) / 2;

  const x = scaleLinear([0, points.length - 1], [PAD.left, W - PAD.right]);
  const incomeY = (cents: number) => zeroY - (cents / 100 / maxY) * halfHeight;
  const expenseY = (cents: number) => zeroY + (cents / 100 / maxY) * halfHeight;
  // Quanto da previsão de cada ponto já "subiu": é o que faz a faixa crescer em onda em vez de aparecer de uma vez.
  const onda = points.map((_, i) => ondaNoPonto(progressoPrevisao, i, points.length));
  const incomeForecast = (p: ComposedAreaPoint, i: number) => p.incomeForecastCents * (onda[i] ?? 0);
  const expenseForecast = (p: ComposedAreaPoint, i: number) => p.expenseForecastCents * (onda[i] ?? 0);
  const incomeTotal = (p: ComposedAreaPoint, i: number) => p.incomeConfirmedCents + incomeForecast(p, i);
  const expenseTotal = (p: ComposedAreaPoint, i: number) => p.expenseConfirmedCents + expenseForecast(p, i);

  type Altura = (p: ComposedAreaPoint, i: number) => number;
  function buildLine(yFn: Altura): string {
    return points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${yFn(p, i)}`).join(" ");
  }
  function buildArea(yFn: Altura): string {
    return `${buildLine(yFn)} L${x(points.length - 1)},${zeroY} L${x(0)},${zeroY} Z`;
  }
  /** Faixa (ribbon) entre duas curvas — usada pra desenhar o "previsto" por cima do confirmado. */
  function buildBand(innerYFn: Altura, outerYFn: Altura): string {
    const top = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${innerYFn(p, i)}`);
    const bottom = points.map((p, i) => ({ p, i })).reverse().map(({ p, i }) => `L${x(i)},${outerYFn(p, i)}`);
    return `${top.join(" ")} ${bottom.join(" ")} Z`;
  }

  const confirmedIncomeArea = buildArea((p) => incomeY(p.incomeConfirmedCents));
  const confirmedExpenseArea = buildArea((p) => expenseY(p.expenseConfirmedCents));
  const confirmedIncomeLine = buildLine((p) => incomeY(p.incomeConfirmedCents));
  const confirmedExpenseLine = buildLine((p) => expenseY(p.expenseConfirmedCents));

  const forecastIncomeBand = buildBand((p) => incomeY(p.incomeConfirmedCents), (p, i) => incomeY(incomeTotal(p, i)));
  const forecastExpenseBand = buildBand((p) => expenseY(p.expenseConfirmedCents), (p, i) => expenseY(expenseTotal(p, i)));
  const forecastIncomeLine = buildLine((p, i) => incomeY(incomeTotal(p, i)));
  const forecastExpenseLine = buildLine((p, i) => expenseY(expenseTotal(p, i)));
  const hasAnyForecast = progressoPrevisao > 0.001 && points.some((p) => p.incomeForecastCents > 0 || p.expenseForecastCents > 0);

  const labelStride = labelEvery ?? Math.max(1, Math.ceil(points.length / 7));
  const gridSteps = [-1, -0.5, 0, 0.5, 1];

  function handleMove(e: ReactMouseEvent<SVGRectElement>) {
    const el = containerRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const px = e.clientX - box.left;
    const relX = (px / box.width) * W;
    const idx = Math.round(((relX - PAD.left) / (W - PAD.left - PAD.right)) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, idx)));

    // Clamp em pixels reais (não em unidade do viewBox) — a proporção de
    // PAD vira uma margem equivalente em px do container atual.
    const padLeftPx = (PAD.left / W) * box.width;
    const padRightPx = (PAD.right / W) * box.width;
    const topPx = ((plotTop + 6) / H) * box.height;
    const leftPx = Math.min(Math.max(px - TOOLTIP_W / 2, padLeftPx), box.width - padRightPx - TOOLTIP_W);
    setTooltipPos({ left: leftPx, top: topPx });
  }

  const hovered = hover !== null ? points[hover] ?? null : null;
  const hoverX = hover !== null ? x(hover) : 0;

  return (
    <div ref={containerRef} className="relative cofre-area-chart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ overflow: "visible" }}>
        <defs>
          <clipPath id={`${uid}-composed-reveal`}>
            <rect x={0} y={-20} width={Math.max(0, (W + 40) * revelado)} height={H + 40} />
          </clipPath>
          <linearGradient id={`${uid}-composed-income-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={incomeColor} stopOpacity={0.5} />
            <stop offset="100%" stopColor={incomeColor} stopOpacity={0.04} />
          </linearGradient>
          <linearGradient id={`${uid}-composed-expense-fill`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor={expenseColor} stopOpacity={0.5} />
            <stop offset="100%" stopColor={expenseColor} stopOpacity={0.04} />
          </linearGradient>
        </defs>

        {gridSteps.map((t) => {
          const gy = zeroY - t * halfHeight;
          const value = maxY * t;
          return (
            <g key={t}>
              <line
                x1={PAD.left}
                y1={gy}
                x2={W - PAD.right}
                y2={gy}
                stroke="var(--border)"
                strokeWidth={t === 0 ? 1.4 : 1}
                opacity={t === 0 ? 1 : 0.5}
              />
              <text x={PAD.left - 8} y={gy + 3} textAnchor="end" fontSize={10} fontFamily="Inter, sans-serif" fill="var(--text-faint)">
                {t === 0 ? "R$0" : `${t > 0 ? "+" : "−"}${compactBRL(Math.abs(value))}`}
              </text>
            </g>
          );
        })}

        <g clipPath={`url(#${uid}-composed-reveal)`}>
          {/* Confirmado (efetivado) — área sólida cheia, do jeito que sempre foi. */}
          <path d={confirmedIncomeArea} fill={`url(#${uid}-composed-income-fill)`} stroke="none" />
          <path d={confirmedExpenseArea} fill={`url(#${uid}-composed-expense-fill)`} stroke="none" />
          <path d={confirmedIncomeLine} fill="none" stroke={incomeColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          <path d={confirmedExpenseLine} fill="none" stroke={expenseColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

          {/* Previsto — faixa mais fraca por cima do confirmado, com a borda externa pontilhada. Some sozinha onde não há previsão (banda de altura zero). */}
          {hasAnyForecast && (
            <>
              <path d={forecastIncomeBand} fill={incomeColor} fillOpacity={0.14} stroke="none" />
              <path d={forecastExpenseBand} fill={expenseColor} fillOpacity={0.14} stroke="none" />
              <path d={forecastIncomeLine} fill="none" stroke={incomeColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="6 5" opacity={0.8 * Math.min(1, progressoPrevisao * 1.6)} />
              <path d={forecastExpenseLine} fill="none" stroke={expenseColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="6 5" opacity={0.8 * Math.min(1, progressoPrevisao * 1.6)} />
            </>
          )}
        </g>

        {points.map((p, i) => {
          if (i !== points.length - 1 && i % labelStride !== 0) return null;
          return (
            <text key={i} x={x(i)} y={H - 10} textAnchor="middle" fontSize={10} fontWeight={600} fontFamily="Inter, sans-serif" fill="var(--text-faint)">
              {p.label}
            </text>
          );
        })}

        {/* overlay transparente só pra capturar o mouse — a área plotável inteira */}
        <rect
          x={PAD.left}
          y={plotTop}
          width={W - PAD.left - PAD.right}
          height={plotBottom - plotTop}
          fill="transparent"
          onPointerMove={handleMove}
          onPointerDown={handleMove}
          onDoubleClick={() => hover !== null && hover < points.length && onSelect?.(hover)}
          tabIndex={0}
          role="slider"
          aria-label="Receitas e despesas por data. Use as setas e Enter, ou toque duas vezes, para ver lançamentos."
          aria-valuemin={0}
          aria-valuemax={points.length - 1}
          aria-valuenow={hover ?? 0}
          aria-valuetext={hovered ? `${hovered.label}: receitas ${formatCentsToBRL(hovered.incomeConfirmedCents + previsto(hovered.incomeForecastCents))}, despesas ${formatCentsToBRL(hovered.expenseConfirmedCents + previsto(hovered.expenseForecastCents))}` : points[0].label}
          onKeyDown={e => {
            if(e.key === "Enter") {onSelect?.(hover ?? 0);return;}
            if(!["ArrowLeft","ArrowRight","Home","End"].includes(e.key))return;
            e.preventDefault();
            setHover(e.key === "Home" ? 0 : e.key === "End" ? points.length-1 : Math.max(0,Math.min(points.length-1,(hover ?? 0)+(e.key === "ArrowRight"?1:-1))));
            setTooltipPos({left:Math.max(0,(W-TOOLTIP_W)/2),top:8});
          }}
          onMouseLeave={() => setHover(null)}
        />

        {hovered && (
          <g style={{ pointerEvents: "none" }}>
            <line x1={hoverX} y1={plotTop} x2={hoverX} y2={plotBottom} stroke="var(--text-faint)" strokeWidth={1} strokeDasharray="3 3" opacity={0.6} />
            <circle cx={hoverX} cy={incomeY(hovered.incomeConfirmedCents)} r={4} fill={incomeColor} stroke="var(--bg)" strokeWidth={1.5} />
            <circle cx={hoverX} cy={expenseY(hovered.expenseConfirmedCents)} r={4} fill={expenseColor} stroke="var(--bg)" strokeWidth={1.5} />
            {previsto(hovered.incomeForecastCents) > 0 && (
              <circle cx={hoverX} cy={incomeY(incomeTotal(hovered, hover ?? 0))} r={3.5} fill="var(--panel)" stroke={incomeColor} strokeWidth={1.5} />
            )}
            {previsto(hovered.expenseForecastCents) > 0 && (
              <circle cx={hoverX} cy={expenseY(expenseTotal(hovered, hover ?? 0))} r={3.5} fill="var(--panel)" stroke={expenseColor} strokeWidth={1.5} />
            )}
          </g>
        )}
      </svg>

      {/* Popup em HTML normal, sobreposto ao SVG — ver comentário de TOOLTIP_W. */}
      {hovered && tooltipPos && (
        <div
          className="pointer-events-none absolute rounded-[10px] border border-[var(--border-strong)] px-3 py-2.5 shadow-[var(--shadow-card)]"
          style={{ left: tooltipPos.left, top: tooltipPos.top, width: TOOLTIP_W, background: "var(--panel-elevated)" }}
        >
          <div className="text-[0.78rem] font-bold">{hovered.label}</div>
          <div className="mt-1 text-[0.72rem] font-semibold" style={{ color: incomeColor }}>
            Recebi: {formatCentsToBRL(hovered.incomeConfirmedCents)}
            {previsto(hovered.incomeForecastCents) > 0 && <span className="opacity-70"> + {formatCentsToBRL(hovered.incomeForecastCents)} previsto</span>}
          </div>
          <div className="text-[0.72rem] font-semibold" style={{ color: expenseColor }}>
            Paguei: {formatCentsToBRL(hovered.expenseConfirmedCents)}
            {previsto(hovered.expenseForecastCents) > 0 && <span className="opacity-70"> + {formatCentsToBRL(hovered.expenseForecastCents)} previsto</span>}
          </div>
        </div>
      )}
    </div>
  );
}
