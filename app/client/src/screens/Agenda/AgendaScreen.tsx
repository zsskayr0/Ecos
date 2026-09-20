import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { useEventosLocais, type EventoLocal } from "@/lib/eventos-locais";
import { useAbrirDocumento } from "@/lib/documento-popup";
import { AlertTriangle, ListChecks, Clock, CheckCircle2, ChevronLeft, ChevronRight, Pin, X, CalendarDays, CalendarRange, CalendarPlus, Columns3, Flag, LayoutGrid, PanelTop, Plus, Sun } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { agenda as agendaApi, tarefas as tarefasApi, rotina as rotinaApi, ApiError, type BlocoPlanejado, type PrioridadeTarefa, type TarefaResumo } from "@/lib/api";
import { formatDuracao } from "@/lib/format";
import { EmptyState } from "@/components/common/EmptyState";
import { CalendarClock } from "lucide-react";
import { useRefreshBus } from "@/lib/refresh-bus";
import { useIsDesktop } from "@/lib/use-viewport";
import { MenuSuspenso, TOM, type OpcaoMenu } from "@/components/common/MenuSuspenso";
import { ENCAIXE_PADRAO, HORA_PADRAO_MIN, concluidasPorDia, horaLocal, OPCOES_ENCAIXE, aplicarPayloadNoBloco, dataLocalISO, duracaoParaAlocar, instanteLocalISO, itensDaTarefa, itemDoBloco, meioDiaLocal, payloadDoBloco, somarDiasISO, type ItemAgenda, type PayloadBloco, type Posicao } from "@/lib/agenda-tempo";
import { useOuvirArrasteTarefa, type TarefaArrastavel } from "@/lib/arraste-tarefa";
import { usePreferenciasCalendario } from "@/lib/preferencias-calendario";
import { AlocarTempoDialog } from "./AlocarTempoDialog";
import { useEdicaoOtimista } from "@/lib/agenda-otimista";
import { GradeTempo, type NovaTarefaRapida } from "./GradeTempo";
import { EditorEvento } from "./EditorEvento";
import { useEspacoFiltro } from "@/lib/use-espaco-filtro";
import { useAppUI } from "@/lib/ui-context";

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
  const { abrirCaptura } = useAppUI();
  const { versao, notificar } = useRefreshBus();
  const [estadoInicial] = useState(lerEstadoInicialAgenda);
  const [modo, setModo] = useState<ModoAgenda>(estadoInicial.modo);
  const [diaAtual, setDiaAtual] = useState(estadoInicial.dia);
  const [pedidoAgora, setPedidoAgora] = useState(0);
  const hoje = new Date();
  // Clicar num dia só abre o popup dele (janela no desktop, folha no celular): o período que está na tela (diaAtual) não se move.
  const [diaPopup, setDiaPopup] = useState(estadoInicial.dia);
  const diaFoco = diaPopup;
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
  const [concluidasDoPeriodo, setConcluidasDoPeriodo] = useState<TarefaResumo[]>([]);
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

  const espaco = useEspacoFiltro();
  useEffect(() => {
    let vivo = true;
    setErro(null);
    // O servidor guarda horários em UTC: ele precisa do fuso para saber onde o dia começa e termina.
    const [a, m, d] = dataStr.split("-").map(Number);
    const tz = -new Date(a, m - 1, d, 12).getTimezoneOffset();
    Promise.all([
      tarefasApi.listar({ data_de: dataStr, data_ate: dataStr, tz, espaco, limit: 100 }),
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
  }, [dataStr, versao, espaco]);

  useEffect(() => {
    let vivo = true;
    const { de, ate } = limitesDoPeriodo(modo, diaAtual);
    const [ano, mes, dia] = de.split("-").map(Number);
    const tz = -new Date(ano, mes - 1, dia, 12).getTimezoneOffset();
    // Nas visões de tempo busca 1 dia a mais de cada lado: o corte de dia do servidor usa o fuso de um único dia (horário de verão!) e a grade refiltra no fuso local.
    const comMargem = modo === "dia" || modo === "tres_dias" || modo === "semana" || modo === "quinzenal";
    tarefasApi.listar({ data_de: comMargem ? somarDiasISO(de, -1) : de, data_ate: comMargem ? somarDiasISO(ate, 1) : ate, tz, espaco, limit: 500 }).then((resultado) => { if (vivo) setItensDoPeriodo(resultado.items); }).catch(() => { if (vivo) setItensDoPeriodo([]); });
    return () => { vivo = false; };
  }, [modo, dataPeriodo, versao, espaco]);

  // Dias em que Tarefas foram concluídas (`concluida_em`): o dia fica marcado no calendário. Sempre com 1 dia de margem de cada lado — o servidor corta o dia num fuso só; o agrupamento final é pelo dia local.
  useEffect(() => {
    let vivo = true;
    const { de, ate } = limitesDoPeriodo(modo, diaAtual);
    const [ano, mes, dia] = de.split("-").map(Number);
    const tz = -new Date(ano, mes - 1, dia, 12).getTimezoneOffset();
    tarefasApi.listar({ concluida_de: somarDiasISO(de, -1), concluida_ate: somarDiasISO(ate, 1), status: "concluida", tz, espaco, limit: 500 }).then((resultado) => { if (vivo) setConcluidasDoPeriodo(resultado.items); }).catch(() => { if (vivo) setConcluidasDoPeriodo([]); });
    return () => { vivo = false; };
  }, [modo, dataPeriodo, versao, espaco]);
  const concluidasNoDia = concluidasPorDia(concluidasDoPeriodo);

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

  /** Criação rápida pela grade: cria a Tarefa na Caixa de Entrada e já aloca o tempo selecionado. */
  async function criarTarefaNoHorario(dados: NovaTarefaRapida) {
    const { id } = await tarefasApi.criar({ titulo: dados.titulo, corpo: dados.corpo || undefined, prioridade: dados.prioridade, duration_min: dados.destino.duracaoMin });
    await alocarTarefa({ id, titulo: dados.titulo, duracaoMin: dados.destino.duracaoMin, prioridade: dados.prioridade }, dados.destino);
    return id;
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
    setDiaPopup(data);
    const pai = agendaRef.current?.getBoundingClientRect();
    const retangulo = alvo?.getBoundingClientRect();
    if (desktop && pai && retangulo) setAncoraPopup({ left: retangulo.left - pai.left, top: retangulo.top - pai.top, width: retangulo.width, height: retangulo.height });
    else setAncoraPopup(null);
    setTarefasAbertas(true);
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

  return (
    <div ref={agendaRef} className={`relative flex min-h-0 flex-col ${desktop ? "h-full px-4 pt-1 pb-4" : "h-[calc(100dvh-13rem-var(--ecos-safe-top)-var(--ecos-safe-bottom))] min-h-[30rem] px-3 pt-1"}`}>
      <div ref={areaRef} className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {modo === "mes" && (
        <VisaoMes onAbrirItem={abrirItemAgenda} modo={modo} onMudarModo={setModo} onHoje={irParaHoje} onNavegar={navegarPeriodo} onAbrirEvento={() => setCriadorEventoAberto(true)} diaAtual={diaAtual} hoje={hoje} itens={itensDoPeriodo} concluidas={concluidasNoDia} onSelecionar={selecionarDia} onAlocarTarefa={alocarNoDia} mostrarPrazos={mostrarPrazos} onAlocar={() => setAlocarAberto(true)} />
      )}
      {(modo === "tres_dias" || modo === "semana" || modo === "quinzenal") && (
        <VisaoTempo concluidas={concluidasNoDia} pedidoAgora={pedidoAgora} modo={modo} onMudarModo={setModo} onHoje={irParaHoje} onNavegar={navegarPeriodo} onAbrirEvento={() => setCriadorEventoAberto(true)} diaAtual={diaAtual} hoje={hoje} onSelecionar={selecionarDia} eventos={eventosLocais} tarefas={itensDoPeriodo} blocos={blocosDeTempo} inicioMin={inicioMin} mostrarPrazos={mostrarPrazos} onRemoverItem={removerBloco} onAlocarTarefa={alocarTarefa} onCriarNoHorario={criarTarefaNoHorario} onAbrirTarefaCriada={(id) => abrirDocumento(`/tarefa/${id}`)} onAbrirCriacaoCompleta={() => abrirCaptura("tarefa")} onAlocar={() => setAlocarAberto(true)} encaixe={encaixe} onMudarEncaixe={setEncaixe} onMoverItem={moverItem} onAbrirItem={abrirItemAgenda} />
      )}
      {modo === "dia" && <VisaoTempo concluidas={concluidasNoDia} pedidoAgora={pedidoAgora} modo={modo} onMudarModo={setModo} onHoje={irParaHoje} onNavegar={navegarPeriodo} onAbrirEvento={() => setCriadorEventoAberto(true)} diaAtual={diaAtual} hoje={hoje} onSelecionar={selecionarDia} eventos={eventosLocais} tarefas={itensDoPeriodo} blocos={blocosDeTempo} inicioMin={inicioMin} mostrarPrazos={mostrarPrazos} onRemoverItem={removerBloco} onAlocarTarefa={alocarTarefa} onCriarNoHorario={criarTarefaNoHorario} onAbrirTarefaCriada={(id) => abrirDocumento(`/tarefa/${id}`)} onAbrirCriacaoCompleta={() => abrirCaptura("tarefa")} onAlocar={() => setAlocarAberto(true)} encaixe={encaixe} onMudarEncaixe={setEncaixe} onMoverItem={moverItem} onAbrirItem={abrirItemAgenda} />}
      {(modo === "seis_meses" || modo === "anual") && <VisaoPeriodos modo={modo} diaAtual={diaAtual} hoje={hoje} itens={[...itensDoPeriodo.flatMap((t) => itensDaTarefa(t, { mostrarPrazos })), ...eventosLocais.map(itemDoEvento)]} concluidas={concluidasNoDia} onMudarModo={setModo} onHoje={irParaHoje} onNavegar={navegarPeriodo} onAbrirEvento={() => setCriadorEventoAberto(true)} onSelecionar={selecionarDia} onAbrirMes={(mes) => { setDiaAtual(mes); setModo("mes"); }} />}
      </div>

      {tarefasAbertas && <PopupTarefas sheet={!desktop} key={`${modo}-${dataStr}`} ancora={ancoraPopup} dia={diaFoco} blocos={blocos} concluidasDoDia={concluidasNoDia.get(paraISO(diaFoco)) ?? []} capacidade={capacidade} semRotina={semRotina} erro={erro} pendentes={pendentes} onFechar={() => setTarefasAbertas(false)} onAjustarRotina={() => navigate("/perfil/rotina")} abrirDocumento={abrirDocumento} visaoDia={<GradeTempo concluidas={concluidasNoDia} dias={[paraISO(diaFoco)]} hoje={paraISO(hoje)} itens={[...itensDoPeriodo.flatMap((t) => itensDaTarefa(t, { mostrarPrazos })), ...blocosDeTempo.map(itemDoBloco), ...eventosLocais.map(itemDoEvento)].filter((i) => i.dia === paraISO(diaFoco))} inicioMin={inicioMin} encaixe={encaixe} onMudarEncaixe={setEncaixe} onSelecionarDia={() => {}} onAbrirItem={abrirItemAgenda} onMover={moverItem} onRemover={removerBloco} onAlocarTarefa={alocarTarefa} onCriarNoHorario={criarTarefaNoHorario} onAbrirTarefaCriada={(id) => abrirDocumento(`/tarefa/${id}`)} onAbrirCriacaoCompleta={() => abrirCaptura("tarefa")} />} />}
      {avisoMover && (
        <div role="alert" className="ecos-fade-in absolute left-1/2 top-3 z-40 flex max-w-[90%] -translate-x-1/2 items-start gap-2 rounded-xl border border-error/40 bg-base px-4 py-3 text-sm text-error shadow-nav">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{avisoMover}</span>
          <button type="button" onClick={() => setAvisoMover(null)} aria-label="Dispensar aviso" className="ml-1 rounded p-0.5 text-text-muted hover:bg-surface-2"><X size={14} /></button>
        </div>
      )}
      {alocarAberto && <AlocarTempoDialog encaixe={encaixe} onFechar={() => setAlocarAberto(false)} onAlocar={(tarefa, destino) => { setAlocarAberto(false); void alocarTarefa(tarefa, destino); }} />}
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
  return <div className="flex flex-wrap items-center gap-2"><button onClick={() => onNavegar(-1)} className="group flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface-1 text-text-muted transition-all hover:bg-surface-2 hover:text-text-primary active:scale-95" aria-label="Período anterior"><ChevronLeft size={18} className="transition-transform duration-300 ease-out group-hover:-translate-x-1 group-active:-translate-x-2.5 group-active:duration-500" /></button><MenuSuspenso ariaLabel="Escolher período da agenda" valor={modo} opcoes={PERIODOS} onChange={onMudarModo} corAtiva={atual?.cor ?? TOM.aco} classeGatilho="group flex h-9 items-center gap-2 rounded-lg border border-border bg-surface-1 px-3 text-sm font-medium text-text-secondary transition-all hover:bg-surface-2 hover:text-text-primary active:scale-95" gatilho={({ aberto }) => <><Icone size={16} className="transition-transform duration-300 ease-out group-hover:-rotate-12 group-hover:scale-125 group-active:rotate-[360deg] group-active:scale-90 group-active:duration-700" /><span>{atual?.rotulo}</span><ChevronRight size={14} className={`transition-transform duration-200 ${aberto ? "rotate-90" : ""}`} /></>} /><button onClick={() => onNavegar(1)} className="group flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface-1 text-text-muted transition-all hover:bg-surface-2 hover:text-text-primary active:scale-95" aria-label="Próximo período"><ChevronRight size={18} className="transition-transform duration-300 ease-out group-hover:translate-x-1 group-active:translate-x-2.5 group-active:duration-500" /></button><button onClick={(e) => onHoje(e.currentTarget)} className="rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary">Hoje</button><button onClick={onAbrirEvento} className="group flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-sm font-medium text-text-secondary transition-all hover:bg-surface-2 hover:text-text-primary active:scale-95"><Plus size={16} className="transition-transform duration-500 ease-out group-hover:rotate-90 group-active:rotate-[450deg] group-active:duration-700" /><span className="hidden sm:inline">Evento</span><span className="sr-only sm:hidden">Novo evento</span></button>{onAlocar && <button onClick={onAlocar} className="group flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-sm font-medium text-text-secondary transition-all hover:bg-surface-2 hover:text-text-primary active:scale-95"><RelogioAnimado /><span className="hidden sm:inline">Alocar tempo</span><span className="sr-only sm:hidden">Alocar tempo</span></button>}</div>;
}

function VisaoMes({ onAbrirItem, modo, onMudarModo, onHoje, onNavegar, onAbrirEvento, diaAtual, hoje, itens, concluidas, onSelecionar, onAlocarTarefa, mostrarPrazos, onAlocar }: { onAbrirItem: (item: ItemAgenda, e: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => void; modo: ModoAgenda; onMudarModo: (modo: ModoAgenda) => void; onHoje: (alvo: HTMLElement) => void; onNavegar: (direcao: number) => void; onAbrirEvento: () => void; diaAtual: Date; hoje: Date; itens: TarefaResumo[]; concluidas: Map<string, TarefaResumo[]>; onSelecionar: (d: Date, alvo?: HTMLElement) => void; onAlocarTarefa: (tarefa: TarefaArrastavel, dia: string) => void; mostrarPrazos: boolean; onAlocar?: () => void }) {
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

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-base">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-3 lg:px-5 lg:py-4">
        <div><p className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">Calendário</p><h1 className="font-display text-xl lg:text-2xl capitalize text-text-primary">{nomeMes}</h1></div>
        <AcoesAgenda modo={modo} onMudarModo={onMudarModo} onHoje={onHoje} onNavegar={onNavegar} onAbrirEvento={onAbrirEvento} onAlocar={onAlocar} />
      </div>
      <div className="grid grid-cols-7 border-b border-border bg-surface-1">
        {["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"].map((nome) => <div key={nome} className="border-r border-border px-1 py-2 text-center text-xs font-medium text-text-muted last:border-r-0 lg:px-3 lg:text-left"><span className="lg:hidden" aria-label={nome}>{nome[0]}</span><span className="hidden lg:inline">{nome}</span></div>)}
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
          const concluidasDoDia = concluidas.get(iso) ?? [];
          return <div key={numeroDoDia} data-dia-mes={iso} className={`group relative min-h-0 overflow-hidden border-b border-r border-border p-1 text-left lg:min-h-[84px] lg:p-2 transition-colors duration-200 ${diaSobre === iso ? "bg-cyan/10 ring-1 ring-inset ring-cyan/60" : ativo ? "bg-surface-2" : "bg-base"}`}>
            <button type="button" aria-label={`Ver tarefas de ${data.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}`} onClick={(e) => onSelecionar(data, e.currentTarget.closest<HTMLElement>("[data-dia-mes]") ?? e.currentTarget)} className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full text-sm transition-all duration-300 ease-out hover:-rotate-12 hover:scale-110 active:rotate-[360deg] active:scale-95 active:duration-700 ${ativo ? "bg-steel-500 font-semibold text-white" : ehHoje ? "bg-surface-2 font-semibold text-text-primary ring-1 ring-steel-400" : "text-text-secondary hover:bg-surface-2"}`}>{numeroDoDia}</button>{concluidasDoDia.length > 0 && <span data-concluidas={concluidasDoDia.length} title={`Concluída${concluidasDoDia.length === 1 ? "" : "s"}: ${concluidasDoDia.map((t) => `${horaLocal(t.concluida_em!)} ${t.titulo}`).join(" · ")}`} className="absolute bottom-0.5 right-0.5 flex items-center gap-0.5 rounded-pill bg-success/15 px-1 py-0.5 text-[9px] font-semibold text-success lg:bottom-auto lg:right-1.5 lg:top-1.5 lg:px-1.5 lg:text-[10px]"><CheckCircle2 size={11} strokeWidth={2} aria-hidden />{concluidasDoDia.length}<span className="sr-only"> {concluidasDoDia.length === 1 ? "tarefa concluída" : "tarefas concluídas"}</span></span>}{tarefasDoDia.length > 0 && <span aria-hidden className="mt-1 flex flex-wrap justify-center gap-0.5 lg:hidden">{tarefasDoDia.slice(0, 4).map((t) => <i key={t.chave} className={`h-1.5 w-1.5 rounded-full ${t.tipo === "prazo" ? "bg-warning" : t.tipo === "evento" ? "bg-violet" : t.classe.includes("error") ? "bg-error" : "bg-cyan"}`} />)}</span>}{tarefasDoDia.slice(0, 2).map((tarefa) => <button type="button" key={tarefa.chave} data-marca={tarefa.tipo === "prazo" ? "prazo" : undefined} title={tarefa.titulo} onClick={(e) => onAbrirItem(tarefa, e)} className={`mt-1 hidden w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] lg:block font-medium transition-[filter] hover:brightness-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan ${tarefa.classe}`}>{(tarefa.tipo === "prazo" || tarefa.comPrazo) && <Flag size={10} aria-label="Prazo" className="mr-1 inline" />}{tarefa.titulo}</button>)}{tarefasDoDia.length > 2 && <span className="mt-1 hidden text-[11px] text-text-muted lg:block">+{tarefasDoDia.length - 2} tarefas</span>}
          </div>;
        })}
      </div>
    </section>
  );

}

function VisaoTempo({ concluidas, pedidoAgora, modo, onMudarModo, onHoje, onNavegar, onAbrirEvento, diaAtual, hoje, onSelecionar, eventos, tarefas, blocos, inicioMin, mostrarPrazos, encaixe, onMudarEncaixe, onAbrirItem, onMoverItem, onRemoverItem, onAlocarTarefa, onCriarNoHorario, onAbrirTarefaCriada, onAbrirCriacaoCompleta, onAlocar }: { concluidas: Map<string, TarefaResumo[]>; onCriarNoHorario: (dados: NovaTarefaRapida) => Promise<string>; onAbrirTarefaCriada: (id: string) => void; onAbrirCriacaoCompleta: () => void; pedidoAgora: number; modo: ModoAgenda; onMudarModo: (modo: ModoAgenda) => void; onHoje: (alvo: HTMLElement) => void; onNavegar: (direcao: number) => void; onAbrirEvento: () => void; diaAtual: Date; hoje: Date; onSelecionar: (d: Date, alvo?: HTMLElement) => void; eventos: EventoLocal[]; tarefas: TarefaResumo[]; blocos: BlocoPlanejado[]; inicioMin: number; mostrarPrazos: boolean; encaixe: number; onMudarEncaixe: (encaixe: number) => void; onAbrirItem: (item: ItemAgenda, e: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => void; onMoverItem: (item: ItemAgenda, destino: Posicao, origem: "ponteiro" | "teclado" | "menu") => void; onRemoverItem: (item: ItemAgenda) => void; onAlocarTarefa: (tarefa: TarefaArrastavel, destino: Posicao) => void; onAlocar: () => void }) {
  const quantidade = modo === "dia" ? 1 : modo === "tres_dias" ? 3 : modo === "quinzenal" ? 14 : 7;
  const inicio = modo === "dia" || modo === "tres_dias" ? diaAtual : inicioDaSemana(diaAtual);
  const rotulo = `${inicio.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} – ${somarDias(inicio, quantidade - 1).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}`;
  const dias = Array.from({ length: quantidade }, (_, indice) => somarDiasISO(paraISO(inicio), indice));
  const itens = [...tarefas.flatMap((t) => itensDaTarefa(t, { mostrarPrazos })), ...blocos.map(itemDoBloco), ...eventos.map(itemDoEvento)].filter((i) => dias.includes(i.dia));
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-base">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-3 lg:px-5 lg:py-4">
        <div><p className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">Calendário</p><h1 className="font-display text-xl lg:text-2xl text-text-primary">{rotulo}</h1></div>
        <AcoesAgenda modo={modo} onMudarModo={onMudarModo} onHoje={onHoje} onNavegar={onNavegar} onAbrirEvento={onAbrirEvento} onAlocar={onAlocar} />
      </div>
      <GradeTempo concluidas={concluidas} rolarParaAgora={pedidoAgora} dias={dias} hoje={paraISO(hoje)} itens={itens} inicioMin={inicioMin} encaixe={encaixe} onMudarEncaixe={onMudarEncaixe} onSelecionarDia={(dia, alvo) => onSelecionar(meioDiaLocal(dia), alvo)} onAbrirItem={onAbrirItem} onMover={onMoverItem} onRemover={onRemoverItem} onAlocarTarefa={onAlocarTarefa} onCriarNoHorario={onCriarNoHorario} onAbrirTarefaCriada={onAbrirTarefaCriada} onAbrirCriacaoCompleta={onAbrirCriacaoCompleta} />
    </section>
  );
}

function VisaoPeriodos({ modo, diaAtual, hoje, itens, concluidas, onMudarModo, onHoje, onNavegar, onAbrirEvento, onSelecionar, onAbrirMes }: { modo: ModoAgenda; diaAtual: Date; hoje: Date; itens: ItemAgenda[]; concluidas: Map<string, TarefaResumo[]>; onMudarModo: (modo: ModoAgenda) => void; onHoje: (alvo: HTMLElement) => void; onNavegar: (direcao: number) => void; onAbrirEvento: () => void; onSelecionar: (d: Date, alvo?: HTMLElement) => void; onAbrirMes: (mes: Date) => void }) {
  const meses = Array.from({ length: modo === "anual" ? 12 : 6 }, (_, indice) => new Date(diaAtual.getFullYear(), (modo === "anual" ? 0 : diaAtual.getMonth()) + indice, 1));
  const porDia = new Map<string, ItemAgenda[]>();
  itens.forEach((item) => porDia.set(item.dia, [...(porDia.get(item.dia) ?? []), item]));
  const totalPeriodo = itens.filter((item) => {
    const primeiro = paraISO(meses[0]);
    const ultimoMes = meses[meses.length - 1];
    const ultimo = paraISO(new Date(ultimoMes.getFullYear(), ultimoMes.getMonth() + 1, 0));
    return item.dia >= primeiro && item.dia <= ultimo;
  }).length;

  return <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-base">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-3 lg:px-5 lg:py-4">
      <div><p className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">Calendário</p><div className="flex items-baseline gap-3"><h1 className="font-display text-xl lg:text-2xl text-text-primary">{modo === "anual" ? diaAtual.getFullYear() : "Próximos 6 meses"}</h1><span className="text-xs text-text-muted">{totalPeriodo} {totalPeriodo === 1 ? "item" : "itens"} no período</span></div></div>
      <AcoesAgenda modo={modo} onMudarModo={onMudarModo} onHoje={onHoje} onNavegar={onNavegar} onAbrirEvento={onAbrirEvento} />
    </div>
    <div className={`min-h-0 flex-1 bg-surface-1/40 ${modo === "anual" ? "overflow-hidden p-2" : "overflow-y-auto p-3 sm:p-4"}`}>
      <div className={`grid gap-2 ${modo === "anual" ? "h-full grid-cols-2 grid-rows-6 md:grid-cols-3 md:grid-rows-4 lg:grid-cols-4 lg:grid-rows-3" : "gap-3 sm:grid-cols-2 xl:grid-cols-3"}`}>
        {meses.map((mes) => <MiniMes key={paraISO(mes)} compacto={modo === "anual"} mes={mes} hoje={hoje} diaSelecionado={diaAtual} porDia={porDia} concluidas={concluidas} onSelecionar={onSelecionar} onAbrirMes={onAbrirMes} />)}
      </div>
    </div>
  </section>;
}

function MiniMes({ mes, hoje, diaSelecionado, porDia, concluidas, onSelecionar, onAbrirMes, compacto = false }: { mes: Date; hoje: Date; diaSelecionado: Date; porDia: Map<string, ItemAgenda[]>; concluidas: Map<string, TarefaResumo[]>; onSelecionar: (d: Date, alvo?: HTMLElement) => void; onAbrirMes: (mes: Date) => void; compacto?: boolean }) {
  const { offset, totalDias, ano, mes: indiceMes } = gerarDiasDoMes(mes);
  const inicioMes = paraISO(new Date(ano, indiceMes, 1));
  const fimMes = paraISO(new Date(ano, indiceMes + 1, 0));
  const itensMes = [...porDia.entries()].reduce((total, [dia, lista]) => total + (dia >= inicioMes && dia <= fimMes ? lista.length : 0), 0);
  return <article data-mini-mes={inicioMes} className={`min-h-0 overflow-hidden border border-border bg-base shadow-sm transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-steel-400/50 hover:shadow-md ${compacto ? "flex flex-col rounded-xl p-2" : "rounded-2xl p-3"}`}>
    <div className={`flex items-center justify-between gap-1 ${compacto ? "mb-0.5" : "mb-2"}`}>
      <button type="button" onClick={() => onAbrirMes(mes)} className={`group flex min-w-0 items-center gap-1 rounded-lg text-left font-semibold capitalize text-text-primary hover:text-cyan ${compacto ? "px-1 py-0.5 text-xs" : "px-1 py-1"}`}>
        {mes.toLocaleDateString("pt-BR", { month: "long" })}<ChevronRight size={14} className="text-text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-cyan" />
      </button>
      <span className={`shrink-0 rounded-pill bg-surface-2 font-medium text-text-muted ${compacto ? "px-1.5 py-px text-[8px]" : "px-2 py-0.5 text-[10px]"}`}>{itensMes} {itensMes === 1 ? "item" : "itens"}</span>
    </div>
    <div className={`grid grid-cols-7 text-center ${compacto ? "min-h-0 flex-1 grid-rows-7" : ""}`}>
      {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((nome, indice) => <span key={`${nome}-${indice}`} className={`font-semibold text-text-muted ${compacto ? "flex items-center justify-center text-[9px]" : "pb-1 text-[9px]"}`}>{nome}</span>)}
      {Array.from({ length: 42 }, (_, indice) => {
        const numero = indice - offset + 1;
        if (numero < 1 || numero > totalDias) return <span key={`v-${indice}`} className={compacto ? "min-h-0" : "h-8"} />;
        const data = new Date(ano, indiceMes, numero);
        const iso = paraISO(data);
        const lista = porDia.get(iso) ?? [];
        const nConcluidas = concluidas.get(iso)?.length ?? 0;
        const ehHoje = iso === paraISO(hoje);
        const selecionado = iso === paraISO(diaSelecionado);
        return <button type="button" key={iso} data-dia-mes={iso} title={`${data.toLocaleDateString("pt-BR", { day: "numeric", month: "long" })}${lista.length ? ` · ${lista.length} ${lista.length === 1 ? "item" : "itens"}` : ""}${nConcluidas ? ` · ${nConcluidas} ${nConcluidas === 1 ? "concluída" : "concluídas"}` : ""}`} onClick={(e) => onSelecionar(data, e.currentTarget)} className={`group/dia relative mx-auto flex flex-col items-center justify-center transition-all duration-150 hover:bg-surface-2 hover:text-text-primary active:scale-90 ${compacto ? "h-full w-full rounded-md text-[11px] md:text-xs" : "h-8 w-8 rounded-lg text-[11px]"} ${selecionado ? "bg-steel-700 font-semibold text-white" : ehHoje ? "font-semibold text-cyan ring-1 ring-inset ring-cyan" : "text-text-secondary"}`}>
          <span>{numero}</span>
          {nConcluidas > 0 && <CheckCircle2 data-concluidas={nConcluidas} aria-hidden size={compacto ? 8 : 9} strokeWidth={2.5} className={`absolute right-0.5 top-0.5 ${selecionado ? "text-white" : "text-success"}`} />}
          {lista.length > 0 && <span className={`absolute flex gap-px ${compacto ? "bottom-0.5" : "bottom-0.5"}`}>{lista.slice(0, compacto ? 2 : 3).map((item) => <i key={item.chave} className={`${compacto ? "h-1 w-1" : "h-1 w-1"} rounded-full ${selecionado ? "bg-white" : item.tipo === "prazo" ? "bg-warning" : item.tipo === "evento" ? "bg-violet" : "bg-cyan"}`} />)}</span>}
        </button>;
      })}
    </div>
  </article>;
}

type AbrirDocumento = (path: string, evento?: MouseEvent<HTMLElement>) => void;

/** O que dizer de um dia sem nada agendado: depende de ele já ter passado, ser hoje ou vir depois — e de ter havido conclusões. */
function textoDiaVazio(dia: string, hoje: string, concluidas: number): { title: string; subtitle: string } | null {
  if (dia < hoje) return concluidas > 0 ? null : { title: "Nada agendado neste dia.", subtitle: "Nenhuma tarefa foi agendada nem concluída nesta data." };
  if (dia === hoje) return { title: concluidas > 0 ? "Nada mais agendado para hoje." : "Nada agendado para hoje.", subtitle: "Encaixe uma tarefa neste dia ou capture algo novo." };
  return { title: "Dia livre.", subtitle: "Sem blocos encaixados — aproveite ou capture algo novo." };
}

function ListaDeTarefas({ blocos, abrirDocumento, dia, concluidas }: { blocos: TarefaResumo[] | null; abrirDocumento: AbrirDocumento; dia: string; concluidas: number }) {
  const vazio = textoDiaVazio(dia, paraISO(new Date()), concluidas);
  return (
    <div className="flex flex-col gap-2.5">
      {blocos === null ? <p className="py-10 text-center text-sm text-text-muted">Carregando...</p> : blocos.length === 0 ? (
        vazio && <EmptyState icon={CalendarClock} title={vazio.title} subtitle={vazio.subtitle} />
      ) : blocos.slice().sort((a, b) => (a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? "")).map((t) => <CartaoTarefa key={t.id} tarefa={t} abrirDocumento={abrirDocumento} />)}
    </div>
  );
}

function ConcluidasDoDia({ tarefas, abrirDocumento }: { tarefas: TarefaResumo[]; abrirDocumento: AbrirDocumento }) {
  if (tarefas.length === 0) return null;
  return <section aria-label="Concluídas neste dia" className="mt-5"><h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-success"><CheckCircle2 size={14} aria-hidden />Concluídas neste dia · {tarefas.length}</h3><ul className="flex flex-col gap-1.5">{tarefas.map((t) => <li key={t.id}><button type="button" onClick={(e) => abrirDocumento(`/tarefa/${t.id}`, e)} className="flex w-full items-center gap-3 rounded-xl bg-surface-1 px-3 py-2 text-left hover:bg-surface-2"><span className="font-mono-value text-xs text-success">{horaLocal(t.concluida_em!)}</span><span className="min-w-0 flex-1 truncate text-sm text-text-muted line-through">{t.titulo}</span></button></li>)}</ul></section>;
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

function CorpoDoDia({ visao, visaoDia, semRotina, erro, capacidade, pendentes, onAjustarRotina, blocos, dia, concluidasDoDia, abrirDocumento }: { visao: "feed" | "dia"; visaoDia: import("react").ReactNode; semRotina: boolean; erro: string | null; capacidade: Capacidade | null; pendentes: number; onAjustarRotina: () => void; blocos: TarefaResumo[] | null; dia: Date; concluidasDoDia: TarefaResumo[]; abrirDocumento: AbrirDocumento }) {
  if (visao === "dia") return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{visaoDia}</div>;
  return <div className="min-h-0 flex-1 overflow-y-auto p-5">

          {semRotina && <button onClick={onAjustarRotina} className="mb-4 flex w-full items-start gap-3 rounded-xl border border-steel-400/40 bg-steel-700/15 p-3 text-left text-sm text-text-primary"><CalendarClock size={18} className="shrink-0 text-steel-300" />Você ainda não contou sobre a sua rotina. <span className="font-semibold text-steel-300">Ajustar rotina</span></button>}
          {erro && <div className="mb-4 flex gap-2 rounded-xl border border-error/40 bg-error/10 p-3 text-sm text-error"><AlertTriangle size={16} className="shrink-0" />{erro}</div>}
          {capacidade?.estourado && <div className="mb-4 flex gap-3 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-text-primary"><AlertTriangle size={18} className="shrink-0 text-warning" /><p>{pendentes} {pendentes === 1 ? "tarefa soma" : "tarefas somam"} {formatDuracao(capacidade.consumido_tarefas_min)}, mas o dia só tem {formatDuracao(capacidade.disponivel_producao_total_min !== undefined ? Math.max(0, capacidade.disponivel_producao_total_min - capacidade.consumido_eventos_externos_min) : capacidade.consumido_tarefas_min)} de produção disponível.</p></div>}
          <ListaDeTarefas blocos={blocos} abrirDocumento={abrirDocumento} dia={paraISO(dia)} concluidas={concluidasDoDia.length} />
          <ConcluidasDoDia tarefas={concluidasDoDia} abrirDocumento={abrirDocumento} />
        
  </div>;
}

/** O popup do dia no celular: uma folha que sobe da base, com a mesma lista (ou a grade do dia) da janela do desktop. */
function FolhaDoDia({ dia, blocos, concluidasDoDia, capacidade, semRotina, erro, pendentes, onFechar, onAjustarRotina, abrirDocumento, visaoDia }: { visaoDia: import("react").ReactNode; dia: Date; blocos: TarefaResumo[] | null; concluidasDoDia: TarefaResumo[]; capacidade: Capacidade | null; semRotina: boolean; erro: string | null; pendentes: number; onFechar: () => void; onAjustarRotina: () => void; abrirDocumento: AbrirDocumento }) {
  const titulo = dia.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
  const [visao, setVisao] = useState<"feed" | "dia">("feed");
  return (
    <div className="fixed inset-0 z-[70] flex items-end bg-black/50" onClick={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <section role="dialog" aria-modal="true" aria-label={`Tarefas de ${titulo}`} className={`ecos-fade-in flex w-full flex-col overflow-hidden rounded-t-2xl border-t border-border bg-base pb-[var(--ecos-safe-bottom)] shadow-nav ${visao === "dia" ? "h-[85dvh]" : "max-h-[75dvh]"}`}>
        <div aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border" />
        <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2"><div className="min-w-0"><p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Agenda</p><h2 className="truncate font-display text-base capitalize text-text-primary">{titulo}</h2></div><div className="flex gap-1"><button type="button" onClick={() => setVisao((v) => (v === "feed" ? "dia" : "feed"))} aria-label={visao === "feed" ? "Ver o dia por horários" : "Ver lista de tarefas"} className={`flex h-10 w-10 items-center justify-center rounded-lg ${visao === "dia" ? "bg-steel-700 text-white" : "text-text-muted active:bg-surface-2"}`}>{visao === "feed" ? <Clock size={17} /> : <ListChecks size={17} />}</button><button type="button" onClick={onFechar} aria-label="Fechar tarefas" className="flex h-10 w-10 items-center justify-center rounded-lg text-text-muted active:bg-surface-2"><X size={19} /></button></div></header>
        <CorpoDoDia visao={visao} visaoDia={visaoDia} semRotina={semRotina} erro={erro} capacidade={capacidade} pendentes={pendentes} onAjustarRotina={onAjustarRotina} blocos={blocos} dia={dia} concluidasDoDia={concluidasDoDia} abrirDocumento={abrirDocumento} />
      </section>
    </div>
  );
}

type PropsPopup = { visaoDia: import("react").ReactNode; ancora: AncoraPopup | null; dia: Date; blocos: TarefaResumo[] | null; concluidasDoDia: TarefaResumo[]; capacidade: Capacidade | null; semRotina: boolean; erro: string | null; pendentes: number; onFechar: () => void; onAjustarRotina: () => void; abrirDocumento: AbrirDocumento };

/** Desktop: janela flutuante ancorada no dia. Celular: folha que sobe da base. */
function PopupTarefas({ sheet, ...props }: PropsPopup & { sheet: boolean }) {
  return sheet ? <FolhaDoDia {...props} /> : <PopupJanela {...props} />;
}

function PopupJanela({ ancora, dia, blocos, concluidasDoDia, capacidade, semRotina, erro, pendentes, onFechar, onAjustarRotina, abrirDocumento, visaoDia }: { visaoDia: import("react").ReactNode; ancora: AncoraPopup | null; dia: Date; blocos: TarefaResumo[] | null; concluidasDoDia: TarefaResumo[]; capacidade: Capacidade | null; semRotina: boolean; erro: string | null; pendentes: number; onFechar: () => void; onAjustarRotina: () => void; abrirDocumento: AbrirDocumento }) {
  const titulo = dia.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
  const janelaRef = useRef<HTMLElement>(null);
  const [fixado, setFixado] = useState(false);
  const [visao, setVisao] = useState<"feed" | "dia">("feed");
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
  // A janela nasce do próprio número do dia: parte do retângulo dele e cresce até a posição final.
  useEffect(() => {
    const quadro = requestAnimationFrame(() => {
      setAnimarEntrada(true);
      const el = janelaRef.current;
      if (!el || !ancora || typeof el.animate !== "function" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
      el.animate(
        [{ opacity: 0, transform: "scale(0.85)" }, { opacity: 1, transform: "scale(1)" }],
        { duration: 220, easing: "ease-out" },
      );
    });
    return () => cancelAnimationFrame(quadro);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clicar fora do popup fecha; o clique num dia seguinte reabre já no novo dia.
  useEffect(() => {
    if (fixado) return;
    const fora = (e: globalThis.PointerEvent) => {
      if (!janelaRef.current?.contains(e.target as Node)) onFechar();
    };
    document.addEventListener("pointerdown", fora);
    return () => document.removeEventListener("pointerdown", fora);
  }, [onFechar, fixado]);

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
      <section ref={janelaRef} role="dialog" aria-modal="false" aria-label={`Tarefas de ${titulo}`} className={`${animarEntrada ? (ancora ? "" : "agenda-popup-entra") : "opacity-0"} pointer-events-auto absolute flex flex-col overflow-hidden rounded-xl border bg-base shadow-nav ${interagindo ? "border-cyan/70" : "border-border"} ${interagindo || !animarEntrada ? "" : "transition-[left,top,width,height] duration-200 ease-out"}`} style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height, transformOrigin: `${origemX}% ${origemY}` }}>
        <header onPointerDown={(e) => { if (!(e.target as HTMLElement).closest("button")) iniciar(e, "mover"); }} onPointerMove={mover} onPointerUp={encerrar} onPointerCancel={encerrar} className={`flex shrink-0 items-center justify-between border-b border-border bg-surface-1 px-3 py-2 ${interagindo ? "cursor-grabbing" : "cursor-grab"}`}><div className="min-w-0"><p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Agenda</p><h2 className="truncate font-display text-base capitalize text-text-primary">{titulo}</h2></div><div className="flex gap-1"><button type="button" onClick={() => setVisao((v) => (v === "feed" ? "dia" : "feed"))} title={visao === "feed" ? "Ver o dia por horários" : "Ver lista de tarefas"} aria-label={visao === "feed" ? "Ver o dia por horários" : "Ver lista de tarefas"} className={`flex h-8 w-8 items-center justify-center rounded-md ${visao === "dia" ? "bg-steel-700 text-white" : "text-text-muted hover:bg-surface-2"}`}>{visao === "feed" ? <Clock size={15} /> : <ListChecks size={15} />}</button><button type="button" onClick={() => setFixado((valor) => !valor)} title={fixado ? "Desafixar do calendário" : "Fixar posição"} aria-label={fixado ? "Desafixar" : "Fixar"} className={`flex h-8 w-8 items-center justify-center rounded-md ${fixado ? "bg-steel-700 text-white" : "text-text-muted hover:bg-surface-2"}`}><Pin size={15} /></button><button type="button" onClick={onFechar} aria-label="Fechar tarefas" className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text-primary"><X size={17} /></button></div></header>
        <CorpoDoDia visao={visao} visaoDia={visaoDia} semRotina={semRotina} erro={erro} capacidade={capacidade} pendentes={pendentes} onAjustarRotina={onAjustarRotina} blocos={blocos} dia={dia} concluidasDoDia={concluidasDoDia} abrirDocumento={abrirDocumento} />
        <div aria-hidden onPointerDown={(e) => iniciar(e, "redimensionar")} onPointerMove={mover} onPointerUp={encerrar} onPointerCancel={encerrar} className="absolute bottom-0 right-0 h-5 w-5 cursor-nwse-resize" />
      </section>
    </div>
  );
}
