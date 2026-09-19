import { X, User, Plus, LifeBuoy, RefreshCw, ShieldCheck, ShieldHalf, LogOut, ListChecks, Library, Trash2, CalendarCheck2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Avatar } from "@/components/common/Avatar";
import { useAppUI } from "@/lib/ui-context";
import { useAuth, nomeExibicao } from "@/lib/auth-context";
import { useMinhasEquipes } from "@/lib/use-minhas-equipes";
import { corDaEquipe } from "@/lib/team-color";
import { useFotoPerfil } from "@/lib/profile-avatar";

/** Side drawer via the avatar (section 3.9). */
export function Drawer() {
  const { drawerAberto, fecharDrawer } = useAppUI();
  const { perfil, logout } = useAuth();
  const { url: urlFotoPerfil } = useFotoPerfil(perfil?.id, perfil?.avatar_atualizado_em);
  const { equipes } = useMinhasEquipes();
  const navigate = useNavigate();

  if (!drawerAberto) return null;

  function ir(rota: string) {
    fecharDrawer();
    navigate(rota);
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Panel first (left), backdrop after (`flex-1`, takes up the rest
          on the right) — the order in the flex is what decides which
          side the drawer opens from; reversed, it opened from the
          right. */}
      <div className="flex h-full w-[82%] max-w-xs flex-col gap-6 overflow-y-auto bg-surface-1 p-5 ecos-fade-in">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Avatar nome={perfil ? nomeExibicao(perfil) : "?"} tamanho={44} url={urlFotoPerfil} />
            <div>
              <p className="font-body text-[15px] font-semibold text-text-primary">{perfil ? nomeExibicao(perfil) : ""}</p>
              <p className="text-sm text-text-muted">Instância local</p>
            </div>
          </div>
          <button onClick={fecharDrawer} aria-label="Fechar">
            <X size={20} className="text-text-muted" />
          </button>
        </div>

        <button
          onClick={() => ir("/perfil")}
          className="flex items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3 text-left text-sm font-medium text-text-primary"
        >
          <User size={18} strokeWidth={1.75} className="text-steel-300" />
          Perfil
        </button>

        {/* Agenda (bottom nav) stays the calendar/time-blocking view;
            Tarefas ganhou pastas (user feedback) e esse é o modo de
            navegar por elas — não ocupa slot da nav (seção 2.1: 5 ícones
            fixos), mora no Drawer como qualquer outra seção de sistema. */}
        <button
          onClick={() => ir("/hoje")}
          className="flex items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3 text-left text-sm font-medium text-text-primary"
        >
          <CalendarCheck2 size={18} strokeWidth={1.75} className="text-steel-300" />
          Hoje
        </button>
        <button
          onClick={() => ir("/tarefas")}
          className="flex items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3 text-left text-sm font-medium text-text-primary"
        >
          <ListChecks size={18} strokeWidth={1.75} className="text-cyan" />
          Tarefas
        </button>
        <button
          onClick={() => ir("/cofre")}
          className="flex items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3 text-left text-sm font-medium text-text-primary"
        >
          <ShieldHalf size={18} strokeWidth={1.75} className="text-violet" />
          Cofre
        </button>
        <button
          onClick={() => ir("/media")}
          className="flex items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3 text-left text-sm font-medium text-text-primary"
        >
          <Library size={18} strokeWidth={1.75} className="text-steel-300" />
          Media
        </button>
        <button onClick={() => ir("/lixeira")} className="flex items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3 text-left text-sm font-medium text-text-primary"><Trash2 size={18} strokeWidth={1.75} className="text-steel-300" />Lixeira</button>

        <div>
          <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-text-muted">Equipes</p>
          <div className="flex flex-col gap-1">
            {equipes.map((eq) => (
              <button
                key={eq.id}
                onClick={() => ir(`/equipe/${eq.id}`)}
                className="flex items-center justify-between rounded-2xl px-3 py-2.5 text-left hover:bg-surface-2"
              >
                <span className="flex items-center gap-2.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: corDaEquipe(eq.id) }} />
                  <span className="text-sm font-medium text-text-primary">{eq.nome}</span>
                </span>
                <span className="text-xs capitalize text-text-muted">{eq.cargo}</span>
              </button>
            ))}
            <button
              onClick={() => ir("/equipe/nova")}
              className="mt-1 flex items-center gap-2.5 rounded-2xl border border-dashed border-border px-3 py-2.5 text-sm font-medium text-text-secondary hover:border-steel-500/60 hover:text-text-primary"
            >
              <Plus size={16} strokeWidth={1.75} />
              Criar ou entrar numa Equipe
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <button
            onClick={() => ir("/configuracoes/sync")}
            className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-medium text-text-primary hover:bg-surface-2"
          >
            <RefreshCw size={18} strokeWidth={1.75} className="text-text-secondary" />
            Sincronização &amp; Backup
          </button>
          <button
            onClick={() => ir("/configuracoes/privacidade")}
            className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-medium text-text-primary hover:bg-surface-2"
          >
            <ShieldCheck size={18} strokeWidth={1.75} className="text-text-secondary" />
            Configurações e privacidade
          </button>
        </div>

        <div className="mt-auto flex flex-col gap-1">
          <button
            onClick={() => ir("/ajuda")}
            className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-medium text-text-muted hover:text-text-primary"
          >
            <LifeBuoy size={18} strokeWidth={1.75} />
            Central de ajuda
          </button>
          <button
            onClick={() => {
              fecharDrawer();
              logout();
            }}
            className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-medium text-error"
          >
            <LogOut size={18} strokeWidth={1.75} />
            Sair
          </button>
        </div>
      </div>

      <button
        aria-label="Fechar menu"
        onClick={fecharDrawer}
        className="flex-1 bg-black/50 backdrop-blur-[2px]"
      />
    </div>
  );
}
