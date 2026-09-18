import { NoteCard } from "@/components/cards/NoteCard";
import { NoteListRow } from "@/components/cards/NoteListRow";
import { TaskCard } from "@/components/cards/TaskCard";
import { TaskListRow } from "@/components/cards/TaskListRow";
import { modoEfetivo, type ModoVisualizacao } from "@/components/common/ViewModeToggle";
import { useIsDesktop } from "@/lib/use-viewport";
import type { FeedItem } from "@/lib/types";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Check, ChevronDown, Filter, Flag, FolderInput, Loader2, X } from "lucide-react";
import { ApiError, pastas, tarefas, notas } from "@/lib/api";
import { useRefreshBus } from "@/lib/refresh-bus";
import { GradeItens } from "./GradeItens";
import { TabelaItens } from "./TabelaItens";

interface Props {
  itens: FeedItem[];
  modo: ModoVisualizacao;
  /** Identifica a tela para guardar as larguras das colunas da tabela. */
  chave: string;
  /** A tabela mostra "Criada" — só onde a data de criação é confiável (não vem do feed). */
  mostrarCriada?: boolean;
  /** A tabela mostra o motivo do ranking — só faz sentido no Feed, onde ele é real. */
  mostrarMotivo?: boolean;
  /** Em telas de pasta, o filtro é renderizado no cabeçalho da própria pasta. */
  exibirFiltros?: boolean;
}

/** Uma lista de notas e/ou tarefas em qualquer das visualizações: feed (cards), lista compacta, tabela ou grade. */
export function ListaDeItens({ itens, modo, chave, mostrarCriada, mostrarMotivo, exibirFiltros = true }: Props) {
  const desktop = useIsDesktop();
  const efetivo = modoEfetivo(modo, desktop);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [pastasDisponiveis, setPastasDisponiveis] = useState<{ caminho: string; nome: string }[]>([]);
  const [menuMoverAberto, setMenuMoverAberto] = useState(false);
  const [menuPrioridadeAberto, setMenuPrioridadeAberto] = useState(false);
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [tipoFiltro, setTipoFiltro] = useState<"todos" | "nota" | "tarefa">("todos");
  const [statusFiltro, setStatusFiltro] = useState<"todos" | "pendente" | "concluida">("todos");
  const [prioridadeFiltro, setPrioridadeFiltro] = useState<"todos" | "baixa" | "media" | "alta">("todos");
  const [processando, setProcessando] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const ancora = useRef<string | null>(null);
  const { notificar } = useRefreshBus();
  const chaveDo = (item: FeedItem) => `${item.tipo}:${item.id}`;
  const itensVisiveis = itens.filter((item) => (tipoFiltro === "todos" || item.tipo === tipoFiltro) && (statusFiltro === "todos" || (item.tipo === "tarefa" && item.status === statusFiltro)) && (prioridadeFiltro === "todos" || (item.tipo === "tarefa" && item.prioridade === prioridadeFiltro)));
  const itensSelecionados = itensVisiveis.filter((item) => selecionados.has(chaveDo(item)));
  const tarefasSelecionadas = itensSelecionados.filter((item) => item.tipo === "tarefa");

  useEffect(() => {
    Promise.all([pastas.listar({ tipo: "nota" }), pastas.listar({ tipo: "tarefa" })]).then(([notasPastas, tarefasPastas]) => {
      const porCaminho = new Map<string, { caminho: string; nome: string }>();
      [...notasPastas.subpastas, ...tarefasPastas.subpastas].forEach((pasta) => porCaminho.set(pasta.caminho, pasta));
      setPastasDisponiveis([...porCaminho.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")));
    }).catch(() => {});
  }, []);

  async function moverSelecionados(pasta: string | null) {
    if (!itensSelecionados.length || processando) return;
    setProcessando(true); setErroAcao(null);
    try {
      // Cada atualização reindexa a árvore no servidor; sequencial evita que
      // várias reindexações concorrentes se anulem ou deixem o SQLite ocupado.
      for (const item of itensSelecionados) {
        if (item.tipo === "nota") await notas.atualizar(item.id, { pasta: pasta ?? "" });
        else await tarefas.atualizar(item.id, { pasta: pasta ?? "" });
      }
      setSelecionados(new Set()); ancora.current = null; notificar();
    } catch (e) { setErroAcao(e instanceof ApiError ? e.message : "Não foi possível mover os itens selecionados."); }
    finally { setProcessando(false); setMenuMoverAberto(false); }
  }
  async function alterarPrioridade(prioridade: "baixa" | "media" | "alta") {
    if (!tarefasSelecionadas.length || processando) return;
    setProcessando(true); setErroAcao(null);
    try {
      for (const item of tarefasSelecionadas) await tarefas.atualizar(item.id, { prioridade });
      notificar();
    } catch (e) { setErroAcao(e instanceof ApiError ? e.message : "Não foi possível alterar a prioridade."); }
    finally { setProcessando(false); setMenuPrioridadeAberto(false); }
  }
  async function concluirSelecionadas() {
    if (!tarefasSelecionadas.length || processando) return;
    setProcessando(true); setErroAcao(null);
    try {
      for (const item of tarefasSelecionadas) await tarefas.atualizarStatus(item.id, "concluida");
      setSelecionados(new Set()); ancora.current = null; notificar();
    } catch (e) { setErroAcao(e instanceof ApiError ? e.message : "Não foi possível concluir as tarefas."); }
    finally { setProcessando(false); }
  }

  function selecionar(e: MouseEvent, item: FeedItem, ordem = itensVisiveis) {
    const controle = (e.target as HTMLElement).closest("[data-ecos-selection-control]");
    if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !controle) return false;
    e.preventDefault();
    e.stopPropagation();
    const chaveItem = chaveDo(item);
    setSelecionados((anteriores) => {
      const proximos = new Set(anteriores);
      if (e.shiftKey && ancora.current) {
        const inicio = ordem.findIndex((candidato) => chaveDo(candidato) === ancora.current);
        const fim = ordem.findIndex((candidato) => chaveDo(candidato) === chaveItem);
        if (inicio >= 0 && fim >= 0) ordem.slice(Math.min(inicio, fim), Math.max(inicio, fim) + 1).forEach((candidato) => proximos.add(chaveDo(candidato)));
        else proximos.add(chaveItem);
      } else if (proximos.has(chaveItem)) proximos.delete(chaveItem);
      else proximos.add(chaveItem);
      return proximos;
    });
    if (!e.shiftKey) ancora.current = chaveItem;
    return true;
  }
  const selecionado = (item: FeedItem) => selecionados.has(chaveDo(item));
  const envolver = (item: FeedItem, filho: React.ReactNode) => <div key={`${item.tipo}-${item.id}`} onClickCapture={(e) => { selecionar(e, item); }} className={`relative [&>button]:pl-10 ${selecionado(item) ? "rounded-card ring-2 ring-steel-400 ring-offset-2 ring-offset-base" : ""}`}><input data-ecos-selection-control type="checkbox" checked={selecionado(item)} readOnly aria-label={`Selecionar ${item.titulo || "item"}`} title="Selecionar — Shift seleciona um intervalo" className="absolute left-3 top-3 z-10 h-5 w-5 cursor-pointer appearance-none rounded-md border-2 border-text-muted bg-surface-1 shadow-sm transition-colors checked:border-steel-400 checked:bg-steel-500 checked:after:block checked:after:pl-[3px] checked:after:text-[13px] checked:after:leading-[15px] checked:after:text-white checked:after:content-['✓'] hover:border-steel-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400" />{filho}</div>;
  const acoes = itensSelecionados.length > 0 && <div className="sticky top-2 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-steel-400/50 bg-surface-1 p-2 shadow-nav" role="toolbar" aria-label="Ações para itens selecionados">
    <span className="px-2 text-sm font-medium text-text-primary">{itensSelecionados.length} selecionado{itensSelecionados.length === 1 ? "" : "s"}</span>
    <div className="relative"><button type="button" onClick={() => { setMenuMoverAberto((aberto) => !aberto); setMenuPrioridadeAberto(false); }} disabled={processando} className="flex min-h-10 items-center gap-2 rounded-lg bg-surface-2 px-3 text-sm text-text-primary hover:bg-surface-3 disabled:opacity-40"><FolderInput size={16} className="text-steel-300" />Mover<ChevronDown size={15} /></button>{menuMoverAberto && <div role="menu" className="absolute left-0 top-full z-30 mt-1 max-h-64 w-56 overflow-y-auto rounded-xl border border-border bg-surface-1 p-1 shadow-nav"><button type="button" role="menuitem" onClick={() => void moverSelecionados(null)} className="flex min-h-10 w-full items-center rounded-lg px-3 text-left text-sm text-text-primary hover:bg-surface-2">Sem pasta</button>{pastasDisponiveis.map((pasta) => <button key={pasta.caminho} type="button" role="menuitem" onClick={() => void moverSelecionados(pasta.caminho)} className="flex min-h-10 w-full items-center rounded-lg px-3 text-left text-sm text-text-primary hover:bg-surface-2">{pasta.nome}</button>)}</div>}</div>
    {tarefasSelecionadas.length > 0 && <><div className="relative"><button type="button" onClick={() => { setMenuPrioridadeAberto((aberto) => !aberto); setMenuMoverAberto(false); }} disabled={processando} className="flex min-h-10 items-center gap-2 rounded-lg bg-surface-2 px-3 text-sm text-text-primary hover:bg-surface-3 disabled:opacity-40"><Flag size={16} className="text-warning" />Prioridade<ChevronDown size={15} /></button>{menuPrioridadeAberto && <div role="menu" className="absolute left-0 top-full z-30 mt-1 w-44 rounded-xl border border-border bg-surface-1 p-1 shadow-nav">{(["baixa", "media", "alta"] as const).map((prioridade) => <button key={prioridade} type="button" role="menuitem" onClick={() => void alterarPrioridade(prioridade)} className="flex min-h-10 w-full items-center rounded-lg px-3 text-left text-sm text-text-primary hover:bg-surface-2">{prioridade[0].toUpperCase() + prioridade.slice(1)}</button>)}</div>}</div><button type="button" onClick={() => void concluirSelecionadas()} disabled={processando} className="flex min-h-10 items-center gap-2 rounded-lg border border-success px-3 text-sm text-success hover:bg-success hover:text-white disabled:opacity-40"><Check size={16} />Concluir{tarefasSelecionadas.length > 1 ? ` (${tarefasSelecionadas.length})` : ""}</button></>}
    <button type="button" onClick={() => { setSelecionados(new Set()); ancora.current = null; }} disabled={processando} className="ml-auto flex min-h-10 min-w-10 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-2" aria-label="Limpar seleção"><>{processando ? <Loader2 size={17} className="animate-spin" /> : <X size={17} />}</></button>
    {erroAcao && <p role="alert" className="basis-full px-2 pb-1 text-sm text-error">{erroAcao}</p>}
  </div>;
  const filtrosAtivos = [tipoFiltro !== "todos" && (tipoFiltro === "nota" ? "Notas" : "Tarefas"), statusFiltro !== "todos" && (statusFiltro === "pendente" ? "Pendentes" : "Concluídas"), prioridadeFiltro !== "todos" && `Prioridade ${prioridadeFiltro}`].filter(Boolean) as string[];
  const cabecalhoFiltros = <div className="relative mb-3 flex min-h-10 items-center gap-2"><button type="button" onClick={() => setFiltrosAbertos((aberto) => !aberto)} aria-haspopup="menu" aria-expanded={filtrosAbertos} className={`flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm transition-colors ${filtrosAtivos.length ? "border-steel-400 bg-steel-700/20 text-steel-200" : "border-border bg-surface-1 text-text-secondary hover:bg-surface-2"}`}><Filter size={16} />Filtrar{filtrosAtivos.length ? ` (${filtrosAtivos.length})` : ""}<ChevronDown size={15} className={filtrosAbertos ? "rotate-180 transition-transform" : "transition-transform"} /></button>{filtrosAtivos.map((filtro) => <span key={filtro} className="rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs text-text-secondary">{filtro}</span>)}{filtrosAbertos && <div role="menu" aria-label="Filtros" className="absolute left-0 top-full z-30 mt-1 w-72 rounded-xl border border-border bg-surface-1 p-3 shadow-nav"><div className="space-y-3"><fieldset><legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">Tipo</legend><div className="flex gap-1">{(["todos", "nota", "tarefa"] as const).map((tipo) => <button key={tipo} type="button" onClick={() => setTipoFiltro(tipo)} className={`min-h-9 rounded-md px-2.5 text-xs ${tipoFiltro === tipo ? "bg-steel-700/40 text-text-primary" : "text-text-secondary hover:bg-surface-2"}`}>{tipo === "todos" ? "Todos" : tipo === "nota" ? "Notas" : "Tarefas"}</button>)}</div></fieldset><fieldset><legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">Status</legend><div className="flex gap-1">{(["todos", "pendente", "concluida"] as const).map((status) => <button key={status} type="button" onClick={() => setStatusFiltro(status)} className={`min-h-9 rounded-md px-2.5 text-xs ${statusFiltro === status ? "bg-steel-700/40 text-text-primary" : "text-text-secondary hover:bg-surface-2"}`}>{status === "todos" ? "Todos" : status === "pendente" ? "Pendentes" : "Concluídas"}</button>)}</div></fieldset><fieldset><legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">Prioridade</legend><div className="flex gap-1">{(["todos", "baixa", "media", "alta"] as const).map((prioridade) => <button key={prioridade} type="button" onClick={() => setPrioridadeFiltro(prioridade)} className={`min-h-9 rounded-md px-2.5 text-xs ${prioridadeFiltro === prioridade ? "bg-steel-700/40 text-text-primary" : "text-text-secondary hover:bg-surface-2"}`}>{prioridade === "todos" ? "Todas" : prioridade[0].toUpperCase() + prioridade.slice(1)}</button>)}</div></fieldset><button type="button" onClick={() => { setTipoFiltro("todos"); setStatusFiltro("todos"); setPrioridadeFiltro("todos"); }} className="min-h-9 text-xs text-steel-300 hover:text-text-primary">Limpar filtros</button></div></div>}</div>;

  if (efetivo === "tabela") return <>{exibirFiltros && cabecalhoFiltros}{acoes}<TabelaItens itens={itensVisiveis} chave={chave} mostrarCriada={mostrarCriada} mostrarMotivo={mostrarMotivo} selecionados={selecionados} onSelecionar={selecionar} /></>;
  if (efetivo === "grade") return <>{exibirFiltros && cabecalhoFiltros}{acoes}<GradeItens itens={itensVisiveis} selecionados={selecionados} onSelecionar={selecionar} /></>;

  const lista = efetivo === "lista";
  return (
    <div>{exibirFiltros && cabecalhoFiltros}{acoes}<div className={lista ? "flex flex-col gap-2" : "flex flex-col gap-3"}>
      {itensVisiveis.map((item) =>
        item.tipo === "nota" ? (
          envolver(item, lista ? <NoteListRow nota={item} /> : <NoteCard nota={item} />)
        ) : lista ? (
          envolver(item, <TaskListRow tarefa={item} />)
        ) : (
          envolver(item, <TaskCard tarefa={item} />)
        ),
      )}
    </div></div>
  );
}
