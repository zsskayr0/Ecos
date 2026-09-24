import { AlarmClock, ArrowDownAZ, ArrowUpDown, CalendarClock, CalendarPlus, ChevronDown, Circle, CircleCheck, CircleDot, Flag, Folder, FolderOpen, ListChecks, ListFilter, PencilLine, Sparkles, Tag, Tags, User, Users, X } from "lucide-react";
import { MenuSuspenso, TOM, type OpcaoMenu } from "@/components/common/MenuSuspenso";
import { MenuMultiplo, type OpcaoMultipla } from "@/components/common/MenuMultiplo";
import { corDaEquipe } from "@/lib/team-color";
import { BuscaExpansivel } from "./BuscaExpansivel";
import { ESTADO_VAZIO, estadoInicial, filtrosAtivos, type EstadoFiltros, type FiltroPrioridade, type FiltroStatus, type Ordem } from "./modelo";

const STATUS: OpcaoMenu<FiltroStatus>[] = [
  { valor: "todos", rotulo: "Todos os status", icone: ListChecks }, { valor: "concluida", rotulo: "Concluídas", cor: TOM.sucesso, icone: CircleCheck },
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
}

const chip = (ativo: boolean) =>
  `flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-all duration-200 active:scale-95 ${ativo ? "text-text-primary" : "border-border bg-surface-2 text-text-secondary hover:border-steel-400/60 hover:text-text-primary"}`;
const corDo = <T extends string>(opcoes: OpcaoMenu<T>[], valor: T, ativo: boolean) => (ativo ? opcoes.find((o) => o.valor === valor)?.cor ?? TOM.aco : null);

const Seta = ({ aberto }: { aberto: boolean }) => <ChevronDown size={13} className={`transition-transform duration-150 ${aberto ? "rotate-180" : ""}`} />;

/** Filtrar por status, prioridade e equipe, e ordenar — chips que abrem menus do próprio app. */
export function BarraFiltros({ estado, onChange, contexto, visiveis, total, temTarefas, pesquisavel = false, placeholderBusca }: Props) {
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
  const set = (patch: Partial<EstadoFiltros>) => onChange({ ...estado, ...patch });

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Filtros e ordenação">
      <ListFilter size={15} className="text-text-muted" aria-hidden />
      {temTarefas && (
        <MenuSuspenso ariaLabel="Filtrar por status" valor={estado.status} opcoes={STATUS} onChange={(status) => set({ status })}
          classeGatilho={chip(estado.status !== padrao.status)} corAtiva={corDo(STATUS, estado.status, estado.status !== padrao.status)}
          gatilho={({ aberto, atual }) => <><CircleDot size={14} /><span>{atual?.rotulo}</span><Seta aberto={aberto} /></>} />
      )}
      {temTarefas && (
        <MenuSuspenso ariaLabel="Filtrar por prioridade" valor={estado.prioridade} opcoes={PRIORIDADES} onChange={(prioridade) => set({ prioridade })}
          classeGatilho={chip(estado.prioridade !== "todas")} corAtiva={corDo(PRIORIDADES, estado.prioridade, estado.prioridade !== "todas")}
          gatilho={({ aberto, atual }) => <><Flag size={14} /><span>{estado.prioridade === "todas" ? "Prioridade" : atual?.rotulo}</span><Seta aberto={aberto} /></>} />
      )}
      {contexto.equipes.length > 0 && (
        <MenuSuspenso ariaLabel="Filtrar por equipe" valor={estado.equipe} opcoes={equipes} onChange={(equipe) => set({ equipe })}
          classeGatilho={chip(estado.equipe !== "todas")} corAtiva={corDo(equipes, estado.equipe, estado.equipe !== "todas")}
          gatilho={({ aberto, atual }) => <><Users size={14} /><span className="max-w-[9rem] truncate">{estado.equipe === "todas" ? "Equipe" : atual?.rotulo ?? "Equipe"}</span><Seta aberto={aberto} /></>} />
      )}
      {contexto.donos.length > 0 && (
        <MenuMultiplo ariaLabel="Filtrar por proprietário" valores={estado.donos} opcoes={opcoesDono} onChange={(donos) => set({ donos })}
          todas={{ rotulo: "Todos os proprietários", icone: Users }}
          pesquisavel placeholderBusca="Pesquisar proprietários…"
          classeGatilho={chip(estado.donos.length > 0)} corAtiva={estado.donos.length ? TOM.ciano : null}
          gatilho={({ aberto }) => <><User size={14} /><span className="max-w-[10rem] truncate">{estado.donos.length ? rotuloDonos : "Proprietário"}</span><Seta aberto={aberto} /></>} />
      )}
      <MenuMultiplo arvore ariaLabel="Filtrar por pasta" valores={estado.pastas} opcoes={opcoesPasta} onChange={(pastas) => set({ pastas })}
        todas={{ rotulo: "Todas as pastas", icone: ListChecks }}
        pesquisavel placeholderBusca="Pesquisar pastas…"
        classeGatilho={chip(estado.pastas.length > 0)} corAtiva={estado.pastas.length ? TOM.aco : null}
        gatilho={({ aberto }) => <><FolderOpen size={14} /><span className="max-w-[10rem] truncate">{estado.pastas.length ? rotuloPastas : "Pasta"}</span><Seta aberto={aberto} /></>} />
      {contexto.tags.length > 0 && (
        <MenuMultiplo ariaLabel="Filtrar por tags" valores={estado.tags} opcoes={opcoesTag} onChange={(tags) => set({ tags })}
          todas={{ rotulo: "Todas as tags", icone: Tags }}
          pesquisavel placeholderBusca="Pesquisar tags…"
          classeGatilho={chip(estado.tags.length > 0)} corAtiva={estado.tags.length ? TOM.violeta : null}
          gatilho={({ aberto }) => <><Tags size={14} /><span className="max-w-[10rem] truncate">{estado.tags.length ? rotuloTags : "Tags"}</span><Seta aberto={aberto} /></>} />
      )}
      <MenuSuspenso ariaLabel="Ordenar" alinhar="dir" valor={estado.ordem} opcoes={ORDENS} onChange={(ordem) => set({ ordem, ordemDirecao: direcaoPadrao(ordem) })}
        classeGatilho={chip(estado.ordem !== "relevancia")} corAtiva={estado.ordem !== "relevancia" ? TOM.violeta : null}
        gatilho={({ aberto, atual }) => <><ArrowUpDown size={14} className={`transition-transform duration-200 ${estado.ordem !== "relevancia" && estado.ordemDirecao === -1 ? "rotate-180" : ""}`} /><span>{estado.ordem === "relevancia" ? "Ordenar" : atual?.rotulo}</span><Seta aberto={aberto} /></>} />
      {pesquisavel && <BuscaExpansivel valor={estado.busca} onChange={(busca) => set({ busca })} placeholder={placeholderBusca ?? "Pesquisar nesta lista…"} />}
      {alterado && (
        <button type="button" onClick={() => onChange({ ...padrao })}
          className="flex h-9 items-center gap-1 rounded-lg px-2 text-xs text-text-muted transition-colors hover:text-text-primary">
          <X size={13} />Limpar
        </button>
      )}
      {visiveis !== total && <span className="ml-auto text-xs text-text-muted" aria-live="polite">{visiveis} de {total}</span>}
    </div>
  );
}
