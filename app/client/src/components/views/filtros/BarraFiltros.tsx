import { ArrowUpDown, ChevronDown, CircleDot, Flag, ListFilter, Users, X } from "lucide-react";
import { MenuSuspenso, TOM, type OpcaoMenu } from "@/components/common/MenuSuspenso";
import { corDaEquipe } from "@/lib/team-color";
import { ESTADO_VAZIO, estadoInicial, filtrosAtivos, type EstadoFiltros, type FiltroPrioridade, type FiltroStatus, type Ordem } from "./modelo";

const STATUS: OpcaoMenu<FiltroStatus>[] = [
  { valor: "pendente", rotulo: "Pendentes", cor: TOM.aco }, { valor: "concluida", rotulo: "Concluídas", cor: TOM.sucesso }, { valor: "todos", rotulo: "Todos os status" },
];
const PRIORIDADES: OpcaoMenu<FiltroPrioridade>[] = [
  { valor: "todas", rotulo: "Todas as prioridades" },
  { valor: "alta", rotulo: "Alta", cor: TOM.erro }, { valor: "media", rotulo: "Média", cor: TOM.alerta }, { valor: "baixa", rotulo: "Baixa", cor: TOM.ciano },
];
const ORDENS: OpcaoMenu<Ordem>[] = [
  { valor: "relevancia", rotulo: "Relevância" }, { valor: "edicao", rotulo: "Editadas recentemente" }, { valor: "criacao", rotulo: "Criadas recentemente" },
  { valor: "titulo", rotulo: "Título (A–Z)" }, { valor: "prioridade", rotulo: "Prioridade" }, { valor: "agenda", rotulo: "Data agendada" },
];

interface Props {
  estado: EstadoFiltros;
  onChange: (e: EstadoFiltros) => void;
  contexto: { equipes: { id: string; nome: string }[] };
  visiveis: number;
  total: number;
  temTarefas: boolean;
}

const chip = (ativo: boolean) =>
  `flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-all duration-200 active:scale-95 ${ativo ? "text-text-primary" : "border-border bg-surface-2 text-text-secondary hover:border-steel-400/60 hover:text-text-primary"}`;
const corDo = <T extends string>(opcoes: OpcaoMenu<T>[], valor: T, ativo: boolean) => (ativo ? opcoes.find((o) => o.valor === valor)?.cor ?? TOM.aco : null);

const Seta = ({ aberto }: { aberto: boolean }) => <ChevronDown size={13} className={`transition-transform duration-150 ${aberto ? "rotate-180" : ""}`} />;

/** Filtrar por status, prioridade e equipe, e ordenar — chips que abrem menus do próprio app. */
export function BarraFiltros({ estado, onChange, contexto, visiveis, total, temTarefas }: Props) {
  const padrao = estadoInicial(temTarefas);
  const equipes: OpcaoMenu<string>[] = [
    { valor: "todas", rotulo: "Todas as equipes" }, { valor: "pessoal", rotulo: "Pessoal", cor: TOM.violeta },
    ...contexto.equipes.map((e) => ({ valor: `equipe:${e.id}`, rotulo: e.nome, cor: corDaEquipe(e.id) })),
  ];
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
      <MenuSuspenso ariaLabel="Ordenar" alinhar="dir" valor={estado.ordem} opcoes={ORDENS} onChange={(ordem) => set({ ordem })}
        classeGatilho={chip(estado.ordem !== "relevancia")} corAtiva={estado.ordem !== "relevancia" ? TOM.violeta : null}
        gatilho={({ aberto, atual }) => <><ArrowUpDown size={14} /><span>{estado.ordem === "relevancia" ? "Ordenar" : atual?.rotulo}</span><Seta aberto={aberto} /></>} />
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
