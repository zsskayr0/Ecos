import { NoteCard } from "@/components/cards/NoteCard";
import { NoteListRow } from "@/components/cards/NoteListRow";
import { TaskCard } from "@/components/cards/TaskCard";
import { TaskListRow } from "@/components/cards/TaskListRow";
import { modoEfetivo, type ModoVisualizacao } from "@/components/common/ViewModeToggle";
import { useIsDesktop } from "@/lib/use-viewport";
import type { FeedItem } from "@/lib/types";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Check, ChevronDown, Flag, FolderInput, Loader2, Users, X } from "lucide-react";
import { ApiError, equipes, pastas, tarefas, notas } from "@/lib/api";
import { useRefreshBus } from "@/lib/refresh-bus";
import { GradeItens } from "./GradeItens";
import { BarraFiltros } from "./filtros/BarraFiltros";
import { ESTADO_VAZIO, filtrar, ordenar, novoFiltro, type EstadoFiltros } from "./filtros/modelo";
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
  /** Onde guardar filtros e ordenação (padrão: `chave`). Pastas usam o caminho para cada uma lembrar os seus. */
  chaveFiltros?: string;
}

function lerFiltros(chave: string): EstadoFiltros | null {
  try {
    const bruto = JSON.parse(localStorage.getItem(`ecos:filtros2:${chave}`) ?? "null");
    return bruto && Array.isArray(bruto.filtros) && Array.isArray(bruto.ordens) ? { ...ESTADO_VAZIO, ...bruto } : null;
  } catch { return null; }
}

/** Uma lista de notas e/ou tarefas em qualquer das visualizações: feed (cards), lista compacta, tabela ou grade. */
export function ListaDeItens({ itens, modo, chave, mostrarCriada, mostrarMotivo, exibirFiltros = true, chaveFiltros }: Props) {
  const chaveDosFiltros = chaveFiltros ?? chave;
  const desktop = useIsDesktop();
  const efetivo = modoEfetivo(modo, desktop);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [pastasDisponiveis, setPastasDisponiveis] = useState<{ caminho: string; nome: string }[]>([]);
  const [menuMoverAberto, setMenuMoverAberto] = useState(false);
  const [menuPrioridadeAberto, setMenuPrioridadeAberto] = useState(false);
  const [menuEquipeAberto, setMenuEquipeAberto] = useState(false);
  const [equipesDisponiveis, setEquipesDisponiveis] = useState<{ id: string; nome: string }[]>([]);
  // Concluídas não poluem a visão operacional; continuam a um filtro de distância (a condição aparece como chip e pode ser removida).
  const [estadoFiltros, setEstadoFiltros] = useState<EstadoFiltros>(() => lerFiltros(chaveDosFiltros) ?? (exibirFiltros && itens.some((item) => item.tipo === "tarefa") ? { ...ESTADO_VAZIO, filtros: [{ ...novoFiltro("status"), op: "e", valor: "pendente" }] } : ESTADO_VAZIO));
  const [processando, setProcessando] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const ancora = useRef<string | null>(null);
  const { notificar } = useRefreshBus();
  const chaveDo = (item: FeedItem) => `${item.tipo}:${item.id}`;
  const itensVisiveis = exibirFiltros ? ordenar(filtrar(itens, estadoFiltros), estadoFiltros.ordens) : itens;
  const [itensAnimados, setItensAnimados] = useState<FeedItem[]>(itensVisiveis);
  const [saindo, setSaindo] = useState<Set<string>>(new Set());
  const [entrando, setEntrando] = useState<Set<string>>(new Set());
  const assinaturaVisivel = itensVisiveis.map(chaveDo).join("|");
  const itensSelecionados = itensVisiveis.filter((item) => selecionados.has(chaveDo(item)));
  const tarefasSelecionadas = itensSelecionados.filter((item) => item.tipo === "tarefa");

  useEffect(() => {
    const proximos = new Set(itensVisiveis.map(chaveDo));
    const anteriores = new Set(itensAnimados.map(chaveDo));
    const removidos = itensAnimados.filter((item) => !proximos.has(chaveDo(item)));
    const novos = itensVisiveis.filter((item) => !anteriores.has(chaveDo(item))).map(chaveDo);
    if (!removidos.length && !novos.length) return;
    setEntrando(new Set(novos));
    setSaindo(new Set(removidos.map(chaveDo)));
    setItensAnimados([...itensVisiveis, ...removidos]);
    const timer = window.setTimeout(() => { setItensAnimados(itensVisiveis); setSaindo(new Set()); setEntrando(new Set()); }, 190);
    return () => window.clearTimeout(timer);
  }, [assinaturaVisivel]);

  useEffect(() => { try { localStorage.setItem(`ecos:filtros2:${chaveDosFiltros}`, JSON.stringify(estadoFiltros)); } catch { /* cache indisponível */ } }, [chaveDosFiltros, estadoFiltros]);

  useEffect(() => {
    Promise.all([pastas.listar({ tipo: "nota" }), pastas.listar({ tipo: "tarefa" })]).then(([notasPastas, tarefasPastas]) => {
      const porCaminho = new Map<string, { caminho: string; nome: string }>();
      [...notasPastas.subpastas, ...tarefasPastas.subpastas].forEach((pasta) => porCaminho.set(pasta.caminho, pasta));
      setPastasDisponiveis([...porCaminho.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")));
    }).catch(() => {});
  }, []);
  useEffect(() => { equipes.listarMinhas().then(setEquipesDisponiveis).catch(() => setEquipesDisponiveis([])); }, []);

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
  async function mudarEquipe(espaco: string) {
    if (!itensSelecionados.length || processando) return;
    setProcessando(true); setErroAcao(null);
    try {
      for (const item of itensSelecionados) {
        if (item.tipo === "nota") await notas.atualizar(item.id, { espaco });
        else await tarefas.atualizar(item.id, { espaco });
      }
      setSelecionados(new Set()); ancora.current = null; notificar();
    } catch (e) { setErroAcao(e instanceof ApiError ? e.message : "Não foi possível alterar a equipe."); }
    finally { setProcessando(false); setMenuEquipeAberto(false); }
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
  const envolver = (item: FeedItem, filho: React.ReactNode, estaSaindo = false, estaEntrando = false) => <div key={`${item.tipo}-${item.id}`} onClickCapture={(e) => { selecionar(e, item); }} className={`relative [&>button]:pl-10 ${estaSaindo ? "ecos-item-sai pointer-events-none" : estaEntrando ? "ecos-item-entra" : ""} ${selecionado(item) ? "rounded-card ring-2 ring-steel-400 ring-offset-2 ring-offset-base" : ""}`}><input data-ecos-selection-control type="checkbox" checked={selecionado(item)} readOnly aria-label={`Selecionar ${item.titulo || "item"}`} title="Selecionar — Shift seleciona um intervalo" className="absolute left-3 top-3 z-10 h-5 w-5 cursor-pointer appearance-none rounded-md border-2 border-text-muted bg-surface-1 shadow-sm transition-colors checked:border-steel-400 checked:bg-steel-500 checked:after:block checked:after:pl-[3px] checked:after:text-[13px] checked:after:leading-[15px] checked:after:text-white checked:after:content-['✓'] hover:border-steel-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400" />{filho}</div>;
  const acoes = itensSelecionados.length > 0 && <div className="sticky top-2 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-steel-400/50 bg-surface-1 p-2 shadow-nav" role="toolbar" aria-label="Ações para itens selecionados">
    <span className="px-2 text-sm font-medium text-text-primary">{itensSelecionados.length} selecionado{itensSelecionados.length === 1 ? "" : "s"}</span>
    <div className="relative"><button type="button" onClick={() => { setMenuMoverAberto((aberto) => !aberto); setMenuPrioridadeAberto(false); setMenuEquipeAberto(false); }} disabled={processando} className="flex min-h-10 items-center gap-2 rounded-lg bg-surface-2 px-3 text-sm text-text-primary hover:bg-surface-3 disabled:opacity-40"><FolderInput size={16} className="text-steel-300" />Mover<ChevronDown size={15} /></button>{menuMoverAberto && <div role="menu" className="absolute left-0 top-full z-30 mt-1 max-h-64 w-56 overflow-y-auto rounded-xl border border-border bg-surface-1 p-1 shadow-nav"><button type="button" role="menuitem" onClick={() => void moverSelecionados(null)} className="flex min-h-10 w-full items-center rounded-lg px-3 text-left text-sm text-text-primary hover:bg-surface-2">Sem pasta</button>{pastasDisponiveis.map((pasta) => <button key={pasta.caminho} type="button" role="menuitem" onClick={() => void moverSelecionados(pasta.caminho)} className="flex min-h-10 w-full items-center rounded-lg px-3 text-left text-sm text-text-primary hover:bg-surface-2">{pasta.nome}</button>)}</div>}</div>
    <div className="relative"><button type="button" onClick={() => { setMenuEquipeAberto((aberto) => !aberto); setMenuMoverAberto(false); setMenuPrioridadeAberto(false); }} disabled={processando} className="flex min-h-10 items-center gap-2 rounded-lg bg-surface-2 px-3 text-sm text-text-primary hover:bg-surface-3 disabled:opacity-40"><Users size={16} className="text-violet" />Equipe<ChevronDown size={15} /></button>{menuEquipeAberto && <div role="menu" className="absolute left-0 top-full z-30 mt-1 max-h-64 w-56 overflow-y-auto rounded-xl border border-border bg-surface-1 p-1 shadow-nav"><button type="button" role="menuitem" onClick={() => void mudarEquipe("pessoal")} className="flex min-h-10 w-full items-center rounded-lg px-3 text-left text-sm text-text-primary hover:bg-surface-2">Pessoal</button>{equipesDisponiveis.map((equipe) => <button key={equipe.id} type="button" role="menuitem" onClick={() => void mudarEquipe(`equipe:${equipe.id}`)} className="flex min-h-10 w-full items-center rounded-lg px-3 text-left text-sm text-text-primary hover:bg-surface-2">{equipe.nome}</button>)}</div>}</div>
    {tarefasSelecionadas.length > 0 && <><div className="relative"><button type="button" onClick={() => { setMenuPrioridadeAberto((aberto) => !aberto); setMenuMoverAberto(false); }} disabled={processando} className="flex min-h-10 items-center gap-2 rounded-lg bg-surface-2 px-3 text-sm text-text-primary hover:bg-surface-3 disabled:opacity-40"><Flag size={16} className="text-warning" />Prioridade<ChevronDown size={15} /></button>{menuPrioridadeAberto && <div role="menu" className="absolute left-0 top-full z-30 mt-1 w-44 rounded-xl border border-border bg-surface-1 p-1 shadow-nav">{(["baixa", "media", "alta"] as const).map((prioridade) => <button key={prioridade} type="button" role="menuitem" onClick={() => void alterarPrioridade(prioridade)} className="flex min-h-10 w-full items-center rounded-lg px-3 text-left text-sm text-text-primary hover:bg-surface-2">{prioridade[0].toUpperCase() + prioridade.slice(1)}</button>)}</div>}</div><button type="button" onClick={() => void concluirSelecionadas()} disabled={processando} className="flex min-h-10 items-center gap-2 rounded-lg border border-success px-3 text-sm text-success hover:bg-success hover:text-white disabled:opacity-40"><Check size={16} />Concluir{tarefasSelecionadas.length > 1 ? ` (${tarefasSelecionadas.length})` : ""}</button></>}
    <button type="button" onClick={() => { setSelecionados(new Set()); ancora.current = null; }} disabled={processando} className="ml-auto flex min-h-10 min-w-10 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-2" aria-label="Limpar seleção"><>{processando ? <Loader2 size={17} className="animate-spin" /> : <X size={17} />}</></button>
    {erroAcao && <p role="alert" className="basis-full px-2 pb-1 text-sm text-error">{erroAcao}</p>}
  </div>;
  const contextoFiltros = useMemo(() => ({
    pastas: pastasDisponiveis,
    equipes: equipesDisponiveis,
    tags: [...new Set(itens.flatMap((item) => item.tags ?? []))].sort((x, y) => x.localeCompare(y, "pt-BR")),
  }), [pastasDisponiveis, equipesDisponiveis, itens]);
  const cabecalhoFiltros = <>
    <BarraFiltros estado={estadoFiltros} onChange={setEstadoFiltros} contexto={contextoFiltros} visiveis={itensVisiveis.length} total={itens.length} />
    {itens.length > 0 && itensVisiveis.length === 0 && <p className="py-8 text-center text-sm text-text-muted">Nenhum item corresponde aos filtros.</p>}
  </>;

  if (efetivo === "tabela") return <>{exibirFiltros && cabecalhoFiltros}{acoes}<TabelaItens itens={itensAnimados} chave={chave} mostrarCriada={mostrarCriada} mostrarMotivo={mostrarMotivo} selecionados={selecionados} onSelecionar={selecionar} saindo={saindo} entrando={entrando} /></>;
  if (efetivo === "grade") return <>{exibirFiltros && cabecalhoFiltros}{acoes}<GradeItens itens={itensAnimados} selecionados={selecionados} onSelecionar={selecionar} saindo={saindo} entrando={entrando} /></>;

  const lista = efetivo === "lista";
  return (
    <div>{exibirFiltros && cabecalhoFiltros}{acoes}<div className={lista ? "flex flex-col gap-2" : "flex flex-col gap-3"}>
      {itensAnimados.map((item) =>
        item.tipo === "nota" ? (
          envolver(item, lista ? <NoteListRow nota={item} /> : <NoteCard nota={item} />, saindo.has(chaveDo(item)), entrando.has(chaveDo(item)))
        ) : lista ? (
          envolver(item, <TaskListRow tarefa={item} />, saindo.has(chaveDo(item)), entrando.has(chaveDo(item)))
        ) : (
          envolver(item, <TaskCard tarefa={item} />, saindo.has(chaveDo(item)), entrando.has(chaveDo(item)))
        ),
      )}
    </div></div>
  );
}
