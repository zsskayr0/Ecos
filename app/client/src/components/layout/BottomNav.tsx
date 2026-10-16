import { NavLink } from "react-router-dom";
import { Rss, FileText, Search, CalendarClock, ListChecks } from "lucide-react";

/**
 * Bottom nav — caminhos de trabalho rápido no mobile. Cofre é uma seção
 * secundária e fica no menu lateral, liberando espaço para Tarefas.
 */
const ITENS = [
  { to: "/feed", label: "Feed", Icon: Rss },
  { to: "/notas", label: "Notas", Icon: FileText },
  { to: "/busca", label: "Busca", Icon: Search },
  { to: "/tarefas", label: "Tarefas", Icon: ListChecks },
  { to: "/agenda", label: "Agenda", Icon: CalendarClock },
] as const;

export function BottomNav() {
  return (
    <nav aria-label="Principal" className="fixed inset-x-4 bottom-[calc(16px+var(--ecos-safe-bottom))] z-40 mx-auto max-w-md md:max-w-xl">
      <div className="flex items-center justify-between rounded-[28px] border border-border/60 bg-surface-1/70 px-2 py-1.5 shadow-nav backdrop-blur-nav">
        {ITENS.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className="relative flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl py-2"
          >
            {({ isActive }) => (
              <>
                {/* Indicador ativo além da cor: barra no topo + rótulo em negrito (aria-current vem do NavLink). */}
                <span
                  aria-hidden
                  className={`absolute left-1/2 top-0 h-0.5 w-6 -translate-x-1/2 rounded-full ${isActive ? "bg-text-primary" : "bg-transparent"}`}
                />
                <Icon
                  size={22}
                  strokeWidth={isActive ? 2.25 : 1.75}
                  aria-hidden
                  className={isActive ? "text-text-primary" : "text-text-muted"}
                />
                <span className={`text-[11px] leading-none ${isActive ? "font-semibold text-text-primary" : "text-text-muted"}`}>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
