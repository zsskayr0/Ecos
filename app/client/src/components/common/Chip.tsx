import type { ReactNode } from "react";

interface ChipProps {
  children: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  icon?: ReactNode;
  accentColor?: string;
}

/** Selection chip — Tarefa duration, Transacao category (section 3.6). */
export function Chip({ children, selected, onClick, icon, accentColor }: ChipProps) {
  return (
    <button
      type="button"
      data-selected={selected ? "true" : undefined}
      onClick={onClick}
      className={`flex items-center gap-1.5 ecos-chip rounded-xl border px-3.5 py-2 text-sm font-medium ${
        selected
          ? "border-steel-400 bg-steel-700/30 text-text-primary"
          : "border-border bg-surface-2 text-text-secondary hover:border-steel-500/60"
      }`}
      style={selected && accentColor ? { borderColor: accentColor, backgroundColor: `${accentColor}22` } : undefined}
    >
      {icon}
      {children}
    </button>
  );
}
