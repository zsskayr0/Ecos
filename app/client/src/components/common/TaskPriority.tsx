import { useEffect, useId, useRef, type PointerEvent } from "react";
import { Flag } from "lucide-react";
import type { PrioridadeTarefa } from "@/lib/api";

const OPTIONS: { value: PrioridadeTarefa; label: string }[] = [
  { value: "baixa", label: "Baixa" }, { value: "media", label: "Média" }, { value: "alta", label: "Alta" },
];
const COLORS = {
  baixa: { thumb: "border-steel-400 bg-steel-700/20", text: "text-text-primary", icon: "text-steel-300" },
  media: { thumb: "border-warning bg-warning/15", text: "text-text-primary", icon: "text-warning" },
  alta: { thumb: "border-error bg-error/15", text: "text-text-primary", icon: "text-error" },
};

export function TaskPriority({ value, onChange, disabled = false, compact = false }: {
  value: PrioridadeTarefa; onChange: (value: PrioridadeTarefa) => void; disabled?: boolean; compact?: boolean;
}) {
  const id = useId();
  const gesture = useRef<{ pointer: number; x: number; y: number; dragging: boolean } | null>(null);
  const ignoreClick = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => { clearTimeout(timer.current); }, []);

  function selectAt(e: PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const index = Math.max(0, Math.min(2, Math.floor((e.clientX - rect.left - 4) / (rect.width - 8) * 3)));
    onChange(OPTIONS[index].value);
  }

  return <div className={`flex flex-col gap-2 md:flex-row md:items-center ${compact ? "" : "md:gap-5"}`}>
    {!compact && <span id={`${id}-label`} className="text-sm font-medium text-text-secondary">Prioridade</span>}
    <div role="group" aria-label={compact ? "Prioridade" : undefined} aria-labelledby={compact ? undefined : `${id}-label`} className={`relative grid touch-pan-y select-none grid-cols-3 rounded-xl bg-surface-2 p-1 ${compact ? "w-[135px]" : "md:w-80"}`}
      onPointerDown={(e) => {
        if (!disabled && e.isPrimary && e.button === 0) gesture.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY, dragging: false };
      }}
      onPointerMove={(e) => {
        const g = gesture.current;
        if (!g || g.pointer !== e.pointerId) return;
        const dx = Math.abs(e.clientX - g.x), dy = Math.abs(e.clientY - g.y);
        if (!g.dragging && dy > 10 && dy > dx) { gesture.current = null; return; }
        if (!g.dragging && dx > 8 && dx > dy) { g.dragging = true; e.currentTarget.setPointerCapture(e.pointerId); }
        if (g.dragging) { e.preventDefault(); selectAt(e); }
      }}
      onPointerUp={(e) => {
        if (gesture.current?.pointer !== e.pointerId) return;
        if (gesture.current.dragging) {
          selectAt(e); ignoreClick.current = true;
          clearTimeout(timer.current); timer.current = setTimeout(() => { ignoreClick.current = false; }, 0);
        }
        gesture.current = null;
      }}
      onPointerCancel={() => { gesture.current = null; }}
      onClickCapture={(e) => { if (ignoreClick.current) { e.preventDefault(); e.stopPropagation(); } }}>
      <span aria-hidden="true" className={`pointer-events-none absolute bottom-1 left-1 top-1 w-[calc((100%-8px)/3)] rounded-lg border transition-[transform,background-color,border-color] duration-200 motion-reduce:transition-none ${COLORS[value].thumb}`}
        style={{ transform: `translateX(${OPTIONS.findIndex((p) => p.value === value) * 100}%)` }} />
      {OPTIONS.map((option) => <label key={option.value} className={`relative min-w-0 ${disabled ? "opacity-50" : "cursor-pointer"}`}>
        <input type="radio" name={id} value={option.value} checked={value === option.value} disabled={disabled}
          onChange={() => onChange(option.value)} className="peer sr-only" />
        <span title={option.label} className={`flex ${compact ? "min-h-11 px-2" : "min-h-11 px-3 py-2.5 text-sm"} items-center justify-center rounded-lg peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-steel-400 ${value === option.value ? `font-semibold ${COLORS[value].text}` : "text-text-secondary"}`}><Flag size={compact ? 17 : 16} className={COLORS[option.value].icon} aria-hidden="true" /><span className="sr-only">{option.label}</span>{!compact && <span className="ml-2">{option.label}</span>}</span>
      </label>)}
    </div>
  </div>;
}
