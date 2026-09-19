import { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";

interface Props {
  /** `HH:MM` (24 h). */
  value: string;
  onChange: (value: string) => void;
  /** Passo dos minutos (o "encaixe" da Agenda). */
  passo?: number;
  ariaLabel?: string;
  className?: string;
}

const dois = (n: number) => String(n).padStart(2, "0");

/**
 * Seletor de horário do Ecos: no lugar do `<input type="time">` nativo (que traz o visual do sistema), abre duas colunas
 * — horas e minutos no passo do encaixe — no mesmo estilo do `DatePicker`. Acento ciano (Agenda/Tarefa).
 */
export function TimePicker({ value, onChange, passo = 5, ariaLabel = "Horário", className }: Props) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const colunaHora = useRef<HTMLDivElement>(null);
  const colunaMinuto = useRef<HTMLDivElement>(null);
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  const hora = m ? Number(m[1]) : 0;
  const minuto = m ? Number(m[2]) : 0;
  const passoOk = Math.max(1, Math.min(60, Math.round(passo)));
  const minutos = Array.from({ length: Math.ceil(60 / passoOk) }, (_, i) => i * passoOk);
  if (m && !minutos.includes(minuto)) minutos.push(minuto), minutos.sort((a, b) => a - b); // horário já escolhido fora do passo continua visível

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (raiz.current && !raiz.current.contains(e.target as Node)) setAberto(false); };
    document.addEventListener("mousedown", fora);
    // Leva a hora e o minuto atuais para o meio da coluna.
    for (const coluna of [colunaHora.current, colunaMinuto.current]) {
      const escolhido = coluna?.querySelector<HTMLElement>("[aria-pressed='true']");
      if (coluna && escolhido) coluna.scrollTop = escolhido.offsetTop - coluna.clientHeight / 2 + escolhido.clientHeight / 2;
    }
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);

  const agora = () => {
    const d = new Date();
    const total = Math.min(Math.ceil((d.getHours() * 60 + d.getMinutes()) / passoOk) * passoOk, 24 * 60 - passoOk);
    onChange(`${dois(Math.floor(total / 60))}:${dois(total % 60)}`);
    setAberto(false);
  };
  const item = (ativo: boolean) => `mx-auto flex h-8 w-11 shrink-0 items-center justify-center rounded-lg font-mono-value text-sm transition-colors ${ativo ? "bg-cyan font-semibold text-black" : "text-text-secondary hover:bg-surface-2"}`;

  return (
    <div ref={raiz} className={`relative ${className ?? ""}`} onKeyDown={(e) => { if (e.key === "Escape" && aberto) { e.stopPropagation(); setAberto(false); } }}>
      <button type="button" aria-label={ariaLabel} aria-haspopup="dialog" aria-expanded={aberto} onClick={() => setAberto((v) => !v)}
        className="flex w-full items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 font-mono-value text-sm text-text-primary transition-colors hover:bg-surface-2/80">
        <Clock size={14} className="text-cyan" strokeWidth={1.75} />
        {m ? `${dois(hora)}:${dois(minuto)}` : "--:--"}
      </button>
      {aberto && (
        <div role="dialog" aria-label={`${ariaLabel}: escolher`} className="ecos-fade-in absolute left-0 top-full z-20 mt-2 w-48 rounded-2xl border border-cyan/25 bg-surface-1 p-2 shadow-xl">
          <div className="grid grid-cols-2 gap-2">
            <div ref={colunaHora} role="group" aria-label="Horas" className="relative max-h-44 space-y-1 overflow-y-auto scroll-smooth pr-1">
              {Array.from({ length: 24 }, (_, h) => <button key={h} type="button" aria-label={`Hora ${dois(h)}`} aria-pressed={h === hora} onClick={() => onChange(`${dois(h)}:${dois(minuto)}`)} className={item(h === hora)}>{dois(h)}</button>)}
            </div>
            <div ref={colunaMinuto} role="group" aria-label="Minutos" className="relative max-h-44 space-y-1 overflow-y-auto scroll-smooth pr-1">
              {minutos.map((mm) => <button key={mm} type="button" aria-label={`Minuto ${dois(mm)}`} aria-pressed={mm === minuto} onClick={() => onChange(`${dois(hora)}:${dois(mm)}`)} className={item(mm === minuto)}>{dois(mm)}</button>)}
            </div>
          </div>
          <div className="mt-2 flex gap-1">
            <button type="button" onClick={agora} className="flex-1 rounded-xl py-1.5 text-center text-xs font-medium text-cyan hover:bg-surface-2">Agora</button>
            <button type="button" onClick={() => setAberto(false)} className="flex-1 rounded-xl py-1.5 text-center text-xs font-medium text-text-secondary hover:bg-surface-2">Pronto</button>
          </div>
        </div>
      )}
    </div>
  );
}
