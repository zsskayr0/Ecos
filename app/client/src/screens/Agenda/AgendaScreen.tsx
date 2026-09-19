import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { useAbrirDocumento } from "@/lib/documento-popup";
import { AlertTriangle, ListChecks, CheckCircle2, ChevronLeft, ChevronRight, Pin, X, CalendarDays, CalendarRange, CalendarPlus, Columns3, LayoutGrid, PanelTop, Plus, Sun } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { tarefas as tarefasApi, rotina as rotinaApi, ApiError, type TarefaResumo } from "@/lib/api";
import { formatDuracao } from "@/lib/format";
import { EmptyState } from "@/components/common/EmptyState";
import { CalendarClock } from "lucide-react";
import { useRefreshBus } from "@/lib/refresh-bus";
import { useIsDesktop } from "@/lib/use-viewport";
import { MenuSuspenso, TOM, type OpcaoMenu } from "@/components/common/MenuSuspenso";

type ModoAgenda = "dia" | "tres_dias" | "semana" | "quinzenal" | "mes" | "seis_meses" | "anual";
type AncoraPopup = { left: number; top: number; width: number; height: number };

const CHAVE_CACHE_AGENDA = "ecos:agenda:visualizacao";

function paraISO(d: Date) {
  return d.toISOString().slice(0, 10);
}

/** A Agenda mostra tanto blocos com hora quanto tarefas que só possuem data/prazo. */
function dataDaTarefa(tarefa: TarefaResumo): string | null {
  return tarefa.scheduled_at ? paraISO(new Date(tarefa.scheduled_at)) : tarefa.due_date;
}

function somarDias(d: Date, n: number) {
  const novo = new Date(d);
  novo.setDate(novo.getDate() + n);
  return novo;
}

function gerarDiasDoMes(referencia: Date) {
  const ano = referencia.getFullYear();
  const mes = referencia.getMonth();
  const primeiroDia = new Date(ano, mes, 1);
  const totalDias = new Date(ano, mes + 1, 0).getDate();
  const offset = primeiroDia.getDay();
  return { offset, totalDias, ano, mes };
}

/** Sunday-start week (matching the month grid's "D S T Q Q S S" header) containing `d`. */
function inicioDaSemana(d: Date) {
  return somarDias(d, -d.getDay());
}

function limitesDoPeriodo(modo: ModoAgenda, referencia: Date): { de: string; ate: string } {
  if (modo === "mes") return { de: paraISO(new Date(referencia.getFullYear(), referencia.getMonth(), 1)), ate: paraISO(new Date(referencia.getFullYear(), referencia.getMonth() + 1, 0)) };
  if (modo === "seis_meses") return { de: paraISO(new Date(referencia.getFullYear(), referencia.getMonth(), 1)), ate: paraISO(new Date(referencia.getFullYear(), referencia.getMonth() + 6, 0)) };
  if (modo === "anual") return { de: paraISO(new Date(referencia.getFullYear(), 0, 1)), ate: paraISO(new Date(referencia.getFullYear(), 11, 31)) };
  const de = modo === "dia" || modo === "tres_dias" ? referencia : inicioDaSemana(referencia);
  const quantidade = modo === "dia" ? 1 : modo === "tres_dias" ? 3 : modo === "quinzenal" ? 14 : 7;
  return { de: paraISO(de), ate: paraISO(somarDias(de, quantidade - 1)) };
}

function lerEstadoInicialAgenda(): { modo: ModoAgenda; dia: Date } {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_CACHE_AGENDA) ?? "{}") as { modo?: unknown; dia?: unknown };
    const modo: ModoAgenda = ["dia", "tres_dias", "semana", "quinzenal", "mes", "seis_meses", "anual"].includes(String(salvo.modo)) ? salvo.modo as ModoAgenda : "mes";
    // Meio-dia evita que a conversão UTC desloque o dia no fuso local.
    const dia = typeof salvo.dia === "string" ? new Date(`${salvo.dia}T12:00:00`) : new Date();
    return { modo, dia: Number.isNaN(dia.getTime()) ? new Date() : dia };
  } catch {
    return { modo: "mes", dia: new Date() };
  }
}

interface Capacidade {
  disponivel_producao_min: number;
  consumido_tarefas_min: number;
  consumido_eventos_externos_min: number;
  disponivel_producao_total_min?: number;
  estourado: boolean;
}

/**
 * Agenda — monthly/weekly/daily calendar + the day's time-block list
 * (section 3.4), reading real `GET /tarefas` and `GET /agenda/capacidade`.
 * User feedback: "a agenda continua intacta ali, com funções de calendário
 * mensal, semanal e diário" — the three views share one selected-day state
 * and the same task list below; only the picker widget above it changes.
 */
export function AgendaScreen() {
  const desktop = useIsDesktop();
  const agendaRef = useRef<HTMLDivElement>(null);
  const abrirDocumento = useAbrirDocumento();
  const { versao, notificar } = useRefreshBus();
  const [estadoInicial] = useState(lerEstadoInicialAgenda);
  const [modo, setModo] = useState<ModoAgenda>(estadoInicial.modo);
  const [diaAtual, setDiaAtual] = useState(estadoInicial.dia);
  const hoje = new Date();
  const dataStr = paraISO(diaAtual);

  const [blocos, setBlocos] = useState<TarefaResumo[] | null>(null);
  const [itensDoPeriodo, setItensDoPeriodo] = useState<TarefaResumo[]>([]);
  const [capacidade, setCapacidade] = useState<Capacidade | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const navigate = useNavigate();
  const [semRotina, setSemRotina] = useState(false);
  const [tarefasAbertas, setTarefasAbertas] = useState(false);
  const [ancoraPopup, setAncoraPopup] = useState<AncoraPopup | null>(null);
  const [criadorEventoAberto, setCriadorEventoAberto] = useState(false);
  const [eventosLocais, setEventosLocais] = useState<{ id: number; titulo: string; inicio: string; cor: string }[]>([]);
  useEffect(() => { rotinaApi.listar().then((b) => setSemRotina(b.length === 0)).catch(() => setSemRotina(false)); }, [versao]);

  // A escolha de Mês/Semana/Dia é uma preferência de trabalho, não uma
  // configuração temporária da tela. Mantemos também o dia de referência
  // para que, ao voltar à Agenda, a pessoa retome exatamente o contexto.
  useEffect(() => {
    try {
      localStorage.setItem(CHAVE_CACHE_AGENDA, JSON.stringify({ modo, dia: paraISO(diaAtual) }));
    } catch { /* cache indisponível */ }
  }, [modo, diaAtual]);

  async function planejarTarefa(dado: string, data: Date) {
    try {
      const tarefa = JSON.parse(dado) as { id: string; duracao: number };
      const inicio = new Date(data.getFullYear(), data.getMonth(), data.getDate(), 9, 0).toISOString();
      await tarefasApi.timeEntries.criar(tarefa.id, { tipo: "planejado", inicio_em: inicio, duracao_min: Math.max(1, tarefa.duracao) });
      notificar();
    } catch (e) { setErro(e instanceof ApiError ? e.message : "Não foi possível planejar a tarefa."); }
  }


  useEffect(() => {
    let vivo = true;
    setErro(null);
    // O servidor guarda horários em UTC: ele precisa do fuso para saber onde o dia começa e termina.
    const [a, m, d] = dataStr.split("-").map(Number);
    const tz = -new Date(a, m - 1, d, 12).getTimezoneOffset();
    Promise.all([
      tarefasApi.listar({ data_de: dataStr, data_ate: dataStr, tz, limit: 100 }),
      tarefasApi.capacidade(dataStr, tz),
    ])
      .then(([t, c]) => {
        if (!vivo) return;
        setBlocos(t.items);
        setCapacidade(c);
      })
      .catch((e) => {
        if (!vivo) return;
        setErro(e instanceof ApiError ? e.message : "Não foi possível carregar a Agenda.");
        setBlocos([]);
      });
    return () => {
      vivo = false;
    };
  }, [dataStr, versao]);

  useEffect(() => {
    let vivo = true;
    const { de, ate } = limitesDoPeriodo(modo, diaAtual);
    const [ano, mes, dia] = de.split("-").map(Number);
    const tz = -new Date(ano, mes - 1, dia, 12).getTimezoneOffset();
    tarefasApi.listar({ data_de: de, data_ate: ate, tz, limit: 500 }).then((resultado) => { if (vivo) setItensDoPeriodo(resultado.items); }).catch(() => { if (vivo) setItensDoPeriodo([]); });
    return () => { vivo = false; };
  }, [modo, dataStr, versao]);

  const ehHojeFn = (d: Date) => paraISO(d) === paraISO(hoje);
  const pendentes = blocos?.filter((b) => b.status === "pendente").length ?? 0;
  const selecionarDia = (data: Date, alvo?: HTMLElement) => {
    setDiaAtual(data);
    if (desktop) {
      const pai = agendaRef.current?.getBoundingClientRect();
      const retangulo = alvo?.getBoundingClientRect();
      if (pai && retangulo) setAncoraPopup({ left: retangulo.left - pai.left, top: retangulo.top - pai.top, width: retangulo.width, height: retangulo.height });
      setTarefasAbertas(true);
    }
  };
  const irParaHoje = (alvo: HTMLElement) => {
    const noPeriodoAtual = modo === "mes"
      ? diaAtual.getFullYear() === hoje.getFullYear() && diaAtual.getMonth() === hoje.getMonth()
      : modo === "semana" || modo === "quinzenal" || modo === "tres_dias"
        ? paraISO(inicioDaSemana(diaAtual)) === paraISO(inicioDaSemana(hoje))
        : paraISO(diaAtual) === paraISO(hoje);
    if (noPeriodoAtual) selecionarDia(hoje, alvo);
    else { setDiaAtual(hoje); setTarefasAbertas(false); }
  };
  const navegarPeriodo = (direcao: number) => setDiaAtual((atual) => {
    if (modo === "mes") return new Date(atual.getFullYear(), atual.getMonth() + direcao, 1);
    if (modo === "seis_meses") return new Date(atual.getFullYear(), atual.getMonth() + direcao * 6, 1);
    if (modo === "anual") return new Date(atual.getFullYear() + direcao, atual.getMonth(), 1);
    return somarDias(atual, direcao * (modo === "tres_dias" ? 3 : modo === "quinzenal" ? 14 : modo === "semana" ? 7 : 1));
  });

  useEffect(() => {
    if (!desktop) setTarefasAbertas(false);
  }, [desktop]);

  return (
    <div ref={agendaRef} className={`relative px-4 pt-1 ${desktop ? "flex h-full min-h-0 flex-col pb-4" : ""}`}>
      {!desktop && <div className="mb-4 flex justify-center rounded-pill bg-surface-2 p-1 self-center w-fit mx-auto">
        {(["mes", "semana", "dia"] as ModoAgenda[]).map((m) => (
          <button
            key={m}
            onClick={() => setModo(m)}
            className={`rounded-pill px-4 py-1.5 text-sm font-medium capitalize ${modo === m ? "bg-steel-700 text-white" : "text-text-muted"}`}
          >
            {m === "mes" ? "Mês" : m === "semana" ? "Semana" : "Dia"}
          </button>
        ))}
      </div>}

      {modo === "mes" && (
        <VisaoMes desktop={desktop} modo={modo} onMudarModo={setModo} onHoje={irParaHoje} onNavegar={navegarPeriodo} onAbrirEvento={() => setCriadorEventoAberto(true)} diaAtual={diaAtual} hoje={hoje} itens={itensDoPeriodo} onMudarMes={(delta) => setDiaAtual((d) => new Date(d.getFullYear(), d.getMonth() + delta, Math.min(d.getDate(), 28)))} onSelecionar={selecionarDia} onPlanejarTarefa={planejarTarefa} />
      )}
      {(modo === "tres_dias" || modo === "semana" || modo === "quinzenal") && (
        <VisaoTempo desktop={desktop} modo={modo} onMudarModo={setModo} onHoje={irParaHoje} onNavegar={navegarPeriodo} onAbrirEvento={() => setCriadorEventoAberto(true)} diaAtual={diaAtual} hoje={hoje} onSelecionar={selecionarDia} eventos={eventosLocais} tarefas={itensDoPeriodo} />
      )}
      {modo === "dia" && (desktop ? <VisaoTempo desktop modo={modo} onMudarModo={setModo} onHoje={irParaHoje} onNavegar={navegarPeriodo} onAbrirEvento={() => setCriadorEventoAberto(true)} diaAtual={diaAtual} hoje={hoje} onSelecionar={selecionarDia} eventos={eventosLocais} tarefas={itensDoPeriodo} /> :
        <VisaoDia desktop={false} modo={modo} onMudarModo={setModo} onHoje={irParaHoje} onNavegar={navegarPeriodo} onAbrirEvento={() => setCriadorEventoAberto(true)} hoje={hoje} diaAtual={diaAtual} onMudarDia={(delta) => setDiaAtual((d) => somarDias(d, delta))} onSelecionar={selecionarDia} />
      )}
      {(modo === "seis_meses" || modo === "anual") && <VisaoPeriodos modo={modo} diaAtual={diaAtual} onMudarModo={setModo} onHoje={irParaHoje} onNavegar={navegarPeriodo} onAbrirEvento={() => setCriadorEventoAberto(true)} onSelecionar={selecionarDia} />}

      {semRotina && !desktop && (
        <button onClick={() => navigate("/perfil/rotina")} className="mb-4 flex w-full items-start gap-3 rounded-2xl border border-steel-400/40 bg-steel-700/15 p-4 text-left">
          <CalendarClock size={20} className="mt-0.5 shrink-0 text-steel-300" strokeWidth={1.75} />
          <span className="text-sm leading-snug text-text-primary">Você ainda não contou sobre a sua rotina. Sem ela a Agenda não sabe quantas horas o seu dia tem. <span className="font-semibold text-steel-300">Ajustar rotina</span></span>
        </button>
      )}

      {erro && !desktop && (
        <div className="mb-4 flex items-start gap-2 rounded-2xl border border-error/40 bg-error/10 p-3 text-sm text-error">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" strokeWidth={1.75} />
          {erro}
        </div>
      )}

      {capacidade?.estourado && !desktop && (
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-4">
          <AlertTriangle size={20} className="mt-0.5 shrink-0 text-warning" strokeWidth={1.75} />
          <p className="text-sm leading-snug text-text-primary">
            {pendentes} {pendentes === 1 ? "tarefa soma" : "tarefas somam"} {formatDuracao(capacidade.consumido_tarefas_min)}, mas o dia só tem{" "}
            {formatDuracao(capacidade.disponivel_producao_total_min !== undefined ? Math.max(0, capacidade.disponivel_producao_total_min - capacidade.consumido_eventos_externos_min) : capacidade.consumido_tarefas_min)} de produção
            disponível. A conta não fecha — alguma vai sobrar pra amanhã. Qual?
          </p>
        </div>
      )}

      {!desktop && <ListaDeTarefas blocos={blocos} abrirDocumento={abrirDocumento} />}
      {desktop && tarefasAbertas && <PopupTarefas key={`${modo}-${dataStr}`} ancora={ancoraPopup} dia={diaAtual} blocos={blocos} capacidade={capacidade} semRotina={semRotina} erro={erro} pendentes={pendentes} onFechar={() => setTarefasAbertas(false)} onAjustarRotina={() => navigate("/perfil/rotina")} abrirDocumento={abrirDocumento} />}
      {desktop && criadorEventoAberto && <CriadorEvento dia={diaAtual} onFechar={() => setCriadorEventoAberto(false)} onCriar={(evento) => { setEventosLocais((anteriores) => [...anteriores, { ...evento, id: Date.now() }]); setCriadorEventoAberto(false); }} />}
    </div>
  );
}

const PERIODOS: OpcaoMenu<ModoAgenda>[] = [
  { valor: "dia", rotulo: "Dia", icone: Sun, cor: TOM.alerta }, { valor: "tres_dias", rotulo: "3 dias", icone: Columns3, cor: TOM.ciano },
  { valor: "semana", rotulo: "Semana", icone: CalendarDays, cor: TOM.sucesso }, { valor: "quinzenal", rotulo: "Quinzenal", icone: CalendarRange, cor: TOM.violeta },
  { valor: "mes", rotulo: "Mensal", icone: LayoutGrid, cor: TOM.aco }, { valor: "seis_meses", rotulo: "6 meses", icone: PanelTop, cor: TOM.ciano }, { valor: "anual", rotulo: "Anual", icone: CalendarDays, cor: TOM.erro },
];
function AcoesAgenda({ modo, onMudarModo, onHoje, onNavegar = () => {}, onAbrirEvento = () => {} }: { modo: ModoAgenda; onMudarModo: (modo: ModoAgenda) => void; onHoje: (alvo: HTMLElement) => void; onNavegar?: (direcao: number) => void; onAbrirEvento?: () => void }) {
  const atual = PERIODOS.find((periodo) => periodo.valor === modo);
  const Icone = atual?.icone ?? CalendarDays;
  return <div className="flex items-center gap-2"><button onClick={() => onNavegar(-1)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface-1 text-text-muted transition-all hover:-translate-x-0.5 hover:bg-surface-2 hover:text-text-primary active:scale-95" aria-label="Período anterior"><ChevronLeft size={18} /></button><MenuSuspenso ariaLabel="Escolher período da agenda" valor={modo} opcoes={PERIODOS} onChange={onMudarModo} corAtiva={atual?.cor ?? TOM.aco} classeGatilho="flex h-9 items-center gap-2 rounded-lg border border-border bg-surface-1 px-3 text-sm font-medium text-text-secondary transition-all hover:bg-surface-2 hover:text-text-primary active:scale-95" gatilho={({ aberto }) => <><Icone size={16} /><span>{atual?.rotulo}</span><ChevronRight size={14} className={`transition-transform duration-200 ${aberto ? "rotate-90" : ""}`} /></>} /><button onClick={() => onNavegar(1)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface-1 text-text-muted transition-all hover:translate-x-0.5 hover:bg-surface-2 hover:text-text-primary active:scale-95" aria-label="Próximo período"><ChevronRight size={18} /></button><button onClick={(e) => onHoje(e.currentTarget)} className="rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary">Hoje</button><button onClick={onAbrirEvento} className="flex h-9 items-center gap-1.5 rounded-lg bg-steel-600 px-3 text-sm font-medium text-white transition-all hover:bg-steel-500 active:scale-95"><Plus size={16} />Evento</button></div>;
}

function VisaoMes({ desktop, modo, onMudarModo, onHoje, onNavegar, onAbrirEvento, diaAtual, hoje, itens, onMudarMes, onSelecionar, onPlanejarTarefa }: { desktop: boolean; modo: ModoAgenda; onMudarModo: (modo: ModoAgenda) => void; onHoje: (alvo: HTMLElement) => void; onNavegar: (direcao: number) => void; onAbrirEvento: () => void; diaAtual: Date; hoje: Date; itens: TarefaResumo[]; onMudarMes: (delta: number) => void; onSelecionar: (d: Date, alvo?: HTMLElement) => void; onPlanejarTarefa: (dado: string, data: Date) => void }) {
  const { offset, totalDias, ano, mes } = gerarDiasDoMes(diaAtual);
  const nomeMes = diaAtual.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  if (desktop) return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-base">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div><p className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">Calendário</p><h1 className="font-display text-2xl capitalize text-text-primary">{nomeMes}</h1></div>
        <AcoesAgenda modo={modo} onMudarModo={onMudarModo} onHoje={onHoje} onNavegar={onNavegar} onAbrirEvento={onAbrirEvento} />
      </div>
      <div className="grid grid-cols-7 border-b border-border bg-surface-1">
        {["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"].map((nome) => <div key={nome} className="border-r border-border px-3 py-2 text-xs font-medium text-text-muted last:border-r-0">{nome}</div>)}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 overflow-hidden">
        {Array.from({ length: 42 }, (_, indice) => {
          const numeroDoDia = indice - offset + 1;
          if (numeroDoDia < 1 || numeroDoDia > totalDias) return <div key={`vazio-${indice}`} className="border-b border-r border-border bg-surface-1 last:border-r-0" />;
          const data = new Date(ano, mes, numeroDoDia);
          const tarefasDoDia = itens.filter((item) => dataDaTarefa(item) === paraISO(data));
          const ativo = paraISO(data) === paraISO(diaAtual);
          const ehHoje = paraISO(data) === paraISO(hoje);
          return <button key={numeroDoDia} onClick={(e) => onSelecionar(data, e.currentTarget)} onDragOver={(e) => { if (e.dataTransfer.types.includes("application/x-ecos-task")) e.preventDefault(); }} onDrop={(e) => { const dado = e.dataTransfer.getData("application/x-ecos-task"); if (dado) { e.preventDefault(); onPlanejarTarefa(dado, data); } }} className={`group min-h-[84px] border-b border-r border-border p-2 text-left transition-colors duration-200 hover:bg-surface-1 ${ativo ? "bg-surface-2" : "bg-base"}`}>
            <span className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full text-sm ${ativo ? "bg-steel-500 font-semibold text-white" : ehHoje ? "bg-surface-2 font-semibold text-text-primary ring-1 ring-steel-400" : "text-text-secondary group-hover:bg-surface-2"}`}>{numeroDoDia}</span>{tarefasDoDia.slice(0, 2).map((tarefa) => <span key={tarefa.id} className={`mt-1 block truncate rounded px-1.5 py-0.5 text-[11px] font-medium ${tarefa.prioridade === "alta" ? "bg-error/15 text-error" : "bg-cyan/15 text-cyan"}`}>{tarefa.titulo}</span>)}{tarefasDoDia.length > 2 && <span className="mt-1 block text-[11px] text-text-muted">+{tarefasDoDia.length - 2} tarefas</span>}
          </button>;
        })}
      </div>
    </section>
  );

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <button onClick={() => onMudarMes(-1)} className="rounded-full p-1.5 text-text-muted hover:bg-surface-2" aria-label="Mês anterior">
          <ChevronLeft size={18} />
        </button>
        <h1 className="font-display text-xl capitalize text-text-primary">{nomeMes}</h1>
        <button onClick={() => onMudarMes(1)} className="rounded-full p-1.5 text-text-muted hover:bg-surface-2" aria-label="Próximo mês">
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="mb-4 grid grid-cols-7 gap-y-2 rounded-card bg-surface-1 p-3">
        {["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => (
          <div key={i} className="text-center text-xs font-medium text-text-muted">
            {d}
          </div>
        ))}
        {Array.from({ length: offset }).map((_, i) => (
          <div key={`vazio-${i}`} />
        ))}
        {Array.from({ length: totalDias }, (_, i) => i + 1).map((dia) => {
          const data = new Date(ano, mes, dia);
          const ativo = paraISO(data) === paraISO(diaAtual);
          const ehHoje = paraISO(data) === paraISO(hoje);
          return (
            <button
              key={dia}
              onClick={(e) => onSelecionar(data, e.currentTarget)}
              onDragOver={(e) => { if (e.dataTransfer.types.includes("application/x-ecos-task")) e.preventDefault(); }}
              onDrop={(e) => { const dado = e.dataTransfer.getData("application/x-ecos-task"); if (dado) { e.preventDefault(); onPlanejarTarefa(dado, data); } }}
              className={`mx-auto flex h-8 w-8 items-center justify-center rounded-full text-sm transition-colors hover:bg-steel-600/30 ${
                ativo ? "bg-steel-700 font-semibold text-white" : ehHoje ? "border border-steel-500 text-text-primary" : "text-text-secondary"
              }`}
            >
              {dia}
            </button>
          );
        })}
      </div>
    </>
  );
}

function VisaoSemana({ desktop, modo, onMudarModo, onHoje, diaAtual, hoje, onMudarSemana, onSelecionar }: { desktop: boolean; modo: ModoAgenda; onMudarModo: (modo: ModoAgenda) => void; onHoje: (alvo: HTMLElement) => void; diaAtual: Date; hoje: Date; onMudarSemana: (delta: number) => void; onSelecionar: (d: Date, alvo?: HTMLElement) => void }) {
  const inicio = inicioDaSemana(diaAtual);
  const dias = Array.from({ length: 7 }, (_, i) => somarDias(inicio, i));
  const rotulo = `${inicio.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} – ${somarDias(inicio, 6).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}`;

  if (desktop) return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-base">
      <div className="flex items-center justify-between border-b border-border px-5 py-4"><div><p className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">Calendário</p><h1 className="font-display text-2xl text-text-primary">{rotulo}</h1></div><AcoesAgenda modo={modo} onMudarModo={onMudarModo} onHoje={onHoje} /></div>
      <div key={paraISO(inicio)} className="agenda-calendario-entra grid min-h-0 flex-1 grid-cols-7 overflow-hidden">
        {dias.map((data) => { const ativo = paraISO(data) === paraISO(diaAtual); const ehHoje = paraISO(data) === paraISO(hoje); return <button key={paraISO(data)} onClick={(e) => onSelecionar(data, e.currentTarget)} className={`group min-h-[180px] border-r border-border p-3 text-left transition-colors duration-200 hover:bg-surface-1 last:border-r-0 ${ativo ? "bg-surface-2" : "bg-base"}`}><span className="block text-xs font-medium text-text-muted">{data.toLocaleDateString("pt-BR", { weekday: "long" })}</span><span className={`mt-2 flex h-8 w-8 items-center justify-center rounded-full text-sm ${ativo ? "bg-steel-500 font-semibold text-white" : ehHoje ? "bg-surface-2 font-semibold text-text-primary ring-1 ring-steel-400" : "text-text-secondary group-hover:bg-surface-2"}`}>{data.getDate()}</span></button>; })}
      </div>
    </section>
  );

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <button onClick={() => onMudarSemana(-1)} className="rounded-full p-1.5 text-text-muted hover:bg-surface-2" aria-label="Semana anterior">
          <ChevronLeft size={18} />
        </button>
        <h1 className="font-display text-lg text-text-primary">{rotulo}</h1>
        <button onClick={() => onMudarSemana(1)} className="rounded-full p-1.5 text-text-muted hover:bg-surface-2" aria-label="Próxima semana">
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="mb-4 grid grid-cols-7 gap-1 rounded-card bg-surface-1 p-3">
        {dias.map((data) => {
          const ativo = paraISO(data) === paraISO(diaAtual);
          const ehHoje = paraISO(data) === paraISO(hoje);
          return (
            <button key={paraISO(data)} onClick={(e) => onSelecionar(data, e.currentTarget)} className="flex flex-col items-center gap-1">
              <span className="text-[10px] font-medium uppercase text-text-muted">{data.toLocaleDateString("pt-BR", { weekday: "narrow" })}</span>
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm ${
                  ativo ? "bg-steel-700 font-semibold text-white" : ehHoje ? "border border-steel-500 text-text-primary" : "text-text-secondary"
                }`}
              >
                {data.getDate()}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function VisaoTempo({ desktop, modo, onMudarModo, onHoje, onNavegar, onAbrirEvento, diaAtual, hoje, onSelecionar, eventos, tarefas }: { desktop: boolean; modo: ModoAgenda; onMudarModo: (modo: ModoAgenda) => void; onHoje: (alvo: HTMLElement) => void; onNavegar: (direcao: number) => void; onAbrirEvento: () => void; diaAtual: Date; hoje: Date; onSelecionar: (d: Date, alvo?: HTMLElement) => void; eventos: { id: number; titulo: string; inicio: string; cor: string }[]; tarefas: TarefaResumo[] }) {
  const quantidade = modo === "dia" ? 1 : modo === "tres_dias" ? 3 : modo === "quinzenal" ? 14 : 7;
  const inicio = modo === "dia" || modo === "tres_dias" ? diaAtual : inicioDaSemana(diaAtual);
  const dias = Array.from({ length: quantidade }, (_, indice) => somarDias(inicio, indice));
  const rotulo = `${inicio.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} – ${somarDias(inicio, quantidade - 1).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}`;
  if (!desktop) return <VisaoSemana desktop={false} modo={modo} onMudarModo={onMudarModo} onHoje={onHoje} diaAtual={diaAtual} hoje={hoje} onMudarSemana={onNavegar} onSelecionar={onSelecionar} />;
  const horas = Array.from({ length: 24 }, (_, indice) => indice);
  const agora = new Date();
  const minutosAgora = agora.getHours() * 60 + agora.getMinutes();
  const tarefasSemHorario = (dia: Date) => tarefas.filter((tarefa) => !tarefa.scheduled_at && dataDaTarefa(tarefa) === paraISO(dia));
  const alturaDiaTodo = Math.max(44, ...dias.map((dia) => tarefasSemHorario(dia).length * 28 + 12));
  return <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-base"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><p className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">Calendário</p><h1 className="font-display text-2xl text-text-primary">{rotulo}</h1></div><AcoesAgenda modo={modo} onMudarModo={onMudarModo} onHoje={onHoje} onNavegar={onNavegar} onAbrirEvento={onAbrirEvento} /></div><div className="min-h-0 flex-1 overflow-auto"><div className="relative grid min-w-[680px]" style={{ gridTemplateColumns: `56px repeat(${quantidade}, minmax(120px, 1fr))` }}><div className="sticky left-0 top-0 z-30 border-b border-r border-border/35 bg-surface-1" />{dias.map((dia) => <button key={paraISO(dia)} onClick={(e) => onSelecionar(dia, e.currentTarget)} className="sticky top-0 z-20 border-b border-r border-border/35 bg-surface-1 px-3 py-2 text-left transition-colors hover:bg-surface-2"><span className="block text-xs font-medium capitalize text-text-muted">{dia.toLocaleDateString("pt-BR", { weekday: "short" })}</span><span className={`mt-1 flex h-7 w-7 items-center justify-center rounded-full text-sm ${paraISO(dia) === paraISO(hoje) ? "bg-steel-500 font-semibold text-white" : "text-text-primary"}`}>{dia.getDate()}</span></button>)}<div className="sticky left-0 top-[52px] z-30 border-b border-r border-border/35 bg-base pr-2 pt-2 text-right text-[10px] font-medium uppercase text-text-muted" style={{ height: alturaDiaTodo }}>O dia todo</div>{dias.map((dia) => <button key={`todo-${paraISO(dia)}`} onClick={(e) => onSelecionar(dia, e.currentTarget)} className="sticky top-[52px] z-20 flex flex-col gap-1 border-b border-r border-border/35 bg-base p-1.5 text-left hover:bg-surface-1" style={{ height: alturaDiaTodo }}>{tarefasSemHorario(dia).map((tarefa) => <span key={tarefa.id} className={`truncate rounded px-2 py-1 text-xs font-medium ${tarefa.prioridade === "alta" ? "bg-error/15 text-error" : "bg-cyan/15 text-cyan"}`}>{tarefa.titulo}</span>)}</button>)}{horas.flatMap((hora) => [<div key={`h-${hora}`} className="sticky left-0 z-10 h-16 border-b border-r border-border/35 bg-base pr-2 pt-1 text-right text-[11px] text-text-muted">{String(hora).padStart(2, "0")}:00</div>, ...dias.map((dia) => { const eventosDoDia = eventos.filter((evento) => evento.inicio === paraISO(dia)); const tarefasDaHora = tarefas.filter((tarefa) => tarefa.scheduled_at && dataDaTarefa(tarefa) === paraISO(dia) && new Date(tarefa.scheduled_at).getHours() === hora); return <button key={`${hora}-${paraISO(dia)}`} onClick={(e) => onSelecionar(dia, e.currentTarget)} className="flex h-16 flex-col gap-1 overflow-hidden border-b border-r border-border/35 bg-base p-1 text-left transition-colors hover:bg-surface-1">{hora === 9 && eventosDoDia.map((evento) => <span key={evento.id} className={`truncate rounded px-2 py-1 text-xs font-medium ${evento.cor}`}>{evento.titulo}</span>)}{tarefasDaHora.map((tarefa) => <span key={tarefa.id} className={`truncate rounded px-2 py-1 text-xs font-medium ${tarefa.prioridade === "alta" ? "bg-error/15 text-error" : "bg-cyan/15 text-cyan"}`}>{tarefa.titulo}</span>)}</button>; })])}<div className="pointer-events-none absolute left-[56px] right-0 z-0 flex items-center" style={{ top: 52 + alturaDiaTodo + (minutosAgora / 60) * 64 }}><span className="-ml-1 rounded bg-error px-1 py-0.5 text-[10px] font-semibold text-white">{agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span><span className="h-px flex-1 bg-error" /></div></div></div></section>;
}

function VisaoPeriodos({ modo, diaAtual, onMudarModo, onHoje, onNavegar, onAbrirEvento, onSelecionar }: { modo: ModoAgenda; diaAtual: Date; onMudarModo: (modo: ModoAgenda) => void; onHoje: (alvo: HTMLElement) => void; onNavegar: (direcao: number) => void; onAbrirEvento: () => void; onSelecionar: (d: Date, alvo?: HTMLElement) => void }) {
  const meses = Array.from({ length: modo === "anual" ? 12 : 6 }, (_, indice) => new Date(diaAtual.getFullYear(), (modo === "anual" ? 0 : diaAtual.getMonth()) + indice, 1));
  return <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-base"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><p className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">Calendário</p><h1 className="font-display text-2xl text-text-primary">{modo === "anual" ? diaAtual.getFullYear() : "Próximos 6 meses"}</h1></div><AcoesAgenda modo={modo} onMudarModo={onMudarModo} onHoje={onHoje} onNavegar={onNavegar} onAbrirEvento={onAbrirEvento} /></div><div className="grid flex-1 grid-cols-3 gap-px bg-border p-px lg:grid-cols-4">{meses.map((mes) => <button key={paraISO(mes)} onClick={(e) => onSelecionar(mes, e.currentTarget)} className="bg-base p-4 text-left transition-colors hover:bg-surface-1"><h2 className="font-medium capitalize text-text-primary">{mes.toLocaleDateString("pt-BR", { month: "long" })}</h2><p className="mt-2 text-sm text-text-muted">Ver agenda do mês</p></button>)}</div></section>;
}

function VisaoDia({ desktop, modo, onMudarModo, onHoje, onNavegar, onAbrirEvento, hoje, diaAtual, onMudarDia, onSelecionar }: { desktop: boolean; modo: ModoAgenda; onMudarModo: (modo: ModoAgenda) => void; onHoje: (alvo: HTMLElement) => void; onNavegar: (direcao: number) => void; onAbrirEvento: () => void; hoje: Date; diaAtual: Date; onMudarDia: (delta: number) => void; onSelecionar: (d: Date, alvo?: HTMLElement) => void }) {
  const rotulo = diaAtual.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
  if (desktop) return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-base"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><p className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">Calendário</p><h1 className="font-display text-2xl capitalize text-text-primary">{rotulo}</h1></div><AcoesAgenda modo={modo} onMudarModo={onMudarModo} onHoje={onHoje} onNavegar={onNavegar} onAbrirEvento={onAbrirEvento} /></div><button onClick={(e) => onSelecionar(diaAtual, e.currentTarget)} className="agenda-calendario-entra group min-h-[280px] flex-1 p-5 text-left transition-colors duration-200 hover:bg-surface-1"><span className="text-xs font-medium uppercase tracking-wide text-text-muted">{diaAtual.toLocaleDateString("pt-BR", { weekday: "long" })}</span><span className={`mt-3 flex h-10 w-10 items-center justify-center rounded-full text-base ${paraISO(diaAtual) === paraISO(hoje) ? "bg-steel-500 font-semibold text-white" : "bg-surface-2 text-text-primary group-hover:bg-steel-700"}`}>{diaAtual.getDate()}</span><p className="mt-6 text-sm text-text-muted">Clique para ver as tarefas deste dia</p></button></section>
  );
  return (
    <div className="mb-4 flex items-center justify-between rounded-card bg-surface-1 p-3">
      <button onClick={() => onMudarDia(-1)} className="rounded-full p-1.5 text-text-muted hover:bg-surface-2" aria-label="Dia anterior">
        <ChevronLeft size={18} />
      </button>
      <h1 className="font-display text-lg capitalize text-text-primary">{rotulo}</h1>
      <button onClick={() => onMudarDia(1)} className="rounded-full p-1.5 text-text-muted hover:bg-surface-2" aria-label="Próximo dia">
        <ChevronRight size={18} />
      </button>
    </div>
  );
}

type AbrirDocumento = (path: string, evento?: MouseEvent<HTMLElement>) => void;

function CriadorEvento({ dia, onFechar, onCriar }: { dia: Date; onFechar: () => void; onCriar: (evento: { titulo: string; inicio: string; cor: string }) => void }) {
  const [titulo, setTitulo] = useState("");
  const [cor, setCor] = useState("bg-cyan/20 text-cyan");
  return <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/35 p-5"><form onSubmit={(e) => { e.preventDefault(); if (titulo.trim()) onCriar({ titulo: titulo.trim(), inicio: paraISO(dia), cor }); }} className="ecos-fade-in w-full max-w-md rounded-xl border border-border bg-base shadow-nav"><header className="flex items-center justify-between border-b border-border bg-surface-1 px-5 py-4"><div><p className="text-xs font-medium uppercase tracking-wide text-text-muted">Novo evento</p><h2 className="font-display text-xl text-text-primary">{dia.toLocaleDateString("pt-BR", { dateStyle: "long" })}</h2></div><button type="button" onClick={onFechar} className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-2"><X size={17} /></button></header><div className="space-y-4 p-5"><label className="block text-sm font-medium text-text-secondary">Título<input autoFocus value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Reunião de planejamento" className="ecos-input mt-1.5 w-full" /></label><div><p className="mb-2 text-sm font-medium text-text-secondary">Cor</p><div className="flex gap-2">{[{ nome: "Ciano", valor: "bg-cyan/20 text-cyan" }, { nome: "Verde", valor: "bg-success/20 text-success" }, { nome: "Amarelo", valor: "bg-warning/20 text-warning" }, { nome: "Vermelho", valor: "bg-error/20 text-error" }].map((item) => <button key={item.nome} type="button" onClick={() => setCor(item.valor)} className={`h-8 w-8 rounded-full ${item.valor.split(" ")[0]} ${cor === item.valor ? "ring-2 ring-white ring-offset-2 ring-offset-base" : ""}`} aria-label={item.nome} />)}</div></div><p className="rounded-lg border border-border bg-surface-1 p-3 text-xs text-text-muted">Criação visual nesta etapa: o evento ficará apenas nesta sessão até a integração do backend.</p></div><footer className="flex justify-end gap-2 border-t border-border px-5 py-3"><button type="button" onClick={onFechar} className="rounded-lg px-3 py-2 text-sm text-text-secondary hover:bg-surface-2">Cancelar</button><button type="submit" className="flex items-center gap-1.5 rounded-lg bg-steel-600 px-3 py-2 text-sm font-medium text-white hover:bg-steel-500"><CalendarPlus size={16} />Criar evento</button></footer></form></div>;
}

function ListaDeTarefas({ blocos, abrirDocumento }: { blocos: TarefaResumo[] | null; abrirDocumento: AbrirDocumento }) {
  return (
    <div className="flex flex-col gap-2.5">
      {blocos === null ? <p className="py-10 text-center text-sm text-text-muted">Carregando...</p> : blocos.length === 0 ? (
        <EmptyState icon={CalendarClock} title="Dia livre." subtitle="Sem blocos encaixados — aproveite ou capture algo novo." />
      ) : blocos.slice().sort((a, b) => (a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? "")).map((t) => <CartaoTarefa key={t.id} tarefa={t} abrirDocumento={abrirDocumento} />)}
    </div>
  );
}

function CartaoTarefa({ tarefa, abrirDocumento }: { tarefa: TarefaResumo; abrirDocumento: AbrirDocumento }) {
  const hora = tarefa.scheduled_at ? new Date(tarefa.scheduled_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "sem horário";
  const concluida = tarefa.status === "concluida";
  return (
    <button onClick={(e) => abrirDocumento(`/tarefa/${tarefa.id}`, e)} className={`flex items-center gap-3 rounded-2xl border-l-4 bg-surface-1 p-3.5 text-left ${concluida ? "border-success" : tarefa.prioridade === "alta" ? "border-error" : "border-cyan"}`}>
      {concluida ? <CheckCircle2 size={18} strokeWidth={1.75} className="shrink-0 text-success" /> : <ListChecks size={18} strokeWidth={1.75} className="shrink-0 text-cyan" />}
      <div className="min-w-0 flex-1"><p className={`truncate text-[15px] font-medium ${concluida ? "text-text-muted line-through" : "text-text-primary"}`}>{tarefa.titulo}</p><p className="font-mono-value text-xs text-text-muted">{hora} {tarefa.duration_min ? `· ${formatDuracao(tarefa.duration_min)}` : ""}</p></div>
    </button>
  );
}

function PopupTarefas({ ancora, dia, blocos, capacidade, semRotina, erro, pendentes, onFechar, onAjustarRotina, abrirDocumento }: { ancora: AncoraPopup | null; dia: Date; blocos: TarefaResumo[] | null; capacidade: Capacidade | null; semRotina: boolean; erro: string | null; pendentes: number; onFechar: () => void; onAjustarRotina: () => void; abrirDocumento: AbrirDocumento }) {
  const titulo = dia.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
  const janelaRef = useRef<HTMLElement>(null);
  const [fixado, setFixado] = useState(false);
  const [interagindo, setInteragindo] = useState(false);
  const [animarEntrada, setAnimarEntrada] = useState(false);
  const [rect, setRect] = useState({ left: 16, top: 16, width: 360, height: 500 });
  const gesto = useRef<{ tipo: "mover" | "redimensionar"; x: number; y: number; rect: typeof rect } | null>(null);

  useLayoutEffect(() => {
    if (fixado) return;
    const pai = janelaRef.current?.parentElement?.getBoundingClientRect();
    if (!pai) return;
    const margem = 12;
    const largura = Math.max(0, Math.min(380, pai.width - margem * 2));
    const altura = Math.max(0, Math.min(540, pai.height - margem * 2));
    const limiteEsquerda = Math.max(margem, pai.width - largura - margem);
    // Alinhado à coluna clicada: centralizar o painel deslocava o foco visual
    // para longe do dia que originou a ação.
    const esquerda = ancora ? Math.min(Math.max(margem, ancora.left), limiteEsquerda) : limiteEsquerda;
    const cabeAbaixo = !!ancora && ancora.top + ancora.height + altura + margem <= pai.height;
    const topoDesejado = ancora ? (cabeAbaixo ? ancora.top + ancora.height + 10 : ancora.top - altura - 10) : 56;
    const topo = Math.min(Math.max(margem, topoDesejado), Math.max(margem, pai.height - altura - margem));
    setRect({ left: esquerda, top: topo, width: largura, height: altura });
  }, [ancora, dia, fixado]);

  // A posição contextual precisa estar aplicada antes da primeira animação;
  // caso contrário o browser usa a posição inicial (canto do painel) como origem.
  useEffect(() => {
    const quadro = requestAnimationFrame(() => setAnimarEntrada(true));
    return () => cancelAnimationFrame(quadro);
  }, []);

  function iniciar(e: PointerEvent<HTMLElement>, tipo: "mover" | "redimensionar") {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    gesto.current = { tipo, x: e.clientX, y: e.clientY, rect };
    setInteragindo(true);
  }
  function mover(e: PointerEvent<HTMLElement>) {
    const inicio = gesto.current;
    const pai = janelaRef.current?.parentElement?.getBoundingClientRect();
    if (!inicio || !pai) return;
    const dx = e.clientX - inicio.x;
    const dy = e.clientY - inicio.y;
    const margem = 12;
    if (inicio.tipo === "mover") setRect({ ...inicio.rect, left: Math.min(Math.max(margem, inicio.rect.left + dx), Math.max(margem, pai.width - inicio.rect.width - margem)), top: Math.min(Math.max(margem, inicio.rect.top + dy), Math.max(margem, pai.height - inicio.rect.height - margem)) });
    else setRect({ ...inicio.rect, width: Math.min(Math.max(Math.min(300, pai.width - inicio.rect.left - margem), inicio.rect.width + dx), pai.width - inicio.rect.left - margem), height: Math.min(Math.max(Math.min(300, pai.height - inicio.rect.top - margem), inicio.rect.height + dy), pai.height - inicio.rect.top - margem) });
  }
  function encerrar() { gesto.current = null; setInteragindo(false); }
  const origemX = ancora ? Math.min(100, Math.max(0, ((ancora.left + ancora.width / 2 - rect.left) / Math.max(1, rect.width)) * 100)) : 50;
  const origemY = ancora && ancora.top < rect.top ? "0%" : ancora ? "100%" : "50%";

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      <section ref={janelaRef} role="dialog" aria-modal="false" aria-label={`Tarefas de ${titulo}`} className={`${animarEntrada ? "agenda-popup-entra" : "opacity-0"} pointer-events-auto absolute flex flex-col overflow-hidden rounded-xl border bg-base shadow-nav ${interagindo ? "border-cyan/70" : "border-border"} ${interagindo ? "" : "transition-[left,top,width,height] duration-200 ease-out"}`} style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height, transformOrigin: `${origemX}% ${origemY}` }}>
        <header onPointerDown={(e) => { if (!(e.target as HTMLElement).closest("button")) iniciar(e, "mover"); }} onPointerMove={mover} onPointerUp={encerrar} onPointerCancel={encerrar} className={`flex shrink-0 items-center justify-between border-b border-border bg-surface-1 px-3 py-2 ${interagindo ? "cursor-grabbing" : "cursor-grab"}`}><div className="min-w-0"><p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Agenda</p><h2 className="truncate font-display text-base capitalize text-text-primary">{titulo}</h2></div><div className="flex gap-1"><button type="button" onClick={() => setFixado((valor) => !valor)} title={fixado ? "Desafixar do calendário" : "Fixar posição"} aria-label={fixado ? "Desafixar" : "Fixar"} className={`flex h-8 w-8 items-center justify-center rounded-md ${fixado ? "bg-steel-700 text-white" : "text-text-muted hover:bg-surface-2"}`}><Pin size={15} /></button><button type="button" onClick={onFechar} aria-label="Fechar tarefas" className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text-primary"><X size={17} /></button></div></header>
        <div className="min-h-0 overflow-y-auto p-5">
          {semRotina && <button onClick={onAjustarRotina} className="mb-4 flex w-full items-start gap-3 rounded-xl border border-steel-400/40 bg-steel-700/15 p-3 text-left text-sm text-text-primary"><CalendarClock size={18} className="shrink-0 text-steel-300" />Você ainda não contou sobre a sua rotina. <span className="font-semibold text-steel-300">Ajustar rotina</span></button>}
          {erro && <div className="mb-4 flex gap-2 rounded-xl border border-error/40 bg-error/10 p-3 text-sm text-error"><AlertTriangle size={16} className="shrink-0" />{erro}</div>}
          {capacidade?.estourado && <div className="mb-4 flex gap-3 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-text-primary"><AlertTriangle size={18} className="shrink-0 text-warning" /><p>{pendentes} {pendentes === 1 ? "tarefa soma" : "tarefas somam"} {formatDuracao(capacidade.consumido_tarefas_min)}, mas o dia só tem {formatDuracao(capacidade.disponivel_producao_total_min !== undefined ? Math.max(0, capacidade.disponivel_producao_total_min - capacidade.consumido_eventos_externos_min) : capacidade.consumido_tarefas_min)} de produção disponível.</p></div>}
          <ListaDeTarefas blocos={blocos} abrirDocumento={abrirDocumento} />
        </div>
        <div aria-hidden onPointerDown={(e) => iniciar(e, "redimensionar")} onPointerMove={mover} onPointerUp={encerrar} onPointerCancel={encerrar} className="absolute bottom-0 right-0 h-5 w-5 cursor-nwse-resize" />
      </section>
    </div>
  );
}
