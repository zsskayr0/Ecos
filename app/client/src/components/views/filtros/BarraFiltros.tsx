import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { AlarmClock, Archive, ArrowDownAZ, ArrowUpDown, CalendarClock, CalendarPlus, ChevronDown, Circle, CircleCheck, CircleDot, Flag, Folder, FolderOpen, ListChecks, ListFilter, PencilLine, Search, Sparkles, Tag, Tags, User, Users, X } from "lucide-react";
import { useIsMobile } from "@/lib/use-viewport";
import { Dialog } from "@/components/common/Dialog";
import { MenuSuspenso, TOM, type OpcaoMenu } from "@/components/common/MenuSuspenso";
import { MenuMultiplo, type OpcaoMultipla } from "@/components/common/MenuMultiplo";
import { corDaEquipe } from "@/lib/team-color";
import { BuscaExpansivel } from "./BuscaExpansivel";
import { ESTADO_VAZIO, estadoInicial, filtrosAtivos, type EstadoFiltros, type FiltroPrioridade, type FiltroStatus, type Ordem } from "./modelo";

const STATUS: OpcaoMenu<FiltroStatus>[] = [
  { valor: "todos", rotulo: "Todos os status", icone: ListChecks }, { valor: "concluida", rotulo: "Concluídas", cor: TOM.sucesso, icone: CircleCheck },
  { valor: "arquivada", rotulo: "Arquivadas", cor: TOM.aco, icone: Archive },
  { valor: "atrasada", rotulo: "Atrasadas", cor: TOM.erro, icone: AlarmClock }, { valor: "pendente", rotulo: "Pendentes", cor: TOM.aco, icone: Circle },
];
const PRIORIDADES: OpcaoMenu<FiltroPrioridade>[] = [
  { valor: "todas", rotulo: "Todas as prioridades", icone: ListChecks },
  { valor: "alta", rotulo: "Alta", cor: TOM.erro, icone: Flag }, { valor: "media", rotulo: "Média", cor: TOM.alerta, icone: Flag }, { valor: "baixa", rotulo: "Baixa", cor: TOM.ciano, icone: Flag },
];
const ORDENS: OpcaoMenu<Ordem>[] = [
  { valor: "relevancia", rotulo: "Relevância", icone: Sparkles }, { valor: "edicao", rotulo: "Editadas recentemente", icone: PencilLine }, { valor: "criacao", rotulo: "Criadas recentemente", icone: CalendarPlus },
  { valor: "titulo", rotulo: "Título (A–Z)", icone: ArrowDownAZ }, { valor: "prioridade", rotulo: "Prioridade", icone: Flag }, { valor: "agenda", rotulo: "Data agendada", icone: CalendarClock },
  { valor: "status", rotulo: "Status", icone: CircleDot }, { valor: "duracao", rotulo: "Duração", icone: AlarmClock },
  { valor: "pasta", rotulo: "Pasta", icone: FolderOpen }, { valor: "equipe", rotulo: "Equipe", icone: Users },
  { valor: "tags", rotulo: "Quantidade de tags", icone: Tags }, { valor: "dono", rotulo: "Proprietário", icone: User },
];
const direcaoPadrao = (ordem: Ordem): 1 | -1 => ordem === "edicao" || ordem === "criacao" ? -1 : 1;

interface Props {
  estado: EstadoFiltros;
  onChange: (e: EstadoFiltros) => void;
  contexto: { equipes: { id: string; nome: string }[]; pastas: { caminho: string; nome: string }[]; tags: string[]; donos: { valor: string; nome: string }[] };
  visiveis: number;
  total: number;
  temTarefas: boolean;
  /** Mostra a lupa ao lado de "Ordenar": a busca vale só para esta lista, junto com os filtros dela. */
  pesquisavel?: boolean;
  placeholderBusca?: string;
  /** Controle alinhado à direita, na mesma linha dos filtros (ex.: seletor de visualização). */
  acaoDireita?: ReactNode;
}

const chip = (ativo: boolean) =>
  `flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-all duration-200 active:scale-95 ${ativo ? "text-text-primary" : "border-border bg-surface-2 text-text-secondary hover:border-steel-400/60 hover:text-text-primary"}`;
const corDo = <T extends string>(opcoes: OpcaoMenu<T>[], valor: T, ativo: boolean) => (ativo ? opcoes.find((o) => o.valor === valor)?.cor ?? TOM.aco : null);

/** Área realmente visível (sem o teclado virtual): a folha de baixo acompanha o teclado em vez de ficar atrás dele. */
function useAreaVisivel(ativo: boolean): CSSProperties | undefined {
  const [area, setArea] = useState<CSSProperties | undefined>();
  useEffect(() => {
    const vv = window.visualViewport;
    if (!ativo || !vv) { setArea(undefined); return; }
    // Só ajusta quando algo (o teclado) tirou mais de 120px da área visível; senão a folha usa a tela inteira, como sempre.
    const medir = () => setArea(window.innerHeight - vv.height > 120
      ? { position: "fixed", left: vv.offsetLeft, top: vv.offsetTop, width: vv.width, height: vv.height, inset: "auto" }
      : undefined);
    medir();
    vv.addEventListener("resize", medir);
    vv.addEventListener("scroll", medir);
    return () => { vv.removeEventListener("resize", medir); vv.removeEventListener("scroll", medir); };
  }, [ativo]);
  return area;
}

const Seta = ({ aberto }: { aberto: boolean }) => <ChevronDown size={13} className={`transition-transform duration-150 ${aberto ? "rotate-180" : ""}`} />;

/** Filtrar por status, prioridade e equipe, e ordenar — chips que abrem menus do próprio app. */
export function BarraFiltros({ estado, onChange, contexto, visiveis, total, temTarefas, pesquisavel = false, placeholderBusca, acaoDireita }: Props) {
  const padrao = estadoInicial(temTarefas);
  const equipes: OpcaoMenu<string>[] = [
    { valor: "todas", rotulo: "Todas as equipes", icone: Users }, { valor: "pessoal", rotulo: "Pessoal", cor: TOM.violeta, icone: User },
    ...contexto.equipes.map((e) => ({ valor: `equipe:${e.id}`, rotulo: e.nome, cor: corDaEquipe(e.id), icone: Users })),
  ];
  const opcoesPasta: OpcaoMultipla[] = [
    { valor: "", rotulo: "Sem pasta", icone: Folder, cor: TOM.alerta },
    ...contexto.pastas.map((p) => ({ valor: p.caminho, pasta: true, rotulo: p.caminho.replace(/\//g, " / "), icone: FolderOpen, cor: TOM.aco })),
  ];
  const opcoesTag: OpcaoMultipla[] = contexto.tags.map((tag) => ({ valor: tag, rotulo: tag, icone: Tag, cor: TOM.violeta }));
  const opcoesDono: OpcaoMultipla[] = contexto.donos.map((dono) => ({ valor: dono.valor, rotulo: dono.nome, icone: User, cor: TOM.ciano }));
  const rotuloPastas = estado.pastas.length === 1 ? opcoesPasta.find((o) => o.valor === estado.pastas[0])?.rotulo ?? "Pasta" : `${estado.pastas.length} pastas`;
  const rotuloTags = estado.tags.length === 1 ? estado.tags[0] : `${estado.tags.length} tags`;
  const rotuloDonos = estado.donos.length === 1 ? opcoesDono.find((o) => o.valor === estado.donos[0])?.rotulo ?? "Proprietário" : `${estado.donos.length} proprietários`;
  const alterado = filtrosAtivos(estado, temTarefas) > 0 || estado.ordem !== ESTADO_VAZIO.ordem;
  const mobile = useIsMobile();
  const [painelAberto, setPainelAberto] = useState(false);
  const areaVisivel = useAreaVisivel(painelAberto);
  const set = (patch: Partial<EstadoFiltros>) => onChange({ ...estado, ...patch });

  const chipsFiltro = (
    <>
      {temTarefas && (
        <MenuSuspenso fixo ariaLabel="Filtrar por status" valor={estado.status} opcoes={STATUS} onChange={(status) => set({ status })}
          classeGatilho={chip(estado.status !== padrao.status)} corAtiva={corDo(STATUS, estado.status, estado.status !== padrao.status)}
          gatilho={({ aberto, atual }) => <><CircleDot size={14} /><span>{atual?.rotulo}</span><Seta aberto={aberto} /></>} />
      )}
      {temTarefas && (
        <MenuSuspenso fixo ariaLabel="Filtrar por prioridade" valor={estado.prioridade} opcoes={PRIORIDADES} onChange={(prioridade) => set({ prioridade })}
          classeGatilho={chip(estado.prioridade !== "todas")} corAtiva={corDo(PRIORIDADES, estado.prioridade, estado.prioridade !== "todas")}
          gatilho={({ aberto, atual }) => <><Flag size={14} /><span>{estado.prioridade === "todas" ? "Prioridade" : atual?.rotulo}</span><Seta aberto={aberto} /></>} />
      )}
      {contexto.equipes.length > 0 && (
        <MenuSuspenso fixo ariaLabel="Filtrar por equipe" valor={estado.equipe} opcoes={equipes} onChange={(equipe) => set({ equipe })}
          classeGatilho={chip(estado.equipe !== "todas")} corAtiva={corDo(equipes, estado.equipe, estado.equipe !== "todas")}
          gatilho={({ aberto, atual }) => <><Users size={14} /><span className="max-w-[9rem] truncate">{estado.equipe === "todas" ? "Equipe" : atual?.rotulo ?? "Equipe"}</span><Seta aberto={aberto} /></>} />
      )}
      {contexto.donos.length > 0 && (
        <MenuMultiplo fixo ariaLabel="Filtrar por proprietário" valores={estado.donos} opcoes={opcoesDono} onChange={(donos) => set({ donos })}
          todas={{ rotulo: "Todos os proprietários", icone: Users }}
          pesquisavel placeholderBusca="Pesquisar proprietários…"
          classeGatilho={chip(estado.donos.length > 0)} corAtiva={estado.donos.length ? TOM.ciano : null}
          gatilho={({ aberto }) => <><User size={14} /><span className="max-w-[10rem] truncate">{estado.donos.length ? rotuloDonos : "Proprietário"}</span><Seta aberto={aberto} /></>} />
      )}
      <MenuMultiplo fixo arvore ariaLabel="Filtrar por pasta" valores={estado.pastas} opcoes={opcoesPasta} onChange={(pastas) => set({ pastas })}
        todas={{ rotulo: "Todas as pastas", icone: ListChecks }}
        pesquisavel placeholderBusca="Pesquisar pastas…"
        classeGatilho={chip(estado.pastas.length > 0)} corAtiva={estado.pastas.length ? TOM.aco : null}
        gatilho={({ aberto }) => <><FolderOpen size={14} /><span className="max-w-[10rem] truncate">{estado.pastas.length ? rotuloPastas : "Pasta"}</span><Seta aberto={aberto} /></>} />
      {contexto.tags.length > 0 && (
        <MenuMultiplo fixo ariaLabel="Filtrar por tags" valores={estado.tags} opcoes={opcoesTag} onChange={(tags) => set({ tags })}
          todas={{ rotulo: "Todas as tags", icone: Tags }}
          pesquisavel placeholderBusca="Pesquisar tags…"
          classeGatilho={chip(estado.tags.length > 0)} corAtiva={estado.tags.length ? TOM.violeta : null}
          gatilho={({ aberto }) => <><Tags size={14} /><span className="max-w-[10rem] truncate">{estado.tags.length ? rotuloTags : "Tags"}</span><Seta aberto={aberto} /></>} />
      )}
    </>
  );
  const ordenar = (
    <>
      <MenuSuspenso fixo larguraMin={232} ariaLabel="Ordenar" alinhar="dir" valor={estado.ordem} opcoes={ORDENS} onChange={(ordem) => set({ ordem, ordemDirecao: direcaoPadrao(ordem) })}
        classeGatilho={chip(estado.ordem !== "relevancia")} corAtiva={estado.ordem !== "relevancia" ? TOM.violeta : null}
        gatilho={({ aberto, atual }) => <><ArrowUpDown size={14} className={`transition-transform duration-200 ${estado.ordem !== "relevancia" && estado.ordemDirecao === -1 ? "rotate-180" : ""}`} /><span>{estado.ordem === "relevancia" ? "Ordenar" : atual?.rotulo}</span><Seta aberto={aberto} /></>} />
    </>
  );
  const rotuloAtivo = (lista: OpcaoMenu<string>[], v: string) => lista.find((o) => o.valor === v)?.rotulo ?? v;
  const ativos: { chave: string; rotulo: string; limpar: () => void }[] = [
    ...(temTarefas && estado.status !== padrao.status ? [{ chave: "status", rotulo: rotuloAtivo(STATUS, estado.status), limpar: () => set({ status: padrao.status }) }] : []),
    ...(temTarefas && estado.prioridade !== "todas" ? [{ chave: "prioridade", rotulo: `Prioridade ${rotuloAtivo(PRIORIDADES, estado.prioridade).toLowerCase()}`, limpar: () => set({ prioridade: "todas" }) }] : []),
    ...(estado.equipe !== "todas" ? [{ chave: "equipe", rotulo: rotuloAtivo(equipes, estado.equipe), limpar: () => set({ equipe: "todas" }) }] : []),
    ...estado.donos.map((d) => ({ chave: `dono:${d}`, rotulo: opcoesDono.find((o) => o.valor === d)?.rotulo ?? d, limpar: () => set({ donos: estado.donos.filter((x) => x !== d) }) })),
    ...estado.pastas.map((pa) => ({ chave: `pasta:${pa}`, rotulo: opcoesPasta.find((o) => o.valor === pa)?.rotulo ?? pa, limpar: () => set({ pastas: estado.pastas.filter((x) => x !== pa) }) })),
    ...estado.tags.map((t) => ({ chave: `tag:${t}`, rotulo: `#${t}`, limpar: () => set({ tags: estado.tags.filter((x) => x !== t) }) })),
  ];
  const nFiltros = ativos.length;

  if (mobile) {
    return (
      <div className="mb-3 flex flex-col gap-2" role="group" aria-label="Filtros e ordenação">
        <div className="flex items-center gap-2">
          {pesquisavel && (
            <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border border-border bg-surface-1 px-3 focus-within:border-steel-400">
              <Search size={15} className="shrink-0 text-text-muted" aria-hidden />
              <input type="search" role="searchbox" aria-label="Pesquisar" value={estado.busca} onChange={(e) => set({ busca: e.target.value })} placeholder={placeholderBusca ?? "Pesquisar…"}
                style={{ outline: "none", boxShadow: "none" }} className="min-w-0 flex-1 appearance-none bg-transparent text-sm text-text-primary outline-none ring-0 placeholder:text-text-muted [&::-webkit-search-cancel-button]:appearance-none" />
              {estado.busca && <button type="button" aria-label="Limpar pesquisa" onClick={() => set({ busca: "" })} className="text-text-muted"><X size={15} /></button>}
            </label>
          )}
          <button type="button" onClick={() => setPainelAberto(true)} aria-label="Filtros" aria-haspopup="dialog" className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-1 text-text-secondary">
            <ListFilter size={17} />
            {nFiltros > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-steel-500 px-1 text-[10px] font-semibold text-white">{nFiltros}</span>}
          </button>
          <MenuSuspenso fixo larguraMin={232} ariaLabel="Ordenar" alinhar="dir" valor={estado.ordem} opcoes={ORDENS} onChange={(ordem) => set({ ordem, ordemDirecao: direcaoPadrao(ordem) })}
            classeGatilho="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-1 text-text-secondary" corAtiva={estado.ordem !== "relevancia" ? TOM.violeta : null}
            gatilho={() => <ArrowUpDown size={17} className={`transition-transform duration-200 ${estado.ordem !== "relevancia" && estado.ordemDirecao === -1 ? "rotate-180" : ""}`} />} />
          {acaoDireita}
        </div>
        {(nFiltros > 0 || visiveis !== total) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {ativos.map((a) => (
              <button key={a.chave} type="button" onClick={a.limpar} aria-label={`Remover filtro ${a.rotulo}`} className="flex h-7 max-w-[11rem] items-center gap-1 rounded-full border border-border bg-surface-2 pl-2.5 pr-1.5 text-xs text-text-secondary">
                <span className="truncate">{a.rotulo}</span><X size={12} className="shrink-0 text-text-muted" />
              </button>
            ))}
            {visiveis !== total && <span className="ml-auto text-xs text-text-muted" aria-live="polite">{visiveis} de {total}</span>}
          </div>
        )}
        {painelAberto && (
          <Dialog rotulo="Filtros" onFechar={() => setPainelAberto(false)} style={areaVisivel} className="fixed inset-0 z-50 flex items-end bg-black/50">
            <div className="flex max-h-[85%] w-full flex-col rounded-t-2xl border-t border-border bg-surface-1 pb-[env(safe-area-inset-bottom)]">
              <header className="flex items-center justify-between px-4 py-3">
                <h2 className="text-base font-semibold text-text-primary">Filtros</h2>
                <button type="button" onClick={() => setPainelAberto(false)} aria-label="Fechar" className="flex h-9 w-9 items-center justify-center rounded-lg text-text-muted hover:bg-surface-2"><X size={19} /></button>
              </header>
              <div className="flex flex-wrap items-center gap-2 overflow-y-auto px-4 pb-4">{chipsFiltro}</div>
              <footer className="flex items-center gap-2 border-t border-border px-4 py-3">
                <button type="button" disabled={!alterado} onClick={() => onChange({ ...padrao })} className="h-11 rounded-xl px-4 text-sm font-medium text-text-secondary disabled:opacity-40">Limpar tudo</button>
                <button type="button" onClick={() => setPainelAberto(false)} className="h-11 flex-1 rounded-xl bg-steel-500 px-4 text-sm font-semibold text-white">Ver {visiveis} resultado{visiveis === 1 ? "" : "s"}</button>
              </footer>
            </div>
          </Dialog>
        )}
      </div>
    );
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Filtros e ordenação">
      <ListFilter size={15} className="text-text-muted" aria-hidden />
      {chipsFiltro}
      {ordenar}
      {pesquisavel && <BuscaExpansivel valor={estado.busca} onChange={(busca) => set({ busca })} placeholder={placeholderBusca ?? "Pesquisar nesta lista…"} />}
      {alterado && (
        <button type="button" onClick={() => onChange({ ...padrao })}
          className="flex h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-xs text-text-muted transition-colors hover:text-text-primary">
          <X size={13} />Limpar
        </button>
      )}
      {visiveis !== total && <span className="ml-auto text-xs text-text-muted" aria-live="polite">{visiveis} de {total}</span>}
      {acaoDireita && <div className={visiveis !== total ? undefined : "ml-auto"}>{acaoDireita}</div>}
    </div>
  );
}
