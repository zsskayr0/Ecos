import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Minus, Plus } from "lucide-react";
import { ASSINATURA_GROSSA as sig } from "./assinatura-ecos";
import type { Ferramenta } from "@/lib/tinta/tipos";

/** 10 posições por ferramenta (o servidor aceita 0,5–64). */
export const FAIXA_ESPESSURA = {
  caneta: { min: 1, passo: 2 },
  "marca-texto": { min: 6, passo: 4 },
} as const;
const POSICOES = 10;
const RAIO = 17;
/** Duração total da escrita (letras + rabeta). O ritmo acelera no meio e desacelera nas pontas, como uma caneta de verdade. */
const DURACAO_ESCRITA = 1100;
/** Instante (0–1) em que um ponto do percurso é alcançado: inverso da curva senoidal de aceleração. */
const quando = (progresso: number) => Math.acos(1 - 2 * Math.min(1, Math.max(0, progresso))) / Math.PI;

interface Props {
  ferramenta: Ferramenta;
  /** Cor CSS já resolvida do pincel (o pontinho mostra o traço como vai ficar). */
  cor: string;
  valor: number;
  onChange: (v: number) => void;
}

/** Slide de espessura: − e + nas pontas, pontinhos nas posições, bolinha com o valor; o pontinho acima mostra o traço real. */
export function ControleEspessura({ ferramenta, cor, valor, onChange }: Props) {
  const { min, passo } = FAIXA_ESPESSURA[ferramenta];
  const indice = Math.min(POSICOES - 1, Math.max(0, Math.round((valor - min) / passo)));
  const v = min + indice * passo;
  const trilho = useRef<HTMLDivElement>(null);
  const [arrastando, setArrastando] = useState(false);
  /** Durante o arrasto a bolinha segue o dedo continuamente (0–1); ao soltar, encaixa na posição com mola. */
  const [fracao, setFracao] = useState<number | null>(null);
  const ir = (i: number) => { const n = Math.min(POSICOES - 1, Math.max(0, i)); if (n !== indice) onChange(min + n * passo); };
  const marca = ferramenta === "marca-texto";
  const tinta = marca ? "rgb(var(--ecos-text-primary-rgb))" : cor;
  const extra = marca ? 0 : Math.max(0, v - 5) * 0.45; // o traço-base da fonte tem ~5 px; acima disso engrossa o contorno, em escala reduzida para as letras não virarem mancha
  const idMascara = `m${useId().replace(/:/g, "")}`;
  // Cada traço do esqueleto ocupa a fatia do percurso total; o tempo vem da curva de aceleração, então letras e rabeta formam um gesto só.
  const total = sig.tracos.reduce((n, t) => n + t.len, sig.rabetaLen);
  let acumulado = 0;
  const tempos = [...sig.tracos.map((t) => t.len), sig.rabetaLen].map((len) => {
    const ini = quando(acumulado / total) * DURACAO_ESCRITA;
    acumulado += len;
    return { delay: ini, dur: Math.max(8, quando(acumulado / total) * DURACAO_ESCRITA - ini) };
  });

  function doPonteiro(e: PointerEvent<HTMLDivElement>) {
    const r = trilho.current!.getBoundingClientRect();
    const f = (e.clientX - r.left - RAIO) / Math.max(1, r.width - 2 * RAIO);
    const c = Math.min(1, Math.max(0, f));
    setFracao(c);
    ir(Math.round(c * (POSICOES - 1)));
  }
  function aoTeclar(e: KeyboardEvent<HTMLDivElement>) {
    const d: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 };
    if (e.key === "Home") ir(0);
    else if (e.key === "End") ir(POSICOES - 1);
    else if (d[e.key]) ir(indice + d[e.key]!);
    else return;
    e.preventDefault();
  }
  const passoBtn = "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-text-primary transition-[color,transform,opacity] active:scale-90 enabled:hover:text-steel-300 disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400";

  return (
    <div className="flex w-[17.5rem] flex-col gap-1 px-2.5 pb-2.5 pt-1.5">
      <div className="relative flex h-[88px] items-end justify-center">
        {/* 1 unidade do desenho = 1 px: a grossura é a real. O esqueleto das letras é uma máscara que se desenha em ordem, então a fonte aparece sendo escrita. */}
        <svg key={marca ? "m" : "c"} aria-hidden viewBox="0 0 240 80" className="h-[80px] w-[240px] max-w-full shrink overflow-visible" fill="none" strokeLinejoin="round">
          {marca && <path d="M12 74 C70 78 160 78 226 64" stroke={cor} strokeWidth={v} strokeLinecap="round" opacity={0.5} pathLength={1} className="ecos-rabisco" style={{ transition: "stroke-width 150ms ease-out" }} />}
          <defs>
            <mask id={idMascara} maskUnits="userSpaceOnUse" x="-10" y="-10" width="260" height="100">
              {sig.tracos.map((t, i) => <path key={i} d={t.d} pathLength={1} stroke="#fff" strokeWidth={t.w + extra} className="ecos-traco" style={{ animationDuration: `${tempos[i]!.dur}ms`, animationDelay: `${tempos[i]!.delay}ms` }} />)}
            </mask>
          </defs>
          <path d={sig.contorno} mask={`url(#${idMascara})`} fill={tinta} stroke={tinta} strokeWidth={extra} fillRule="nonzero" style={{ transition: "stroke-width 150ms ease-out" }} />
          <path pathLength={1} className="ecos-traco" d={sig.rabeta} stroke={tinta} strokeWidth={marca ? 1.3 : Math.max(1.3, v * 0.5)} style={{ animationDuration: `${tempos[tempos.length - 1]!.dur}ms`, animationDelay: `${tempos[tempos.length - 1]!.delay}ms`, transition: "stroke-width 150ms ease-out" }} />
        </svg>
        <span aria-hidden className="absolute inset-x-0 top-0 text-center text-xs tabular-nums text-text-muted">{v} px</span>
      </div>
      {/* Amostra na espessura exata: a prévia do desenho acima engrossa só em parte nos valores altos. */}
      {!marca && <div aria-hidden className="-mt-4 flex h-6 items-center justify-center"><svg viewBox="0 0 256 24" className="h-6 w-64 max-w-full overflow-visible" fill="none"><path d="M40.5 12.0L41.9 10.2L43.3 8.5L44.8 7.1L46.2 5.9L47.6 5.2L49.0 5.0L50.4 5.2L51.8 5.9L53.2 7.1L54.7 8.5L56.1 10.2L57.5 12.0L59.6 14.3L61.7 16.5L63.8 18.4L65.8 19.8L67.9 20.7L70.0 21.0L72.1 20.7L74.2 19.8L76.2 18.4L78.3 16.5L80.4 14.3L82.5 12.0L84.2 10.4L85.8 9.0L87.5 7.8L89.2 6.8L90.8 6.2L92.5 6.0L94.2 6.2L95.8 6.8L97.5 7.8L99.2 9.0L100.8 10.4L102.5 12.0L104.8 14.6L107.2 17.0L109.5 19.1L111.8 20.7L114.2 21.7L116.5 22.0L118.8 21.7L121.2 20.7L123.5 19.1L125.8 17.0L128.2 14.6L130.5 12.0L132.1 10.2L133.7 8.5L135.2 7.1L136.8 5.9L138.4 5.2L140.0 5.0L141.6 5.2L143.2 5.9L144.8 7.1L146.3 8.5L147.9 10.2L149.5 12.0L151.5 14.3L153.5 16.5L155.5 18.4L157.5 19.8L159.5 20.7L161.5 21.0L163.5 20.7L165.5 19.8L167.5 18.4L169.5 16.5L171.5 14.3L173.5 12.0L174.8 10.4L176.2 9.0L177.5 7.8L178.8 6.8L180.2 6.2L181.5 6.0L182.8 6.2L184.2 6.8L185.5 7.8L186.8 9.0L188.2 10.4L189.5 12.0L191.7 14.1L193.8 16.0L196.0 17.7L198.2 18.9L200.3 19.7L202.5 20.0L204.7 19.7L206.8 18.9L209.0 17.7L211.2 16.0L213.3 14.1L215.5 12.0" strokeLinejoin="round" stroke={tinta} strokeWidth={v} strokeLinecap="round" style={{ transition: "stroke-width 150ms ease-out" }} /></svg></div>}
      <div className="flex items-center gap-1.5">
        <button type="button" aria-label="Diminuir espessura" disabled={indice === 0} onClick={() => ir(indice - 1)} className={passoBtn}><Minus size={18} strokeWidth={2} /></button>
        <div ref={trilho} role="slider" tabIndex={0} aria-label="Espessura do traço (px)" aria-valuemin={min} aria-valuemax={min + (POSICOES - 1) * passo} aria-valuenow={v} onKeyDown={aoTeclar}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setArrastando(true); doPonteiro(e); }}
          onPointerMove={(e) => { if (arrastando) doPonteiro(e); }} onPointerUp={() => { setArrastando(false); setFracao(null); }} onPointerCancel={() => { setArrastando(false); setFracao(null); }}
          className="relative h-9 min-w-0 flex-1 cursor-pointer touch-none select-none rounded-full bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400">
          {Array.from({ length: POSICOES }, (_, i) => (
            <span key={i} aria-hidden className="absolute top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-text-muted/60 transition-opacity duration-200"
              style={{ left: `calc(${RAIO}px + (100% - ${2 * RAIO}px) * ${i / (POSICOES - 1)})`, opacity: i === indice ? 0 : 1 }} />
          ))}
          <span aria-hidden className="absolute top-1/2 flex items-center justify-center rounded-full bg-steel-500 text-sm font-medium tabular-nums text-white shadow-md motion-reduce:transition-none"
            style={{ width: 2 * RAIO, height: 2 * RAIO, left: `calc(${RAIO}px + (100% - ${2 * RAIO}px) * ${fracao ?? indice / (POSICOES - 1)})`, transform: `translate(-50%, -50%) scale(${arrastando ? 1.15 : 1})`, transition: arrastando ? "left 70ms ease-out, transform 200ms cubic-bezier(0.2, 0.9, 0.25, 1.3)" : "left 380ms cubic-bezier(0.2, 0.9, 0.25, 1.25), transform 280ms cubic-bezier(0.2, 0.9, 0.25, 1.3)" }}>{v}</span>
        </div>
        <button type="button" aria-label="Aumentar espessura" disabled={indice === POSICOES - 1} onClick={() => ir(indice + 1)} className={passoBtn}><Plus size={18} strokeWidth={2} /></button>
      </div>
    </div>
  );
}
