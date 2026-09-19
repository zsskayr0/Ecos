import { ChevronLeft, ChevronRight, Plus, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useMinhasEquipes } from "@/lib/use-minhas-equipes";
import { corDaEquipe } from "@/lib/team-color";
import { Avatar } from "@/components/common/Avatar";

/** Lista administrativa de equipes — separada do Perfil pessoal e acessível
 * por Configurações → Equipes. */
export function TeamsScreen() {
  const navigate = useNavigate();
  const { equipes, carregando } = useMinhasEquipes();
  return <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe"><div className="mb-5 flex items-center gap-2"><button onClick={() => navigate(-1)} className="text-text-muted"><ChevronLeft size={22} /></button><h1 className="font-display text-xl text-text-primary">Equipes</h1></div><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Suas equipes</p><div className="overflow-hidden rounded-2xl bg-surface-1">{carregando ? <p className="px-4 py-5 text-sm text-text-muted">Carregando…</p> : equipes.map((equipe) => <button key={equipe.id} onClick={() => navigate(`/equipe/${equipe.id}`)} className="flex w-full items-center gap-3 border-b border-border/60 px-4 py-3 text-left last:border-0"><Avatar nome={equipe.nome} corFundo={corDaEquipe(equipe.id)} tamanho={34} /><span className="min-w-0 flex-1"><span className="block truncate text-[15px] text-text-primary">{equipe.nome}</span><span className="text-xs text-text-muted">{equipe.cargo}</span></span><ChevronRight size={16} className="text-text-muted" /></button>)}</div><button onClick={() => navigate("/equipe/nova")} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-3 text-sm font-medium text-steel-300 hover:bg-surface-1"><Plus size={17} />Criar ou entrar em uma equipe</button><p className="mt-4 flex items-center gap-2 text-xs text-text-muted"><Users size={14} />Abra uma equipe para editar seus detalhes e membros.</p></div>;
}
