import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { useEventosLocais, type EventoLocal } from "@/lib/eventos-locais";
import { useAbrirDocumento } from "@/lib/documento-popup";
import { AlertTriangle, ListChecks, CheckCircle2, ChevronLeft, ChevronRight, Pin, X, CalendarDays, CalendarRange, CalendarPlus, Columns3, Flag, LayoutGrid, PanelTop, Plus, Sun } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { agenda as agendaApi, tarefas as tarefasApi, rotina as rotinaApi, ApiError, type BlocoPlanejado, type PrioridadeTarefa, type TarefaResumo } from "@/lib/api";
import { formatDuracao } from "@/lib/format";
import { EmptyState } from "@/components/common/EmptyState";
import { CalendarClock } from "lucide-react";
import { useRefreshBus } from "@/lib/refresh-bus";
import { useIsDesktop } from "@/lib/use-viewport";
import { MenuSuspenso, TOM, type OpcaoMenu } from "@/components/common/MenuSuspenso";
import { ENCAIXE_PADRAO, HORA_PADRAO_MIN, OPCOES_ENCAIXE, aplicarPayloadNoBloco, dataLocalISO, duracaoParaAlocar, instanteLocalISO, itensDaTarefa, itemDoBloco, meioDiaLocal, payloadDoBloco, somarDiasISO, type ItemAgenda, type PayloadBloco, type Posicao } from "@/lib/agenda-tempo";
import { useOuvirArrasteTarefa, type TarefaArrastavel } from "@/lib/arraste-tarefa";
import { usePreferenciasCalendario } from "@/lib/preferencias-calendario";
import { AlocarTempoDialog } from "./AlocarTempoDialog";
import { useEdicaoOtimista } from "@/lib/agenda-otimista";
import { GradeTempo } from "./GradeTempo";
import { EditorEvento } from "./EditorEvento";

type ModoAgenda = "dia" | "tres_dias" | "semana" | "quinzenal" | "mes" | "seis_meses" | "anual";
type AncoraPopup = { left: number; top: number; width: number; height: number };

const CHAVE_CACHE_AGENDA = "ecos:agenda:visualizacao";
const CHAVE_ENCAIXE = "ecos:agenda:encaixe";

/** Dia LOCAL (`YYYY-MM-DD`). Nunca o dia em UTC: à noite no Brasil ele já é o dia seguinte e a tarefa cairia na coluna errada. */
function paraISO(d: Date) {
  return dataLocalISO(d);
}

function lerEncaixe(): number {
  try {
    const salvo = Number(localStorage.getItem(CHAVE_ENCAIXE));
    return (OPCOES_ENCAIXE as readonly number[]).includes(salvo) ? salvo : ENCAIXE_PADRAO;
  } catch {
    return ENCAIXE_PADRAO;
  }
}

function itemDoEvento(e: EventoLocal): ItemAgenda {
  return { chave: `evento:${e.id}`, tipo: "evento", id: String(e.id), titulo: e.titulo, dia: e.inicio, inicioMin: e.minutos, duracaoMin: e.duracaoMin, classe: e.corHex ? "" : e.cor, corHex: e.corHex, concluida: false };
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
  const [pedidoAgora, setPedidoAgora] = useState(0);
  const hoje = new Date();
  // No desktop, clicar num dia só abre o popup dele: o período que está na tela (diaAtual) não se move.
  const [diaPopup, setDiaPopup] = useState(estadoInicial.dia);
  const diaFoco = desktop ? diaPopup : diaAtual;
  const dataStr = paraISO(diaFoco);
  const dataPeriodo = paraISO(diaAtual);
  // Ao trocar de mês/semana/etc. a visão desliza para o lado de onde o período veio; ao trocar de modo, ela "acomoda" (sem remontar: a grade mantém a rolagem).
  const areaRef = useRef<HTMLDivElement>(null);
  const periodoDe = limitesDoPeriodo(modo, diaAtual).de;
  const periodoAnterior = useRef({ modo, de: periodoDe });
  useEffect(() => {
    const antes = periodoAnterior.current;
    periodoAnterior.current = { modo, de: periodoDe };
    if (antes.modo === modo && antes.de === periodoDe) return;
    const el = areaRef.current;
    if (!el || typeof el.animate !== "function" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const sentido = antes.modo !== modo ? 0 : periodoDe > antes.de ? 1 : -1;
    const curva = "cubic-bezier(0.2, 0.7, 0.25, 1)";
    el.animate(
      sentido === 0 ? [{ opacity: 0, transform: "scale(0.97)" }, { opacity: 1, transform: "scale(1)" }] : [{ opacity: 0, transform: `translateX(${sentido * 40}px)` }, { opacity: 1, transform: "translateX(0)" }],
      { duration: 280, easing: curva },
    );
    // Cada dia (célula do mês, coluna da grade, mês da visão anual) entra em cascata, do lado de onde veio o período.
    const partes = [...el.querySelectorAll<HTMLElement>("[data-dia-mes], [data-cabecalho-dia], [data-mini-mes]")];
    const colunas = sentido < 0 ? partes.length : 0;
    partes.forEach((parte, i) => {
      const ordem = sentido < 0 ? colunas - 1 - i : i;
      parte.animate(
        [{ opacity: 0, transform: sentido === 0 ? "translateY(8px) scale(0.94)" : `translateX(${sentido * 14}px) scale(0.94)` }, { opacity: 1, transform: "none" }],
        { duration: 320, delay: Math.min(ordem * 14, 320), easing: curva, fill: "backwards" },
      );
    });
  }, [modo, periodoDe]);

  const [blocos, setBlocos] = useState<TarefaResumo[] | null>(null);
  const [itensDoPeriodo, setItensDoPeriodo] = useState<TarefaResumo[]>([]);
  /** Tempo alocado a tarefas no calendário (blocos). Não confundir com `blocos`, a lista de tarefas do dia do popup. */
  const [blocosDeTempo, setBlocosDeTempo] = useState<BlocoPlanejado[]>([]);
  const [alocarAberto, setAlocarAberto] = useState(false);
  // Preferências de Configurações → Calendário: início do dia (rolagem inicial) e prazos. Reagem ao salvar, sem recarregar.
  const { inicioMin, mostrarPrazos } = usePreferenciasCalendario();
  const [capacidade, setCapacidade] = useState<Capacidade | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const navigate = useNavigate();
  const [semRotina, setSemRotina] = useState(false);
  const [tarefasAbertas, setTarefasAbertas] = useState(false);
  const [ancoraPopup, setAncoraPopup] = useState<AncoraPopup | null>(null);
  const [criadorEventoAberto, setCriadorEventoAberto] = useState(false);
  const [eventosLocais, setEventosLocais] = useEventosLocais();
  const [eventoEmEdicao, setEventoEmEdicao] = useState<EventoLocal | null>(null);
  const abrirItemAgenda = (item: ItemAgenda, e: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => {
    if (item.tipo === "tarefa" || item.tipo === "prazo") abrirDocumento(`/tarefa/${item.id}`, e.type === "click" ? (e as MouseEvent<HTMLElement>) : undefined);
    else if (item.tipo === "evento") setEventoEmEdicao(eventosLocais.find((ev) => String(ev.id) === item.id) ?? null);
  };
  useEffect(() => { rotinaApi.listar().then((b) => setSemRotina(b.length === 0)).catch(() => setSemRotina(false)); }, [versao]);

  // A escolha de Mês/Semana/Dia é uma preferência de trabalho, não uma
  // configuração temporária da tela. Mantemos também o dia de referência
  // para que, ao voltar à Agenda, a pessoa retome exatamente o contexto.
  useEffect(() => {
    try {
      localStorage.setItem(CHAVE_CACHE_AGENDA, JSON.stringify({ modo, dia: paraISO(diaAtual) }));
    } catch { /* cache indisponível */ }
  }, [modo, diaAtual]);

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
    // Nas visões de tempo busca 1 dia a mais de cada lado: o corte de dia do servidor usa o fuso de um único dia (horário de verão!) e a grade refiltra no fuso local.
    const comMargem = modo === "dia" || modo === "tres_dias" || modo === "semana" || modo === "quinzenal";
    tarefasApi.listar({ data_de: comMargem ? somarDiasISO(de, -1) : de, data_ate: comMargem ? somarDiasISO(ate, 1) : ate, tz, limit: 500 }).then((resultado) => { if (vivo) setItensDoPeriodo(resultado.items); }).catch(() => { if (vivo) setItensDoPeriodo([]); });
    return () => { vivo = false; };
  }, [modo, dataPeriodo, versao]);

  // Blocos de tempo do período (só as visões de horário os desenham). Mesma margem de 1 dia: o corte de dia do servidor usa o fuso de um único dia.
  useEffect(() => {
    const tempo = modo === "dia" || modo === "tres_dias" || modo === "semana" || modo === "quinzenal";
    if (!tempo) { setBlocosDeTempo([]); return; }
    let vivo = true;
    const { de, ate } = limitesDoPeriodo(modo, diaAtual);
    const [ano, mes, dia] = de.split("-").map(Number);
    const tz = -new Date(ano, mes - 1, dia, 12).getTimezoneOffset();
    agendaApi.blocos({ data_de: somarDiasISO(de, -1), data_ate: somarDiasISO(ate, 1), tz }).then((b) => { if (vivo) setBlocosDeTempo(b); }).catch(() => { if (vivo) setBlocosDeTempo([]); });
    return () => { vivo = false; };
  }, [modo, dataPeriodo, versao]);

  const [encaixe, setEncaixe] = useState(lerEncaixe);
  useEffect(() => {
    try { localStorage.setItem(CHAVE_ENCAIXE, String(encaixe)); } catch { /* preferência não salva */ }
  }, [encaixe]);
  const [avisoMover, setAvisoMover] = useState<string | null>(null);
  useEffect(() => {
    if (!avisoMover) return;
    const t = window.setTimeout(() => setAvisoMover(null), 7000);
    return () => window.clearTimeout(t);
  }, [avisoMover]);

  // A Agenda NUNCA muda a data de uma tarefa: arrastar aloca TEMPO (um bloco) e mover/redimensionar mexe só no bloco.
  // A grade muda na hora, o `PATCH .../time-entries/:id` vai depois e, se falhar, tudo volta e a pessoa é avisada.
  const blocosRef = useRef(blocosDeTempo);
  blocosRef.current = blocosDeTempo;
  const { editar: editarBloco } = useEdicaoOtimista<BlocoPlanejado, PayloadBloco>({
    itens: blocosDeTempo,
    setItens: setBlocosDeTempo,
    salvar: (id, payload) => {
      const bloco = blocosRef.current.find((b) => b.id === id);
      return bloco ? tarefasApi.timeEntries.atualizar(bloco.tarefa_id, id, payload) : Promise.reject(new Error("bloco não encontrado"));
    },
    aplicar: aplicarPayloadNoBloco,
    aoConfirmar: notificar,
    aoFalhar: (e) => setAvisoMover(e instanceof ApiError ? `${e.message} A mudança foi desfeita.` : "Não foi possível salvar a mudança. Ela foi desfeita."),
    atrasoMs: 350,
  });

  function moverItem(item: ItemAgenda, destino: Posicao, origem: "ponteiro" | "teclado" | "menu") {
    if (item.tipo === "evento") {
      setEventosLocais((atuais: EventoLocal[]) => atuais.map((e) => (String(e.id) === item.id ? { ...e, inicio: destino.dia, minutos: destino.inicioMin, duracaoMin: destino.duracaoMin } : e)));
      return;
    }
    if (item.tipo !== "bloco") return; // tarefa com data própria: a Agenda não a move
    // Teclas em sequência juntam-se num único salvamento; gesto de ponteiro e menu salvam na hora.
    editarBloco(item.id, payloadDoBloco({ dia: item.dia, inicioMin: item.inicioMin, duracaoMin: item.duracaoMin }, destino), { imediato: origem !== "teclado" });
  }

  /** Uma tarefa foi solta no calendário (arrasto ou diálogo): reserva `destino.duracaoMin` de tempo. A tarefa em si não muda. */
  async function alocarTarefa(tarefa: TarefaArrastavel, destino: Posicao) {
    if (destino.inicioMin === null) return;
    const inicio = instanteLocalISO(destino.dia, destino.inicioMin);
    const provisorio: BlocoPlanejado = {
      id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, tarefa_id: tarefa.id, tipo: "planejado", inicio_em: inicio, duracao_min: destino.duracaoMin, foco: "",
      titulo: tarefa.titulo, status: "pendente", prioridade: (tarefa.prioridade as PrioridadeTarefa | undefined) ?? "baixa", tarefa_duration_min: tarefa.duracaoMin,
    };
    setBlocosDeTempo((atuais) => [...atuais, provisorio]);
    try {
      await tarefasApi.timeEntries.criar(tarefa.id, { tipo: "planejado", inicio_em: inicio, duracao_min: destino.duracaoMin });
      notificar();
    } catch (e) {
      setBlocosDeTempo((atuais) => atuais.filter((b) => b.id !== provisorio.id));
      setAvisoMover(e instanceof ApiError ? `${e.message} O tempo não foi alocado.` : "Não foi possível alocar o tempo. Nada foi alterado.");
    }
  }

  /** Solta no mês: sem horário para escolher, o tempo cai às 09:00 daquele dia (dá para arrastar o bloco depois). */
  function alocarNoDia(tarefa: TarefaArrastavel, dia: string) {
    void alocarTarefa(tarefa, { dia, inicioMin: HORA_PADRAO_MIN, duracaoMin: duracaoParaAlocar(tarefa.duracaoMin) });
  }

  async function removerBloco(item: ItemAgenda) {
    const bloco = blocosRef.current.find((b) => b.id === item.id);
    if (!bloco) return;
    setBlocosDeTempo((atuais) => atuais.filter((b) => b.id !== bloco.id));
    try {
      await tarefasApi.timeEntries.excluir(bloco.tarefa_id, bloco.id);
      notificar();
    } catch (e) {
      setBlocosDeTempo((atuais) => (atuais.some((b) => b.id === bloco.id) ? atuais : [...atuais, bloco]));
      setAvisoMover(e instanceof ApiError ? `${e.message} O bloco voltou.` : "Não foi possível remover o bloco. Ele voltou.");
    }
  }

  const ehHojeFn = (d: Date) => paraISO(d) === paraISO(hoje);
  const pendentes = blocos?.filter((b) => b.status === "pendente").length ?? 0;
  const selecionarDia = (data: Date, alvo?: HTMLElement) => {
    if (!desktop) setDiaAtual(data);
    else {
      setDiaPopup(data);
      const pai = agendaRef.current?.getBoundingClientRect();
      const retangulo = alvo?.getBoundingClientRect();
      if (pai && retangulo) setAncoraPopup({ left: retangulo.left - pai.left, top: retangulo.top - pai.top, width: retangulo.width, height: retangulo.height });
      setTarefasAbertas(true);
    }
  };
  // "Hoje" é igual em todas as visões: se o período visível já contém hoje, abre o popup do dia; senão navega até o período
  // certo e (nas visões de tempo) rola a grade até o horário atual.
  const irParaHoje = (alvo: HTMLElement) => {
    const { de, ate } = limitesDoPeriodo(modo, diaAtual);
    const hojeISO = paraISO(hoje);
    if (hojeISO >= de && hojeISO <= ate) selecionarDia(hoje, alvo);
    else { setDiaAtual(hoje); setTarefasAbertas(false); setPedidoAgora((n) => n + 1); }
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

      <div ref={areaRef} className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {modo === "mes" && (
        <VisaoMes desktop={desktop} modo={modo} onMudarModo={setModo} onHoje={irParaHoje} onNavegar={navegarPeriodo} onAbrirEvento={() => setCriadorEventoAberto(true)} diaAtual={diaAtual} hoje={hoje} itens={itensDoPeriodo} onMudarMes={(delta) => setDiaAtual((d) => new Date(d.getFullYear(), d.getMonth() + delta, Math.min(d.getDate(), 28)))} onSelecionar={selecionarDia} onAlocarTarefa={alocarNoDia} mostrarPrazos={mostrarPrazos} onAlocar={() => setAlocarAberto(true)} />
      )}
      {(modo === "tres_dias" || modo === "semana" || modo === "quinzenal") && (
        <VisaoTempo pedidoAgora={pedidoAgora} desktop={desktop} modo={modo} onMudarModo={setModo} onHoje={irParaHoje} onNavegar={navegarPeriodo} onAbrirEvento={() => setCriadorEventoAberto(true)} diaAtual={diaAtual} hoje={hoje} onSelecionar={selecionarDia} eventos={eventosLocais} tarefas={itensDoPeriodo} blocos={blocosDeTempo} inicioMin={inicioMin} mostrarPrazos={mostrarPrazos} onRemoverItem={removerBloco} onAlocarTarefa={alocarTarefa} onAlocar={() => setAlocarAberto(true)} encaixe={encaixe} onMudarEncaixe={setEncaixe} onMoverItem={moverItem} onAbrirItem={abrirItemAgenda} />
      )}
      {modo === "dia" && (desktop ? <VisaoTempo pedidoAgora={pedidoAgora} desktop modo={modo} onMudarModo={setModo} onHoje={irParaHoje} onNavegar={navegarPeriodo} onAbrirEvento={() => setCriadorEventoAberto(true)} diaAtual={diaAtual} hoje={hoje} onSelecionar={selecionarDia} eventos={eventosLocais} tarefas={itensDoPeriodo} blocos={blocosDeTempo} inicioMin={inicioMin} mostrarPrazos={mostrarPrazos} onRemoverItem={removerBloco} onAlocarTarefa={alocarTarefa} onAlocar={() => setAlocarAberto(true)} encaixe={encaixe} onMudarEncaixe={setEncaixe} onMoverItem={moverItem} onAbrirItem={abrirItemAgenda} /> :
        <VisaoDia desktop={false} modo={modo} onMudarModo={setModo} onHoje={irParaHoje} onNavegar={navegarPeriodo} onAbrirEvento={() => setCriadorEventoAberto(true)} hoje={hoje} diaAtual={diaAtual} onMudarDia={(delta) => setDiaAtual((d) => somarDias(d, delta))} onSelecionar={selecionarDia} />
      )}
      {(modo === "seis_meses" || modo === "anual") && <VisaoPeriodos modo={modo} diaAtual={diaAtual} onMudarModo={setModo} onHoje={irParaHoje} onNavegar={navegarPeriodo} onAbrirEvento={() => setCriadorEventoAberto(true)} onSelecionar={selecionarDia} />}
      </div>

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
      {desktop && tarefasAbertas && <PopupTarefas key={`${modo}-${dataStr}`} ancora={ancoraPopup} dia={diaFoco} blocos={blocos} capacidade={capacidade} semRotina={semRotina} erro={erro} pendentes={pendentes} onFechar={() => setTarefasAbertas(false)} onAjustarRotina={() => navigate("/perfil/rotina")} abrirDocumento={abrirDocumento} />}
      {desktop && avisoMover && (
        <div role="alert" className="ecos-fade-in absolute left-1/2 top-3 z-40 flex max-w-[90%] -translate-x-1/2 items-start gap-2 rounded-xl border border-error/40 bg-base px-4 py-3 text-sm text-error shadow-nav">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{avisoMover}</span>
          <button type="button" onClick={() => setAvisoMover(null)} aria-label="Dispensar aviso" className="ml-1 rounded p-0.5 text-text-muted hover:bg-surface-2"><X size={14} /></button>
        </div>
      )}
      {desktop && alocarAberto && <AlocarTempoDialog encaixe={encaixe} onFechar={() => setAlocarAberto(false)} onAlocar={(tarefa, destino) => { setAlocarAberto(false); void alocarTarefa(tarefa, destino); }} />}
      {criadorEventoAberto && <EditorEvento dia={diaAtual} eventos={eventosLocais} passoMin={encaixe} onFechar={() => setCriadorEventoAberto(false)} onSalvar={(dados) => { setEventosLocais((anteriores: EventoLocal[]) => [...anteriores, { ...dados, id: Date.now() }]); setCriadorEventoAberto(false); }} />}
      {eventoEmEdicao && <EditorEvento key={eventoEmEdicao.id} dia={diaAtual} evento={eventoEmEdicao} eventos={eventosLocais} passoMin={encaixe} onFechar={() => setEventoEmEdicao(null)} onSalvar={(dados) => { setEventosLocais((anteriores: EventoLocal[]) => anteriores.map((ev) => ev.id === eventoEmEdicao.id ? { ...ev, ...dados } : ev)); setEventoEmEdicao(null); }} onExcluir={() => { setEventosLocais((anteriores: EventoLocal[]) => anteriores.filter((ev) => ev.id !== eventoEmEdicao.id)); setEventoEmEdicao(null); }} />}
    </div>
  );
}

const PERIODOS: OpcaoMenu<ModoAgenda>[] = [
  { valor: "dia", rotulo: "Dia", icone: Sun, cor: TOM.alerta }, { valor: "tres_dias", rotulo: "3 dias", icone: Columns3, cor: TOM.ciano },
  { valor: "semana", rotulo: "Semana", icone: CalendarDays, cor: TOM.sucesso }, { valor: "quinzenal", rotulo: "Quinzenal", icone: CalendarRange, cor: TOM.violeta },
  { valor: "mes", rotulo: "Mensal", icone: LayoutGrid, cor: TOM.aco }, { valor: "seis_meses", rotulo: "6 meses", icone: PanelTop, cor: TOM.ciano }, { valor: "anual", rotulo: "Anual", icone: CalendarDays, cor: TOM.erro },
];
/** Relógio que reage ao botão pai (`group`): no hover os ponteiros avançam um pouco; ao apertar, dão voltas (as horas passam). */
function RelogioAnimado() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <g style={{ transformOrigin: "12px 12px" }} className="transition-transform duration-500 ease-out group-hover:rotate-[30deg] group-active:rotate-[360deg] group-active:duration-700"><line x1="12" y1="12" x2="12" y2="7" /></g>
      <g style={{ transformOrigin: "12px 12px" }} className="transition-transform duration-500 ease-out group-hover:rotate-[90deg] group-active:rotate-[1440deg] group-active:duration-700"><line x1="12" y1="12" x2="16" y2="12" /></g>
    </svg>
  );
}

function AcoesAgenda({ modo, onMudarModo, onHoje, onNavegar = () => {}, onAbrirEvento = () => {}, onAlocar }: { modo: ModoAgenda; onMudarModo: (modo: ModoAgenda) => void; onHoje: (alvo: HTMLElement) => void; onNavegar?: (direcao: number) => void; onAbrirEvento?: () => void; onAlocar?: () => void }) {
  const atual = PERIODOS.find((periodo) => periodo.valor === modo);
  const Icone = atual?.icone ?? CalendarDays;
  return <div className="flex items-center gap-2"><button onClick={() => onNavegar(-1)} className="group flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface-1 text-text-muted transition-all hover:bg-surface-2 hover:text-text-primary active:scale-95" aria-label="Período anterior"><ChevronLeft size={18} className="transition-transform duration-300 ease-out group-hover:-translate-x-1 group-active:-translate-x-2.5 group-active:duration-500" /></button><MenuSuspenso ariaLabel="Escolher período da agenda" valor={modo} opcoes={PERIODOS} onChange={onMudarModo} corAtiva={atual?.cor ?? TOM.aco} classeGatilho="group flex h-9 items-center gap-2 rounded-lg border border-border bg-surface-1 px-3 text-sm font-medium text-text-secondary transition-all hover:bg-surface-2 hover:text-text-primary active:scale-95" gatilho={({ aberto }) => <><Icone size={16} className="transition-transform duration-300 ease-out group-hover:-rotate-12 group-hover:scale-125 group-active:rotate-[360deg] group-active:scale-90 group-active:duration-700" /><span>{atual?.rotulo}</span><ChevronRight size={14} className={`transition-transform duration-200 ${aberto ? "rotate-90" : ""}`} /></>} /><button onClick={() => onNavegar(1)} className="group flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface-1 text-text-muted transition-all hover:bg-surface-2 hover:text-text-primary active:scale-95" aria-label="Próximo período"><ChevronRight size={18} className="transition-transform duration-300 ease-out group-hover:translate-x-1 group-active:translate-x-2.5 group-active:duration-500" /></button><button onClick={(e) => onHoje(e.currentTarget)} className="rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary">Hoje</button><button onClick={onAbrirEvento} className="group flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-sm font-medium text-text-secondary transition-all hover:bg-surface-2 hover:text-text-primary active:scale-95"><Plus size={16} className="transition-transform duration-500 ease-out group-hover:rotate-90 group-active:rotate-[450deg] group-active:duration-700" />Evento</button>{onAlocar && <button onClick={onAlocar} className="group flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-sm font-medium text-text-secondary transition-all hover:bg-surface-2 hover:text-text-primary active:scale-95"><RelogioAnimado />Alocar tempo</button>}</div>;
}

function VisaoMes({ desktop, modo, onMudarModo, onHoje, onNavegar, onAbrirEvento, diaAtual, hoje, itens, onMudarMes, onSelecionar, onAlocarTarefa, mostrarPrazos, onAlocar }: { desktop: boolean; modo: ModoAgenda; onMudarModo: (modo: ModoAgenda) => void; onHoje: (alvo: HTMLElement) => void; onNavegar: (direcao: number) => void; onAbrirEvento: () => void; diaAtual: Date; hoje: Date; itens: TarefaResumo[]; onMudarMes: (delta: number) => void; onSelecionar: (d: Date, alvo?: HTMLElement) => void; onAlocarTarefa: (tarefa: TarefaArrastavel, dia: string) => void; mostrarPrazos: boolean; onAlocar?: () => void }) {
  const { offset, totalDias, ano, mes } = gerarDiasDoMes(diaAtual);
  // Uma tarefa arrastada de uma lista pode cair num dia do mês: o dia sob o ponteiro ganha destaque e, ao soltar, recebe o tempo dela.
  const [diaSobre, setDiaSobre] = useState<string | null>(null);
  useOuvirArrasteTarefa((e) => {
    if (e.fase === "cancelar") return setDiaSobre(null);
    const dia = (document.elementsFromPoint?.(e.x, e.y) ?? []).map((el) => el.closest<HTMLElement>("[data-dia-mes]")).find(Boolean)?.dataset.diaMes ?? null;
    if (e.fase === "mover") return setDiaSobre(dia);
    setDiaSobre(null);
    if (dia) onAlocarTarefa(e.tarefa, dia);
  });
  const nomeMes = diaAtual.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  if (desktop) return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-base">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div><p className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">Calendário</p><h1 className="font-display text-2xl capitalize text-text-primary">{nomeMes}</h1></div>
        <AcoesAgenda modo={modo} onMudarModo={onMudarModo} onHoje={onHoje} onNavegar={onNavegar} onAbrirEvento={onAbrirEvento} onAlocar={onAlocar} />
      </div>
      <div className="grid grid-cols-7 border-b border-border bg-surface-1">
        {["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"].map((nome) => <div key={nome} className="border-r border-border px-3 py-2 text-xs font-medium text-text-muted last:border-r-0">{nome}</div>)}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 overflow-hidden">
        {Array.from({ length: 42 }, (_, indice) => {
          const numeroDoDia = indice - offset + 1;
          if (numeroDoDia < 1 || numeroDoDia > totalDias) return <div key={`vazio-${indice}`} className="border-b border-r border-border bg-surface-1 last:border-r-0" />;
          const data = new Date(ano, mes, numeroDoDia);
          // Mesma regra da grade: agendada = um cartão; prazo (se ligado) = marca, e no mesmo dia do agendamento vai no próprio cartão.
          const tarefasDoDia = itens.flatMap((t) => itensDaTarefa(t, { mostrarPrazos })).filter((i) => i.dia === paraISO(data));
          const ativo = paraISO(data) === paraISO(diaAtual);
          const ehHoje = paraISO(data) === paraISO(hoje);
          const iso = paraISO(data);
          return <div key={numeroDoDia} data-dia-mes={iso} className={`group min-h-[84px] border-b border-r border-border p-2 text-left transition-colors duration-200 ${diaSobre === iso ? "bg-cyan/10 ring-1 ring-inset ring-cyan/60" : ativo ? "bg-surface-2" : "bg-base"}`}>
            <button type="button" aria-label={`Ver tarefas de ${data.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}`} onClick={(e) => onSelecionar(data, e.currentTarget.closest<HTMLElement>("[data-dia-mes]") ?? e.currentTarget)} className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full text-sm transition-all duration-300 ease-out hover:-rotate-12 hover:scale-110 active:rotate-[360deg] active:scale-95 active:duration-700 ${ativo ? "bg-steel-500 font-semibold text-white" : ehHoje ? "bg-surface-2 font-semibold text-text-primary ring-1 ring-steel-400" : "text-text-secondary hover:bg-surface-2"}`}>{numeroDoDia}</button>{tarefasDoDia.slice(0, 2).map((tarefa) => <span key={tarefa.chave} data-marca={tarefa.tipo === "prazo" ? "prazo" : undefined} className={`mt-1 block truncate rounded px-1.5 py-0.5 text-[11px] font-medium ${tarefa.classe}`}>{(tarefa.tipo === "prazo" || tarefa.comPrazo) && <Flag size={10} aria-label="Prazo" className="mr-1 inline" />}{tarefa.titulo}</span>)}{tarefasDoDia.length > 2 && <span className="mt-1 block text-[11px] text-text-muted">+{tarefasDoDia.length - 2} tarefas</span>}
          </div>;
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
              data-dia-mes={paraISO(data)}
              onClick={(e) => onSelecionar(data, e.currentTarget)}
              className={`mx-auto flex h-8 w-8 items-center justify-center rounded-full text-sm transition-colors hover:bg-steel-600/30 ${diaSobre === paraISO(data) ? "ring-2 ring-cyan" : ""} ${
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

function VisaoTempo({ pedidoAgora, desktop, modo, onMudarModo, onHoje, onNavegar, onAbrirEvento, diaAtual, hoje, onSelecionar, eventos, tarefas, blocos, inicioMin, mostrarPrazos, encaixe, onMudarEncaixe, onAbrirItem, onMoverItem, onRemoverItem, onAlocarTarefa, onAlocar }: { pedidoAgora: number; desktop: boolean; modo: ModoAgenda; onMudarModo: (modo: ModoAgenda) => void; onHoje: (alvo: HTMLElement) => void; onNavegar: (direcao: number) => void; onAbrirEvento: () => void; diaAtual: Date; hoje: Date; onSelecionar: (d: Date, alvo?: HTMLElement) => void; eventos: EventoLocal[]; tarefas: TarefaResumo[]; blocos: BlocoPlanejado[]; inicioMin: number; mostrarPrazos: boolean; encaixe: number; onMudarEncaixe: (encaixe: number) => void; onAbrirItem: (item: ItemAgenda, e: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => void; onMoverItem: (item: ItemAgenda, destino: Posicao, origem: "ponteiro" | "teclado" | "menu") => void; onRemoverItem: (item: ItemAgenda) => void; onAlocarTarefa: (tarefa: TarefaArrastavel, destino: Posicao) => void; onAlocar: () => void }) {
  const quantidade = modo === "dia" ? 1 : modo === "tres_dias" ? 3 : modo === "quinzenal" ? 14 : 7;
  const inicio = modo === "dia" || modo === "tres_dias" ? diaAtual : inicioDaSemana(diaAtual);
  const rotulo = `${inicio.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} – ${somarDias(inicio, quantidade - 1).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}`;
  if (!desktop) return <VisaoSemana desktop={false} modo={modo} onMudarModo={onMudarModo} onHoje={onHoje} diaAtual={diaAtual} hoje={hoje} onMudarSemana={onNavegar} onSelecionar={onSelecionar} />;
  const dias = Array.from({ length: quantidade }, (_, indice) => somarDiasISO(paraISO(inicio), indice));
  const itens = [...tarefas.flatMap((t) => itensDaTarefa(t, { mostrarPrazos })), ...blocos.map(itemDoBloco), ...eventos.map(itemDoEvento)].filter((i) => dias.includes(i.dia));
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-base">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div><p className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">Calendário</p><h1 className="font-display text-2xl text-text-primary">{rotulo}</h1></div>
        <AcoesAgenda modo={modo} onMudarModo={onMudarModo} onHoje={onHoje} onNavegar={onNavegar} onAbrirEvento={onAbrirEvento} onAlocar={onAlocar} />
      </div>
      <GradeTempo rolarParaAgora={pedidoAgora} dias={dias} hoje={paraISO(hoje)} itens={itens} inicioMin={inicioMin} encaixe={encaixe} onMudarEncaixe={onMudarEncaixe} onSelecionarDia={(dia, alvo) => onSelecionar(meioDiaLocal(dia), alvo)} onAbrirItem={onAbrirItem} onMover={onMoverItem} onRemover={onRemoverItem} onAlocarTarefa={onAlocarTarefa} />
    </section>
  );
}

function VisaoPeriodos({ modo, diaAtual, onMudarModo, onHoje, onNavegar, onAbrirEvento, onSelecionar }: { modo: ModoAgenda; diaAtual: Date; onMudarModo: (modo: ModoAgenda) => void; onHoje: (alvo: HTMLElement) => void; onNavegar: (direcao: number) => void; onAbrirEvento: () => void; onSelecionar: (d: Date, alvo?: HTMLElement) => void }) {
  const meses = Array.from({ length: modo === "anual" ? 12 : 6 }, (_, indice) => new Date(diaAtual.getFullYear(), (modo === "anual" ? 0 : diaAtual.getMonth()) + indice, 1));
  return <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-base"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><p className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">Calendário</p><h1 className="font-display text-2xl text-text-primary">{modo === "anual" ? diaAtual.getFullYear() : "Próximos 6 meses"}</h1></div><AcoesAgenda modo={modo} onMudarModo={onMudarModo} onHoje={onHoje} onNavegar={onNavegar} onAbrirEvento={onAbrirEvento} /></div><div className="grid flex-1 grid-cols-3 gap-px bg-border p-px lg:grid-cols-4">{meses.map((mes) => <button data-mini-mes={paraISO(mes)} key={paraISO(mes)} onClick={(e) => onSelecionar(mes, e.currentTarget)} className="bg-base p-4 text-left transition-colors hover:bg-surface-1"><h2 className="font-medium capitalize text-text-primary">{mes.toLocaleDateString("pt-BR", { month: "long" })}</h2><p className="mt-2 text-sm text-text-muted">Ver agenda do mês</p></button>)}</div></section>;
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
