import { cabecalhoDaSemana, deslocamentoDoMes } from "@/lib/formato-data";
import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, X } from "lucide-react";

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const HORARIOS = Array.from({ length: 96 }, (_, index) => `${String(Math.floor(index / 4)).padStart(2, "0")}:${String((index % 4) * 15).padStart(2, "0")}`);
const iso = (year: number, month: number, day: number) => `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

export function TaskDateTimePicker({ data, horario, onChange, disabled = false }: { data: string; horario: string; onChange: (data: string, horario: string) => void; disabled?: boolean }) {
  const initial = data ? new Date(`${data}T12:00:00`) : new Date();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(initial.getMonth());
  const [year, setYear] = useState(initial.getFullYear());
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const outside = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); }; document.addEventListener("mousedown", outside); return () => document.removeEventListener("mousedown", outside); }, []);
  const days = useMemo(() => {
    const first = deslocamentoDoMes(new Date(year, month, 1));
    const count = new Date(year, month + 1, 0).getDate();
    return Array.from({ length: first + count }, (_, index) => index < first ? null : index - first + 1);
  }, [year, month]);
  const label = data ? `${data.split("-").reverse().join("/")}${horario ? ` · ${horario}` : ""}` : "Definir data e horário";
  function nav(delta: number) { const next = new Date(year, month + delta, 1); setMonth(next.getMonth()); setYear(next.getFullYear()); }
  return <div ref={ref} className="relative">
    <button type="button" disabled={disabled} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="ecos-input flex min-h-11 items-center gap-3 !py-2.5 text-left hover:border-steel-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400 disabled:opacity-40"><CalendarDays size={17} className="text-steel-300" /><span className={`flex-1 ${data ? "text-text-primary" : "text-text-secondary"}`}>{label}</span><Clock size={16} className="text-text-muted" /></button>
    {open && <div role="dialog" aria-label="Escolher data e horário" className="absolute left-0 z-40 mt-1 flex w-[390px] max-w-[calc(100vw-48px)] overflow-hidden rounded-xl border border-border bg-surface-1 shadow-nav">
      <div className="min-w-0 flex-1 p-3"><div className="mb-3 flex items-center justify-between"><button type="button" onClick={() => nav(-1)} className="flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-2"><ChevronLeft size={17} /></button><span className="text-sm font-semibold text-text-primary">{MESES[month]} {year}</span><button type="button" onClick={() => nav(1)} className="flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-2"><ChevronRight size={17} /></button></div><div className="grid grid-cols-7 text-center text-xs text-text-muted">{cabecalhoDaSemana().map((day, index) => <span key={`${day}-${index}`} className="py-1">{day}</span>)}</div><div className="grid grid-cols-7 gap-y-1">{days.map((day, index) => day === null ? <span key={`empty-${index}`} /> : <button key={day} type="button" onClick={() => onChange(iso(year, month, day), horario)} className={`mx-auto flex h-8 w-8 items-center justify-center rounded-full text-xs transition-colors ${data === iso(year, month, day) ? "bg-steel-500 text-white" : "text-text-secondary hover:bg-surface-2 hover:text-text-primary"}`}>{day}</button>)}</div><button type="button" onClick={() => { onChange("", ""); setOpen(false); }} className="mt-3 flex min-h-9 items-center gap-2 text-xs text-text-secondary hover:text-error"><X size={14} />Limpar data e horário</button></div>
      <div className="w-24 shrink-0 border-l border-border"><p className="px-3 pb-2 pt-4 text-xs font-semibold text-text-secondary">Horário</p><div className="max-h-64 overflow-y-auto px-1 pb-2">{HORARIOS.map((time) => <button key={time} type="button" disabled={!data} onClick={() => { onChange(data, time); setOpen(false); }} className={`flex min-h-9 w-full items-center rounded-lg px-3 text-xs ${horario === time ? "bg-steel-700/40 text-text-primary" : "text-text-secondary hover:bg-surface-2"} disabled:cursor-not-allowed disabled:opacity-35`}>{time}</button>)}</div></div>
    </div>}
  </div>;
}
