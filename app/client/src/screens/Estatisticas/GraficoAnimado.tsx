import { useEffect, useId, useRef } from "react";
import { movimentoReduzido } from "@/lib/movimento";

export type SerieId = "notas" | "tarefas" | "concluidas";
export interface PontoSerie { rotulo: string; notas: number; tarefas: number; concluidas: number }
export interface DefinicaoSerie { id: SerieId; nome: string; cor: string }

const DURACAO_MS = 1000;
const ATRASO_ENTRE_SERIES_MS = 90;
const X0 = 40, LARGURA = 620, BASE = 178, ALTURA = 150;

/** Uma série desenhada: posições x normalizadas (0 a 1, crescentes) e o valor em cada uma. */
interface Forma { xs: number[]; ys: Record<SerieId, number[]>; max: number }

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** Valor da série em `x`, por interpolação linear entre os pontos vizinhos. */
function valorEm(xs: number[], ys: number[], x: number): number {
  if (!xs.length) return 0;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let lo = 0, hi = xs.length - 1;
  while (hi - lo > 1) { const meio = (lo + hi) >> 1; if (xs[meio] <= x) lo = meio; else hi = meio; }
  const f = (x - xs[lo]) / (xs[hi] - xs[lo] || 1);
  return ys[lo] + (ys[hi] - ys[lo]) * f;
}

/** Forma exata dos dados: um ponto por intervalo, espaçados por igual. Série escondida vale zero (a linha desce e some). */
function formaDoAlvo(pontos: PontoSerie[], visiveis: SerieId[], series: DefinicaoSerie[]): Forma {
  const n = pontos.length;
  const xs = n > 1 ? pontos.map((_, i) => i / (n - 1)) : [0, 1];
  const ys = {} as Record<SerieId, number[]>;
  for (const s of series) {
    const valores = pontos.map((p) => p[s.id]);
    ys[s.id] = n > 1 ? valores : [valores[0] ?? 0, valores[0] ?? 0];
  }
  const max = Math.max(1, ...pontos.flatMap((p) => visiveis.map((s) => p[s])));
  return { xs, ys, max };
}

/**
 * Mistura duas formas: usa a união das posições de ambas, então a linha passa exatamente pelos vértices de cada uma (nenhum
 * pico é "cortado" no caminho). No fim (t=1) o resultado é a forma nova, sem salto. Cada série tem o seu próprio atraso.
 */
function misturar(a: Forma, b: Forma, series: DefinicaoSerie[], decorrido: number): { forma: Forma; fim: boolean } {
  const xs = [...new Set([...a.xs, ...b.xs])].sort((p, q) => p - q);
  const ys = {} as Record<SerieId, number[]>;
  let fim = true;
  series.forEach((s, i) => {
    const bruto = (decorrido - i * ATRASO_ENTRE_SERIES_MS) / DURACAO_MS;
    if (bruto < 1) fim = false;
    const t = easeInOut(clamp01(bruto));
    ys[s.id] = xs.map((x) => { const va = valorEm(a.xs, a.ys[s.id], x); return va + (valorEm(b.xs, b.ys[s.id], x) - va) * t; });
  });
  const tMax = easeInOut(clamp01(decorrido / DURACAO_MS));
  return { forma: { xs, ys, max: a.max + (b.max - a.max) * tMax }, fim };
}

/**
 * Gráfico de linhas que se transforma: ao mudar período, escopo ou séries visíveis, as linhas escorregam do desenho antigo
 * para o novo (picos e vales se movendo), a escala do eixo acompanha, e cada série chega um instante depois da anterior.
 * É desenhado direto no SVG a cada quadro (sem re-renderizar o React), e interrompê-lo no meio é seguro: a animação nova
 * parte de onde a antiga estava.
 */
export function GraficoAnimado({ pontos, visiveis, series }: { pontos: PontoSerie[]; visiveis: SerieId[]; series: DefinicaoSerie[] }) {
  const idGradiente = useId().replace(/:/g, "");
  const linhas = useRef<Partial<Record<SerieId, SVGPolylineElement | null>>>({});
  const areas = useRef<Partial<Record<SerieId, SVGPathElement | null>>>({});
  const eixo = useRef<(HTMLSpanElement | null)[]>([]);
  // Começa achatado no zero: a primeira exibição "cresce" do chão.
  const atual = useRef<Forma>({ xs: [0, 1], ys: { notas: [0, 0], tarefas: [0, 0], concluidas: [0, 0] }, max: 1 });
  const quadro = useRef(0);

  function desenhar(f: Forma) {
    for (const s of series) {
      const coords = f.xs.map((x, i) => `${(X0 + x * LARGURA).toFixed(1)},${(BASE - (f.ys[s.id][i] / f.max) * ALTURA).toFixed(1)}`);
      linhas.current[s.id]?.setAttribute("points", coords.join(" "));
      areas.current[s.id]?.setAttribute("d", `M${coords[0]} L${coords.join(" L")} L${X0 + f.xs[f.xs.length - 1] * LARGURA},${BASE} L${X0 + f.xs[0] * LARGURA},${BASE} Z`);
    }
    [0, 0.5, 1].forEach((fator, i) => { if (eixo.current[i]) eixo.current[i]!.textContent = String(Math.round(f.max * fator)); });
  }

  useEffect(() => {
    const alvo = formaDoAlvo(pontos, visiveis, series);
    window.cancelAnimationFrame(quadro.current);
    if (movimentoReduzido()) { atual.current = alvo; desenhar(alvo); return; }
    const origem = atual.current;
    const inicio = performance.now();
    function passo(agora: number) {
      const { forma, fim } = misturar(origem, alvo, series, agora - inicio);
      if (fim) { atual.current = alvo; desenhar(alvo); return; }
      atual.current = forma;
      desenhar(forma);
      quadro.current = window.requestAnimationFrame(passo);
    }
    quadro.current = window.requestAnimationFrame(passo);
    return () => window.cancelAnimationFrame(quadro.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pontos, visiveis]);

  const maximo = Math.max(1, ...pontos.flatMap((p) => visiveis.map((s) => p[s])));
  const marcas = [0, Math.floor((pontos.length - 1) / 2), pontos.length - 1].filter((i, pos, a) => i >= 0 && a.indexOf(i) === pos);
  // O SVG estica para preencher a largura (preserveAspectRatio="none"), o que amassaria qualquer texto dentro dele. Por isso
  // os números e as datas dos eixos são HTML por cima do SVG, posicionados em porcentagem, com a fonte sempre no tamanho certo.
  const pctX = (x: number) => `${(x / 680) * 100}%`;
  const pctY = (y: number) => `${(y / 225) * 100}%`;
  return <div className="overflow-x-auto" role="img" aria-label={`Gráfico de atividade. Máximo de ${maximo} itens por intervalo.`}>
    <div className="relative h-[225px] w-full min-w-[430px]">
    <svg viewBox="0 0 680 225" className="absolute inset-0 h-full w-full" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        {series.map((s) => <linearGradient key={s.id} id={`${idGradiente}-${s.id}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={s.cor} stopOpacity="0.28" /><stop offset="100%" stopColor={s.cor} stopOpacity="0" /></linearGradient>)}
      </defs>
      {[0, 0.5, 1].map((f) => <line key={f} x1="40" x2="660" y1={178 - f * 150} y2={178 - f * 150} stroke="currentColor" className="text-border" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />)}
      {series.map((s) => {
        const mostrar = visiveis.includes(s.id);
        return <g key={s.id} style={{ opacity: mostrar ? 1 : 0, transition: "opacity 450ms ease" }}>
          <path ref={(el) => { areas.current[s.id] = el; }} fill={`url(#${idGradiente}-${s.id})`} stroke="none" />
          <polyline ref={(el) => { linhas.current[s.id] = el; }} fill="none" stroke={s.cor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </g>;
      })}
    </svg>
    {[0, 0.5, 1].map((f, i) => <span key={f} ref={(el) => { eixo.current[i] = el; }} className="pointer-events-none absolute -translate-y-1/2 text-right text-[11px] tabular-nums leading-none text-text-muted" style={{ right: `calc(100% - ${pctX(32)})`, top: pctY(178 - f * 150) }}>0</span>)}
    {/* Datas do eixo x: reaparecem com um fade quando o período muda */}
    <div key={`${pontos.length}-${pontos[0]?.rotulo}`} className="ecos-fade-in">
      {marcas.map((i) => <span key={i} className={`pointer-events-none absolute whitespace-nowrap text-[11px] leading-none text-text-muted ${i === 0 ? "" : i === pontos.length - 1 ? "-translate-x-full" : "-translate-x-1/2"}`} style={{ left: pctX(40 + (i * 620) / Math.max(1, pontos.length - 1)), top: pctY(205) }}>{pontos[i]?.rotulo}</span>)}
    </div>
    </div>
  </div>;
}
