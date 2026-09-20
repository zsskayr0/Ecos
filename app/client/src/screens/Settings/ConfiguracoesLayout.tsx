import { Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import { Bell, CalendarClock, CalendarDays, DatabaseBackup, FolderTree, Info, Palette, Server, ShieldCheck, User, Users, type LucideIcon } from "lucide-react";
import { useIsDesktop } from "@/lib/use-viewport";

export interface Aba { para: string; rotulo: string; Icone: LucideIcon; fim?: boolean }

export const GRUPOS: { titulo: string; abas: Aba[] }[] = [
  { titulo: "Conta", abas: [
    { para: "/configuracoes/perfil", rotulo: "Perfil", Icone: User },
    { para: "/configuracoes/rotina", rotulo: "Rotina", Icone: CalendarClock },
    { para: "/configuracoes/equipes", rotulo: "Equipes", Icone: Users },
  ] },
  { titulo: "Geral", abas: [
    { para: "/configuracoes/aparencia", rotulo: "Aparência", Icone: Palette },
    { para: "/configuracoes/calendario", rotulo: "Calendário e localização", Icone: CalendarDays },
    { para: "/configuracoes/organizacao", rotulo: "Organização", Icone: FolderTree },
  ] },
  { titulo: "Sistema", abas: [
    { para: "/configuracoes/servidor", rotulo: "Servidor e backup", Icone: Server },
    { para: "/configuracoes/privacidade", rotulo: "Privacidade e cofre", Icone: ShieldCheck },
    { para: "/configuracoes/conta", rotulo: "Conta e dados", Icone: DatabaseBackup },
    { para: "/configuracoes/notificacoes", rotulo: "Notificações", Icone: Bell },
  ] },
  { titulo: "Ecos", abas: [{ para: "/configuracoes/sobre", rotulo: "Sobre", Icone: Info }] },
];

/** No desktop, as configurações ganham uma barra lateral de categorias (estilo Obsidian); no celular continua a lista de telas. */
export function ConfiguracoesLayout() {
  const desktop = useIsDesktop();
  const { pathname } = useLocation();
  if (!desktop) return <Outlet />;
  // No desktop a lista de configurações é a própria barra lateral: a raiz abre a primeira aba.
  if (pathname.replace(/\/$/, "") === "/configuracoes") return <Navigate to="/configuracoes/perfil" replace />;
  return (
    <div className="config-desktop flex h-full min-h-[70vh] overflow-hidden">
      <nav aria-label="Categorias de configurações" className="relative z-10 w-56 shrink-0 overflow-y-auto border-r border-border bg-surface-1/60 px-2 py-4">
        {GRUPOS.map((grupo) => (
          <div key={grupo.titulo} className="mb-4">
            <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wide text-text-muted">{grupo.titulo}</p>
            {grupo.abas.map(({ para, rotulo, Icone, fim }) => (
              <NavLink key={para} to={para} end={fim} className={({ isActive }) => `flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition-colors ${isActive ? "bg-surface-3 font-medium text-text-primary" : "text-text-secondary hover:bg-surface-2 hover:text-text-primary"}`}>
                <Icone size={16} strokeWidth={1.75} aria-hidden />{rotulo}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="relative isolate min-w-0 flex-1 overflow-y-auto"><div className="mx-auto max-w-4xl"><Outlet /></div></div>
    </div>
  );
}
