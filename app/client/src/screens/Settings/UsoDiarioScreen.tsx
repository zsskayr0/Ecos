import { Clock3, Columns3, Flag, Keyboard, LayoutList, ListChecks, Eye, StickyNote, Timer, Zap, CheckSquare, Ruler } from "lucide-react";
import { TOM } from "@/components/common/MenuSuspenso";
import { Toggle } from "@/components/common/Toggle";
import { limparEscolhaDeVisualizacao } from "@/components/common/ViewModeToggle";
import { useIsDesktop } from "@/lib/use-viewport";
import { Cabecalho, Linha, Secao, Segmentado, Seletor, usePreferencias } from "./campos-config";

const PRIORIDADES = [
  { valor: "baixa", rotulo: "Baixa", icone: Flag, cor: TOM.ciano },
  { valor: "media", rotulo: "Média", icone: Flag, cor: TOM.alerta },
  { valor: "alta", rotulo: "Alta", icone: Flag, cor: TOM.erro },
] as const;

const DURACOES = [5, 15, 30, 45, 60, 90, 120].map((min) => ({ valor: String(min), rotulo: min < 60 ? `${min} min` : min % 60 === 0 ? `${min / 60} h` : `${Math.floor(min / 60)} h ${min % 60} min`, icone: Timer, cor: TOM.ciano }));
const ENCAIXES = [5, 10, 15, 30, 60].map((min) => ({ valor: String(min), rotulo: `${min} min`, icone: Ruler, cor: TOM.ciano }));

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

const ehMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
const MOD = ehMac ? "⌘" : "Ctrl";

/** Atalhos que existem hoje (só desktop). A lista é de consulta: ainda não dá para remapear. */
const ATALHOS: { teclas: string[]; acao: string }[] = [
  { teclas: [MOD, "K"], acao: "Abrir a paleta de comandos" },
  { teclas: [MOD, "Shift", "K"], acao: "Paleta de comandos global (busca em tudo)" },
  { teclas: [MOD, "B"], acao: "Recolher ou expandir a barra lateral" },
  { teclas: [MOD, "W"], acao: "Fechar a aba atual" },
  { teclas: [MOD, "Tab"], acao: "Ir para a próxima aba (com Shift, a anterior)" },
  { teclas: [MOD, "\\"], acao: "Dividir o painel para a direita" },
  { teclas: [MOD, "1–9"], acao: "Focar o painel pelo número" },
  { teclas: ["Alt", "← →"], acao: "Voltar e avançar no histórico" },
  { teclas: ["Enter"], acao: "Captura rápida: criar (nota ou tarefa, conforme a preferência acima)" },
  { teclas: [MOD, "Enter"], acao: "Captura rápida: criar o outro tipo" },
  { teclas: ["Shift", "Enter"], acao: "Captura rápida: quebrar a linha" },
];

export function UsoDiarioScreen() {
  const desktop = useIsDesktop();
  const [prefs, alterar] = usePreferencias();

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
      <Cabecalho titulo="Uso diário" />

      <Secao titulo="Tarefas">
        <Linha Icone={Flag} titulo="Prioridade padrão" descricao="Prioridade que uma tarefa nova já traz preenchida.">
          <Seletor valor={prefs.tarefaPrioridade} opcoes={PRIORIDADES} onChange={(tarefaPrioridade) => alterar({ tarefaPrioridade })} label="Prioridade padrão" />
        </Linha>
        <Linha Icone={Timer} titulo="Duração padrão" descricao="Duração estimada que uma tarefa nova já traz preenchida.">
          <Seletor valor={String(prefs.tarefaDuracaoMin)} opcoes={DURACOES} onChange={(v) => alterar({ tarefaDuracaoMin: Number(v) })} label="Duração padrão" />
        </Linha>
        <Linha Icone={CheckSquare} titulo="Mostrar concluídas ao abrir" descricao="As listas começam só com as pendentes. Ligue para ver também as concluídas.">
          <Toggle checked={prefs.mostrarConcluidas} onChange={(mostrarConcluidas) => alterar({ mostrarConcluidas })} label="Mostrar concluídas ao abrir" />
        </Linha>
        {desktop ? (
          <Linha Icone={Eye} titulo="Visualização padrão" descricao="Como as tarefas aparecem ao abrir. A escolha feita na própria tela é esquecida ao mudar aqui.">
            <Seletor valor={prefs.visualizacaoTarefasDesktop} opcoes={VISUALIZACOES_DESKTOP} onChange={(visualizacaoTarefasDesktop) => { limparEscolhaDeVisualizacao(); alterar({ visualizacaoTarefasDesktop }); }} label="Visualização padrão de tarefas" />
          </Linha>
        ) : (
          <Linha Icone={Eye} titulo="Visualização padrão" descricao="Como as tarefas aparecem ao abrir. A escolha feita na própria tela é esquecida ao mudar aqui.">
            <Seletor valor={prefs.visualizacaoTarefasMobile} opcoes={VISUALIZACOES_MOBILE} onChange={(visualizacaoTarefasMobile) => { limparEscolhaDeVisualizacao(); alterar({ visualizacaoTarefasMobile }); }} label="Visualização padrão de tarefas" />
          </Linha>
        )}
      </Secao>

      <Secao titulo="Captura rápida">
        <Linha Icone={Zap} titulo="Enter cria" descricao="Na captura rápida do Feed. Ctrl+Enter cria o outro tipo e Shift+Enter quebra a linha.">
          <Segmentado valor={prefs.capturaEnter} opcoes={[{ id: "nota", rotulo: "Nota", Icone: StickyNote }, { id: "tarefa", rotulo: "Tarefa", Icone: ListChecks }]} onChange={(capturaEnter) => alterar({ capturaEnter })} label="O que o Enter cria" />
        </Linha>
      </Secao>

      <Secao titulo="Agenda">
        <Linha Icone={Clock3} titulo="Encaixe inicial" descricao="Passo ao arrastar e redimensionar blocos. Dá para trocar a qualquer momento na própria Agenda.">
          <Seletor valor={String(prefs.agendaEncaixe)} opcoes={ENCAIXES} onChange={(v) => alterar({ agendaEncaixe: Number(v) as typeof prefs.agendaEncaixe })} label="Encaixe inicial da Agenda" />
        </Linha>
      </Secao>

      {desktop && (
        <section className="mt-6">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Atalhos de teclado</p>
          <div className="rounded-2xl border border-border bg-surface-1 p-2">
            <p className="flex items-center gap-2 px-3 pb-2 pt-2 text-xs text-text-muted"><Keyboard size={14} />Lista de consulta. Ainda não é possível remapear.</p>
            {ATALHOS.map(({ teclas, acao }) => (
              <div key={acao} className="flex min-h-11 items-center justify-between gap-4 rounded-lg px-3 py-2 hover:bg-surface-2">
                <span className="text-sm text-text-secondary">{acao}</span>
                <span className="flex shrink-0 items-center gap-1">{teclas.map((t) => <kbd key={t} className="rounded border border-border bg-surface-3 px-1.5 py-0.5 font-mono-value text-[11px] text-text-primary">{t}</kbd>)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
