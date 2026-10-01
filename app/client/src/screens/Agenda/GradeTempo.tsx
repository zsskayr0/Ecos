import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { CheckCircle2, Expand, Flag, Inbox, ListChecks, MoreHorizontal, Trash2, X } from "lucide-react";
import {
  DURACAO_VISUAL_MINIMA_MIN, INICIO_PADRAO_MIN, MINUTOS_DIA, OPCOES_ENCAIXE, PX_POR_HORA, PX_POR_MINUTO, acaoDaTecla, aplicarAcao, capacidadesDo, descreverPosicao, diaEMinutosLocais, horaLocal, distribuirColunas, duracaoDoPonteiro,
  duracaoParaAlocar, meioDiaLocal, posicaoDoPonteiro, posicaoIgual, rotuloHorario, type ColunaGeometria, type FaixaDiaTodoGeometria, type ItemAgenda, type Posicao,
} from "@/lib/agenda-tempo";
import type { TarefaResumo } from "@/lib/api";
import { useOuvirArrasteTarefa, type TarefaArrastavel } from "@/lib/arraste-tarefa";
import { formatarHoras } from "@/lib/agenda-planejamento";

/** Quanto o dedo precisa ficar parado sobre um bloco para "pegá-lo" (antes disso, arrastar rola a tela). */
export const LONGO_TOQUE_MS = 350;
/** Quanto o ponteiro anda (px) antes de um clique de mouse virar arrasto, e quanto o dedo pode andar durante a pressão longa. */
const LIMIAR_MOUSE_PX = 4;
const TOLERANCIA_TOQUE_PX = 8;
const ALTURA_CABECALHO = 60;
const BORDA_ROLAGEM_PX = 40;
/** Faixa "O dia todo": em "Resumo" é uma linha só de chips; em "Todos" cresce até `MAX_LINHAS_TODOS` linhas e depois rola por dentro. */
const ALTURA_FAIXA_RESUMO = 36;
const ALTURA_LINHA_FAIXA = 28;
const MAX_LINHAS_TODOS = 3;
/** Blocos que dividem a largura com tantos outros ou mais passam a mostrar o nome na vertical (e o nome inteiro ao passar o mouse). */
const COLUNAS_ESTREITO = 3;

export type ModoFaixa = "ocultar" | "resumo" | "todos";
export const CHAVE_FAIXA_DIA_TODO = "ecos:agenda:faixa-dia-todo";
const MODOS_FAIXA: { valor: ModoFaixa; rotulo: string }[] = [{ valor: "ocultar", rotulo: "Ocultar" }, { valor: "resumo", rotulo: "Resumo" }, { valor: "todos", rotulo: "Todos" }];

/** O estado da faixa é uma preferência de trabalho: volta como a pessoa deixou (Resumo, se nunca escolheu). */
function lerModoFaixa(): ModoFaixa {
  try {
    const salvo = localStorage.getItem(CHAVE_FAIXA_DIA_TODO);
    return salvo === "ocultar" || salvo === "todos" ? salvo : "resumo";
  } catch { return "resumo"; }
}

export interface GradeTempoProps {
  /** Dias mostrados, `YYYY-MM-DD` local, em ordem. */
  dias: string[];
  hoje: string;
  itens: ItemAgenda[];
  /** Tarefas concluídas por dia local: o dia ganha um selo no cabeçalho e um ✓ na hora exata em que foi concluída. */
  concluidas?: Map<string, TarefaResumo[]>;
  /** Granularidade do arrasto, em minutos. */
  encaixe: number;
  onMudarEncaixe: (encaixe: number) => void;
  /** Só o NÚMERO do dia chama isto (é o único gatilho do popup do dia). `alvo` é a célula do dia, para ancorar o popup. */
  onSelecionarDia: (dia: string, alvo: HTMLElement) => void;
  onAbrirItem: (item: ItemAgenda, e: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => void;
  /** Chamado uma vez por mudança confirmada pela pessoa (soltar o ponteiro, tecla, menu). A tela pai aplica e persiste. */
  onMover: (item: ItemAgenda, destino: Posicao, origem: "ponteiro" | "teclado" | "menu") => void;
  /** Remove um bloco de tempo (não a Tarefa). */
  onRemover?: (item: ItemAgenda) => void;
  /** Uma Tarefa arrastada de uma lista foi solta aqui: aloca `destino.duracaoMin` de tempo nesse dia/horário. Não altera a Tarefa. */
  onAlocarTarefa?: (tarefa: TarefaArrastavel, destino: Posicao) => void;
  /**
   * Minutos desde 00:00 em que a rolagem começa (o "início do tempo acordado"). As 24 horas continuam todas na grade:
   * isto só define até onde ela já vem rolada; dá para subir até 00:00 e descer até 23:00.
   */
  inicioMin?: number;
  agora?: Date;
  /** Muda a cada pedido "Hoje": a grade rola até o horário atual (uma vez por pedido). */
  rolarParaAgora?: number;
  /** Clicar (ou arrastar) num horário vazio abre a criação rápida; ao confirmar, a tela pai cria a Tarefa e aloca o tempo. */
  onCriarNoHorario?: (dados: NovaTarefaRapida) => Promise<string | void> | string | void;
  /** Depois da criação rápida, abre a visualização completa da tarefa recém-criada. */
  onAbrirTarefaCriada?: (id: string) => void;
  /** Abre o formulário completo quando ainda não há título suficiente para criar a tarefa. */
  onAbrirCriacaoCompleta?: () => void;
}

export interface NovaTarefaRapida {
  titulo: string;
  corpo: string;
  prioridade: "baixa" | "media" | "alta";
  destino: Posicao;
}

interface Gesto {
  chave: string;
  tipo: "mover" | "redimensionar";
  origem: Posicao;
  previa: Posicao;
  levantado: boolean;
}

/** Remove o "engolidor" do clique que o navegador dispara logo depois de um arrasto; vale só até a próxima interação. */
let descartarCliqueFantasma: (() => void) | null = null;

const posDoItem = (i: Posicao): Posicao => ({ dia: i.dia, inicioMin: i.inicioMin, duracaoMin: i.duracaoMin });

/** "8 prazos · 10,5 h": o que o dia guarda na faixa. As horas somam só o que tem estimativa. */
export function resumoDoDia(itens: ItemAgenda[]): { rotulo: string } {
  const prazos = itens.filter((i) => i.tipo === "prazo");
  const transacoes = itens.filter((i) => i.transacao);
  const outros = itens.length - prazos.length - transacoes.length;
  const minutos = prazos.reduce((soma, i) => soma + (i.semEstimativa ? 0 : i.duracaoMin), 0);
  const partes = [
    prazos.length > 0 ? `${prazos.length} ${prazos.length === 1 ? "prazo" : "prazos"}` : null,
    outros > 0 ? `${outros} ${outros === 1 ? "evento" : "eventos"}` : null,
    transacoes.length > 0 ? `${transacoes.length} ${transacoes.length === 1 ? "transação" : "transações"}` : null,
    minutos > 0 ? formatarHoras(minutos) : null,
  ].filter(Boolean);
  return { rotulo: partes.join(" · ") };
}

/** Cor livre do evento: fundo translúcido e texto/borda numa mistura da cor com o texto do tema (legível em claro e escuro). */
function estiloCorLivre(hex?: string): CSSProperties | undefined {
  if (!hex) return undefined;
  return { backgroundColor: `${hex}33`, color: `color-mix(in srgb, ${hex} 70%, var(--ecos-text-primary))` };
}

export function GradeTempo({ dias, hoje, itens, concluidas, encaixe, onMudarEncaixe, onSelecionarDia, onAbrirItem, onMover, onRemover, onAlocarTarefa, inicioMin = INICIO_PADRAO_MIN, agora = new Date(), rolarParaAgora = 0, onCriarNoHorario, onAbrirTarefaCriada, onAbrirCriacaoCompleta }: GradeTempoProps) {
  const rolagemRef = useRef<HTMLDivElement>(null);
  const [gesto, setGesto] = useState<Gesto | null>(null);
  const [previaExterna, setPreviaExterna] = useState<{ pos: Posicao; titulo: string } | null>(null);
  const [menuDe, setMenuDe] = useState<string | null>(null);
  const [aviso, setAviso] = useState("");
  const [modoFaixa, setModoFaixa] = useState<ModoFaixa>(lerModoFaixa);
  /** Lista aberta a partir de um chip de resumo (`dia`) ou do botão "O dia todo" (`dia: null` = o período inteiro). */
  const [lista, setLista] = useState<{ dia: string | null; ancora: DOMRect } | null>(null);
  const escolherModoFaixa = (modo: ModoFaixa) => {
    setModoFaixa(modo);
    setLista(null);
    try { localStorage.setItem(CHAVE_FAIXA_DIA_TODO, modo); } catch { /* preferência não salva */ }
  };
  const focoPendente = useRef<string | null>(null);
  const cancelarGesto = useRef<(() => void) | null>(null);
  const [selecao, setSelecao] = useState<Posicao | null>(null);
  const [criando, setCriando] = useState<{ pos: Posicao; rect: DOMRect } | null>(null);
  const previaSelecaoRef = useRef<HTMLDivElement>(null);
  const animacaoSelecaoRef = useRef<{ origem?: DOMRect } | null>(null);
  const fimDaAnimacaoSelecaoRef = useRef<Promise<void>>(Promise.resolve());

  // FLIP: a prévia troca de coluna no DOM, mas visualmente percorre a distância entre o dia antigo e o novo.
  useLayoutEffect(() => {
    const elemento = previaSelecaoRef.current;
    const animacao = animacaoSelecaoRef.current;
    if (!elemento || !animacao || !selecao) return;
    animacaoSelecaoRef.current = null;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || typeof elemento.animate !== "function") {
      fimDaAnimacaoSelecaoRef.current = Promise.resolve();
      return;
    }
    if (!animacao.origem) {
      const entrada = elemento.animate(
        [{ opacity: 0, transform: "translateY(5px) scale(0.96)" }, { opacity: 1, transform: "none" }],
        { duration: 220, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
      );
      fimDaAnimacaoSelecaoRef.current = entrada.finished.then(() => undefined, () => undefined);
      return;
    }
    const destino = elemento.getBoundingClientRect();
    const movimento = elemento.animate(
      [
        { transform: `translate(${animacao.origem.left - destino.left}px, ${animacao.origem.top - destino.top}px)`, opacity: 0.86 },
        { transform: "translate(0, 0)", opacity: 1 },
      ],
      { duration: 320, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
    fimDaAnimacaoSelecaoRef.current = movimento.finished.then(() => undefined, () => undefined);
  }, [selecao?.dia, selecao?.inicioMin]);

  const gridTemplateColumns = `56px repeat(${dias.length}, minmax(120px, 1fr))`;
  const horarios = useMemo(() => itens.filter((i) => i.inicioMin !== null), [itens]);
  const diaTodo = useMemo(() => itens.filter((i) => i.inicioMin === null), [itens]);

  // Cada dia divide a largura entre os blocos que se sobrepõem (posições originais: a prévia do arrasto não faz os outros se mexerem).
  const colunasPorDia = useMemo(() => {
    const mapa = new Map<string, { coluna: number; colunas: number }>();
    for (const dia of dias) {
      const doDia = horarios.filter((i) => i.dia === dia).map((i) => ({ chave: i.chave, inicioMin: i.inicioMin as number, duracaoMin: i.duracaoMin }));
      for (const [chave, v] of distribuirColunas(doDia)) mapa.set(chave, v);
    }
    return mapa;
  }, [dias, horarios]);

  const alturaDiaTodo = modoFaixa === "ocultar" ? 0
    : modoFaixa === "resumo" ? ALTURA_FAIXA_RESUMO
      : Math.min(Math.max(44, ...dias.map((dia) => diaTodo.filter((i) => i.dia === dia).length * ALTURA_LINHA_FAIXA + 12)), MAX_LINHAS_TODOS * ALTURA_LINHA_FAIXA + 12);
  const minutosAgora = agora.getHours() * 60 + agora.getMinutes();

  // A grade vem rolada até o início configurado (as linhas fixas ocupam o topo, então a hora de início fica logo abaixo delas).
  // Reaplica ao trocar de período e quando a preferência muda — sem recarregar; em qualquer outra renderização não mexe na rolagem da pessoa.
  useLayoutEffect(() => {
    if (rolagemRef.current) rolagemRef.current.scrollTop = Math.min(Math.max(0, inicioMin), MINUTOS_DIA) * PX_POR_MINUTO;
  }, [dias[0], inicioMin]);

  // Bloco que começa acima da parte visível (ex.: 03:59–07:29 com a grade rolada até 06:00): o nome acompanha a rolagem e
  // fica no topo visível do bloco, em vez de ficar escondido sob as linhas fixas. Direto no DOM: roda a cada quadro de rolagem.
  function ajustarRotulos() {
    const raiz = rolagemRef.current;
    if (!raiz) return;
    const topoVisivel = raiz.scrollTop; // em coordenadas da coluna de horas (as linhas fixas ocupam o que vem antes)
    raiz.querySelectorAll<HTMLElement>("[data-corpo-bloco]").forEach((rotulo) => {
      const bloco = rotulo.parentElement as HTMLElement;
      const topo = parseFloat(bloco.style.top);
      const altura = parseFloat(bloco.style.height);
      const desloca = Math.min(Math.max(0, topoVisivel - topo), Math.max(0, altura - rotulo.offsetHeight));
      rotulo.style.transform = desloca > 0 ? `translateY(${desloca}px)` : "";
    });
  }
  useLayoutEffect(ajustarRotulos);

  const ultimoPedidoAgora = useRef(rolarParaAgora);
  useLayoutEffect(() => {
    if (rolarParaAgora === ultimoPedidoAgora.current) return;
    ultimoPedidoAgora.current = rolarParaAgora;
    if (rolagemRef.current) rolagemRef.current.scrollTop = Math.max(0, agora.getHours() * 60 + agora.getMinutes() - 60) * PX_POR_MINUTO;
  }, [rolarParaAgora, dias[0]]);

  // Depois de mover por teclado o bloco pode trocar de coluna (remonta): devolve o foco a ele.
  useLayoutEffect(() => {
    if (!focoPendente.current) return;
    const chave = focoPendente.current;
    const el = [...(rolagemRef.current?.querySelectorAll<HTMLElement>("[data-item]") ?? [])].find((n) => n.dataset.item === chave);
    focoPendente.current = null;
    el?.focus({ preventScroll: false });
  });

  const arrastouDaLista = useRef(false);
  useEffect(() => {
    if (gesto) { arrastouDaLista.current = true; return; }
    if (arrastouDaLista.current) { arrastouDaLista.current = false; setLista(null); }
  }, [gesto]);
  useEffect(() => {
    if (!lista) return;
    const fora = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest("[data-lista-dia-todo], [data-abre-lista]")) setLista(null); };
    const tecla = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") setLista(null); };
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", tecla);
    return () => { document.removeEventListener("pointerdown", fora); document.removeEventListener("keydown", tecla); };
  }, [lista]);

  useEffect(() => () => {
    cancelarGesto.current?.();
    descartarCliqueFantasma?.();
  }, []);

  function geometria() {
    const raiz = rolagemRef.current;
    const colunas: ColunaGeometria[] = [];
    const faixasDiaTodo: FaixaDiaTodoGeometria[] = [];
    if (raiz) {
      raiz.querySelectorAll<HTMLElement>("[data-coluna-dia]").forEach((el) => {
        const r = el.getBoundingClientRect();
        colunas.push({ dia: el.dataset.colunaDia as string, left: r.left, right: r.right, top: r.top });
      });
      raiz.querySelectorAll<HTMLElement>("[data-faixa-dia]").forEach((el) => {
        const r = el.getBoundingClientRect();
        faixasDiaTodo.push({ dia: el.dataset.faixaDia as string, left: r.left, right: r.right, top: r.top, bottom: r.bottom });
      });
    }
    return { colunas, faixasDiaTodo };
  }

  // Tarefa arrastada de uma lista: mostra onde o tempo dela ficaria e, ao soltar, aloca. Só vale com o ponteiro sobre as horas
  // (não sobre o cabeçalho, a faixa "O dia todo" nem a coluna das horas).
  function destinoDaTarefa(x: number, y: number, tarefa: TarefaArrastavel): Posicao | null {
    const raiz = rolagemRef.current;
    if (!raiz) return null;
    const r = raiz.getBoundingClientRect();
    const g = geometria();
    if (!g.colunas.length) return null;
    if (x < g.colunas[0].left || x > g.colunas[g.colunas.length - 1].right || y < r.top + ALTURA_CABECALHO + alturaDiaTodo || y > r.bottom) return null;
    return posicaoDoPonteiro({ ...g, x, y, deslocamentoMin: 0, duracaoMin: duracaoParaAlocar(tarefa.duracaoMin), encaixe, permiteDiaInteiro: false });
  }

  useOuvirArrasteTarefa((e) => {
    if (!onAlocarTarefa) return;
    if (e.fase === "cancelar") return setPreviaExterna(null);
    const destino = destinoDaTarefa(e.x, e.y, e.tarefa);
    if (e.fase === "mover") {
      setPreviaExterna(destino ? { pos: destino, titulo: e.tarefa.titulo } : null);
      const r = rolagemRef.current?.getBoundingClientRect();
      if (r && e.y >= r.top && e.y <= r.bottom) {
        if (e.y > r.bottom - BORDA_ROLAGEM_PX) rolagemRef.current?.scrollBy(0, 14);
        else if (e.y < r.top + ALTURA_CABECALHO + alturaDiaTodo + BORDA_ROLAGEM_PX) rolagemRef.current?.scrollBy(0, -14);
      }
      return;
    }
    setPreviaExterna(null);
    if (destino) {
      onAlocarTarefa(e.tarefa, destino);
      setAviso(`${e.tarefa.titulo}: ${descreverPosicao(destino)}`);
    }
  });

  /** Pressionar num horário vazio: um clique reserva 1 h, arrastar define a duração; ao soltar abre a criação rápida. */
  function aoPressionarVazio(e: ReactPointerEvent<HTMLElement>, dia: string) {
    if (!onCriarNoHorario || e.target !== e.currentTarget) return;
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    cancelarGesto.current?.();
    animacaoSelecaoRef.current = { origem: previaSelecaoRef.current?.getBoundingClientRect() };
    setCriando(null);
    const topo = e.currentTarget.getBoundingClientRect().top;
    const minutoDe = (y: number) => Math.min(MINUTOS_DIA, Math.max(0, Math.round(((y - topo) / PX_POR_MINUTO) / encaixe) * encaixe));
    const inicio = Math.min(minutoDe(e.clientY), MINUTOS_DIA - encaixe);
    const origemY = e.clientY;
    let arrastou = false;
    let atual: Posicao = { dia, inicioMin: inicio, duracaoMin: Math.min(60, MINUTOS_DIA - inicio) };
    setSelecao(atual);
    const mover = (ev: PointerEvent) => {
      if (!arrastou && Math.abs(ev.clientY - origemY) < LIMIAR_MOUSE_PX) return;
      arrastou = true;
      const fim = minutoDe(ev.clientY);
      const proxima = { dia, inicioMin: Math.min(inicio, fim), duracaoMin: Math.max(encaixe, Math.abs(fim - inicio)) };
      if (proxima.inicioMin === atual.inicioMin && proxima.duracaoMin === atual.duracaoMin) return;
      atual = proxima;
      setSelecao(atual);
    };
    const limpar = () => { window.removeEventListener("pointermove", mover); window.removeEventListener("pointerup", soltar); window.removeEventListener("pointercancel", cancelar); cancelarGesto.current = null; };
    const cancelar = () => { limpar(); setSelecao(null); };
    const soltar = () => {
      limpar();
      const fimDaAnimacao = fimDaAnimacaoSelecaoRef.current;
      void fimDaAnimacao.then(() => requestAnimationFrame(() => {
        const bloco = previaSelecaoRef.current;
        if (!bloco) return;
        // Mede somente a posição final: getBoundingClientRect durante o FLIP inclui o translate temporário.
        setCriando({ pos: atual, rect: bloco.getBoundingClientRect() });
      }));
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
    window.addEventListener("pointercancel", cancelar);
    cancelarGesto.current = cancelar;
  }

  function fecharCriacao() { setCriando(null); setSelecao(null); }

  function anunciar(item: ItemAgenda, pos: Posicao) {
    setAviso(`${item.titulo}: ${descreverPosicao(pos)}`);
  }

  function confirmar(item: ItemAgenda, destino: Posicao, origem: "ponteiro" | "teclado" | "menu") {
    if (posicaoIgual(posDoItem(item), destino)) return;
    onMover(item, destino, origem);
    anunciar(item, destino);
  }

  /** Início de qualquer gesto de ponteiro (mouse, caneta ou toque) num bloco ou na alça de redimensionar. */
  function aoPressionar(e: ReactPointerEvent<HTMLElement>, item: ItemAgenda, tipo: "mover" | "redimensionar") {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-acao]")) return;
    if (tipo === "redimensionar") e.stopPropagation();
    cancelarGesto.current?.();
    descartarCliqueFantasma?.();

    const cap = capacidadesDo(item);
    const toque = e.pointerType === "touch";
    const pointerId = e.pointerId;
    const inicio = { x: e.clientX, y: e.clientY };
    const origem = posDoItem(item);
    const retanguloItem = e.currentTarget.closest<HTMLElement>("[data-item]")?.getBoundingClientRect() ?? e.currentTarget.getBoundingClientRect();
    // Onde dentro do bloco foi agarrado — para o bloco não "pular" e pôr o topo sob o dedo.
    const deslocamentoMin = tipo === "mover" && item.inicioMin !== null ? Math.max(0, (inicio.y - retanguloItem.top) / PX_POR_MINUTO) : 0;
    const ultimo = { x: inicio.x, y: inicio.y };
    let ativo = false;
    let timerLongo: ReturnType<typeof setTimeout> | null = null;
    let quadro = 0;

    const bloquearRolagem = (ev: TouchEvent) => { if (ativo && ev.cancelable) ev.preventDefault(); };

    function calcularPrevia(x: number, y: number): Posicao | null {
      const g = geometria();
      if (tipo === "redimensionar") {
        const coluna = g.colunas.find((c) => c.dia === origem.dia);
        if (!coluna || origem.inicioMin === null) return null;
        return { ...origem, duracaoMin: duracaoDoPonteiro({ y, colunaTop: coluna.top, inicioMin: origem.inicioMin, encaixe }) };
      }
      // As linhas fixas cobrem o topo das colunas: soltar sobre o cabeçalho dos dias, ou sobre a faixa "O dia todo" quando o item não a aceita,
      // não é um horário (o que estaria "embaixo" ficou escondido) — nesse caso o gesto não muda nada.
      const r = rolagemRef.current?.getBoundingClientRect();
      if (r && (y < r.top + ALTURA_CABECALHO || (alturaDiaTodo > 0 && y < r.top + ALTURA_CABECALHO + alturaDiaTodo && !cap.diaInteiro))) return null;
      return posicaoDoPonteiro({ ...g, x, y, deslocamentoMin, duracaoMin: origem.duracaoMin, encaixe, permiteDiaInteiro: cap.diaInteiro });
    }

    function atualizarPrevia() {
      // Sem posição válida sob o ponteiro (ex.: sobre o cabeçalho), a prévia volta para onde o item está: soltar ali não muda nada.
      const previa = calcularPrevia(ultimo.x, ultimo.y) ?? origem;
      setGesto((g) => (g ? { ...g, previa } : g));
    }

    function rolarSeNaBorda() {
      const raiz = rolagemRef.current;
      if (!ativo || !raiz) return;
      const r = raiz.getBoundingClientRect();
      const passo = ultimo.y < r.top + ALTURA_CABECALHO + BORDA_ROLAGEM_PX ? -14 : ultimo.y > r.bottom - BORDA_ROLAGEM_PX ? 14 : 0;
      if (passo) {
        raiz.scrollBy(0, passo);
        atualizarPrevia();
      }
      quadro = requestAnimationFrame(rolarSeNaBorda);
    }

    function comecar() {
      if (ativo) return;
      ativo = true;
      document.body.style.userSelect = "none";
      if (toque) (navigator as Navigator & { vibrate?: (ms: number) => boolean }).vibrate?.(12);
      setGesto({ chave: item.chave, tipo, origem, previa: origem, levantado: toque });
      quadro = requestAnimationFrame(rolarSeNaBorda);
    }

    function limpar() {
      if (timerLongo) clearTimeout(timerLongo);
      cancelAnimationFrame(quadro);
      window.removeEventListener("pointermove", aoMover);
      window.removeEventListener("pointerup", aoSoltar);
      window.removeEventListener("pointercancel", aoCancelar);
      window.removeEventListener("keydown", aoTecla, true);
      window.removeEventListener("touchmove", bloquearRolagem);
      cancelarGesto.current = null;
      if (ativo) {
        document.body.style.userSelect = "";
        // O clique que o navegador dispara ao soltar não pode abrir o item que acabou de ser arrastado.
        const engolir = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); };
        const remover = () => { window.removeEventListener("click", engolir, true); clearTimeout(timerFantasma); if (descartarCliqueFantasma === remover) descartarCliqueFantasma = null; };
        const timerFantasma = setTimeout(remover, 0);
        window.addEventListener("click", engolir, { capture: true, once: true });
        descartarCliqueFantasma = remover;
      }
      setGesto(null);
    }

    function aoMover(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return;
      ultimo.x = ev.clientX;
      ultimo.y = ev.clientY;
      const distancia = Math.hypot(ev.clientX - inicio.x, ev.clientY - inicio.y);
      if (!ativo) {
        if (toque && tipo === "mover") {
          // Mexeu antes da pressão longa: é rolagem, não arrasto.
          if (distancia > TOLERANCIA_TOQUE_PX) limpar();
          return;
        }
        if (distancia < LIMIAR_MOUSE_PX) return;
        comecar();
      }
      atualizarPrevia();
    }

    function aoSoltar(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return;
      if (!ativo) return limpar();
      const previa = calcularPrevia(ev.clientX, ev.clientY);
      limpar();
      if (previa) confirmar(item, previa, "ponteiro");
    }

    function aoCancelar(ev: PointerEvent) {
      if (ev.pointerId === pointerId) limpar();
    }

    function aoTecla(ev: globalThis.KeyboardEvent) {
      if (ev.key === "Escape") {
        ev.stopPropagation();
        limpar();
      }
    }

    window.addEventListener("pointermove", aoMover);
    window.addEventListener("pointerup", aoSoltar);
    window.addEventListener("pointercancel", aoCancelar);
    window.addEventListener("keydown", aoTecla, true);
    cancelarGesto.current = limpar;

    if (toque && tipo === "mover") {
      window.addEventListener("touchmove", bloquearRolagem, { passive: false });
      timerLongo = setTimeout(comecar, LONGO_TOQUE_MS);
    } else if (toque) {
      // Alça de redimensionar no toque: o dedo já está numa área que não rola, começa de imediato.
      comecar();
    }
  }

  function aoTeclar(e: KeyboardEvent<HTMLElement>, item: ItemAgenda) {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onAbrirItem(item, e);
      return;
    }
    const cap = capacidadesDo(item);
    if ((!cap.mover && !cap.remover) || item.tipo === "prazo") return; // Tarefa com data própria e prazo: só abrem (o prazo só vai a um horário pelo ponteiro; no teclado, "Alocar tempo")
    if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10") || e.key === "m" || e.key === "M") {
      e.preventDefault();
      setMenuDe(item.chave);
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && cap.remover && onRemover) {
      e.preventDefault();
      onRemover(item);
      return;
    }
    const acao = acaoDaTecla(e);
    if (!acao || !cap.mover) return;
    if (acao.tipo === "redimensionar" && !cap.redimensionar) return;
    e.preventDefault();
    const destino = aplicarAcao(posDoItem(item), acao, encaixe, cap.diaInteiro);
    if (posicaoIgual(posDoItem(item), destino)) return;
    focoPendente.current = item.chave;
    confirmar(item, destino, "teclado");
  }

  const itemDoMenu = menuDe ? itens.find((i) => i.chave === menuDe) ?? null : null;

  function corpoDoItem(item: ItemAgenda, pos: Posicao, diaInteiro: boolean, estreito = false) {
    const cap = capacidadesDo(item);
    const horario = diaInteiro ? "" : `${rotuloHorario(pos.inicioMin as number)}–${rotuloHorario((pos.inicioMin as number) + pos.duracaoMin)}`;
    const corpo = (
      <>
        <span className={`flex items-center gap-1 truncate text-xs font-medium ${item.concluida ? "line-through opacity-70" : ""}`}>
          {item.tipo === "prazo" && <><Flag size={11} aria-hidden className="shrink-0" /><span className="sr-only">Prazo: </span></>}
          <span className="truncate">{item.titulo}</span>
        </span>
        {!diaInteiro && <span className="block truncate font-mono-value text-[10px] opacity-80">{horario}</span>}
        {item.comPrazo && <span data-marca-prazo className="mt-0.5 inline-flex items-center gap-1 rounded bg-warning/20 px-1 text-[10px] font-medium text-warning"><Flag size={10} aria-hidden />Prazo hoje</span>}
        {(cap.mover || cap.remover) && item.tipo !== "prazo" && (
          <button
            type="button"
            data-acao="menu"
            tabIndex={-1}
            aria-label={`Mover ou redimensionar ${item.titulo}`}
            onClick={(e) => { e.stopPropagation(); setMenuDe(item.chave); }}
            className="absolute right-0.5 top-0.5 flex h-6 w-6 items-center justify-center rounded bg-base/70 text-text-primary opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100 group-focus:opacity-100 [@media(pointer:coarse)]:opacity-100"
          >
            <MoreHorizontal size={14} />
          </button>
        )}
      </>
    );
    if (!estreito) return corpo;
    // Coluna estreita: o nome fica de pé (legível em ~20 px) e, ao passar o mouse ou focar, o bloco se abre com o conteúdo normal.
    return (
      <>
        <span aria-hidden className="block max-h-full overflow-hidden text-[11px] font-medium leading-tight [writing-mode:vertical-rl] group-hover:hidden group-focus:hidden group-focus-visible:hidden">{item.titulo}</span>
        <div className="hidden group-hover:block group-focus:block group-focus-visible:block">{corpo}</div>
      </>
    );
  }

  /** Um item de "O dia todo" (prazo ou evento): o mesmo elemento na faixa e na lista, para o arraste funcionar nos dois. */
  function itemDiaTodo(item: ItemAgenda) {
    const emGesto = gesto?.chave === item.chave;
    const { cursor, ...atributos } = propsDoItem(item, item);
    return (
      <div
        key={item.chave}
        {...atributos}
        title={item.titulo}
        style={estiloCorLivre(item.corHex)}
        className={`group relative select-none rounded px-2 py-1 pr-7 outline-none ring-cyan focus-visible:ring-2 ${cursor} ${item.classe} ${emGesto ? "opacity-40" : ""} ${emGesto && gesto?.levantado ? "scale-105 shadow-nav" : ""}`}
      >
        {corpoDoItem(item, item, true)}
      </div>
    );
  }

  function abrirLista(dia: string | null, alvo: HTMLElement) {
    setLista((atual) => (atual && atual.dia === dia ? null : { dia, ancora: alvo.getBoundingClientRect() }));
  }

  function propsDoItem(item: ItemAgenda, pos: Posicao) {
    const cap = capacidadesDo(item);
    const fixo = (!cap.mover && !cap.remover) || item.tipo === "prazo";
    const dica = item.tipo === "prazo" ? "Prazo da tarefa: arraste para um horário para reservar tempo." : fixo ? "Tarefa agendada: a Agenda não a move." : "Setas movem, Shift e setas mudam a duração, M abre o menu.";
    const rotuloPosicao = item.tipo === "prazo" ? `prazo em ${meioDiaLocal(pos.dia).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}` : `${descreverPosicao(pos)}${item.comPrazo ? ", com prazo neste dia" : ""}`;
    return {
      role: "button" as const,
      tabIndex: 0,
      "data-item": item.chave,
      "data-tipo": item.tipo,
      "aria-label": `${item.titulo}, ${rotuloPosicao}. ${dica}`,
      onPointerDown: cap.mover ? (e: ReactPointerEvent<HTMLElement>) => aoPressionar(e, item, "mover") : undefined,
      onKeyDown: (e: KeyboardEvent<HTMLElement>) => aoTeclar(e, item),
      onClick: (e: MouseEvent<HTMLElement>) => onAbrirItem(item, e),
      onContextMenu: fixo ? undefined : (e: MouseEvent<HTMLElement>) => { e.preventDefault(); setMenuDe(item.chave); },
      cursor: cap.mover ? "cursor-grab" : "cursor-pointer",
    };
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-1.5 text-xs text-text-muted">
        <span className="truncate">Arraste um prazo para um horário para reservar tempo (ou use “Alocar tempo”) · arraste o bloco para mover · borda de baixo muda a duração · segure no toque · setas no teclado</span>
        <div className="flex shrink-0 items-center gap-3">
        {diaTodo.length > 0 && modoFaixa === "ocultar" && (
          <button type="button" data-abre-lista onClick={(e) => abrirLista(null, e.currentTarget)} aria-expanded={lista?.dia === null && lista !== null} className="flex items-center gap-1 rounded border border-border bg-surface-1 px-1.5 py-0.5 text-xs text-text-primary hover:bg-surface-2">
            <ListChecks size={12} aria-hidden />O dia todo ({diaTodo.length})
          </button>
        )}
        <div role="group" aria-label="Faixa O dia todo" className="flex items-center gap-1.5">
          <span>Faixa</span>
          <span className="flex overflow-hidden rounded border border-border">
            {MODOS_FAIXA.map(({ valor, rotulo }) => (
              <button key={valor} type="button" aria-pressed={modoFaixa === valor} onClick={() => escolherModoFaixa(valor)} className={`px-1.5 py-0.5 text-xs transition-colors ${modoFaixa === valor ? "bg-steel-500 text-white" : "bg-surface-1 text-text-secondary hover:bg-surface-2"}`}>{rotulo}</button>
            ))}
          </span>
        </div>
        <label className="flex shrink-0 items-center gap-1.5">
          Encaixe
          <select aria-label="Encaixe ao arrastar" value={encaixe} onChange={(e) => onMudarEncaixe(Number(e.target.value))} className="rounded border border-border bg-surface-1 px-1.5 py-0.5 text-xs text-text-primary">
            {OPCOES_ENCAIXE.map((m) => <option key={m} value={m}>{m === 60 ? "1 h" : `${m} min`}</option>)}
          </select>
        </label>
        </div>
      </div>

      {/* `isolate`: os z-index das linhas fixas (cabeçalho dos dias, "O dia todo") valem só aqui dentro; sem isso eles passam por cima do popup do dia e de qualquer outra camada da Agenda. */}
      <div ref={rolagemRef} data-testid="grade-rolagem" onScroll={ajustarRotulos} className="isolate min-h-0 flex-1 overflow-auto">
        <div className="relative min-w-[680px]">
          <div className="sticky top-0 z-30 grid bg-surface-1" style={{ gridTemplateColumns, height: ALTURA_CABECALHO }}>
            <div className="sticky left-0 z-30 border-b border-r border-border/35 bg-surface-1" />
            {dias.map((dia) => {
              const d = meioDiaLocal(dia);
              return (
                // O dia NÃO é um botão: só o número abre o popup. O número fica no topo e no meio da coluna, o dia da semana logo abaixo.
                <div key={dia} data-cabecalho-dia={dia} className="relative flex flex-col items-center justify-start gap-0.5 border-b border-r border-border/35 bg-surface-1 px-2 pt-1.5 text-center">
                  <button
                    type="button"
                    aria-label={`Ver tarefas de ${d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}`}
                    onClick={(e) => onSelecionarDia(dia, e.currentTarget.closest<HTMLElement>("[data-cabecalho-dia]") ?? e.currentTarget)}
                    className={`peer flex h-8 w-8 items-center justify-center rounded-full text-sm transition-all duration-300 ease-out hover:-rotate-12 hover:scale-110 active:rotate-[360deg] active:scale-95 active:duration-700 ${dia === hoje ? "bg-steel-500 font-semibold text-white hover:bg-steel-400" : "text-text-primary hover:bg-surface-3"}`}
                  >
                    {d.getDate()}
                  </button>
                  <span className="text-[11px] font-medium capitalize text-text-muted transition-colors duration-300 peer-hover:text-text-primary">{d.toLocaleDateString("pt-BR", { weekday: "short" })}</span>
                  {(concluidas?.get(dia)?.length ?? 0) > 0 && (() => {
                    const feitas = concluidas!.get(dia)!;
                    return <span data-concluidas={feitas.length} title={`Concluída${feitas.length === 1 ? "" : "s"}: ${feitas.map((t) => `${horaLocal(t.concluida_em!)} ${t.titulo}`).join(" · ")}`} className="absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded-pill bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold text-success"><CheckCircle2 size={11} strokeWidth={2} aria-hidden />{feitas.length}<span className="sr-only"> {feitas.length === 1 ? "tarefa concluída" : "tarefas concluídas"}</span></span>;
                  })()}
                </div>
              );
            })}
          </div>

          {modoFaixa !== "ocultar" && (
          <div className="sticky z-30 grid bg-base" style={{ gridTemplateColumns, top: ALTURA_CABECALHO, height: alturaDiaTodo }}>
            <div className="sticky left-0 z-30 border-b border-r border-border/35 bg-base pr-2 pt-2 text-right text-[10px] font-medium uppercase text-text-muted">O dia todo</div>
            {dias.map((dia) => {
              const daqui = diaTodo.filter((i) => i.dia === dia);
              const alvoDaPrevia = gesto?.tipo === "mover" && gesto.previa.inicioMin === null && gesto.previa.dia === dia;
              const resumo = resumoDoDia(daqui);
              return (
                <div key={dia} data-faixa-dia={dia} className={`flex min-h-0 flex-col gap-1 border-b border-r border-border/35 p-1.5 transition-colors ${modoFaixa === "todos" ? "overflow-y-auto" : "overflow-hidden"} ${alvoDaPrevia ? "bg-cyan/10 ring-1 ring-inset ring-cyan/60" : "bg-base"}`}>
                  {modoFaixa === "todos" ? daqui.map(itemDiaTodo) : daqui.length > 0 && (
                    <button type="button" data-abre-lista data-resumo-dia={dia} aria-expanded={lista?.dia === dia} onClick={(e) => abrirLista(dia, e.currentTarget)} title={resumo.rotulo} className="flex w-full items-center gap-1 rounded bg-warning/15 px-1.5 py-1 text-left text-xs font-medium text-warning outline-none ring-cyan hover:brightness-125 focus-visible:ring-2">
                      <Flag size={11} aria-hidden className="shrink-0" /><span className="truncate">{resumo.rotulo}</span>
                    </button>
                  )}
                  {gesto?.tipo === "mover" && alvoDaPrevia && !daqui.some((i) => i.chave === gesto.chave) && <div aria-hidden className="pointer-events-none rounded border border-dashed border-cyan/70 px-2 py-1 text-xs text-cyan">Dia inteiro</div>}
                </div>
              );
            })}
          </div>
          )}

          <div className="relative grid" style={{ gridTemplateColumns, height: 24 * PX_POR_HORA }}>
            <div className="sticky left-0 z-10 border-r border-border/35 bg-base">
              {Array.from({ length: 24 }, (_, h) => <div key={h} className="pr-2 pt-1 text-right text-[11px] text-text-muted" style={{ height: PX_POR_HORA }}>{String(h).padStart(2, "0")}:00</div>)}
            </div>
            {dias.map((dia) => {
              const daqui = horarios.filter((i) => i.dia === dia);
              const previaAqui = gesto?.tipo === "mover" && gesto.previa.inicioMin !== null && gesto.previa.dia === dia ? gesto.previa : null;
              const previaDeFora = previaExterna && previaExterna.pos.dia === dia && previaExterna.pos.inicioMin !== null ? previaExterna : null;
              return (
                <div key={dia} data-coluna-dia={dia} onPointerDown={(e) => aoPressionarVazio(e, dia)} className={`relative border-r border-border/35 ${dia === hoje ? "bg-surface-1/40" : "bg-base"}`}>
                  {Array.from({ length: 24 }, (_, h) => <div key={h} aria-hidden className="pointer-events-none absolute inset-x-0 border-b border-border/35" style={{ top: h * PX_POR_HORA, height: PX_POR_HORA }} />)}
                  {(concluidas?.get(dia) ?? []).map((t) => <span key={`concluida:${t.id}`} aria-hidden data-concluida-em={t.id} className="pointer-events-none absolute right-0.5 z-10 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full bg-success text-base shadow-sm" style={{ top: diaEMinutosLocais(t.concluida_em!).minutos * PX_POR_MINUTO }}><CheckCircle2 size={12} strokeWidth={2.5} /></span>)}
                  {daqui.map((item) => {
                    const cap = capacidadesDo(item);
                    const emGesto = gesto?.chave === item.chave;
                    const pos: Posicao = emGesto && gesto?.tipo === "redimensionar" ? gesto.previa : item;
                    const { coluna, colunas } = colunasPorDia.get(item.chave) ?? { coluna: 0, colunas: 1 };
                    const altura = Math.max(pos.duracaoMin, DURACAO_VISUAL_MINIMA_MIN) * PX_POR_MINUTO;
                    const { cursor, ...atributos } = propsDoItem(item, pos);
                    const estreito = colunas >= COLUNAS_ESTREITO;
                    return (
                      <div
                        key={item.chave}
                        {...atributos}
                        data-coluna={coluna}
                        data-colunas={colunas}
                        title={`${item.titulo} · ${rotuloHorario(pos.inicioMin as number)}–${rotuloHorario((pos.inicioMin as number) + pos.duracaoMin)}`}
                        style={{ top: (pos.inicioMin as number) * PX_POR_MINUTO, height: altura, left: `calc(${(coluna / colunas) * 100}% + 2px)`, width: `calc(${100 / colunas}% - 4px)`, ...estiloCorLivre(item.corHex) }}
                        className={`group absolute select-none overflow-hidden rounded border-l-2 border-current outline-none ring-cyan focus-visible:z-20 focus-visible:ring-2 hover:z-20 ${estreito ? "px-0.5 py-0.5" : "px-1.5 py-0.5 pr-7"} ${colunas > 1 && !gesto ? "hover:!left-0.5 hover:!w-[calc(100%-4px)] hover:shadow-nav focus-visible:!left-0.5 focus-visible:!w-[calc(100%-4px)]" : ""} ${cursor} ${item.classe} ${emGesto ? (gesto?.tipo === "redimensionar" ? "z-20 shadow-nav" : "opacity-40") : ""} ${emGesto && gesto?.levantado ? "scale-[1.03] shadow-nav" : ""} ${item.salvando ? "animate-pulse" : ""}`}
                      >
                        <div data-corpo-bloco className="will-change-transform">{corpoDoItem(item, pos, false, estreito)}</div>
                        {cap.redimensionar && (
                          <span
                            data-resize="baixo"
                            aria-hidden
                            onPointerDown={(e) => aoPressionar(e, item, "redimensionar")}
                            className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize touch-none bg-current/0 hover:bg-current/25 [@media(pointer:coarse)]:h-3 [@media(pointer:coarse)]:bg-current/20"
                          />
                        )}
                      </div>
                    );
                  })}
                  {previaAqui && (
                    <div aria-hidden data-previa="mover" className="pointer-events-none absolute z-30 rounded border border-dashed border-cyan/80 bg-cyan/10 px-1.5 py-0.5 text-[10px] text-cyan" style={{ top: (previaAqui.inicioMin as number) * PX_POR_MINUTO, height: Math.max(previaAqui.duracaoMin, DURACAO_VISUAL_MINIMA_MIN) * PX_POR_MINUTO, left: 2, right: 2 }}>
                      {rotuloHorario(previaAqui.inicioMin as number)}–{rotuloHorario((previaAqui.inicioMin as number) + previaAqui.duracaoMin)}
                    </div>
                  )}
                  {selecao && selecao.dia === dia && (
                    <div ref={previaSelecaoRef} aria-hidden data-previa="criar" className="pointer-events-none absolute z-20 flex items-start gap-1.5 overflow-hidden rounded border-l-2 border-current bg-steel-500 px-2 py-2 text-xs font-medium text-white transition-[top,height] duration-100 ease-out will-change-[top,height]" style={{ top: (selecao.inicioMin as number) * PX_POR_MINUTO, height: Math.max(selecao.duracaoMin, DURACAO_VISUAL_MINIMA_MIN) * PX_POR_MINUTO, left: 2, right: 2 }}>
                      <span className="truncate font-mono-value">{rotuloHorario(selecao.inicioMin as number)}-{rotuloHorario((selecao.inicioMin as number) + selecao.duracaoMin)}</span>
                    </div>
                  )}
                  {previaDeFora && (
                    <div aria-hidden data-previa="alocar" className="pointer-events-none absolute z-30 overflow-hidden rounded border border-dashed border-cyan/80 bg-cyan/15 px-1.5 py-0.5 text-[10px] text-cyan" style={{ top: (previaDeFora.pos.inicioMin as number) * PX_POR_MINUTO, height: Math.max(previaDeFora.pos.duracaoMin, DURACAO_VISUAL_MINIMA_MIN) * PX_POR_MINUTO, left: 2, right: 2 }}>
                      <span className="block truncate font-medium">{previaDeFora.titulo}</span>
                      {rotuloHorario(previaDeFora.pos.inicioMin as number)}–{rotuloHorario((previaDeFora.pos.inicioMin as number) + previaDeFora.pos.duracaoMin)}
                    </div>
                  )}
                </div>
              );
            })}
            <div aria-hidden className="pointer-events-none absolute z-[5] flex items-center" style={{ left: 56, right: 0, top: Math.min(minutosAgora, MINUTOS_DIA) * PX_POR_MINUTO }}>
              <span className="-ml-1 rounded bg-error px-1 py-0.5 text-[10px] font-semibold text-white">{agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
              <span className="h-px flex-1 bg-error" />
            </div>
          </div>
        </div>
      </div>

      {lista && (() => {
        const dosDias = (lista.dia ? [lista.dia] : dias).map((dia) => ({ dia, itens: diaTodo.filter((i) => i.dia === dia) })).filter((g) => g.itens.length > 0);
        const largura = 272;
        const left = Math.max(8, Math.min(lista.ancora.left, window.innerWidth - largura - 8));
        return (
          // Durante um arrasto a lista fica translúcida e deixa o ponteiro passar: o horário de destino aparece por baixo dela.
          <div data-lista-dia-todo role="group" aria-label={lista.dia ? `O dia todo, ${meioDiaLocal(lista.dia).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}` : "O dia todo, período inteiro"} style={{ left, top: lista.ancora.bottom + 4, width: largura }} className={`ecos-fade-in fixed z-[115] max-h-[60vh] overflow-y-auto rounded-xl border border-border bg-base p-2 shadow-nav transition-opacity ${gesto ? "pointer-events-none opacity-30" : ""}`}>
            <p className="px-1 pb-1.5 text-xs text-text-muted">Arraste um prazo para um horário para reservar tempo.</p>
            <div className="flex flex-col gap-1">
              {dosDias.map(({ dia, itens }) => (
                <div key={dia} className="flex flex-col gap-1">
                  {!lista.dia && <p className="px-1 pt-1 text-xs font-semibold capitalize text-text-secondary">{meioDiaLocal(dia).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })}</p>}
                  {itens.map(itemDiaTodo)}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      <div role="status" aria-live="polite" className="sr-only">{aviso}</div>

      {criando && onCriarNoHorario && (
        <CriacaoRapida
          pos={criando.pos}
          ancora={criando.rect}
          hoje={hoje}
          onFechar={fecharCriacao}
          onSalvar={async (dados) => { await onCriarNoHorario({ ...dados, destino: criando.pos }); fecharCriacao(); }}
          onAbrirCriacaoCompleta={onAbrirCriacaoCompleta ? () => { fecharCriacao(); onAbrirCriacaoCompleta(); } : undefined}
          onAbrirCompleto={onAbrirTarefaCriada ? async (dados) => {
            const id = await onCriarNoHorario({ ...dados, destino: criando.pos });
            if (typeof id === "string") {
              fecharCriacao();
              onAbrirTarefaCriada(id);
            }
          } : undefined}
        />
      )}

      {itemDoMenu && (
        <MenuDeMovimento
          item={itemDoMenu}
          encaixe={encaixe}
          podeRemover={!!onRemover}
          onFechar={() => { focoPendente.current = itemDoMenu.chave; setMenuDe(null); }}
          onAplicar={(destino) => { focoPendente.current = itemDoMenu.chave; setMenuDe(null); confirmar(itemDoMenu, destino, "menu"); }}
          onRemover={() => { setMenuDe(null); onRemover?.(itemDoMenu); }}
        />
      )}
    </div>
  );
}

/**
 * Alternativa por formulário a qualquer arrasto: data, início e duração (e, para eventos, dia inteiro). Serve a quem
 * não pode/quer arrastar (teclado, leitor de tela, toque impreciso) — faz exatamente as mesmas mudanças que o gesto.
 */
function MenuDeMovimento({ item, encaixe, podeRemover, onFechar, onAplicar, onRemover }: { item: ItemAgenda; encaixe: number; podeRemover: boolean; onFechar: () => void; onAplicar: (destino: Posicao) => void; onRemover: () => void }) {
  const cap = capacidadesDo(item);
  const [dia, setDia] = useState(item.dia);
  const [diaInteiro, setDiaInteiro] = useState(item.inicioMin === null);
  const [inicio, setInicio] = useState(rotuloHorario(item.inicioMin ?? 9 * 60));
  const [duracao, setDuracao] = useState(String(item.duracaoMin));
  const primeiroCampo = useRef<HTMLInputElement>(null);
  useEffect(() => primeiroCampo.current?.focus(), []);

  const minutosDoInicio = (() => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(inicio);
    return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
  })();
  const duracaoNum = Number(duracao);
  const erro = !/^\d{4}-\d{2}-\d{2}$/.test(dia) ? "Escolha uma data." : !diaInteiro && !(minutosDoInicio >= 0 && minutosDoInicio < MINUTOS_DIA) ? "Informe um horário válido." : !Number.isInteger(duracaoNum) || duracaoNum < 1 || duracaoNum > MINUTOS_DIA ? "A duração deve ser de 1 a 1440 minutos." : null;
  const rotulo = item.tipo === "bloco" ? "Tempo alocado" : "Mover ou redimensionar";

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4" role="presentation" onPointerDown={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <form
        noValidate
        role="dialog"
        aria-modal="true"
        aria-label={`Mover ou redimensionar ${item.titulo}`}
        onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onFechar(); } }}
        onSubmit={(e) => {
          e.preventDefault();
          if (erro) return;
          onAplicar({ dia, inicioMin: diaInteiro && cap.diaInteiro ? null : minutosDoInicio, duracaoMin: duracaoNum });
        }}
        className="ecos-fade-in w-full max-w-sm rounded-xl border border-border bg-base shadow-nav"
      >
        <header className="flex items-center justify-between border-b border-border bg-surface-1 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">{rotulo}</p>
            <h2 className="truncate font-display text-base text-text-primary">{item.titulo}</h2>
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-2"><X size={16} /></button>
        </header>
        <div className="space-y-3 p-4">
          <label className="block text-sm font-medium text-text-secondary">Data
            <input ref={primeiroCampo} type="date" value={dia} onChange={(e) => setDia(e.target.value)} className="ecos-input mt-1 w-full" />
          </label>
          {cap.diaInteiro && (
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              <input type="checkbox" checked={diaInteiro} onChange={(e) => setDiaInteiro(e.target.checked)} className="accent-steel-400" /> Dia inteiro
            </label>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium text-text-secondary">Início
              <input type="time" step={encaixe * 60} value={inicio} disabled={diaInteiro && cap.diaInteiro} onChange={(e) => setInicio(e.target.value)} className="ecos-input mt-1 w-full disabled:opacity-40" />
            </label>
            <label className="block text-sm font-medium text-text-secondary">Duração (min)
              <input type="number" min={1} max={MINUTOS_DIA} step={encaixe} value={duracao} onChange={(e) => setDuracao(e.target.value)} className="ecos-input mt-1 w-full" />
            </label>
          </div>
          {item.tipo === "bloco" && <p className="text-xs text-text-muted">Isto muda só o tempo alocado no calendário. A data da tarefa não é alterada.</p>}
          {erro && <p role="alert" className="text-sm text-error">{erro}</p>}
        </div>
        <footer className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
          {cap.remover && podeRemover ? (
            <button type="button" onClick={onRemover} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-error hover:bg-error/10"><Trash2 size={15} />Remover bloco</button>
          ) : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onFechar} className="rounded-lg px-3 py-2 text-sm text-text-secondary hover:bg-surface-2">Cancelar</button>
            <button type="submit" disabled={!!erro} className="rounded-lg bg-steel-600 px-3 py-2 text-sm font-medium text-white hover:bg-steel-500 disabled:opacity-40">Aplicar</button>
          </div>
        </footer>
      </form>
    </div>
  );
}


const PRIORIDADES_CICLO: NovaTarefaRapida["prioridade"][] = ["baixa", "media", "alta"];
const COR_PRIORIDADE = { baixa: "text-text-muted", media: "text-warning", alta: "text-error" } as const;

/** Popup de criação rápida ancorado no horário selecionado: título, notas, prioridade e criar (Enter). */
function CriacaoRapida({ pos, ancora, hoje, onFechar, onSalvar, onAbrirCompleto, onAbrirCriacaoCompleta }: { pos: Posicao; ancora: DOMRect; hoje: string; onFechar: () => void; onSalvar: (dados: { titulo: string; corpo: string; prioridade: NovaTarefaRapida["prioridade"] }) => Promise<void>; onAbrirCompleto?: (dados: { titulo: string; corpo: string; prioridade: NovaTarefaRapida["prioridade"] }) => Promise<void>; onAbrirCriacaoCompleta?: () => void }) {
  const raiz = useRef<HTMLFormElement>(null);
  const campoTitulo = useRef<HTMLInputElement>(null);
  const [titulo, setTitulo] = useState("");
  const [corpo, setCorpo] = useState("");
  const [prioridade, setPrioridade] = useState<NovaTarefaRapida["prioridade"]>("baixa");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  useEffect(() => campoTitulo.current?.focus(), []);

  useEffect(() => {
    const fora = (e: PointerEvent) => {
      const alvo = e.target as HTMLElement;
      // A própria grade cuida da troca de horário; não apague a prévia antes que ela possa deslizar para o novo dia.
      if (alvo.closest?.("[data-coluna-dia]")) return;
      if (!raiz.current?.contains(alvo)) onFechar();
    };
    const tecla = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", tecla);
    return () => { document.removeEventListener("pointerdown", fora); document.removeEventListener("keydown", tecla); };
  }, [onFechar]);

  const inicio = pos.inicioMin as number;
  const dataBase = meioDiaLocal(pos.dia);
  const diasDiferenca = Math.round((dataBase.getTime() - meioDiaLocal(hoje).getTime()) / 86_400_000);
  const relativo = diasDiferenca === 0 ? "Hoje" : diasDiferenca === 1 ? "Amanhã" : diasDiferenca === -1 ? "Ontem" : diasDiferenca < 0 ? `${-diasDiferenca} dias atrás` : `Em ${diasDiferenca} dias`;
  const passado = diasDiferenca < 0;
  const rotulo = `${relativo}, ${dataBase.toLocaleDateString("pt-BR", { day: "numeric", month: "short" }).replace(".", "")}, ${rotuloHorario(inicio)} – ${rotuloHorario(inicio + pos.duracaoMin)}`;

  const largura = 320;
  const alturaEstimada = 230;
  const cabeDireita = ancora.right + 8 + largura <= window.innerWidth - 8;
  const left = cabeDireita ? ancora.right + 8 : Math.max(8, ancora.left - 8 - largura);
  const top = Math.min(Math.max(8, ancora.top), Math.max(8, window.innerHeight - alturaEstimada - 8));

  async function enviar(abrirCompleto = false) {
    const limpo = titulo.trim();
    if (salvando) return;
    if (!limpo) {
      if (abrirCompleto) onAbrirCriacaoCompleta?.();
      return;
    }
    setSalvando(true);
    setErro("");
    try {
      const dados = { titulo: limpo, corpo: corpo.trim(), prioridade };
      await (abrirCompleto && onAbrirCompleto ? onAbrirCompleto(dados) : onSalvar(dados));
    }
    catch (e) { setErro(e instanceof Error ? e.message : "Não foi possível criar a tarefa."); setSalvando(false); }
  }

  return (
    <form
      ref={raiz}
      role="dialog"
      aria-label="Nova tarefa"
      onSubmit={(e) => { e.preventDefault(); void enviar(false); }}
      className="ecos-fade-in fixed z-[110] flex flex-col overflow-hidden rounded-xl border border-border bg-surface-1 shadow-nav"
      style={{ left, top, width: largura }}
    >
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className={`truncate text-xs font-medium ${passado ? "text-error" : "text-cyan"}`}>{rotulo}</span>
        <button type="button" onClick={() => setPrioridade((p) => PRIORIDADES_CICLO[(PRIORIDADES_CICLO.indexOf(p) + 1) % PRIORIDADES_CICLO.length])} title={`Prioridade: ${prioridade}`} aria-label={`Prioridade ${prioridade}. Clique para alterar`} className={`flex h-7 w-7 items-center justify-center rounded-md hover:bg-surface-2 ${COR_PRIORIDADE[prioridade]}`}>
          <Flag size={15} fill={prioridade === "baixa" ? "none" : "currentColor"} />
        </button>
      </header>
      <div className="space-y-1 px-3 py-3">
        <input ref={campoTitulo} value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="O que você gostaria de fazer?" aria-label="Título da tarefa" className="w-full bg-transparent font-display text-base font-semibold text-text-primary outline-none placeholder:text-text-muted/60" />
        <textarea value={corpo} onChange={(e) => setCorpo(e.target.value)} placeholder="Digite o conteúdo" aria-label="Conteúdo da tarefa" rows={3} className="w-full resize-none bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted/60" />
        {erro && <p role="alert" className="text-xs text-error">{erro}</p>}
      </div>
      <footer className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs text-text-secondary"><Inbox size={14} aria-hidden />Caixa de Entrada</span>
        <div className="flex items-center gap-1.5">
          {onAbrirCompleto && (
            <button type="button" onClick={() => void enviar(true)} disabled={salvando} className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-steel-400 hover:bg-surface-2 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40" title={titulo.trim() ? "Salvar e abrir a visualização completa" : "Abrir o formulário completo"}>
              <Expand size={13} aria-hidden />Completo
            </button>
          )}
          <button type="submit" disabled={!titulo.trim() || salvando} className="rounded-lg bg-[#1e5f96] px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[#174d7b] disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-text-muted disabled:shadow-none">{salvando ? "Salvando…" : "Salvar"}</button>
        </div>
      </footer>
    </form>
  );
}
