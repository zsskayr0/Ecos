import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

interface PillProps {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  withCaret?: boolean;
}

/** Pill de filtro do topbar (seção 2.2) — "Tudo" por padrão. */
export function Pill({ children, onClick, active, withCaret }: PillProps) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 rounded-pill px-4 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-surface-3 text-text-primary"
          : "bg-surface-2 text-text-secondary hover:text-text-primary"
      }`}
    >
      {children}
      {withCaret && <ChevronDown size={14} strokeWidth={1.75} />}
    </button>
  );
}
