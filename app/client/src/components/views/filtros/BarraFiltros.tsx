import { ArrowUpDown, ChevronDown, CircleDot, Flag, ListFilter, Users, X } from "lucide-react";
import { MenuSuspenso, type OpcaoMenu } from "@/components/common/MenuSuspenso";
import { ESTADO_VAZIO, estadoInicial, filtrosAtivos, type EstadoFiltros, type FiltroPrioridade, type FiltroStatus, type Ordem } from "./modelo";

const STATUS: OpcaoMenu<FiltroStatus>[] = [
  { valor: "pendente", rotulo: "Pendentes" }, { valor: "concluida", rotulo: "Concluídas" }, { valor: "todos", rotulo: "Todos os status" },
];
const PRIORIDADES: OpcaoMenu<FiltroPrioridade>[] = [
  { valor: "todas", rotulo: "Todas as prioridades" },
  { valor: "alta", rotulo: "Alta", cor: "rgb(239 68 68)" }, { valor: "media", rotulo: "Média", cor: "rgb(245 158 11)" }, { valor: "baixa", rotulo: "Baixa", cor: "rgb(96 165 250)" },
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
  `flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-all duration-150 active:scale-95 ${ativo ? "border-steel-400/70 bg-steel-700/25 text-text-primary" : "border-border bg-surface-2 text-text-secondary hover:border-steel-400/60 hover:text-text-primary"}`;

const Seta = ({ aberto }: { aberto: boolean }) => <ChevronDown size={13} className={`transition-transform duration-150 ${aberto ? "rotate-180" : ""}`} />;

/** Filtrar por status, prioridade e equipe, e ordenar — chips que abrem menus do próprio app. */
export function BarraFiltros({ estado, onChange, contexto, visiveis, total, temTarefas }: Props) {
  const padrao = estadoInicial(temTarefas);
  const equipes: OpcaoMenu<string>[] = [
    { valor: "todas", rotulo: "Todas as equipes" }, { valor: "pessoal", rotulo: "Pessoal" },
    ...contexto.equipes.map((e) => ({ valor: `equipe:${e.id}`, rotulo: e.nome })),
  ];
  const alterado = filtrosAtivos(estado, temTarefas) > 0 || estado.ordem !== ESTADO_VAZIO.ordem;
  const set = (patch: Partial<EstadoFiltros>) => onChange({ ...estado, ...patch });

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Filtros e ordenação">
      <ListFilter size={15} className="text-text-muted" aria-hidden />
      {temTarefas && (
        <MenuSuspenso ariaLabel="Filtrar por status" valor={estado.status} opcoes={STATUS} onChange={(status) => set({ status })}
          classeGatilho={chip(estado.status !== padrao.status)}
          gatilho={({ aberto, atual }) => <><CircleDot size={14} /><span>{atual?.rotulo}</span><Seta aberto={aberto} /></>} />
      )}
      {temTarefas && (
        <MenuSuspenso ariaLabel="Filtrar por prioridade" valor={estado.prioridade} opcoes={PRIORIDADES} onChange={(prioridade) => set({ prioridade })}
          classeGatilho={chip(estado.prioridade !== "todas")}
          gatilho={({ aberto, atual }) => <><Flag size={14} /><span>{estado.prioridade === "todas" ? "Prioridade" : atual?.rotulo}</span><Seta aberto={aberto} /></>} />
      )}
      {contexto.equipes.length > 0 && (
        <MenuSuspenso ariaLabel="Filtrar por equipe" valor={estado.equipe} opcoes={equipes} onChange={(equipe) => set({ equipe })}
          classeGatilho={chip(estado.equipe !== "todas")}
          gatilho={({ aberto, atual }) => <><Users size={14} /><span className="max-w-[9rem] truncate">{estado.equipe === "todas" ? "Equipe" : atual?.rotulo ?? "Equipe"}</span><Seta aberto={aberto} /></>} />
      )}
      <MenuSuspenso ariaLabel="Ordenar" alinhar="dir" valor={estado.ordem} opcoes={ORDENS} onChange={(ordem) => set({ ordem })}
        classeGatilho={chip(estado.ordem !== "relevancia")}
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
