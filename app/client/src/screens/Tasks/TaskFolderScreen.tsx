import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronDown, ChevronLeft, Filter, Folder, AlertTriangle } from "lucide-react";
import { ListaDeItens } from "@/components/views/ListaDeItens";
import { PastasGrade } from "@/components/views/PastasGrade";
import { ViewModeToggle, useModoVisualizacao } from "@/components/common/ViewModeToggle";
import { EmptyState } from "@/components/common/EmptyState";
import { tarefas as tarefasApi, pastas as pastasApi, ApiError, type TarefaResumo } from "@/lib/api";
import { tarefaResumoParaView } from "@/lib/adapters";
import { useMinhasEquipes } from "@/lib/use-minhas-equipes";
import { useAuth } from "@/lib/auth-context";
import { useRefreshBus } from "@/lib/refresh-bus";

/** Inside a Tarefa folder — same shape as `FolderScreen` (Notas, section 3.2), reusing the Feed's own `TaskCard`. */
export function TaskFolderScreen() {
  const { pastaId } = useParams();
  const caminho = decodeURIComponent(pastaId ?? "");
  const nomeExibicao = caminho.split("/").pop() ?? caminho;
  const navigate = useNavigate();
  const { equipes } = useMinhasEquipes();
  const { perfil } = useAuth();
  const { versao } = useRefreshBus();
  const [modo, setModo] = useModoVisualizacao("tarefas");
  const [filtroAberto, setFiltroAberto] = useState(false);
  const [statusFiltro, setStatusFiltro] = useState<"todos" | "pendente" | "concluida">("todos");
  const [prioridadeFiltro, setPrioridadeFiltro] = useState<"todos" | "baixa" | "media" | "alta">("todos");

  const [subpastas, setSubpastas] = useState<{ caminho: string; nome: string; contagem_itens: number }[]>([]);
  const [itens, setItens] = useState<TarefaResumo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    Promise.all([pastasApi.listar({ tipo: "tarefa", pasta_pai: caminho }), tarefasApi.listar({ pasta: caminho, limit: 100 })])
      .then(([p, t]) => {
        if (!vivo) return;
        setSubpastas(p.subpastas);
        setItens(t.items);
      })
      .catch((e) => {
        if (!vivo) return;
        setErro(e instanceof ApiError ? e.message : "Não foi possível carregar esta pasta.");
        setItens([]);
      });
    return () => {
      vivo = false;
    };
  }, [caminho, versao]);

  return (
    <div className="px-4 pt-1">
      <button onClick={() => navigate(-1)} className="mb-3 flex items-center gap-1 text-sm text-text-muted">
        <ChevronLeft size={18} />
        Tarefas
      </button>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="flex items-center gap-2 font-display text-2xl text-text-primary">
          <Folder size={22} className="text-cyan" />
          {nomeExibicao}
        </h1>
        <ViewModeToggle modo={modo} onMudar={setModo} />
      </div>
      <div className="relative mb-4"><button type="button" onClick={() => setFiltroAberto((aberto) => !aberto)} aria-haspopup="menu" aria-expanded={filtroAberto} className={`flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm ${statusFiltro !== "todos" || prioridadeFiltro !== "todos" ? "border-steel-400 bg-steel-700/20 text-steel-200" : "border-border bg-surface-1 text-text-secondary hover:bg-surface-2"}`}><Filter size={16} />Filtrar{statusFiltro !== "todos" || prioridadeFiltro !== "todos" ? " (ativo)" : ""}<ChevronDown size={15} className={filtroAberto ? "rotate-180" : ""} /></button>{filtroAberto && <div role="menu" className="absolute left-0 top-full z-30 mt-1 w-64 rounded-xl border border-border bg-surface-1 p-3 shadow-nav"><p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">Status</p><div className="mb-3 flex gap-1">{(["todos", "pendente", "concluida"] as const).map((status) => <button key={status} type="button" onClick={() => setStatusFiltro(status)} className={`min-h-9 rounded-md px-2 text-xs ${statusFiltro === status ? "bg-steel-700/40 text-text-primary" : "text-text-secondary hover:bg-surface-2"}`}>{status === "todos" ? "Todos" : status === "pendente" ? "Pendentes" : "Concluídas"}</button>)}</div><p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">Prioridade</p><div className="flex gap-1">{(["todos", "baixa", "media", "alta"] as const).map((prioridade) => <button key={prioridade} type="button" onClick={() => setPrioridadeFiltro(prioridade)} className={`min-h-9 rounded-md px-2 text-xs ${prioridadeFiltro === prioridade ? "bg-steel-700/40 text-text-primary" : "text-text-secondary hover:bg-surface-2"}`}>{prioridade === "todos" ? "Todas" : prioridade[0].toUpperCase() + prioridade.slice(1)}</button>)}</div></div>}</div>

      {erro && (
        <div className="mb-4 flex items-start gap-2 rounded-2xl border border-error/40 bg-error/10 p-3 text-sm text-error">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" strokeWidth={1.75} />
          {erro}
        </div>
      )}

      {subpastas.length > 0 && (
        <div className="mb-4">
          <PastasGrade
            chave="tarefas"
            titulo="Subpastas"
            corIcone="text-cyan"
            pastas={subpastas}
            aoAbrir={(p) => navigate(`/tarefas/pasta/${encodeURIComponent(p.caminho)}`)}
          />
        </div>
      )}

      <div>
        {itens === null ? (
          <p className="py-10 text-center text-sm text-text-muted">Carregando...</p>
        ) : itens.length === 0 ? (
          <EmptyState icon={Folder} title="Pasta vazia por enquanto." subtitle="Toque no + pra criar a primeira tarefa aqui." />
        ) : (
          <ListaDeItens chave="tarefas" mostrarCriada exibirFiltros={false} modo={modo} itens={itens.filter((t) => (statusFiltro === "todos" || t.status === statusFiltro) && (prioridadeFiltro === "todos" || t.prioridade === prioridadeFiltro)).map((t) => tarefaResumoParaView(t, equipes, perfil))} />
        )}
      </div>
    </div>
  );
}
