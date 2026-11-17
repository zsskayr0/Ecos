import { useEffect, useRef, useState } from "react";
import { formatarData, useFormatoData } from "@/lib/formato-data";
import { CalendarDays } from "lucide-react";
import { GradeMes, dataParaISO as paraISO, isoParaData as paraData } from "./GradeMes";

interface Props {
  /** `YYYY-MM-DD`, matching `TransacaoApi.data`'s wire format. */
  value: string;
  onChange: (value: string) => void;
  className?: string;
  /** Violet is exclusive to the Cofre (section 1.3) — Agenda/Tarefa
   * contexts use cyan instead, same accent as their own Feed cards. */
  accent?: "violet" | "cyan";
  /** Mostra "Limpar" e aceita valor vazio (data opcional). */
  limpavel?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
}

/** Tailwind needs full literal class names to see them at build time —
 * can't interpolate `text-${accent}` — so each accent's classes are
 * spelled out here instead of built from a template string. */
const CORES = {
  violet: {
    icone: "text-violet",
    borda: "border-violet/25",
    hoje: "border border-violet text-text-primary",
    selecionado: "bg-violet font-semibold text-black",
    hojeBtn: "text-violet hover:bg-surface-2",
  },
  cyan: {
    icone: "text-cyan",
    borda: "border-cyan/25",
    hoje: "border border-cyan text-text-primary",
    selecionado: "bg-cyan font-semibold text-black",
    hojeBtn: "text-cyan hover:bg-surface-2",
  },
} as const;

/**
 * Custom calendar dropdown for picking a Transacao's date — replaces the
 * browser's native `<input type="date">` popup, which carries the OS's own
 * chrome/fonts/colors and doesn't follow Ecos's design system at all
 * (section 1). Violet-themed since it only ever appears inside a
 * Cofre-context form (section 1.3: violet exclusively signals "Cofre") —
 * pass `accent="cyan"` for any other context (e.g. Tarefa/Agenda).
 */
export function DatePicker({ value, onChange, className, accent = "violet", limpavel = false, disabled = false, ariaLabel }: Props) {
  const cor = CORES[accent];
  useFormatoData(); // re-renderiza quando o formato de data muda
  const [aberto, setAberto] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    function aoClicarFora(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setAberto(false);
    }
    document.addEventListener("mousedown", aoClicarFora);
    return () => document.removeEventListener("mousedown", aoClicarFora);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  const hoje = new Date();

  function irParaHoje() {
    onChange(paraISO(hoje));
    setAberto(false);
  }

  return (
    <div ref={containerRef} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        disabled={disabled}
        aria-label={ariaLabel}
        className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-1.5 font-mono-value text-sm text-text-primary"
      >
        <CalendarDays size={14} className={cor.icone} strokeWidth={1.75} />
        {value ? formatarData(paraData(value), undefined) : "Sem data"}
      </button>

      {aberto && (
        <div className={`absolute left-1/2 top-full z-20 mt-2 w-64 max-w-[85vw] -translate-x-1/2 rounded-2xl border ${cor.borda} bg-surface-1 p-3 shadow-xl`}>
          <GradeMes valor={value} onSelecionar={(iso) => { onChange(iso); setAberto(false); }} classeSelecionado={cor.selecionado} classeHoje={cor.hoje} />

          <div className="mt-2 flex items-center justify-between gap-2">
            {limpavel && <button type="button" onClick={() => { onChange(""); setAberto(false); }} className="flex-1 rounded-xl py-1.5 text-center text-xs font-medium text-text-muted hover:bg-surface-2">Limpar</button>}
            <button type="button" onClick={irParaHoje} className={`flex-1 rounded-xl py-1.5 text-center text-xs font-medium ${cor.hojeBtn}`}>
              Hoje
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
