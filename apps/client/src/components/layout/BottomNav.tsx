import { NavLink } from "react-router-dom";
import { Rss, FileText, Search, CalendarClock, ShieldHalf } from "lucide-react";

/**
 * Bottom nav — 5 ícones outline finos, mesmo peso, sem pills de fundo
 * (seção 2.1). Barra flutuante com blur/glass, cantos grandes, respiro
 * lateral. Nunca grudada na borda, nunca Material Design (regra 1).
 */
const ITENS = [
  { to: "/feed", label: "Feed", Icon: Rss },
  { to: "/notas", label: "Notas", Icon: FileText },
  { to: "/busca", label: "Busca", Icon: Search },
  { to: "/agenda", label: "Agenda", Icon: CalendarClock },
  { to: "/cofre", label: "Cofre", Icon: ShieldHalf },
] as const;

export function BottomNav() {
  return (
    <nav className="fixed inset-x-4 bottom-4 z-40 mx-auto max-w-md">
      {/* py-3 (12px) + 2.5px de cada lado = barra 5px mais grossa no total. */}
      <div className="flex items-center justify-between rounded-[28px] border border-border/60 bg-surface-1/70 px-6 py-[14.5px] shadow-nav backdrop-blur-nav">
        {ITENS.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} className="flex flex-col items-center gap-1" aria-label={label}>
            {({ isActive }) => (
              <>
                <Icon
                  size={22}
                  strokeWidth={1.75}
                  className={
                    isActive
                      ? to === "/cofre"
                        ? "text-violet"
                        : "text-text-primary"
                      : "text-text-muted"
                  }
                />
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
