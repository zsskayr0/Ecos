import { useEffect, useState } from "react";
import { Bell, Check, ChevronDown, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Avatar } from "@/components/common/Avatar";
import { Pill } from "@/components/common/Pill";
import { useAppUI } from "@/lib/ui-context";
import { useAuth, nomeExibicao } from "@/lib/auth-context";
import { useMinhasEquipes } from "@/lib/use-minhas-equipes";
import { useRefreshBus } from "@/lib/refresh-bus";
import { notificacoes } from "@/lib/api";
import { corDaEquipe } from "@/lib/team-color";
import { useFotoPerfil } from "@/lib/profile-avatar";

/**
 * Topbar — avatar (drawer) on the left, filter pill in the center,
 * notification bell on the right (section 2.2). Team filter is
 * optional/temporary, never a fixed tab (section 2.3, rule 6).
 */
export function Topbar() {
  const { abrirDrawer, filtroEquipeId, setFiltroEquipeId, espacoAtivo, setEspacoAtivo, intercalarEquipes } = useAppUI();
  const { perfil } = useAuth();
  const { url: urlFotoPerfil } = useFotoPerfil(perfil?.id, perfil?.avatar_atualizado_em);
  const { equipes } = useMinhasEquipes();
  const { versao } = useRefreshBus();
  const [filtroAberto, setFiltroAberto] = useState(false);
  const [workspaceAberto, setWorkspaceAberto] = useState(false);
  const [naoLidas, setNaoLidas] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    notificacoes
      .listar({ lida: false, limit: 50 })
      .then((p) => setNaoLidas(p.items.length))
      .catch(() => setNaoLidas(0));
  }, [versao]);

  const equipeAtiva = equipes.find((e) => e.id === (espacoAtivo.startsWith("equipe:") ? espacoAtivo.slice(7) : ""));
  const labelFiltro = equipeAtiva ? equipeAtiva.nome : "Pessoal";

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-3 bg-base/90 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+12px)] backdrop-blur">
      <div className="relative flex items-center gap-1">
        <button onClick={abrirDrawer} aria-label="Abrir menu">
          <Avatar nome={perfil ? nomeExibicao(perfil) : "?"} tamanho={34} url={urlFotoPerfil} />
        </button>
        <button type="button" onClick={() => setWorkspaceAberto((v) => !v)} className="flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium text-text-secondary hover:bg-surface-2"><Users size={14} className="text-steel-300" />{labelFiltro}<ChevronDown size={13} /></button>
        {workspaceAberto && <div className="absolute left-0 top-10 z-40 w-56 rounded-xl border border-border bg-surface-1 p-1.5 shadow-nav ecos-fade-in"><button type="button" onClick={() => { setEspacoAtivo("pessoal"); setWorkspaceAberto(false); }} className={`flex min-h-10 w-full items-center rounded-lg px-3 text-left text-sm ${espacoAtivo === "pessoal" ? "bg-steel-700/30 text-text-primary" : "text-text-secondary hover:bg-surface-2"}`}>Pessoal</button>{equipes.map((eq) => <button key={eq.id} type="button" onClick={() => { setEspacoAtivo(`equipe:${eq.id}`); setWorkspaceAberto(false); }} className={`flex min-h-10 w-full items-center rounded-lg px-3 text-left text-sm ${espacoAtivo === `equipe:${eq.id}` ? "bg-steel-700/30 text-text-primary" : "text-text-secondary hover:bg-surface-2"}`}>{eq.nome}</button>)}</div>}
      </div>

      {intercalarEquipes && <div className="relative">
        <Pill withCaret active={!!equipeAtiva} onClick={() => setFiltroAberto((v) => !v)}>
          Todas as equipes
        </Pill>
        {filtroAberto && (
          <div className="absolute left-1/2 top-11 z-40 w-56 -translate-x-1/2 rounded-2xl border border-border bg-surface-2 p-1.5 shadow-nav ecos-fade-in">
            <FiltroItem
              label="Tudo"
              ativo={!filtroEquipeId}
              onClick={() => {
                setFiltroEquipeId(null);
                setFiltroAberto(false);
              }}
            />
            {equipes.map((eq) => (
              <FiltroItem
                key={eq.id}
                label={eq.nome}
                cor={corDaEquipe(eq.id)}
                ativo={filtroEquipeId === eq.id}
                onClick={() => {
                  setFiltroEquipeId(eq.id);
                  setFiltroAberto(false);
                }}
              />
            ))}
          </div>
        )}
      </div>}

      <button onClick={() => navigate("/notificacoes")} aria-label="Notificações" className="relative p-1">
        <Bell size={22} strokeWidth={1.75} className="text-text-primary" />
        {naoLidas > 0 && <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-cyan" />}
      </button>
    </header>
  );
}

function FiltroItem({
  label,
  cor,
  ativo,
  onClick,
}: {
  label: string;
  cor?: string;
  ativo: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-text-primary hover:bg-surface-3"
    >
      <span className="flex items-center gap-2">
        {cor && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: cor }} />}
        {label}
      </span>
      {ativo && <Check size={14} className="text-steel-300" />}
    </button>
  );
}
