import { useContext, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, Folder, AlertTriangle } from "lucide-react";
import { ListaDeItens } from "@/components/views/ListaDeItens";
import { PastasGrade } from "@/components/views/PastasGrade";
import { ViewModeToggle, useModoVisualizacao } from "@/components/common/ViewModeToggle";
import { EmptyState } from "@/components/common/EmptyState";
import { tarefas as tarefasApi, pastas as pastasApi, ApiError, type TarefaResumo } from "@/lib/api";
import { tarefaResumoParaView } from "@/lib/adapters";
import { useMinhasEquipes } from "@/lib/use-minhas-equipes";
import { useAuth } from "@/lib/auth-context";
import { useRefreshBus } from "@/lib/refresh-bus";
import { TituloJanelaContext } from "@/lib/documento-popup";
import { useEspacoFiltro } from "@/lib/use-espaco-filtro";

/** Inside a Tarefa folder — same shape as `FolderScreen` (Notas, section 3.2), reusing the Feed's own `TaskCard`. */
export function TaskFolderScreen() {
  const { pastaId } = useParams();
  const caminho = decodeURIComponent(pastaId ?? "");
  const nomeExibicao = caminho.split("/").pop() ?? caminho;
  const definirTituloJanela = useContext(TituloJanelaContext);
  const navigate = useNavigate();
  const { equipes } = useMinhasEquipes();
  const { perfil } = useAuth();
  const { versao } = useRefreshBus();
  const [modo, setModo] = useModoVisualizacao("tarefas");

  const [subpastas, setSubpastas] = useState<{ caminho: string; nome: string; contagem_itens: number }[]>([]);
  const [itens, setItens] = useState<TarefaResumo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // No desktop a rota é técnica; a aba deve comunicar a pasta que a pessoa
  // realmente abriu. No mobile o contexto é nulo e nada muda.
  useEffect(() => { definirTituloJanela?.(nomeExibicao); }, [definirTituloJanela, nomeExibicao]);


  const espaco = useEspacoFiltro();
  useEffect(() => {
    let vivo = true;
    Promise.all([pastasApi.listar({ tipo: "tarefa", pasta_pai: caminho, espaco }), tarefasApi.listar({ pasta: caminho, espaco, limit: 100 })])
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
      <div className="mb-4 flex items-center justify-between">
        <h1 className="flex items-center gap-2 font-display text-2xl text-text-primary">
          <button type="button" onClick={() => navigate(-1)} aria-label="Voltar para tarefas" className="-ml-1 rounded-lg p-1 text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary"><ChevronLeft size={21} /></button>
          <Folder size={22} className="text-cyan" />
          {nomeExibicao}
        </h1>
        <ViewModeToggle modo={modo} onMudar={setModo} />
      </div>
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
          <ListaDeItens chave="tarefas" tipoPastas="tarefa" mostrarCriada pesquisavel placeholderBusca={`Pesquisar em ${nomeExibicao}…`} chaveFiltros={`tarefas:${caminho}`} modo={modo} itens={itens.map((t) => tarefaResumoParaView(t, equipes, perfil))} />
        )}
      </div>
    </div>
  );
}
