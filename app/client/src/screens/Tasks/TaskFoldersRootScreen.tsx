import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { pastas, tarefas as tarefasApi, ApiError, type TarefaResumo } from "@/lib/api";
import { tarefaResumoParaView } from "@/lib/adapters";
import { ListaDeItens } from "@/components/views/ListaDeItens";
import { PastasGrade } from "@/components/views/PastasGrade";
import { ViewModeToggle, useModoVisualizacao } from "@/components/common/ViewModeToggle";
import { useMinhasEquipes } from "@/lib/use-minhas-equipes";
import { useAuth } from "@/lib/auth-context";
import { useRefreshBus } from "@/lib/refresh-bus";
import { useAppUI } from "@/lib/ui-context";

/**
 * Tarefas — root-level folder grid, same shape as `NotesRootScreen` (section
 * 3.2) but for the `Tarefas/` tree. Reachable from the Drawer (section 3.9)
 * since Tarefas already has a slot in the bottom nav for the Agenda
 * time-blocking view (section 2.1) — this is the folder-browsing mode,
 * not a second nav icon. Also lists loose (no-folder) Tarefas, same fix
 * as `NotesRootScreen` for the same reported gap.
 */
export function TaskFoldersRootScreen() {
  const navigate = useNavigate();
  const { equipes } = useMinhasEquipes();
  const { perfil } = useAuth();
  const { versao } = useRefreshBus();
  const { espacoAtivo, intercalarEquipes, filtroEquipeId } = useAppUI();
  const [modo, setModo] = useModoVisualizacao("tarefas");
  const [subpastas, setSubpastas] = useState<{ caminho: string; nome: string; contagem_itens: number }[] | null>(null);
  const [soltas, setSoltas] = useState<TarefaResumo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    // `pasta: ""` is the loose-items filter for Tarefa (`COALESCE(pasta_id,
    // '') = ''` in `tarefas::listar` — unlike Nota, omitting `pasta`
    // entirely returns every Tarefa regardless of folder).
    const espaco = intercalarEquipes ? (filtroEquipeId ? `equipe:${filtroEquipeId}` : undefined) : espacoAtivo;
    Promise.all([pastas.listar({ tipo: "tarefa", espaco }), tarefasApi.listar({ pasta: "", espaco, limit: 100 })])
      .then(([p, t]) => {
        setSubpastas(p.subpastas);
        setSoltas(t.items);
      })
      .catch((e) => setErro(e instanceof ApiError ? e.message : "Não foi possível carregar as pastas."));
  }, [versao, espacoAtivo, intercalarEquipes, filtroEquipeId]);

  return (
    <div className="px-4 pt-1">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-2xl text-text-primary">Pastas de Tarefas</h1>
        <div className="flex items-center gap-2"><ViewModeToggle modo={modo} onMudar={setModo} /></div>
      </div>

      {erro && (
        <div className="mb-4 flex items-start gap-2 rounded-2xl border border-error/40 bg-error/10 p-3 text-sm text-error">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" strokeWidth={1.75} />
          {erro}
        </div>
      )}

      <PastasGrade
        chave="tarefas"
        corIcone="text-cyan"
        pastas={subpastas ?? []}
        aoAbrir={(p) => navigate(`/tarefas/pasta/${encodeURIComponent(p.caminho)}`)}
        aoCriar={() => navigate("/tarefas/pasta/nova")}
      />

      <p className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-text-muted">Sem pasta</p>
      <div>
        {soltas === null ? (
          <p className="py-6 text-center text-sm text-text-muted">Carregando...</p>
        ) : soltas.length === 0 ? (
          <p className="py-6 text-center text-sm text-text-muted">
            Nenhuma tarefa solta — tudo o que você tem está catalogado numa pasta.
          </p>
        ) : (
          <ListaDeItens chave="tarefas" tipoPastas="tarefa" mostrarCriada modo={modo} itens={soltas.map((t) => tarefaResumoParaView(t, equipes, perfil))} />
        )}
      </div>
    </div>
  );
}
