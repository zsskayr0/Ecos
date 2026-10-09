import { useEffect, useState } from "react";
import { GloboPais } from "./GloboPais";
import { MapaFusos, offsetDoFuso, rotuloOffset } from "./MapaFusos";
import { PAISES_NO_GLOBO } from "./paises";
import "./globo.css";

export type ModoPainel = "globo" | "fusos";

function horaNoFuso(fuso: string, agora: Date): string {
  try { return new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(agora); }
  catch { return "--:--:--"; }
}

/** Camada que gira para dentro/fora (como virar uma carta) ao trocar de visão. */
const camada = (ativa: boolean, lado: 1 | -1) => ({
  opacity: ativa ? 1 : 0,
  transform: ativa ? "perspective(900px) rotateY(0deg) scale(1)" : `perspective(900px) rotateY(${lado * 78}deg) scale(0.9)`,
  filter: ativa ? "none" : "blur(3px)",
  pointerEvents: ativa ? ("auto" as const) : ("none" as const),
});

/**
 * Painel ao lado de Calendário e localização: o globo gira até o país escolhido; enquanto se escolhe o fuso, ele
 * "vira" e dá lugar ao mapa dividido em fusos horários, com a hora local do fuso em tempo real.
 */
export function PainelMundo({ pais, fuso, rotuloFuso, modo, className = "" }: { pais: string; fuso: string; rotuloFuso: string; modo: ModoPainel; className?: string }) {
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    if (modo !== "fusos") return;
    setAgora(new Date());
    const id = window.setInterval(() => setAgora(new Date()), 1000);
    return () => window.clearInterval(id);
  }, [modo]);
  const alvo = PAISES_NO_GLOBO[pais];
  const emGlobo = modo === "globo";

  return (
    <figure className={`ecos-globo relative overflow-hidden rounded-2xl border border-border bg-surface-1 p-3 ${className}`} aria-label={emGlobo ? `Globo mostrando ${pais}` : `Mapa de fusos horários: ${rotuloOffset(offsetDoFuso(fuso))}`}>
      <div className="relative mx-auto aspect-square w-full max-w-[340px]">
        <div className="absolute inset-0 transition-[opacity,transform,filter] duration-500 ease-out" style={camada(emGlobo, -1)}><GloboPais pais={pais} ativo={emGlobo} /></div>
        <div className="absolute inset-0 transition-[opacity,transform,filter] duration-500 ease-out" style={camada(!emGlobo, 1)}><MapaFusos fuso={fuso} pais={pais} ativo={!emGlobo} /></div>
      </div>
      <figcaption className="relative mt-1 grid px-1 text-xs">
        <div className={`col-start-1 row-start-1 flex items-baseline justify-between gap-2 transition-opacity duration-300 ${emGlobo ? "opacity-100" : "opacity-0"}`}>
          <span className="truncate text-sm font-semibold text-text-primary">{pais}</span>
          {alvo && <span className="shrink-0 font-mono-value text-text-muted">{Math.abs(alvo.lat).toFixed(1)}°{alvo.lat >= 0 ? "N" : "S"} {Math.abs(alvo.lon).toFixed(1)}°{alvo.lon >= 0 ? "L" : "O"}</span>}
        </div>
        <div className={`col-start-1 row-start-1 flex items-baseline justify-between gap-2 transition-opacity duration-300 ${emGlobo ? "opacity-0" : "opacity-100"}`} aria-hidden={emGlobo}>
          <span className="truncate text-sm font-semibold text-text-primary">{rotuloFuso}</span>
          <span className="shrink-0 font-mono-value text-text-secondary">{rotuloOffset(offsetDoFuso(fuso, agora))} · {horaNoFuso(fuso, agora)}</span>
        </div>
      </figcaption>
    </figure>
  );
}
