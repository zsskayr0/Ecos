import {
  CalendarCheck2,
  CalendarDays,
  HelpCircle,
  Library,
  ListChecks,
  LogOut,
  Newspaper,
  Settings,
  StickyNote,
  Trash2,
  User,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Avatar } from "@/components/common/Avatar";
import { useAppUI } from "@/lib/ui-context";
import { useAuth, nomeExibicao } from "@/lib/auth-context";
import { useFotoPerfil } from "@/lib/profile-avatar";

interface ItemMenu {
  rota: string;
  rotulo: string;
  Icone: typeof User;
  destaque?: "erro";
}

/** Navegação lateral do mobile, organizada como o rail do desktop. */
const MODULOS: ItemMenu[] = [
  { rota: "/hoje", rotulo: "Hoje", Icone: CalendarCheck2 },
  { rota: "/agenda", rotulo: "Agenda", Icone: CalendarDays },
  { rota: "/tarefas", rotulo: "Tarefas", Icone: ListChecks },
  { rota: "/notas", rotulo: "Notas", Icone: StickyNote },
  { rota: "/feed", rotulo: "Feed", Icone: Newspaper },
  { rota: "/cofre", rotulo: "Cofre", Icone: Wallet },
  { rota: "/media", rotulo: "Media", Icone: Library },
];

const ADMINISTRACAO: ItemMenu[] = [
  { rota: "/configuracoes/equipes", rotulo: "Equipes", Icone: Users },
  { rota: "/configuracoes", rotulo: "Configurações", Icone: Settings },
  { rota: "/lixeira", rotulo: "Lixeira", Icone: Trash2, destaque: "erro" },
];

export function Drawer() {
  const { drawerAberto, fecharDrawer } = useAppUI();
  const { perfil, logout } = useAuth();
  const { url: urlFotoPerfil } = useFotoPerfil(perfil?.id, perfil?.avatar_atualizado_em);
  const navigate = useNavigate();
  const { pathname } = useLocation();

  if (!drawerAberto) return null;

  function ir(rota: string) {
    fecharDrawer();
    navigate(rota);
  }

  function ativo(rota: string) {
    if (rota === "/configuracoes") return pathname.startsWith("/configuracoes") && !pathname.startsWith("/configuracoes/equipes");
    return pathname === rota || pathname.startsWith(`${rota}/`);
  }

  function item({ rota, rotulo, Icone, destaque }: ItemMenu) {
    const selecionado = ativo(rota);
    const erro = destaque === "erro";
    return (
      <button
        key={rota}
        type="button"
        onClick={() => ir(rota)}
        aria-current={selecionado ? "page" : undefined}
        className={`relative flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium transition-colors ${
          erro
            ? selecionado ? "bg-error/15 text-error" : "text-error/75 hover:bg-error/10 hover:text-error"
            : selecionado ? "bg-surface-2 text-text-primary" : "text-text-muted hover:bg-surface-2 hover:text-text-primary"
        }`}
      >
        {selecionado && <span className={`absolute -left-2 top-2 bottom-2 w-0.5 rounded-full ${erro ? "bg-error" : "bg-cyan"}`} />}
        <Icone size={19} strokeWidth={1.75} className="shrink-0" />
        {rotulo}
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <aside aria-label="Menu principal" className="flex h-full w-[82%] max-w-xs flex-col overflow-y-auto border-r border-border bg-surface-1 px-2 py-3 shadow-nav ecos-fade-in">
        <header className="mb-3 flex items-center justify-between px-2">
          <button type="button" onClick={() => ir("/perfil")} className="flex min-w-0 items-center gap-3 rounded-xl p-1 text-left hover:bg-surface-2">
            <Avatar nome={perfil ? nomeExibicao(perfil) : "?"} tamanho={40} url={urlFotoPerfil} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-text-primary">{perfil ? nomeExibicao(perfil) : "Perfil"}</span>
              <span className="block text-xs text-text-muted">Ver perfil</span>
            </span>
          </button>
          <button type="button" onClick={fecharDrawer} aria-label="Fechar menu" className="flex h-9 w-9 items-center justify-center rounded-lg text-text-muted hover:bg-surface-2 hover:text-text-primary">
            <X size={19} />
          </button>
        </header>

        <nav className="flex flex-col gap-1" aria-label="Módulos">{MODULOS.map(item)}</nav>
        <div className="my-3 border-t border-border" />
        <nav className="flex flex-col gap-1" aria-label="Administração">{ADMINISTRACAO.map(item)}</nav>

        <div className="mt-auto pt-3">
          <div className="border-t border-border pt-3">
            <button type="button" onClick={() => ir("/ajuda")} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary">
              <HelpCircle size={19} strokeWidth={1.75} />
              Ajuda
            </button>
            <button type="button" onClick={() => { fecharDrawer(); void logout(); }} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium text-error transition-colors hover:bg-error/10">
              <LogOut size={19} strokeWidth={1.75} />
              Sair
            </button>
          </div>
        </div>
      </aside>
      <button aria-label="Fechar menu" onClick={fecharDrawer} className="flex-1 bg-black/50 backdrop-blur-[2px]" />
    </div>
  );
}
