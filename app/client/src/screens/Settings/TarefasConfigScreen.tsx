import { CalendarDays, CheckSquare, Clock3, Columns3, Eye, Flag, LayoutList, Maximize2, PanelRight, Pencil, Timer } from "lucide-react";
import { TOM } from "@/components/common/MenuSuspenso";
import { Toggle } from "@/components/common/Toggle";
import { limparEscolhaDeVisualizacao } from "@/components/common/ViewModeToggle";
import { useIsDesktop } from "@/lib/use-viewport";
import type { DataNovaTarefa } from "@/lib/preferencias-aplicativo";
import { Cabecalho, CampoHora, Linha, Secao, Seletor, usePreferencias } from "./campos-config";
import { LinhasPastaETags } from "./novo-item-config";

const PRIORIDADES = [
  { valor: "baixa", rotulo: "Baixa", icone: Flag, cor: TOM.ciano },
  { valor: "media", rotulo: "Média", icone: Flag, cor: TOM.alerta },
  { valor: "alta", rotulo: "Alta", icone: Flag, cor: TOM.erro },
] as const;

const DURACOES = [5, 15, 30, 45, 60, 90, 120].map((min) => ({ valor: String(min), rotulo: min < 60 ? `${min} min` : min % 60 === 0 ? `${min / 60} h` : `${Math.floor(min / 60)} h ${min % 60} min`, icone: Timer, cor: TOM.ciano }));

const VISUALIZACOES_DESKTOP = [
  { valor: "tabela", rotulo: "Tabela", icone: LayoutList, cor: TOM.aco },
  { valor: "grade", rotulo: "Grade", icone: LayoutList, cor: TOM.aco },
  { valor: "kanban", rotulo: "Kanban", icone: Columns3, cor: TOM.violeta },
  { valor: "matriz", rotulo: "Matriz", icone: LayoutList, cor: TOM.ciano },
] as const;
const VISUALIZACOES_MOBILE = [
  { valor: "cards", rotulo: "Feed", icone: LayoutList, cor: TOM.aco },
  { valor: "lista", rotulo: "Lista", icone: LayoutList, cor: TOM.aco },
  { valor: "agrupada", rotulo: "Agrupada", icone: LayoutList, cor: TOM.violeta },
] as const;

const DATAS_NOVA_TAREFA = [
  { valor: "nenhuma", rotulo: "Sem data", icone: CalendarDays, cor: TOM.aco },
  { valor: "hoje", rotulo: "Hoje", icone: CalendarDays, cor: TOM.ciano },
  { valor: "amanha", rotulo: "Amanhã", icone: CalendarDays, cor: TOM.ciano },
  { valor: "em7dias", rotulo: "Em 7 dias", icone: CalendarDays, cor: TOM.violeta },
] as const satisfies readonly { valor: DataNovaTarefa; rotulo: string; icone: typeof CalendarDays; cor: string }[];

/** Tudo que é só de tarefas: como a lista aparece, como uma tarefa abre e com o que uma tarefa nova nasce. */
export function TarefasConfigScreen() {
  const desktop = useIsDesktop();
  const [prefs, alterar] = usePreferencias();

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
      <Cabecalho titulo="Tarefas" />

      <Secao titulo="Lista de tarefas">
        {desktop ? (
          <Linha Icone={Eye} titulo="Visualização padrão" descricao="Como as tarefas aparecem ao abrir. A escolha feita na própria tela é esquecida ao mudar aqui.">
            <Seletor valor={prefs.visualizacaoTarefasDesktop} opcoes={VISUALIZACOES_DESKTOP} onChange={(visualizacaoTarefasDesktop) => { limparEscolhaDeVisualizacao(); alterar({ visualizacaoTarefasDesktop }); }} label="Visualização padrão de tarefas" />
          </Linha>
        ) : (
          <Linha Icone={Eye} titulo="Visualização padrão" descricao="Como as tarefas aparecem ao abrir. A escolha feita na própria tela é esquecida ao mudar aqui.">
            <Seletor valor={prefs.visualizacaoTarefasMobile} opcoes={VISUALIZACOES_MOBILE} onChange={(visualizacaoTarefasMobile) => { limparEscolhaDeVisualizacao(); alterar({ visualizacaoTarefasMobile }); }} label="Visualização padrão de tarefas" />
          </Linha>
        )}
        <Linha Icone={CheckSquare} titulo="Mostrar concluídas ao abrir" descricao="As listas começam só com as pendentes. Ligue para ver também as concluídas.">
          <Toggle checked={prefs.mostrarConcluidas} onChange={(mostrarConcluidas) => alterar({ mostrarConcluidas })} label="Mostrar concluídas ao abrir" />
        </Linha>
      </Secao>

      <Secao titulo="Ao abrir uma tarefa">
        <Linha Icone={Maximize2} titulo="Abrir tarefas maximizadas" descricao="A tarefa já abre no modo Focus, com o painel lateral. O botão de maximizar na janela continua alternando.">
          <Toggle checked={prefs.tarefaMaximizada} onChange={(tarefaMaximizada) => alterar({ tarefaMaximizada })} label="Abrir tarefas maximizadas" />
        </Linha>
        <Linha Icone={Pencil} titulo="Abrir tarefas em edição" descricao="Ao abrir uma tarefa existente, a descrição já fica editável. Desligado, ela abre em visualização e você alterna quando quiser.">
          <Toggle checked={prefs.tarefaAbreEditando} onChange={(tarefaAbreEditando) => alterar({ tarefaAbreEditando })} label="Abrir tarefas em edição" />
        </Linha>
      </Secao>

      <Secao titulo="Nova tarefa">
        <Linha Icone={Flag} titulo="Prioridade padrão" descricao="Prioridade que uma tarefa nova já traz preenchida.">
          <Seletor valor={prefs.tarefaPrioridade} opcoes={PRIORIDADES} onChange={(tarefaPrioridade) => alterar({ tarefaPrioridade })} label="Prioridade padrão" />
        </Linha>
        <Linha Icone={Timer} titulo="Duração padrão" descricao="Duração estimada que uma tarefa nova já traz preenchida.">
          <Seletor valor={String(prefs.tarefaDuracaoMin)} opcoes={DURACOES} onChange={(v) => alterar({ tarefaDuracaoMin: Number(v) })} label="Duração padrão" />
        </Linha>
        <Linha Icone={CalendarDays} titulo="Data padrão" descricao="A tarefa nova já nasce com esta data (&quot;Hoje&quot; mantém a data fixa no dia em que você cria). Dá para trocar ou limpar na própria tarefa.">
          <Seletor valor={prefs.tarefaNovaData} opcoes={DATAS_NOVA_TAREFA} onChange={(tarefaNovaData) => alterar({ tarefaNovaData })} label="Data padrão da tarefa nova" />
        </Linha>
        <Linha Icone={Clock3} titulo="Horário padrão" descricao="Junto da data padrão, a tarefa já entra na Agenda neste horário. Desligado, ela fica só com o dia.">
          <span className="flex items-center gap-2">
            {prefs.tarefaNovaHorario && <CampoHora valor={prefs.tarefaNovaHorario} onChange={(tarefaNovaHorario) => alterar({ tarefaNovaHorario })} label="Horário padrão da tarefa nova" desabilitado={prefs.tarefaNovaData === "nenhuma"} />}
            <Toggle checked={!!prefs.tarefaNovaHorario} onChange={(ligado) => alterar({ tarefaNovaHorario: ligado ? "09:00" : "" })} label="Usar horário padrão" />
          </span>
        </Linha>
        <LinhasPastaETags tipo="tarefa"
          pasta={prefs.tarefaNovaPasta} aoMudarPasta={(tarefaNovaPasta) => alterar({ tarefaNovaPasta })}
          pastaFixa={prefs.tarefaNovaPastaFixa} aoMudarPastaFixa={(tarefaNovaPastaFixa) => alterar({ tarefaNovaPastaFixa })}
          tagsModo={prefs.tarefaNovaTagsModo} aoMudarTagsModo={(tarefaNovaTagsModo) => alterar({ tarefaNovaTagsModo })}
          tags={prefs.tarefaNovaTags} aoMudarTags={(tarefaNovaTags) => alterar({ tarefaNovaTags })} />
        {desktop && (
          <>
            <Linha Icone={Maximize2} titulo="Criar maximizada" descricao="A janela de criação já abre no modo Focus. Sair do Focus fecha a criação, salvando o que foi escrito.">
              <Toggle checked={prefs.tarefaNovaMaximizada} onChange={(tarefaNovaMaximizada) => alterar({ tarefaNovaMaximizada })} label="Criar tarefas maximizadas" />
            </Linha>
            <Linha Icone={PanelRight} titulo="Barra lateral aberta na criação" descricao="Na criação maximizada, o painel de opções (data, pasta, tags, duração) já começa aberto.">
              <Toggle checked={prefs.tarefaNovaPainelAberto} onChange={(tarefaNovaPainelAberto) => alterar({ tarefaNovaPainelAberto })} label="Barra lateral aberta na criação" />
            </Linha>
          </>
        )}
      </Secao>
    </div>
  );
}
