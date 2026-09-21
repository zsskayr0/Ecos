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
import { chaveDoDono, ESTADO_VAZIO, estadoInicial, filtrar, ordenarComDirecao, pastaDoItem, type EstadoFiltros, type Ordem } from "./filtros/modelo";
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
  /** Origem das pastas exibidas no filtro. O Feed aceita ambas; telas específicas não as intercalam. */
  tipoPastas?: "nota" | "tarefa" | "ambos";
  /** Checkbox de seleção e ações em lote. O Feed desliga. */
  selecionavel?: boolean;
  /** Lupa ao lado de "Ordenar" (vira barra de pesquisa). A busca vale só para esta lista e fica junto dos filtros dela. */
  pesquisavel?: boolean;
  /** Texto do campo de busca, ex.: "Pesquisar em Trabalho…". */
  placeholderBusca?: string;
}

function lerFiltros(chave: string): EstadoFiltros | null {
  try {
    const bruto = JSON.parse(localStorage.getItem(`ecos:filtros3:${chave}`) ?? "null");
    return bruto && typeof bruto.status === "string" && typeof bruto.equipe === "string" ? { ...ESTADO_VAZIO, ...bruto } : null;
  } catch { return null; }
}

/** Uma lista de notas e/ou tarefas em qualquer das visualizações: feed (cards), lista compacta, tabela ou grade. */
export function ListaDeItens({ itens, modo, chave, mostrarCriada, mostrarMotivo, exibirFiltros = true, chaveFiltros, tipoPastas = "ambos", selecionavel = true, pesquisavel = false, placeholderBusca }: Props) {
  const chaveDosFiltros = chaveFiltros ?? chave;
  const desktop = useIsDesktop();
  const efetivo = modoEfetivo(modo, desktop);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [pastasDisponiveis, setPastasDisponiveis] = useState<{ caminho: string; nome: string }[]>([]);
  const [menuMoverAberto, setMenuMoverAberto] = useState(false);
  const [menuPrioridadeAberto, setMenuPrioridadeAberto] = useState(false);
  const [menuEquipeAberto, setMenuEquipeAberto] = useState(false);
  const [equipesDisponiveis, setEquipesDisponiveis] = useState<{ id: string; nome: string }[]>([]);
  // Concluídas não poluem a visão operacional; ficam a um clique de distância no filtro de status.
  const temTarefas = itens.some((item) => item.tipo === "tarefa");
  const [estadoFiltros, setEstadoFiltros] = useState<EstadoFiltros>(() => (exibirFiltros ? lerFiltros(chaveDosFiltros) : null) ?? (exibirFiltros ? estadoInicial(temTarefas) : ESTADO_VAZIO));
  const [processando, setProcessando] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const ancora = useRef<string | null>(null);
  const { notificar } = useRefreshBus();
  const chaveDo = (item: FeedItem) => `${item.tipo}:${item.id}`;
  const itensVisiveis = exibirFiltros ? ordenarComDirecao(filtrar(itens, estadoFiltros), estadoFiltros.ordem, estadoFiltros.ordemDirecao) : itens;
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
    if (!removidos.length && !novos.length) {
      if (itensAnimados.map(chaveDo).join("|") !== assinaturaVisivel) setItensAnimados(itensVisiveis);
      return;
    }
    setEntrando(new Set(novos));
    setSaindo(new Set(removidos.map(chaveDo)));
    setItensAnimados([...itensVisiveis, ...removidos]);
    const timer = window.setTimeout(() => { setItensAnimados(itensVisiveis); setSaindo(new Set()); setEntrando(new Set()); }, 190);
    return () => window.clearTimeout(timer);
  }, [assinaturaVisivel]);

  useEffect(() => { try { localStorage.setItem(`ecos:filtros3:${chaveDosFiltros}`, JSON.stringify(estadoFiltros)); } catch { /* cache indisponível */ } }, [chaveDosFiltros, estadoFiltros]);

  useEffect(() => {
    let ativo = true;
    const tipos = tipoPastas === "ambos" ? (["nota", "tarefa"] as const) : [tipoPastas];
    Promise.all(tipos.map((tipo) => pastas.listar({ tipo }))).then((respostas) => {
      if (!ativo) return;
      const porCaminho = new Map<string, { caminho: string; nome: string }>();
      respostas.flatMap((resposta) => resposta.subpastas).forEach((pasta) => porCaminho.set(pasta.caminho, pasta));
      setPastasDisponiveis([...porCaminho.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")));
    }).catch(() => { if (ativo) setPastasDisponiveis([]); });
    return () => { ativo = false; };
  }, [tipoPastas]);
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
  const envolver = (item: FeedItem, filho: React.ReactNode, estaSaindo = false, estaEntrando = false) => !selecionavel ? <div key={`${item.tipo}-${item.id}`} className={estaSaindo ? "ecos-item-sai pointer-events-none" : estaEntrando ? "ecos-item-entra" : ""}>{filho}</div> : <div key={`${item.tipo}-${item.id}`} onClickCapture={(e) => { selecionar(e, item); }} className={`group relative [&>button]:pl-10 [&>article]:pl-10 ${estaSaindo ? "ecos-item-sai pointer-events-none" : estaEntrando ? "ecos-item-entra" : ""} ${selecionado(item) ? "rounded-card ring-2 ring-steel-400 ring-offset-2 ring-offset-base" : ""}`}><input data-ecos-selection-control type="checkbox" checked={selecionado(item)} readOnly aria-label={`Selecionar ${item.titulo || "item"}`} title="Selecionar — Shift seleciona um intervalo" className="absolute left-3 top-3 z-10 h-5 w-5 cursor-pointer appearance-none rounded-md border-2 border-text-muted bg-surface-1 shadow-sm transition-all checked:border-steel-400 checked:bg-steel-500 checked:after:block checked:after:pl-[3px] checked:after:text-[13px] checked:after:leading-[15px] checked:after:text-white checked:after:content-['✓'] hover:border-steel-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400 md:pointer-events-none md:opacity-0 md:group-hover:pointer-events-auto md:group-hover:opacity-100 md:group-focus-within:pointer-events-auto md:group-focus-within:opacity-100" />{filho}</div>;
  const acoes = itensSelecionados.length > 0 && <div className="sticky top-2 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-steel-400/50 bg-surface-1 p-2 shadow-nav" role="toolbar" aria-label="Ações para itens selecionados">
    <span className="px-2 text-sm font-medium text-text-primary">{itensSelecionados.length} selecionado{itensSelecionados.length === 1 ? "" : "s"}</span>
    <div className="relative"><button type="button" onClick={() => { setMenuMoverAberto((aberto) => !aberto); setMenuPrioridadeAberto(false); setMenuEquipeAberto(false); }} disabled={processando} className="flex min-h-10 items-center gap-2 rounded-lg bg-surface-2 px-3 text-sm text-text-primary hover:bg-surface-3 disabled:opacity-40"><FolderInput size={16} className="text-steel-300" />Mover<ChevronDown size={15} /></button>{menuMoverAberto && <div role="menu" className="absolute left-0 top-full z-30 mt-1 max-h-64 w-56 overflow-y-auto rounded-xl border border-border bg-surface-1 p-1 shadow-nav"><button type="button" role="menuitem" onClick={() => void moverSelecionados(null)} className="flex min-h-10 w-full items-center rounded-lg px-3 text-left text-sm text-text-primary hover:bg-surface-2">Sem pasta</button>{pastasDisponiveis.map((pasta) => <button key={pasta.caminho} type="button" role="menuitem" onClick={() => void moverSelecionados(pasta.caminho)} className="flex min-h-10 w-full items-center rounded-lg px-3 text-left text-sm text-text-primary hover:bg-surface-2">{pasta.nome}</button>)}</div>}</div>
    <div className="relative"><button type="button" onClick={() => { setMenuEquipeAberto((aberto) => !aberto); setMenuMoverAberto(false); setMenuPrioridadeAberto(false); }} disabled={processando} className="flex min-h-10 items-center gap-2 rounded-lg bg-surface-2 px-3 text-sm text-text-primary hover:bg-surface-3 disabled:opacity-40"><Users size={16} className="text-violet" />Equipe<ChevronDown size={15} /></button>{menuEquipeAberto && <div role="menu" className="absolute left-0 top-full z-30 mt-1 max-h-64 w-56 overflow-y-auto rounded-xl border border-border bg-surface-1 p-1 shadow-nav"><button type="button" role="menuitem" onClick={() => void mudarEquipe("pessoal")} className="flex min-h-10 w-full items-center rounded-lg px-3 text-left text-sm text-text-primary hover:bg-surface-2">Pessoal</button>{equipesDisponiveis.map((equipe) => <button key={equipe.id} type="button" role="menuitem" onClick={() => void mudarEquipe(`equipe:${equipe.id}`)} className="flex min-h-10 w-full items-center rounded-lg px-3 text-left text-sm text-text-primary hover:bg-surface-2">{equipe.nome}</button>)}</div>}</div>
    {tarefasSelecionadas.length > 0 && <><div className="relative"><button type="button" onClick={() => { setMenuPrioridadeAberto((aberto) => !aberto); setMenuMoverAberto(false); }} disabled={processando} className="flex min-h-10 items-center gap-2 rounded-lg bg-surface-2 px-3 text-sm text-text-primary hover:bg-surface-3 disabled:opacity-40"><Flag size={16} className="text-warning" />Prioridade<ChevronDown size={15} /></button>{menuPrioridadeAberto && <div role="menu" className="absolute left-0 top-full z-30 mt-1 w-44 rounded-xl border border-border bg-surface-1 p-1 shadow-nav">{(["baixa", "media", "alta"] as const).map((prioridade) => <button key={prioridade} type="button" role="menuitem" onClick={() => void alterarPrioridade(prioridade)} className="flex min-h-10 w-full items-center rounded-lg px-3 text-left text-sm text-text-primary hover:bg-surface-2">{prioridade[0].toUpperCase() + prioridade.slice(1)}</button>)}</div>}</div><button type="button" onClick={() => void concluirSelecionadas()} disabled={processando} className="flex min-h-10 items-center gap-2 rounded-lg border border-success px-3 text-sm text-success hover:bg-success hover:text-white disabled:opacity-40"><Check size={16} />Concluir{tarefasSelecionadas.length > 1 ? ` (${tarefasSelecionadas.length})` : ""}</button></>}
    <button type="button" onClick={() => { setSelecionados(new Set()); ancora.current = null; }} disabled={processando} className="ml-auto flex min-h-10 min-w-10 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-2" aria-label="Limpar seleção"><>{processando ? <Loader2 size={17} className="animate-spin" /> : <X size={17} />}</></button>
    {erroAcao && <p role="alert" className="basis-full px-2 pb-1 text-sm text-error">{erroAcao}</p>}
  </div>;
  // Pastas conhecidas (raiz, vindas do servidor) mais as que aparecem nos próprios itens, inclusive subpastas.
  const pastasDoFiltro = useMemo(() => {
    const porCaminho = new Map(pastasDisponiveis.map((p) => [p.caminho, p]));
    for (const item of itens) {
      const caminho = pastaDoItem(item);
      if (caminho && !porCaminho.has(caminho)) porCaminho.set(caminho, { caminho, nome: caminho.split("/").pop() ?? caminho });
    }
    return [...porCaminho.values()].sort((a, b) => a.caminho.localeCompare(b.caminho, "pt-BR"));
  }, [pastasDisponiveis, itens]);
  const tagsDoFiltro = useMemo(() => {
    const porNome = new Map<string, string>();
    for (const item of itens) {
      for (const tag of item.tags ?? []) {
        const rotulo = tag.trim();
        const chave = rotulo.toLocaleLowerCase("pt-BR");
        if (rotulo && !porNome.has(chave)) porNome.set(chave, rotulo);
      }
    }
    return [...porNome.values()].sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));
  }, [itens]);
  const donosDoFiltro = useMemo(() => {
    const porChave = new Map<string, { valor: string; nome: string }>();
    for (const item of itens) {
      const valor = chaveDoDono(item);
      if (!porChave.has(valor)) porChave.set(valor, { valor, nome: item.dono.nome });
    }
    return [...porChave.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }));
  }, [itens]);
  const cabecalhoFiltros = <>
    <BarraFiltros estado={estadoFiltros} onChange={setEstadoFiltros} contexto={{ equipes: equipesDisponiveis, pastas: pastasDoFiltro, tags: tagsDoFiltro, donos: donosDoFiltro }} visiveis={itensVisiveis.length} total={itens.length} temTarefas={temTarefas} pesquisavel={pesquisavel} placeholderBusca={placeholderBusca} />
    {itens.length > 0 && itensVisiveis.length === 0 && <p className="py-8 text-center text-sm text-text-muted">{estadoFiltros.busca.trim() ? `Nada encontrado para “${estadoFiltros.busca.trim()}”.` : "Nenhum item corresponde aos filtros."}</p>}
  </>;

  const colunaDaOrdem: Record<Ordem, string | null> = { relevancia: null, edicao: "editada", criacao: "criada", titulo: "titulo", prioridade: "prioridade", agenda: "prazo", status: "status", duracao: "duracao", pasta: "pasta", equipe: "equipe", tags: "tags", dono: "dono" };
  const ordemDaColuna: Record<string, Ordem> = { editada: "edicao", criada: "criacao", titulo: "titulo", prioridade: "prioridade", prazo: "agenda", status: "status", duracao: "duracao", pasta: "pasta", equipe: "equipe", tags: "tags", dono: "dono" };
  const ordemTabela = colunaDaOrdem[estadoFiltros.ordem] ? { id: colunaDaOrdem[estadoFiltros.ordem]!, dir: estadoFiltros.ordemDirecao } : null;
  const mudarOrdemTabela = (proxima: { id: string; dir: 1 | -1 } | null) => {
    if (!proxima) setEstadoFiltros((atual) => ({ ...atual, ordem: "relevancia", ordemDirecao: 1 }));
    else {
      const ordem = ordemDaColuna[proxima.id];
      if (ordem) setEstadoFiltros((atual) => ({ ...atual, ordem, ordemDirecao: proxima.dir }));
    }
  };

  if (efetivo === "tabela") return <>{exibirFiltros && cabecalhoFiltros}{acoes}<TabelaItens itens={itensAnimados} chave={chave} mostrarCriada={mostrarCriada} mostrarMotivo={mostrarMotivo} ordem={ordemTabela} onOrdemChange={mudarOrdemTabela} selecionados={selecionados} onSelecionar={selecionar} saindo={saindo} entrando={entrando} /></>;
  if (efetivo === "grade") return <>{exibirFiltros && cabecalhoFiltros}{acoes}<GradeItens itens={itensAnimados} selecionados={selecionados} onSelecionar={selecionar} saindo={saindo} entrando={entrando} /></>;

  const lista = efetivo === "lista";
  const renderItem = (item: FeedItem) => {
    const chaveItem = chaveDo(item);
    const conteudo = item.tipo === "nota"
      ? (lista ? <NoteListRow nota={item} /> : <NoteCard nota={item} pastas={pastasDisponiveis} />)
      : lista ? <TaskListRow tarefa={item} /> : <TaskCard tarefa={item} pastas={pastasDisponiveis} />;
    return envolver(item, conteudo, saindo.has(chaveItem), entrando.has(chaveItem));
  };
  // Feed em cards: coluna estreita (leitura confortável em monitor largo) e agrupada por data.
  const grupos = lista ? null : agruparPorData(itensAnimados, estadoFiltros.ordem);
  return (
    <div className={lista ? undefined : "mx-auto w-full max-w-[780px]"}>{exibirFiltros && cabecalhoFiltros}{acoes}<div className={lista ? "flex flex-col gap-2" : "flex flex-col gap-3"}>
      {grupos
        ? grupos.map((grupo) => (
          <section key={grupo.rotulo} className="flex flex-col gap-3">
            {grupo.rotulo && <h3 className="sticky top-0 z-10 -mx-1 bg-base/90 px-1 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-text-muted backdrop-blur">{grupo.rotulo}</h3>}
            {grupo.itens.map(renderItem)}
          </section>
        ))
        : itensAnimados.map(renderItem)}
    </div></div>
  );
}

const ORDENS_POR_DATA: Ordem[] = ["relevancia", "edicao", "criacao"];
const ROTULO_SEM_DATA = "Sem data";

function rotuloDoDia(iso: string | undefined, agora = new Date()): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return ROTULO_SEM_DATA;
  const inicio = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dias = Math.round((inicio(agora) - inicio(d)) / 86_400_000);
  if (dias <= 0) return "Hoje";
  if (dias === 1) return "Ontem";
  if (dias < 7) return d.toLocaleDateString("pt-BR", { weekday: "long" }).replace(/^./, (c) => c.toUpperCase());
  return d.toLocaleDateString("pt-BR", { day: "numeric", month: "long", ...(d.getFullYear() === agora.getFullYear() ? {} : { year: "numeric" }) });
}

/**
 * Agrupa por dia de edição (ou de criação, se for a ordenação escolhida). Em "relevância" os dias vêm do mais
 * recente para o mais antigo e o ranking do servidor é preservado dentro de cada dia; nas ordenações por data a
 * ordem escolhida (inclusive crescente) é mantida. Outras ordenações não são agrupadas.
 */
function agruparPorData(itens: FeedItem[], ordem: Ordem): { rotulo: string; itens: FeedItem[] }[] | null {
  if (!ORDENS_POR_DATA.includes(ordem)) return null;
  const dataDe = (item: FeedItem) => ordem === "criacao" ? item.criadoEm ?? item.atualizadoEm : item.atualizadoEm ?? item.criadoEm;
  const comDia = itens.map((item, posicao) => ({ item, posicao, iso: dataDe(item), rotulo: rotuloDoDia(dataDe(item)) }));
  if (ordem === "relevancia") {
    const dia = (x: { iso?: string }) => { const t = x.iso ? new Date(x.iso) : null; return t && !Number.isNaN(t.getTime()) ? new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime() : -Infinity; };
    comDia.sort((a, b) => dia(b) - dia(a) || a.posicao - b.posicao);
  }
  const grupos: { rotulo: string; itens: FeedItem[] }[] = [];
  for (const { item, rotulo } of comDia) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo?.rotulo === rotulo) ultimo.itens.push(item);
    else grupos.push({ rotulo, itens: [item] });
  }
  return grupos;
}
