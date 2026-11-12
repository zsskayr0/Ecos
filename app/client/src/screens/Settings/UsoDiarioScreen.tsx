import { useEffect, useState } from "react";
import { Tags, CalendarDays, Clock3, Folder, FolderOpen, Maximize2, PanelRight, Columns3, Flag, Keyboard, LayoutList, ListChecks, Eye, StickyNote, Timer, Zap, CheckSquare, Ruler } from "lucide-react";
import { TOM } from "@/components/common/MenuSuspenso";
import { Toggle } from "@/components/common/Toggle";
import { limparEscolhaDeVisualizacao } from "@/components/common/ViewModeToggle";
import { useIsDesktop } from "@/lib/use-viewport";
import { pastas } from "@/lib/api";
import { EditorTagsPadrao } from "@/components/common/EditorTagsPadrao";
import type { ModoTagsPadrao } from "@/lib/tags-pasta";
import type { DataNovaTarefa, PastaNovoItem } from "@/lib/preferencias-aplicativo";
import { Cabecalho, CampoHora, Linha, Secao, Segmentado, Seletor, usePreferencias } from "./campos-config";

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

const DATAS_NOVA_TAREFA = [
  { valor: "nenhuma", rotulo: "Sem data", icone: CalendarDays, cor: TOM.aco },
  { valor: "hoje", rotulo: "Hoje", icone: CalendarDays, cor: TOM.ciano },
  { valor: "amanha", rotulo: "Amanhã", icone: CalendarDays, cor: TOM.ciano },
  { valor: "em7dias", rotulo: "Em 7 dias", icone: CalendarDays, cor: TOM.violeta },
] as const satisfies readonly { valor: DataNovaTarefa; rotulo: string; icone: typeof CalendarDays; cor: string }[];

const MODOS_PASTA = [
  { valor: "contexto", rotulo: "A pasta atual", icone: FolderOpen, cor: TOM.ciano },
  { valor: "fixa", rotulo: "Uma pasta fixa", icone: Folder, cor: TOM.violeta },
  { valor: "nenhuma", rotulo: "Nenhuma", icone: Folder, cor: TOM.aco },
] as const satisfies readonly { valor: PastaNovoItem; rotulo: string; icone: typeof Folder; cor: string }[];

/** Escolha da pasta fixa: lista as pastas existentes do tipo (e mantém a salva, mesmo que já não apareça). */
function PastaFixa({ tipo, valor, onChange, label }: { tipo: "nota" | "tarefa"; valor: string; onChange: (v: string) => void; label: string }) {
  const [lista, setLista] = useState<string[]>([]);
  useEffect(() => {
    let vivo = true;
    pastas.listar({ tipo, recursivo: true }).then((r) => { if (vivo) setLista(r.subpastas.map((p) => p.caminho).sort((a, b) => a.localeCompare(b))); }).catch(() => undefined);
    return () => { vivo = false; };
  }, [tipo]);
  const caminhos = valor && !lista.includes(valor) ? [valor, ...lista] : lista;
  const opcoes = [{ valor: "", rotulo: "Escolher…", icone: Folder, cor: TOM.aco }, ...caminhos.map((c) => ({ valor: c, rotulo: c, icone: Folder, cor: TOM.ciano }))];
  return <Seletor valor={valor} opcoes={opcoes} onChange={onChange} label={label} />;
}

const MODOS_TAGS = [
  { id: "hierarquia", rotulo: "Hierarquia" },
  { id: "pasta", rotulo: "Só a pasta" },
  { id: "manual", rotulo: "Manual" },
] as const satisfies readonly { id: ModoTagsPadrao; rotulo: string }[];
const DESCRICAO_TAGS = "Hierarquia: o item novo recebe as tags padrão da pasta e de todas as pastas de cima. Só a pasta: apenas as da própria pasta. Manual: ignora as pastas e usa a lista abaixo. Defina as das pastas em Editar pasta.";

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

      <Secao titulo="Abrir tarefas e notas existentes">
        <Linha Icone={Maximize2} titulo="Abrir tarefas maximizadas" descricao="A tarefa já abre no modo Focus, com o painel lateral. O botão de maximizar na janela continua alternando.">
          <Toggle checked={prefs.tarefaMaximizada} onChange={(tarefaMaximizada) => alterar({ tarefaMaximizada })} label="Abrir tarefas maximizadas" />
        </Linha>
        <Linha Icone={Maximize2} titulo="Abrir notas maximizadas" descricao="A nota já abre no modo Focus. O botão de maximizar na janela continua alternando.">
          <Toggle checked={prefs.notaMaximizada} onChange={(notaMaximizada) => alterar({ notaMaximizada })} label="Abrir notas maximizadas" />
        </Linha>
        <Linha Icone={Eye} titulo="Abrir notas em edição" descricao="Ao abrir uma nota existente, o texto já fica editável. Desligado, ela abre em visualização e você alterna quando quiser.">
          <Toggle checked={prefs.notaAbreEditando} onChange={(notaAbreEditando) => alterar({ notaAbreEditando })} label="Abrir notas em edição" />
        </Linha>
        <Linha Icone={Eye} titulo="Abrir tarefas em edição" descricao="Ao abrir uma tarefa existente, a descrição já fica editável. Desligado, ela abre em visualização e você alterna quando quiser.">
          <Toggle checked={prefs.tarefaAbreEditando} onChange={(tarefaAbreEditando) => alterar({ tarefaAbreEditando })} label="Abrir tarefas em edição" />
        </Linha>
        <Linha Icone={PanelRight} titulo="Painel lateral do Focus recolhido" descricao="No modo Focus (tarefas e notas) o painel de opções começa fechado, com o texto em primeiro plano. Desligue para ele já abrir. O botão no cabeçalho alterna a qualquer momento.">
          <Toggle checked={prefs.focusPainelRecolhido} onChange={(focusPainelRecolhido) => alterar({ focusPainelRecolhido })} label="Painel lateral do Focus recolhido" />
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
        <Linha Icone={FolderOpen} titulo="Pasta" descricao="Onde a tarefa nova é guardada: na pasta em que você está, sempre em uma pasta específica ou sem pasta.">
          <Seletor valor={prefs.tarefaNovaPasta} opcoes={MODOS_PASTA} onChange={(tarefaNovaPasta) => alterar({ tarefaNovaPasta })} label="Pasta da tarefa nova" />
        </Linha>
        {prefs.tarefaNovaPasta === "fixa" && (
          <Linha Icone={Folder} titulo="Pasta fixa" descricao="Pasta de tarefas usada sempre que você cria uma tarefa.">
            <PastaFixa tipo="tarefa" valor={prefs.tarefaNovaPastaFixa} onChange={(tarefaNovaPastaFixa) => alterar({ tarefaNovaPastaFixa })} label="Pasta fixa das tarefas novas" />
          </Linha>
        )}
        <Linha Icone={Tags} titulo="Tags padrão" descricao={DESCRICAO_TAGS}>
          <Segmentado valor={prefs.tarefaNovaTagsModo} opcoes={MODOS_TAGS} onChange={(tarefaNovaTagsModo) => alterar({ tarefaNovaTagsModo })} label="Origem das tags padrão" />
        </Linha>
        {prefs.tarefaNovaTagsModo === "manual" && (
          <div className="border-b border-border/60 px-4 py-3 last:border-0">
            <EditorTagsPadrao valor={prefs.tarefaNovaTags} onChange={(tarefaNovaTags) => alterar({ tarefaNovaTags })} label="Tags padrão das tarefas novas" />
          </div>
        )}
        {desktop && (
          <>
            <Linha Icone={Maximize2} titulo="Criar maximizada" descricao="A janela de criação já abre no modo Focus. Sair do Focus fecha a criação, salvando o que foi escrito.">
              <Toggle checked={prefs.tarefaNovaMaximizada} onChange={(tarefaNovaMaximizada) => alterar({ tarefaNovaMaximizada })} label="Criar tarefas maximizadas" />
            </Linha>
            <Linha Icone={PanelRight} titulo="Barra lateral aberta" descricao="Na criação maximizada, o painel de opções (data, pasta, tags, duração) já começa aberto.">
              <Toggle checked={prefs.tarefaNovaPainelAberto} onChange={(tarefaNovaPainelAberto) => alterar({ tarefaNovaPainelAberto })} label="Barra lateral aberta na criação" />
            </Linha>
          </>
        )}
      </Secao>

      <Secao titulo="Nova nota">
        <Linha Icone={FolderOpen} titulo="Pasta" descricao="Onde a nota nova é guardada: na pasta em que você está, sempre em uma pasta específica ou sem pasta.">
          <Seletor valor={prefs.notaNovaPasta} opcoes={MODOS_PASTA} onChange={(notaNovaPasta) => alterar({ notaNovaPasta })} label="Pasta da nota nova" />
        </Linha>
        {prefs.notaNovaPasta === "fixa" && (
          <Linha Icone={Folder} titulo="Pasta fixa" descricao="Pasta de notas usada sempre que você cria uma nota.">
            <PastaFixa tipo="nota" valor={prefs.notaNovaPastaFixa} onChange={(notaNovaPastaFixa) => alterar({ notaNovaPastaFixa })} label="Pasta fixa das notas novas" />
          </Linha>
        )}
        <Linha Icone={Tags} titulo="Tags padrão" descricao={DESCRICAO_TAGS}>
          <Segmentado valor={prefs.notaNovaTagsModo} opcoes={MODOS_TAGS} onChange={(notaNovaTagsModo) => alterar({ notaNovaTagsModo })} label="Origem das tags padrão" />
        </Linha>
        {prefs.notaNovaTagsModo === "manual" && (
          <div className="border-b border-border/60 px-4 py-3 last:border-0">
            <EditorTagsPadrao valor={prefs.notaNovaTags} onChange={(notaNovaTags) => alterar({ notaNovaTags })} label="Tags padrão das notas novas" />
          </div>
        )}
        {desktop && (
          <Linha Icone={Maximize2} titulo="Criar maximizada" descricao="A janela de criação já abre no modo Focus. Sair do Focus fecha a criação, salvando o que foi escrito.">
            <Toggle checked={prefs.notaNovaMaximizada} onChange={(notaNovaMaximizada) => alterar({ notaNovaMaximizada })} label="Criar notas maximizadas" />
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
