import { useEffect, useMemo, useState } from "react";
import { CalendarCheck2, AlertTriangle } from "lucide-react";
import { tarefas, ApiError, type TarefaResumo } from "@/lib/api";
import { tarefaResumoParaView } from "@/lib/adapters";
import { TaskListRow } from "@/components/cards/TaskListRow";
import { EmptyState } from "@/components/common/EmptyState";
import { useMinhasEquipes } from "@/lib/use-minhas-equipes";
import { useAuth } from "@/lib/auth-context";
import { useAppUI } from "@/lib/ui-context";
import { useRefreshBus } from "@/lib/refresh-bus";

function dataLocal(d = new Date()) {
  const dois = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
}

/** Lista operacional do dia: tarefas com horário ou prazo hoje, sem misturar
 * com a Agenda visual. É o equivalente à entrada "Hoje" do TickTick. */
export function TodayScreen() {
  const { equipes } = useMinhasEquipes();
  const { perfil } = useAuth();
  const { filtroEquipeId, espacoAtivo, intercalarEquipes } = useAppUI();
  const { versao } = useRefreshBus();
  const [itens, setItens] = useState<TarefaResumo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const hoje = dataLocal();

  useEffect(() => {
    let ativo = true;
    setErro(null);
    const espaco = intercalarEquipes ? (filtroEquipeId ? `equipe:${filtroEquipeId}` : undefined) : espacoAtivo;
    tarefas.listar({ data_de: hoje, data_ate: hoje, status: "pendente", espaco, tz: -new Date().getTimezoneOffset(), limit: 200 })
      .then((pagina) => { if (ativo) setItens(pagina.items); })
      .catch((e) => { if (ativo) { setErro(e instanceof ApiError ? e.message : "Não foi possível carregar as tarefas de hoje."); setItens([]); } });
    return () => { ativo = false; };
  }, [filtroEquipeId, espacoAtivo, intercalarEquipes, hoje, versao]);

  const grupos = useMemo(() => {
    const mapa = new Map<string, TarefaResumo[]>();
    for (const item of itens ?? []) {
      const pasta = item.pasta?.split("/").filter(Boolean).pop() ?? "Sem pasta";
      mapa.set(pasta, [...(mapa.get(pasta) ?? []), item]);
    }
    return [...mapa.entries()];
  }, [itens]);

  return <div className="px-4 pt-1">
    <header className="mb-5 flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-steel-700/20 text-steel-300"><CalendarCheck2 size={21} /></span><div><h1 className="font-display text-2xl text-text-primary">Hoje</h1><p className="text-sm text-text-secondary">{itens === null ? "Carregando tarefas…" : `${itens.length} tarefa${itens.length === 1 ? "" : "s"} para hoje`}</p></div></header>
    {erro && <div role="alert" className="mb-4 flex items-start gap-2 rounded-2xl border border-error/40 bg-error/10 p-3 text-sm text-error"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{erro}</div>}
    {itens === null ? <p className="py-10 text-center text-sm text-text-muted">Carregando…</p> : itens.length === 0 ? <EmptyState icon={CalendarCheck2} title="Seu dia está livre." subtitle="Tarefas com prazo ou horário hoje aparecerão aqui." /> : <div className="space-y-5">{grupos.map(([pasta, tarefasDaPasta]) => <section key={pasta}><h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">{pasta}</h2><div className="flex flex-col gap-2">{tarefasDaPasta.map((tarefa) => <TaskListRow key={tarefa.id} tarefa={tarefaResumoParaView(tarefa, equipes, perfil)} />)}</div></section>)}</div>}
  </div>;
}
