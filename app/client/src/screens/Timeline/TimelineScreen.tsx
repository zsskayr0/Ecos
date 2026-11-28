import { Fragment, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Activity, AlertTriangle, ArrowDown, ArrowUp, Clock, Plus } from "lucide-react";
import { tarefas } from "@/lib/api";
import { dataLocalISO, diaEMinutosLocais, diasEntre, instanteLocalISO, somarDiasISO } from "@/lib/agenda-tempo";
import { useEventosDoPeriodo } from "@/lib/eventos-agenda";
import { useEspacoFiltro } from "@/lib/use-espaco-filtro";
import { useNavigate } from "react-router-dom";
import { useAbrirDocumento } from "@/lib/documento-popup";
import { useIsDesktop } from "@/lib/use-viewport";
import { useRefreshBus } from "@/lib/refresh-bus";
import { avisarComDesfazer } from "@/lib/desfazer";
import { mensagemDeErro } from "@/lib/erros";
import {
  atrasadasAteOntem, janelaComDia, janelaInicial, montarTimeline, ramosDoRegistro, resumirDia, trechosDaTimeline,
  MAX_DIAS, PASSO_DIAS, type ItemTimeline, type Janela,
} from "@/lib/timeline";
import { SkeletonHoje } from "@/components/common/SkeletonTelas";
import { EventoDialog } from "@/screens/Eventos/EventoDialog";
import { CalendarioAtividade } from "./CalendarioAtividade";
import { iniciarArrasteMes } from "@/lib/arraste-mes";
import { tipoDoItem } from "@/lib/filtros-agenda";
import { PopoverAncorado, quandoDoItem, type ResumoPopover } from "@/components/common/PopoverAncorado";
import { FaixaVazia, GrupoDia } from "./GrupoDia";
import { LinhaItem, MarcadorAgora, type AcoesItem } from "./LinhaItem";
import { PainelDoDia } from "./PainelDoDia";
import { useDadosDaTimeline, useIntensidadeDoMes } from "./dados";
import { ALTURA_CABECALHO, TRONCO } from "./geometria";
import { lerMemoria, useGuardarMemoria } from "./memoria";
import "./timeline.css";

const fmtDiaCurto = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "numeric", month: "short" });
const fmtDiaCheio = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" });
const fmtDiaMes = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long" });
const formatar = (f: Intl.DateTimeFormat, dia: string) => f.format(new Date(`${dia}T12:00:00`)).replace(/\./g, "");
const maiuscula = (t: string) => t[0].toUpperCase() + t.slice(1);

function rotuloDoDia(dia: string, hoje: string): string {
  const distancia = diasEntre(hoje, dia);
  if (distancia === 0) return maiuscula(formatar(fmtDiaCheio, dia));
  if (distancia === -1) return "Ontem";
  if (distancia === 1) return "Amanhã";
  return maiuscula(formatar(fmtDiaCurto, dia));
}

/** Relógio de minuto em minuto: o marcador "agora" e o vermelho dos atrasos acompanham o tempo sem recarregar. */
function useAgora(): Date {
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setAgora(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return agora;
}

/** Quais grupos estão recolhidos. "Atrasadas" começa sempre recolhido; os dias, abertos. */
function useRecolhidos(iniciais: string[] = ["atrasadas"]) {
  const [recolhidos, setRecolhidos] = useState<Set<string>>(() => new Set(iniciais));
  const alternar = (id: string) => setRecolhidos((atual) => {
    const novo = new Set(atual);
    if (!novo.delete(id)) novo.add(id);
    return novo;
  });
  const abrir = (id: string) => setRecolhidos((atual) => {
    if (!atual.has(id)) return atual;
    const novo = new Set(atual);
    novo.delete(id);
    return novo;
  });
  return { recolhidos, recolhido: (id: string) => recolhidos.has(id), alternar, abrir };
}

/**
 * Timeline: o tempo como uma linha contínua. No trilho principal, o que estava programado (tarefas, prazos, eventos,
 * lançamentos do Cofre); num ramo ao lado, o que a pessoa fez (notas e tarefas criadas, editadas, concluídas).
 * Abre em volta de hoje e cresce para o passado e para o futuro. Ao lado, o resumo de hoje e o calendário de atividade.
 */
/** Timeline embutida ao lado do mês da Agenda (desktop): sem cabeçalho nem painéis, rolagem própria e dia em foco sincronizado. */
export interface TimelineEmbutida {
  /** Dia que a grade do mês pediu para mostrar (AAAA-MM-DD). */
  diaEmFoco?: string | null;
  /** Avisa o dia que está no topo da coluna depois que a rolagem assenta. */
  onDiaEmFoco?: (dia: string) => void;
  /** "Meus calendários": tipos escondidos somem da coluna também. */
  filtros?: import("@/lib/filtros-agenda").FiltrosAgenda;
  /** Sobe a cada pedido da grade, mesmo para o mesmo dia. */
  versaoPedido?: number;
  /** Botão "+" (no hover) do cabeçalho do dia: criar algo naquele dia. */
  onNovoNoDia?: (dia: string) => void;
  /** Mostrar o registro de atividade (o toggle fica na barra da Agenda). */
  mostrarAtividade?: boolean;
  /** Grade de horários que a Agenda sabe desenhar, para os dias do período carregado nela (de..ate). */
  horarios?: { de: string; ate: string; render: (dia: string) => ReactNode };
}

const CHAVE_ATIVIDADE = "ecos.agenda.mostrarAtividade";
/** Na Agenda o registro de atividade começa desligado: o que está programado vem primeiro. */
export function lerMostrarAtividade(): boolean {
  try { return localStorage.getItem(CHAVE_ATIVIDADE) === "1"; } catch { return false; }
}
export function gravarMostrarAtividade(valor: boolean) {
  try { localStorage.setItem(CHAVE_ATIVIDADE, valor ? "1" : "0"); } catch { /* sem armazenamento: só nesta sessão */ }
}

export function TimelineScreen({ embutida }: { embutida?: TimelineEmbutida } = {}) {
  const { versao, notificar } = useRefreshBus();
  const abrirDocumento = useAbrirDocumento();
  const navigate = useNavigate();
  const desktop = useIsDesktop();
  const hoje = dataLocalISO(new Date());
  // Voltando de uma nota/tarefa: retoma janela, grupos, mês e rolagem de onde a pessoa estava.
  const [lembrada] = useState(() => lerMemoria(hoje));
  const [janela, setJanela] = useState<Janela>(() => lembrada?.janela ?? janelaInicial(hoje));
  const [eventoEmEdicao, setEventoEmEdicao] = useState<{ id: string; ocorrencia?: string } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const { recolhidos, recolhido, alternar, abrir: abrirGrupo } = useRecolhidos(lembrada?.recolhidos);

  // Fora da Agenda (a Timeline própria do celular) o registro aparece sempre.
  const mostrarAtividade = embutida ? !!embutida.mostrarAtividade : true;
  const { dados, erro } = useDadosDaTimeline(janela, versao);
  /** Embutida: o dia aberto em horários (um por vez). */
  const [diaEmHorarios, setDiaEmHorarios] = useState<string | null>(null);
  const horarios = embutida?.horarios;
  const temHorarios = (dia: string) => !!horarios && dia >= horarios.de && dia <= horarios.ate;
  const { eventos } = useEventosDoPeriodo(janela.de, janela.ate, versao, useEspacoFiltro(), true);
  const agora = useAgora();

  const filtros = embutida?.filtros;
  const dias = useMemo(() => {
    if (!dados) return [];
    const todos = montarTimeline({ janela, tarefas: dados.tarefas, eventos, atividades: mostrarAtividade ? dados.atividades : [], agora });
    return filtros ? todos.map((d) => ({ ...d, itens: d.itens.filter((i) => filtros[tipoDoItem(i)]) })) : todos;
  }, [dados, eventos, janela, agora, mostrarAtividade, filtros]);
  const atrasadas = useMemo(() => dados ? atrasadasAteOntem(dados.atrasadas, agora) : [], [dados, agora]);
  const resumo = useMemo(() => resumirDia(dias.find((d) => d.dia === hoje), atrasadas.length), [dias, hoje, atrasadas.length]);
  const [mesCalendario, setMesCalendario] = useState(() => lembrada?.mesCalendario ?? hoje.slice(0, 7));
  const intensidade = useIntensidadeDoMes(mesCalendario, versao);
  const trechos = useMemo(() => trechosDaTimeline(dias, hoje, !!embutida), [dias, hoje, !!embutida]);
  const listaRecolhidos = useMemo(() => [...recolhidos], [recolhidos]);
  useGuardarMemoria({ dia: hoje, janela, recolhidos: listaRecolhidos, mesCalendario });
  const podeCrescer = diasEntre(janela.de, janela.ate) + 1 < MAX_DIAS;

  const executar = async (acao: () => Promise<unknown>, falha: string) => {
    setAviso(null);
    try { await acao(); } catch (e) { setAviso(mensagemDeErro(e, falha)); }
    notificar();
  };
  const [popover, setPopover] = useState<{ ancora: DOMRect; origem: HTMLElement; resumo: ResumoPopover } | null>(null);
  const abrirDireto = (item: ItemTimeline, e?: MouseEvent<HTMLButtonElement>) => {
    const alvo = item.alvo;
    if (!alvo) return;
    if (alvo.tipo === "evento") {
      if (desktop) setEventoEmEdicao({ id: alvo.id, ocorrencia: alvo.ocorrencia });
      else navigate(`/eventos?evento=${encodeURIComponent(alvo.id)}${alvo.ocorrencia ? `&ocorrencia=${encodeURIComponent(alvo.ocorrencia)}` : ""}`);
    }
    else if (alvo.tipo === "transacao") abrirDocumento(`/cofre/transacao/${alvo.id}`, e);
    else if (alvo.tipo === "recorrencia") navigate("/cofre/recorrencias");
    else abrirDocumento(`/${alvo.tipo}/${alvo.id}`, e);
  };
  /** Embutida na Agenda: o clique abre o popover do item (resumo + ações), como na grade do mês. */
  const resumoDoItem = (item: ItemTimeline): ResumoPopover => {
    const alvo = item.alvo!;
    const quando = quandoDoItem(item.dia, item.minutos);
    const abrir = { rotulo: alvo.tipo === "evento" ? "Editar" : alvo.tipo === "recorrencia" ? "Ver recorrências" : alvo.tipo === "transacao" ? "Abrir lançamento" : "Abrir", onClick: () => abrirDireto(item) };
    const tipo = item.natureza === "registro" ? "Atividade" : alvo.tipo === "tarefa" ? (item.icone === "prazo" ? "Prazo de tarefa" : "Tarefa") : alvo.tipo === "nota" ? "Nota" : alvo.tipo === "evento" ? "Evento" : alvo.tipo === "recorrencia" ? "Conta a vencer" : "Lançamento do Cofre";
    const tarefaAberta = alvo.tipo === "tarefa" && item.natureza !== "registro" && item.situacao !== "concluida";
    return {
      tipo, titulo: item.titulo, quando, detalhe: item.detalhe, cor: item.cor,
      acoes: tarefaAberta ? [{ ...abrir }, { rotulo: "Adiar", onClick: () => acoes.onAdiar(item) }, { rotulo: "Concluir", primaria: true, onClick: () => acoes.onConcluir(item) }] : [{ ...abrir, primaria: true }],
    };
  };
  const acoes: AcoesItem = {
    onAbrir: (item: ItemTimeline, e: MouseEvent<HTMLButtonElement>) => {
      const alvo = item.alvo;
      if (!alvo) return;
      if (embutida) {
        const origem = e.currentTarget;
        setPopover((atual) => (atual?.origem === origem ? null : { ancora: origem.getBoundingClientRect(), origem, resumo: resumoDoItem(item) }));
        return;
      }
      abrirDireto(item, e);
    },
    onArrastar: embutida ? (item, e) => {
      const alvo = item.alvo;
      if (!alvo || alvo.tipo === "nota") return false;
      setPopover(null);
      const prazo = alvo.tipo === "tarefa" && item.icone === "prazo";
      iniciarArrasteMes(e, { chave: item.chave, scheduledAt: prazo ? null : item.info?.scheduledAt ?? null, dueDate: prazo ? item.dia : null });
      return true;
    } : undefined,
    onConcluir: (item) => {
      const id = item.alvo?.id;
      if (!id) return;
      void executar(async () => {
        await tarefas.atualizarStatus(id, "concluida");
        avisarComDesfazer("Tarefa concluída.", () => tarefas.atualizarStatus(id, "pendente"), { aoDesfazer: notificar, sucesso: "Tarefa reaberta." });
      }, "Não foi possível concluir a tarefa.");
    },
    onAdiar: (item) => {
      const id = item.alvo?.id;
      if (!id) return;
      const amanha = somarDiasISO(hoje, 1);
      const scheduledAt = item.info?.scheduledAt;
      const payload = scheduledAt ? { scheduled_at: instanteLocalISO(amanha, diaEMinutosLocais(scheduledAt).minutos) } : { due_date: amanha };
      void executar(() => tarefas.atualizar(id, { ...payload, adiar: item.dia < amanha }), "Não foi possível adiar a tarefa.");
    },
  };

  // Pular para um dia (pelo calendário): abre o grupo, estende a janela se preciso e rola quando ele existir.
  const diaPendente = useRef<string | null>(null);
  /** O dia pode ter grupo próprio ou estar dentro de uma faixa de dias vazios. */
  // Procura só nesta Timeline: as abas do app ficam montadas em segundo plano, e o mesmo dia pode existir em outra.
  const listaRef = useRef<HTMLOListElement>(null);
  const elementoDoDia = (dia: string) => {
    const raiz: ParentNode = listaRef.current ?? document;
    return raiz.querySelector<HTMLElement>(`[data-dia="${dia}"]`)
      ?? [...raiz.querySelectorAll<HTMLElement>("[data-faixa-de]")].find((el) => el.dataset.faixaDe! <= dia && dia <= el.dataset.faixaAte!)
      ?? null;
  };
  const rolarAte = (dia: string) => {
    const el = elementoDoDia(dia);
    const coluna = colunaRef.current;
    // Na coluna da Agenda, um salto longo rolado de ponta a ponta trava: pula quase até lá e anima só o último trecho.
    if (el && coluna && embutida) {
      const distancia = el.getBoundingClientRect().top - coluna.getBoundingClientRect().top;
      const trecho = coluna.clientHeight * 0.6;
      if (Math.abs(distancia) > trecho * 2) coluna.scrollTop += distancia - Math.sign(distancia) * trecho;
    }
    el?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  };
  const irPara = (dia: string) => {
    abrirGrupo(dia);
    // Embutida: o dia precisa de dias depois dele para conseguir subir até o topo; perto do fim, a janela cresce.
    if (embutida && dia >= janela.de && dia <= janela.ate && diasEntre(dia, janela.ate) < 7 && diasEntre(janela.de, janela.ate) + 1 < MAX_DIAS) {
      diaPendente.current = dia;
      setJanela((j) => ({ ...j, ate: somarDiasISO(j.ate, PASSO_DIAS) }));
      return;
    }
    if (dia < janela.de || dia > janela.ate) {
      diaPendente.current = dia;
      // Embutida: um dia longe não estica a janela até ele (centenas de dias para buscar e desenhar); ela muda para em volta dele.
      const longe = embutida && (diasEntre(janela.ate, dia) > PASSO_DIAS || diasEntre(dia, janela.de) > PASSO_DIAS);
      setJanela((j) => (longe ? janelaInicial(dia) : janelaComDia(j, dia)));
      return;
    }
    rolarAte(dia);
  };
  useEffect(() => {
    const dia = diaPendente.current;
    if (dia && elementoDoDia(dia)) { diaPendente.current = null; rolagemExterna.current = Date.now(); alvoTravado.current = dia; rolarAte(dia); return; }
    // Embutida: eventos e Cofre chegam depois e empurram os dias; se a última rolagem foi nossa, realinha sem animar.
    const alvo = alvoTravado.current;
    if (embutida && alvo) elementoDoDia(alvo)?.scrollIntoView?.({ block: "start" });
  }, [dias]);

  // Na primeira carga, rola até hoje (o passado fica logo acima, a um gesto) — ou, na volta, até onde a pessoa estava.
  const hojeRef = useRef<HTMLLIElement | null>(null);
  const rolou = useRef(false);
  useEffect(() => {
    if (!dados || rolou.current) return;
    rolou.current = true;
    if (embutida) { rolagemExterna.current = Date.now(); alvoTravado.current = embutida.diaEmFoco ?? hoje; irPara(alvoTravado.current); }
    else if (lembrada) window.scrollTo({ top: lembrada.rolagem });
    else hojeRef.current?.scrollIntoView({ block: "start" });
  }, [dados]);

  // Embutida: o dia em foco vai e volta entre a grade do mês e a coluna.
  const colunaRef = useRef<HTMLDivElement>(null);
  const ultimoFoco = useRef<string | null>(embutida?.diaEmFoco ?? null);
  /** Enquanto a coluna rola por pedido da grade, ela não devolve o foco (a grade pularia no meio do caminho). */
  const rolagemExterna = useRef(0);
  /** Último dia que a coluna foi mandada mostrar (para realinhar se o conteúdo crescer acima dele). */
  const alvoTravado = useRef<string | null>(null);
  const pedido = embutida?.diaEmFoco ?? null;
  /** Dia que a coluna destaca: o pedido pela grade ou o que a rolagem trouxe para o topo. */
  const [diaFocado, setDiaFocado] = useState<string | null>(pedido);
  useEffect(() => { if (pedido) setDiaFocado(pedido); }, [pedido]);
  // `versaoPedido` sobe a cada clique na grade (ou em Hoje): clicar de novo no mesmo dia também traz a coluna até ele.
  const versaoPedido = embutida?.versaoPedido ?? 0;
  const ultimaVersao = useRef(versaoPedido);
  useEffect(() => {
    if (!embutida || !pedido || !rolou.current) return;
    // Eco: o dia veio da própria coluna (rolagem) e a grade só o repetiu; sem clique novo, não rola de novo.
    const cliqueNovo = versaoPedido !== ultimaVersao.current;
    ultimaVersao.current = versaoPedido;
    if (!cliqueNovo && pedido === ultimoFoco.current) return;
    ultimoFoco.current = pedido;
    rolagemExterna.current = Date.now();
    alvoTravado.current = pedido;
    setDiaFocado(pedido);
    irPara(pedido);
  }, [pedido, versaoPedido]);
  const avisarFoco = embutida?.onDiaEmFoco;
  const temColuna = !!embutida && dados !== null;
  useEffect(() => {
    const coluna = colunaRef.current;
    if (!temColuna || !coluna) return;
    let espera = 0;
    /** O dia do cabeçalho preso no topo: o primeiro grupo que ainda passa da altura do cabeçalho. */
    const diaNoTopo = () => {
      const topo = coluna.getBoundingClientRect().top + ALTURA_CABECALHO;
      const grupos = coluna.querySelectorAll<HTMLElement>("[data-dia]:not([data-dia=atrasadas]), [data-faixa-de]");
      const alvo = [...grupos].find((el) => el.getBoundingClientRect().bottom > topo);
      return alvo?.dataset.dia ?? alvo?.dataset.faixaDe ?? null;
    };
    const externa = () => !!diaPendente.current || !!alvoTravado.current || Date.now() - rolagemExterna.current < 900;
    // A grade só recebe o dia quando a rolagem assenta (trocar de mês a cada quadro faria a grade piscar).
    const assentou = () => {
      if (diaPendente.current) return;
      if (Date.now() - rolagemExterna.current < 900) { rolagemExterna.current = Date.now(); return; }
      // A rolagem foi nossa e parou antes (conteúdo novo a interrompeu): termina de levar o dia pedido até o topo.
      const alvo = alvoTravado.current;
      if (alvo) {
        if (diaNoTopo() !== alvo) { rolagemExterna.current = Date.now(); elementoDoDia(alvo)?.scrollIntoView?.({ block: "start" }); }
        return;
      }
      // Rolagem por dia: no meio de um dia, livre; perto da virada, encaixa. Se o próximo dia já passou da linha
      // (35% da altura), ele sobe para o topo; se a pessoa só entrou um pouco no dia, ele volta ao começo do dia.
      const topoColuna = coluna.getBoundingClientRect().top;
      const grupos = [...coluna.querySelectorAll<HTMLElement>("li[data-dia]:not([data-dia=atrasadas])")];
      const i = grupos.findIndex((el) => el.getBoundingClientRect().bottom > topoColuna + ALTURA_CABECALHO);
      const atual = grupos[i];
      const proximo = grupos[i + 1];
      const linha = coluna.clientHeight * 0.35;
      let encaixe: HTMLElement | null = null;
      if (atual && proximo && proximo.getBoundingClientRect().top - topoColuna < linha) encaixe = proximo;
      else if (atual) {
        const dentro = topoColuna - atual.getBoundingClientRect().top;
        // Entrou só um pouco no dia, ou parou com o fim do dia anterior ainda à mostra: volta ao começo dele.
        if ((dentro > 2 && dentro < Math.min(linha, atual.offsetHeight * 0.5)) || (dentro < -2 && dentro > -linha)) encaixe = atual;
      }
      if (encaixe) { rolagemExterna.current = Date.now(); encaixe.scrollIntoView({ block: "start", behavior: "smooth" }); }
      const dia = encaixe?.dataset.dia ?? diaNoTopo();
      if (!dia || dia === ultimoFoco.current) return;
      ultimoFoco.current = dia;
      setDiaFocado(dia);
      avisarFoco?.(dia);
    };
    // O destaque (o resto esmaecido) acompanha a rolagem quadro a quadro.
    let quadro = 0;
    const aoRolar = () => {
      window.clearTimeout(espera);
      espera = window.setTimeout(assentou, 120);
      if (quadro || externa()) return;
      quadro = window.requestAnimationFrame(() => { quadro = 0; const dia = diaNoTopo(); if (dia) setDiaFocado((atual) => (atual === dia ? atual : dia)); });
    };
    // Só a pessoa solta o dia pedido: roda do mouse, toque, arrastar a barra ou teclas de rolagem.
    const soltar = () => { alvoTravado.current = null; rolagemExterna.current = 0; };
    const soltarPorTecla = (e: KeyboardEvent) => { if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(e.key)) soltar(); };
    coluna.addEventListener("scroll", aoRolar, { passive: true });
    coluna.addEventListener("wheel", soltar, { passive: true });
    coluna.addEventListener("touchstart", soltar, { passive: true });
    coluna.addEventListener("pointerdown", soltar);
    coluna.addEventListener("keydown", soltarPorTecla);
    return () => {
      coluna.removeEventListener("scroll", aoRolar); coluna.removeEventListener("wheel", soltar); coluna.removeEventListener("touchstart", soltar);
      coluna.removeEventListener("pointerdown", soltar); coluna.removeEventListener("keydown", soltarPorTecla);
      window.clearTimeout(espera); window.cancelAnimationFrame(quadro);
    };
  }, [temColuna, avisarFoco]);

  const botaoMais = "rounded-lg px-2.5 py-1 text-xs font-medium text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary";
  const calendario = <CalendarioAtividade hoje={hoje} mes={mesCalendario} intensidade={intensidade} onMudarMes={setMesCalendario} onIrPara={irPara} />;

  const linhaDoTempo = dados === null ? <SkeletonHoje rotulo="Carregando a timeline…" className="pt-4" /> : <>
          {podeCrescer && <button type="button" onClick={() => setJanela((j) => ({ ...j, de: somarDiasISO(j.de, -PASSO_DIAS) }))} className={botaoMais} style={{ marginLeft: TRONCO + 8 }}>Ver dias anteriores</button>}
          <ol ref={listaRef} className="relative pt-1" aria-label="Timeline">
            {atrasadas.length > 0 && <GrupoDia id="atrasadas" rotulo="Atrasadas" contagem={atrasadas.length} destaque primeiro recolhido={recolhido("atrasadas")} onAlternar={alternar}>
              {atrasadas.map((item, i) => <LinhaItem key={item.chave} item={item} indice={i} enfase mostrarData acoes={acoes} />)}
            </GrupoDia>}
            {trechos.map((trecho, n) => {
              const ultimo = n === trechos.length - 1;
              if (trecho.tipo === "vazio") return <FaixaVazia key={trecho.de} de={trecho.de} ate={trecho.ate} ultimo={ultimo} foco={!!embutida && !!diaFocado && trecho.de <= diaFocado && diaFocado <= trecho.ate} />;
              const { dia, itens } = trecho.dia;
              const ehHoje = dia === hoje;
              const minutoAgora = agora.getHours() * 60 + agora.getMinutes();
              const posAgora = ehHoje ? itens.findIndex((i) => (i.minutos ?? -1) > minutoAgora) : -1;
              const ramos = ramosDoRegistro(itens);
              const porLinha = ramos.some((r) => r.porLinha);
              return <GrupoDia key={dia} id={dia} rotulo={embutida && ehHoje ? `Hoje, ${formatar(fmtDiaMes, dia)}` : rotuloDoDia(dia, hoje)} semCartao={!!embutida} subtitulo={Math.abs(diasEntre(hoje, dia)) === 1 ? formatar(fmtDiaCurto, dia) : undefined}
                foco={!!embutida && dia === diaFocado} contagem={itens.length} atual={ehHoje} futuro={dia > hoje} primeiro={n === 0 && atrasadas.length === 0} ultimo={ultimo}
                recolhido={recolhido(dia)} onAlternar={alternar} refDia={ehHoje ? hojeRef : undefined} trilhoPorLinha={porLinha}
                extra={embutida ? <span className="flex items-center gap-0.5">
                  {embutida.onNovoNoDia && <button type="button" aria-label={`Criar no dia ${formatar(fmtDiaMes, dia)}`} title="Criar neste dia" onClick={() => embutida.onNovoNoDia!(dia)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted opacity-0 transition-opacity hover:bg-surface-2 hover:text-text-primary focus-visible:opacity-100 group-hover/dia:opacity-100"><Plus size={15} /></button>}
                  {temHorarios(dia) && <button type="button" aria-pressed={diaEmHorarios === dia} aria-label={diaEmHorarios === dia ? "Fechar os horários do dia" : "Ver o dia por horários"} title={diaEmHorarios === dia ? "Fechar horários" : "Ver por horários"}
                  onClick={() => { abrirGrupo(dia); setDiaEmHorarios((atual) => (atual === dia ? null : dia)); }}
                  className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${diaEmHorarios === dia ? "bg-steel-700 text-on-steel" : "text-text-muted hover:bg-surface-2 hover:text-text-primary"}`}><Clock size={15} /></button>}
                </span> : undefined}>
                {diaEmHorarios === dia && temHorarios(dia) && <li data-horarios-dia={dia} className="mb-2 flex h-[30rem] min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface-1">{horarios!.render(dia)}</li>}
                {itens.length === 0 && <li className="ecos-timeline-item py-2 text-sm text-text-muted">Nada programado neste dia.</li>}
                {itens.map((item, i) => <Fragment key={item.chave}>
                  {ehHoje && i === posAgora && <MarcadorAgora agora={agora} trilho={porLinha} />}
                  <LinhaItem item={item} indice={i} ramo={ramos[i]} acoes={acoes} />
                </Fragment>)}
                {ehHoje && itens.length > 0 && posAgora === -1 && <MarcadorAgora agora={agora} trilho={porLinha} />}
              </GrupoDia>;
            })}
          </ol>
          {podeCrescer && <button type="button" onClick={() => setJanela((j) => ({ ...j, ate: somarDiasISO(j.ate, PASSO_DIAS) }))} className={botaoMais} style={{ marginLeft: TRONCO + 8 }}>Ver próximos dias</button>}
        </>;
  const dialogoEvento = <EventoDialog aberto={eventoEmEdicao !== null} eventoId={eventoEmEdicao?.id ?? null} ocorrencia={eventoEmEdicao?.ocorrencia ?? null} categorias={[]} onFechar={() => setEventoEmEdicao(null)} onSalvo={() => { setEventoEmEdicao(null); notificar(); }} />;

  if (embutida) return <section aria-label="Timeline" className="flex min-h-0 flex-col overflow-hidden">
    {erro && <div role="alert" className="m-3 flex items-start gap-2 rounded-xl border border-error/40 bg-error/10 p-3 text-sm text-error"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{erro}</div>}
    {aviso && <div role="alert" className="m-3 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning">{aviso}</div>}
    <div ref={colunaRef} data-coluna-timeline data-com-foco={diaFocado ? "" : undefined} className="scroll-discreto min-h-0 flex-1 overflow-y-auto pb-10 pl-1 pr-3">{linhaDoTempo}</div>
    {dialogoEvento}
    {popover && <PopoverAncorado ancora={popover.ancora} origem={popover.origem} resumo={popover.resumo} onFechar={() => setPopover(null)} />}
  </section>;

  return <div className="w-full max-w-[92rem] px-4 pb-16 pt-1 max-lg:mx-auto max-lg:max-w-3xl">
    {/* No desktop o título fica onde fica o de Notas e Tarefas; no celular, preso ao topo. */}
    <header className="mb-2 max-lg:sticky max-lg:top-0 max-lg:z-10 max-lg:-mx-4 max-lg:border-b max-lg:border-border max-lg:bg-base/90 max-lg:px-4 max-lg:py-3 max-lg:backdrop-blur lg:mb-4">
      <h1 className="font-display text-2xl text-text-primary">Timeline</h1>
    </header>

    {erro && <div role="alert" className="mb-4 flex items-start gap-2 rounded-2xl border border-error/40 bg-error/10 p-3 text-sm text-error"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{erro}</div>}
    {aviso && <div role="alert" className="mb-4 rounded-2xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning">{aviso}</div>}

    {/* Desktop: resumo à esquerda, Timeline no centro, calendário à direita (abaixo do resumo em telas médias). */}
    <div className="lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start lg:gap-10 2xl:grid-cols-[18rem_minmax(0,52rem)_18rem]">
      <div className="mb-4 flex flex-col gap-3 lg:sticky lg:top-4 lg:mb-0">
        {dados && <PainelDoDia hoje={hoje} versao={versao} resumo={resumo} />}
        {dados && <div className="max-lg:hidden 2xl:hidden">{calendario}</div>}
      </div>

      <div className="min-w-0">
        {linhaDoTempo}
      </div>

      {dados && <div className="hidden 2xl:sticky 2xl:top-4 2xl:block">{calendario}</div>}
    </div>

    {dados && <BotaoHoje alvo={hojeRef} versao={dias.length} />}
    {dialogoEvento}
  </div>;
}

/**
 * Botão flutuante "Hoje": aparece quando o dia de hoje sai da tela e rola de volta até ele. A seta diz para que lado
 * ele ficou. No celular fica acima da barra de baixo, à direita (o "+" está no centro).
 */
function BotaoHoje({ alvo, versao }: { alvo: React.RefObject<HTMLLIElement | null>; versao: number }) {
  const [lado, setLado] = useState<"acima" | "abaixo" | null>(null);
  useEffect(() => {
    const el = alvo.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(([e]) => {
      if (!e) return;
      setLado(e.isIntersecting ? null : e.boundingClientRect.top < 0 ? "acima" : "abaixo");
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [alvo, versao]);
  if (!lado) return null;
  const Seta = lado === "acima" ? ArrowUp : ArrowDown;
  return <button type="button" onClick={() => alvo.current?.scrollIntoView({ block: "start", behavior: "smooth" })}
    className="ecos-pop fixed bottom-[calc(var(--ecos-safe-bottom,0px)+96px)] right-4 z-40 flex min-h-11 items-center gap-1.5 rounded-full border border-cyan/40 bg-surface-1/95 px-4 text-sm font-semibold text-cyan shadow-nav backdrop-blur-md hover:bg-surface-2 lg:bottom-6 lg:right-6">
    <Seta size={16} aria-hidden />Hoje
  </button>;
}
