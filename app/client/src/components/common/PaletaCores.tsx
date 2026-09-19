import { useEffect, useRef, useState } from "react";

export const PALETAS_CORES = [
  { nome: "Vivas", cor: "#E11D48", cores: ["#2563EB", "#0891B2", "#06B6D4", "#0D9488", "#059669", "#16A34A", "#65A30D", "#EAB308", "#F59E0B", "#EA580C", "#DC2626", "#E11D48", "#DB2777", "#C026D3", "#7C3AED", "#4F46E5", "#9333EA", "#0284C7"] },
  { nome: "Pastéis", cor: "#A78BFA", cores: ["#93C5FD", "#A5D8FF", "#A5F3FC", "#99F6E4", "#A7F3D0", "#BBF7D0", "#D9F99D", "#FEF08A", "#FDE68A", "#FED7AA", "#FECACA", "#FECDD3", "#FBCFE8", "#F5D0FE", "#DDD6FE", "#C7D2FE", "#BAE6FD", "#E2E8F0"] },
  { nome: "Escuras", cor: "#4F46E5", cores: ["#1E3A8A", "#164E63", "#134E4A", "#14532D", "#365314", "#713F12", "#7C2D12", "#7F1D1D", "#881337", "#831843", "#701A75", "#581C87", "#312E81", "#0C4A6E", "#1E293B", "#292524", "#3F3F46", "#111827"] },
  { nome: "Neutras", cor: "#64748B", cores: ["#F8FAFC", "#E2E8F0", "#CBD5E1", "#94A3B8", "#64748B", "#475569", "#334155", "#1E293B", "#F5F5F4", "#D6D3D1", "#A8A29E", "#78716C", "#57534E", "#44403C", "#27272A", "#18181B", "#3E6FA8", "#0F172A"] },
] as const;

/** Seletor de cor das equipes: 4 paletas, arrastar para escolher e cor personalizada. */
export function PaletaCores({ valor, onChange }: { valor: string; onChange: (cor: string) => void }) {
  const grupoInicial = Math.max(0, PALETAS_CORES.findIndex((grupo) => grupo.cores.some((cor) => cor.toLowerCase() === valor.toLowerCase())));
  const [grupoAtivo, setGrupoAtivo] = useState(grupoInicial);
  const cores = PALETAS_CORES[grupoAtivo].cores;
  const inicial = Math.max(0, cores.findIndex((cor) => cor.toLowerCase() === valor.toLowerCase()));
  const [destaque, setDestaque] = useState(inicial);
  const arrastando = useRef(false);
  const arrastandoTipo = useRef(false);
  const colunas = 6;
  const passo = 34;
  useEffect(() => {
    const indice = cores.findIndex((cor) => cor.toLowerCase() === valor.toLowerCase());
    if (indice >= 0) setDestaque(indice);
  }, [cores, valor]);
  useEffect(() => {
    const parar = () => { arrastando.current = false; arrastandoTipo.current = false; };
    window.addEventListener("pointerup", parar);
    window.addEventListener("pointercancel", parar);
    return () => { window.removeEventListener("pointerup", parar); window.removeEventListener("pointercancel", parar); };
  }, []);
  const escolher = (indice: number) => { setDestaque(indice); onChange(cores[indice]); };
  const trocarTipo = (indice: number) => {
    const posicao = Math.min(destaque, PALETAS_CORES[indice].cores.length - 1);
    setGrupoAtivo(indice);
    setDestaque(posicao);
    onChange(PALETAS_CORES[indice].cores[posicao]);
  };
  return <div><div className="relative mb-2 grid touch-none select-none grid-cols-4 rounded-lg bg-surface-2 p-0.5"><span aria-hidden className="pointer-events-none absolute bottom-0.5 left-0.5 top-0.5 w-[calc(25%-2px)] rounded-md border shadow-sm transition-[transform,background-color,border-color] duration-100 ease-out motion-reduce:transition-none" style={{ transform: `translateX(${grupoAtivo * 100}%)`, backgroundColor: `${PALETAS_CORES[grupoAtivo].cor}22`, borderColor: `${PALETAS_CORES[grupoAtivo].cor}80` }} />{PALETAS_CORES.map((grupo, indice) => <button key={grupo.nome} type="button" onPointerDown={(e) => { e.preventDefault(); arrastandoTipo.current = true; trocarTipo(indice); }} onPointerEnter={() => { if (arrastandoTipo.current) trocarTipo(indice); }} onFocus={() => trocarTipo(indice)} onClick={() => trocarTipo(indice)} className={`relative z-10 rounded-md px-1 py-1.5 text-[10px] font-medium transition-colors duration-100 ${grupoAtivo === indice ? "text-text-primary" : "text-text-muted hover:text-text-secondary"}`}>{grupo.nome}</button>)}</div><div className="relative mx-auto grid w-fit touch-none select-none grid-cols-6 gap-1.5 rounded-xl p-1" onPointerLeave={() => { if (!arrastando.current) setDestaque(Math.max(0, cores.findIndex((cor) => cor.toLowerCase() === valor.toLowerCase()))); }}>
    <span aria-hidden className="pointer-events-none absolute left-1 top-1 h-7 w-7 rounded-full border-2 border-white/90 shadow-[0_0_0_2px_rgba(62,111,168,0.35)] transition-transform duration-100 ease-out motion-reduce:transition-none" style={{ transform: `translate3d(${(destaque % colunas) * passo}px, ${Math.floor(destaque / colunas) * passo}px, 0)` }} />
    {cores.map((opcao, indice) => <button key={opcao} type="button" aria-label={`Usar cor ${opcao}`} aria-pressed={valor.toLowerCase() === opcao.toLowerCase()} onPointerDown={(e) => { e.preventDefault(); arrastando.current = true; escolher(indice); }} onPointerEnter={() => { setDestaque(indice); if (arrastando.current) escolher(indice); }} onFocus={() => setDestaque(indice)} onClick={() => escolher(indice)} className="relative h-7 w-7 rounded-full border-2 border-black/10 shadow-sm transition-transform duration-100 hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steel-300" style={{ backgroundColor: opcao }} />)}
  </div><label className="mt-2 flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"><span className="relative h-7 w-7 shrink-0 rounded-full border-2 border-white/50 shadow-sm" style={{ background: "conic-gradient(#ef4444, #eab308, #22c55e, #06b6d4, #6366f1, #d946ef, #ef4444)" }}><input type="color" value={valor} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" /></span><span>Cor personalizada</span><span className="ml-auto font-mono text-[10px] uppercase text-text-muted">{valor}</span></label></div>;
}
