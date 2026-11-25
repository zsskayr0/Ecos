import { Fragment } from "react";
import { NavLink } from "react-router-dom";
import { Rss, FileText, CalendarClock, ListChecks } from "lucide-react";

/**
 * Bottom nav — caminhos de trabalho rápido no mobile. Cofre é uma seção
 * secundária e fica no menu lateral, liberando espaço para Tarefas.
 */
const ITENS = [
  { to: "/feed", label: "Feed", Icon: Rss },
  { to: "/notas", label: "Notas", Icon: FileText },
  { to: "/tarefas", label: "Tarefas", Icon: ListChecks },
  { to: "/agenda", label: "Agenda", Icon: CalendarClock },
] as const;

export function BottomNav() {
  return (
    <nav aria-label="Principal" className="fixed inset-x-4 bottom-[calc(16px+var(--ecos-safe-bottom))] z-40 mx-auto lg:max-w-xl">
      <div className="flex items-center justify-between ecos-pilula-recorte rounded-2xl border border-border/60 bg-surface-1/70 px-2 py-1.5 shadow-nav backdrop-blur-nav">
        {ITENS.map(({ to, label, Icon }, i) => (
          <Fragment key={to}>
            {/* Vão do meio: o botão + (Fab) fica encaixado no recorte da pílula. */}
            {i === ITENS.length / 2 && <span aria-hidden className="w-[76px] shrink-0" />}
          <NavLink
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
          </Fragment>
        ))}
      </div>
    </nav>
  );
}
