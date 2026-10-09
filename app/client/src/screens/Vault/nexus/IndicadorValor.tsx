import { useRef } from "react";
import type { ModoValor } from "@/lib/exibicao-valores";

/**
 * Barra ou anel ao lado de um valor. `max` é o maior valor da tela no período atual (100%).
 * No modo "numero" não desenha nada.
 */
export function IndicadorValor({ modo, valor, max, cor = "var(--cofre-accent, #3b82f6)" }: { modo: ModoValor; valor: number; max: number; cor?: string }) {
  if (modo === "numero") return null;
  const pct = max > 0 ? Math.min(1, Math.abs(valor) / max) : 0;
  if (modo === "barra") {
    return (
      <i className="cofre-ind-barra" role="presentation" aria-hidden="true">
        <u style={{ width: `${Math.round(pct * 100)}%`, background: cor }} />
      </i>
    );
  }
  const r = 8;
  const c = 2 * Math.PI * r;
  return (
    <svg className="cofre-ind-anel" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r={r} fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="3" />
      <circle cx="10" cy="10" r={r} fill="none" stroke={cor} strokeWidth="3" strokeLinecap="round" strokeDasharray={`${c * pct} ${c}`} transform="rotate(-90 10 10)" />
    </svg>
  );
}

/** Conteúdo de `.cofre-cats-row-total`: o valor e, conforme o modo, a barra embaixo ou o anel ao lado. */
export function TotalDaLinha({ modo, valor, max, cor, texto, negativo }: { modo: ModoValor; valor: number; max: number; cor?: string; texto: string; negativo?: boolean }) {
  const num = <b className="cofre-mono" data-neg={negativo || undefined}>{texto}</b>;
  if (modo === "barra") {
    const pct = max > 0 ? Math.round(Math.min(1, Math.abs(valor) / max) * 100) : 0;
    return <>{num}<i><u style={{ width: `${Math.max(pct > 0 ? 4 : 0, pct)}%`, background: cor }} /></i></>;
  }
  if (modo === "anel") return <span className="cofre-ind-valor cofre-ind-linha">{num}<IndicadorValor modo="anel" valor={valor} max={max} cor={cor} /></span>;
  return num;
}

/**
 * Valor formatado + indicador lado a lado. O espaço do indicador abre e fecha com animação (via CSS em `data-modo`),
 * e lembra o último desenho para ele não sumir de uma vez quando volta para "número".
 */
export function ValorComIndicador({ modo, valor, max, children, cor }: { modo: ModoValor; valor: number; max: number; children: React.ReactNode; cor?: string }) {
  const ultimo = useRef<Exclude<ModoValor, "numero">>("barra");
  if (modo !== "numero") ultimo.current = modo;
  return <span className="cofre-ind-valor"><span className="cofre-ind-num">{children}</span><span className="cofre-ind-slot" data-modo={modo} aria-hidden="true"><IndicadorValor modo={ultimo.current} valor={valor} max={max} cor={cor} /></span></span>;
}
