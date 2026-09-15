import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

interface Props {
  /** `YYYY-MM-DD`, matching `TransacaoApi.data`'s wire format. */
  value: string;
  onChange: (value: string) => void;
  className?: string;
  /** Violet is exclusive to the Cofre (section 1.3) — Agenda/Tarefa
   * contexts use cyan instead, same accent as their own Feed cards. */
  accent?: "violet" | "cyan";
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

function paraISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function paraData(iso: string): Date {
  const [ano, mes, dia] = iso.split("-").map(Number);
  return new Date(ano, mes - 1, dia);
}

function gerarDiasDoMes(referencia: Date) {
  const ano = referencia.getFullYear();
  const mes = referencia.getMonth();
  const primeiroDia = new Date(ano, mes, 1);
  const totalDias = new Date(ano, mes + 1, 0).getDate();
  const offset = primeiroDia.getDay();
  return { offset, totalDias, ano, mes };
}

/**
 * Custom calendar dropdown for picking a Transacao's date — replaces the
 * browser's native `<input type="date">` popup, which carries the OS's own
 * chrome/fonts/colors and doesn't follow Ecos's design system at all
 * (section 1). Violet-themed since it only ever appears inside a
 * Cofre-context form (section 1.3: violet exclusively signals "Cofre") —
 * pass `accent="cyan"` for any other context (e.g. Tarefa/Agenda).
 */
export function DatePicker({ value, onChange, className, accent = "violet" }: Props) {
  const cor = CORES[accent];
  const [aberto, setAberto] = useState(false);
  const [mesReferencia, setMesReferencia] = useState(() => paraData(value));
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    setMesReferencia(paraData(value));
    function aoClicarFora(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setAberto(false);
    }
    document.addEventListener("mousedown", aoClicarFora);
    return () => document.removeEventListener("mousedown", aoClicarFora);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  const { offset, totalDias, ano, mes } = gerarDiasDoMes(mesReferencia);
  const hoje = new Date();
  const nomeMes = mesReferencia.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  function selecionar(dia: number) {
    onChange(paraISO(new Date(ano, mes, dia)));
    setAberto(false);
  }

  function irParaHoje() {
    onChange(paraISO(hoje));
    setAberto(false);
  }

  return (
    <div ref={containerRef} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-1.5 font-mono-value text-sm text-text-primary"
      >
        <CalendarDays size={14} className={cor.icone} strokeWidth={1.75} />
        {paraData(value).toLocaleDateString("pt-BR")}
      </button>

      {aberto && (
        <div className={`absolute left-1/2 top-full z-20 mt-2 w-64 max-w-[85vw] -translate-x-1/2 rounded-2xl border ${cor.borda} bg-surface-1 p-3 shadow-xl`}>
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setMesReferencia((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
              className="rounded-full p-1 text-text-muted hover:bg-surface-2"
              aria-label="Mês anterior"
            >
              <ChevronLeft size={16} />
            </button>
            <p className="text-sm font-medium capitalize text-text-primary">{nomeMes}</p>
            <button
              type="button"
              onClick={() => setMesReferencia((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
              className="rounded-full p-1 text-text-muted hover:bg-surface-2"
              aria-label="Próximo mês"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-y-1">
            {["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => (
              <div key={i} className="text-center text-[10px] font-medium text-text-muted">
                {d}
              </div>
            ))}
            {Array.from({ length: offset }).map((_, i) => (
              <div key={`vazio-${i}`} />
            ))}
            {Array.from({ length: totalDias }, (_, i) => i + 1).map((dia) => {
              const ehSelecionado = value === paraISO(new Date(ano, mes, dia));
              const ehHoje = ano === hoje.getFullYear() && mes === hoje.getMonth() && dia === hoje.getDate();
              return (
                <button
                  key={dia}
                  type="button"
                  onClick={() => selecionar(dia)}
                  className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full text-xs ${
                    ehSelecionado ? cor.selecionado : ehHoje ? cor.hoje : "text-text-secondary hover:bg-surface-2"
                  }`}
                >
                  {dia}
                </button>
              );
            })}
          </div>

          <button type="button" onClick={irParaHoje} className={`mt-2 w-full rounded-xl py-1.5 text-center text-xs font-medium ${cor.hojeBtn}`}>
            Hoje
          </button>
        </div>
      )}
    </div>
  );
}
