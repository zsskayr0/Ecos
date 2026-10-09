import type { BlocoPlanejado, TarefaResumo } from "@/lib/api";

/**
 * Regras da grade de tempo da Agenda (arrastar, redimensionar, dia inteiro), sem nada de React ou DOM — é aqui que
 * ficam fuso, encaixe (snap), sobreposição e a garantia de que mover não mexe na duração.
 *
 * Modelo: o servidor guarda `scheduled_at` em UTC (instante) e `due_date` como data sem fuso. Na tela tudo é hora
 * "de parede" do fuso local: um item tem `dia` (YYYY-MM-DD local) e `inicioMin` (minutos desde 00:00 local). Um item
 * "de dia inteiro" é o que não tem `scheduled_at` — só a data; ele mora na faixa "O dia todo" (`inicioMin === null`).
 */

export const MINUTOS_DIA = 24 * 60;
export const PX_POR_HORA = 64;
export const PX_POR_MINUTO = PX_POR_HORA / 60;
export const OPCOES_ENCAIXE = [5, 10, 15, 30, 60] as const;
export const ENCAIXE_PADRAO = 15;
/** Hora em que um item de dia inteiro cai ao ser solto na grade sem posição melhor (teclado/atalho). */
export const HORA_PADRAO_MIN = 9 * 60;
/** Início padrão da rolagem nas visões de horário (o "início do tempo acordado" das preferências). */
export const INICIO_PADRAO_MIN = 6 * 60;
/** Duração assumida (só na tela) para tarefas antigas sem `duration_min`. Nunca é enviada ao servidor. */
export const DURACAO_SEM_DADO_MIN = 30;
/** Altura mínima legível de um bloco, em minutos: blocos de 5 min continuam clicáveis e alinham na sobreposição. */
export const DURACAO_VISUAL_MINIMA_MIN = 22;

// ---------------------------------------------------------------------------------------------------------------
// Datas e fuso
// ---------------------------------------------------------------------------------------------------------------

const dois = (n: number) => String(n).padStart(2, "0");

/** `YYYY-MM-DD` do dia LOCAL de `d` — nunca `toISOString().slice(0, 10)`, que é o dia em UTC e erra à noite no Brasil. */
export function dataLocalISO(d: Date): string {
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
}

/** Meio-dia local do dia `YYYY-MM-DD`: longe da meia-noite, onde as viradas de horário de verão bagunçam as contas. */
export function meioDiaLocal(dia: string): Date {
  const [a, m, d] = dia.split("-").map(Number);
  return new Date(a, m - 1, d, 12, 0, 0, 0);
}

export function somarDiasISO(dia: string, n: number): string {
  const d = meioDiaLocal(dia);
  d.setDate(d.getDate() + n);
  return dataLocalISO(d);
}

/** Diferença em dias de calendário (não em múltiplos de 24 h) entre dois `YYYY-MM-DD`. */
export function diasEntre(de: string, ate: string): number {
  const a = meioDiaLocal(de);
  const b = meioDiaLocal(ate);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** Instante (ISO/UTC do servidor) → dia e minutos no relógio local. */
export function diaEMinutosLocais(instanteISO: string): { dia: string; minutos: number } {
  const d = new Date(instanteISO);
  return { dia: dataLocalISO(d), minutos: d.getHours() * 60 + d.getMinutes() };
}

/** Dia local + minutos desde 00:00 local → instante em ISO/UTC (o que o servidor guarda). */
export function instanteLocalISO(dia: string, minutos: number): string {
  const [a, m, d] = dia.split("-").map(Number);
  return new Date(a, m - 1, d, Math.floor(minutos / 60), minutos % 60, 0, 0).toISOString();
}

export function limitar(n: number, minimo: number, maximo: number): number {
  return Math.min(Math.max(n, minimo), maximo);
}

export function arredondar(minutos: number, encaixe: number): number {
  return Math.round(minutos / encaixe) * encaixe;
}

export function rotuloHorario(minutos: number): string {
  const m = ((Math.round(minutos) % MINUTOS_DIA) + MINUTOS_DIA) % MINUTOS_DIA;
  return `${dois(Math.floor(m / 60))}:${dois(m % 60)}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Itens e posições
// ---------------------------------------------------------------------------------------------------------------

/** Onde um item está (ou vai ficar) na grade. `inicioMin === null` = faixa "O dia todo". */
export interface Posicao {
  dia: string;
  inicioMin: number | null;
  duracaoMin: number;
}

/**
 * O que a grade mostra:
 *  - `tarefa`: uma Tarefa agendada (`scheduled_at`). Só aparece; a Agenda nunca a muda de dia.
 *  - `prazo`: a marca do prazo (`due_date`) de uma Tarefa, na faixa "O dia todo". Só existe com "Mostrar prazos no calendário" ligado.
 *  - `bloco`: tempo ALOCADO a uma Tarefa no calendário (arrastar uma Tarefa para cá cria um). É o que se move e redimensiona.
 *  - `evento`: evento criado na Agenda (só nesta sessão).
 */
export interface ItemAgenda extends Posicao {
  /** Identidade estável na tela (`tarefa:<id>` / `bloco:<id>` / `evento:<id>`). */
  chave: string;
  tipo: "tarefa" | "bloco" | "evento" | "prazo";
  id: string;
  /** Só em `bloco`: a Tarefa dona do tempo. */
  tarefaId?: string;
  /** Só em `tarefa` agendada: o prazo (`due_date`) cai no MESMO dia do agendamento — vira uma marca no próprio cartão, não um segundo cartão. */
  comPrazo?: boolean;
  titulo: string;
  classe: string;
  /** Cor livre (#RRGGBB) — quando existe, a grade a usa no lugar de `classe`. */
  corHex?: string;
  concluida: boolean;
  /** A tarefa não tem `duration_min`: `duracaoMin` é só um valor de exibição e não deve entrar em somas de carga. */
  semEstimativa?: boolean;
  /** Ainda sendo gravado no servidor (sem id definitivo): fica parado até confirmar. */
  salvando?: boolean;
  /** Item que é uma transação do Cofre (conta à parte no resumo do dia). */
  transacao?: boolean;
  /** Linha abaixo do título (em lançamento: o valor, no lugar do "dia inteiro"). */
  legenda?: string;
}

export interface CapacidadesItem {
  mover: boolean;
  redimensionar: boolean;
  /** Pode entrar/sair da faixa "O dia todo". Bloco de tempo não: ele sempre tem um horário. */
  diaInteiro: boolean;
  remover: boolean;
}

const SEM_CAPACIDADES: CapacidadesItem = { mover: false, redimensionar: false, diaInteiro: false, remover: false };

export function capacidadesDo(item: Pick<ItemAgenda, "tipo" | "salvando">): CapacidadesItem {
  if (item.salvando) return SEM_CAPACIDADES;
  if (item.tipo === "bloco") return { mover: true, redimensionar: true, diaInteiro: false, remover: true };
  if (item.tipo === "evento") return { mover: true, redimensionar: true, diaInteiro: true, remover: false };
  // Prazo: arrastá-lo para um horário reserva tempo (cria um bloco); o prazo em si fica onde está. Não vai para "O dia todo" nem se redimensiona.
  if (item.tipo === "prazo") return { mover: true, redimensionar: false, diaInteiro: false, remover: false };
  return SEM_CAPACIDADES;
}

/**
 * O que uma Tarefa desenha no calendário. O agendamento (`scheduled_at`) e o prazo (`due_date`) são coisas diferentes:
 *  - agendada: um cartão na hora dela;
 *  - prazo (só com `mostrarPrazos`): uma marca distinta. Se cai no mesmo dia do agendamento, a marca vai NO cartão
 *    (`comPrazo`) — nunca um segundo cartão; se cai em outro dia (ou a Tarefa só tem prazo), vira uma marca na faixa "O dia todo".
 * Com `mostrarPrazos` desligado nenhuma marca aparece (a Tarefa segue nas listas e no popup do dia, que não dependem disto).
 */
export function itensDaTarefa(t: TarefaResumo, { mostrarPrazos }: { mostrarPrazos: boolean }): ItemAgenda[] {
  const base = { id: t.id, titulo: t.titulo, concluida: t.status === "concluida", classe: t.prioridade === "alta" ? "bg-error/15 text-error" : "bg-cyan/15 text-cyan" };
  const duracaoMin = t.duration_min && t.duration_min > 0 ? t.duration_min : DURACAO_SEM_DADO_MIN;
  const marcaEstimativa = t.duration_min && t.duration_min > 0 ? {} : { semEstimativa: true };
  const itens: ItemAgenda[] = [];
  let diaAgendado: string | null = null;
  if (t.scheduled_at) {
    const { dia, minutos } = diaEMinutosLocais(t.scheduled_at);
    diaAgendado = dia;
    itens.push({ ...base, chave: `tarefa:${t.id}`, tipo: "tarefa", dia, inicioMin: minutos, duracaoMin, ...(mostrarPrazos && t.due_date === dia ? { comPrazo: true } : {}) });
  }
  if (mostrarPrazos && t.due_date && t.due_date !== diaAgendado) {
    itens.push({ ...base, chave: `prazo:${t.id}`, tipo: "prazo", dia: t.due_date, inicioMin: null, duracaoMin, classe: "bg-warning/15 text-warning", ...marcaEstimativa });
  }
  return itens;
}

/**
 * Tarefas concluídas agrupadas pelo dia LOCAL em que foram concluídas (`concluida_em`), cada dia em ordem de horário.
 * Reaberta (`pendente`) ou sem `concluida_em` não conta: o dia só fica marcado enquanto a conclusão existe.
 */
export function concluidasPorDia(tarefas: TarefaResumo[]): Map<string, TarefaResumo[]> {
  const porDia = new Map<string, TarefaResumo[]>();
  for (const t of tarefas) {
    if (t.status !== "concluida" || !t.concluida_em) continue;
    const dia = dataLocalISO(new Date(t.concluida_em));
    porDia.set(dia, [...(porDia.get(dia) ?? []), t]);
  }
  for (const lista of porDia.values()) lista.sort((a, b) => a.concluida_em!.localeCompare(b.concluida_em!));
  return porDia;
}

/** Hora local `HH:MM` de um instante (ISO/UTC do servidor). */
export function horaLocal(instanteISO: string): string {
  return rotuloHorario(diaEMinutosLocais(instanteISO).minutos);
}

export function itemDoBloco(b: BlocoPlanejado): ItemAgenda {
  const { dia, minutos } = diaEMinutosLocais(b.inicio_em);
  return {
    chave: `bloco:${b.id}`, tipo: "bloco", id: b.id, tarefaId: b.tarefa_id, titulo: b.titulo, dia, inicioMin: minutos, duracaoMin: b.duracao_min,
    classe: b.prioridade === "alta" ? "bg-error/30 text-error" : "bg-cyan/30 text-cyan", concluida: b.status === "concluida", salvando: b.id.startsWith("tmp-"),
  };
}

/** Campos do `PATCH /tarefas/:id/time-entries/:entrada`. Só o que mudou: mover não manda a duração, redimensionar não manda o início. */
export interface PayloadBloco {
  inicio_em?: string;
  duracao_min?: number;
}

export function payloadDoBloco(antes: Posicao, depois: Posicao): PayloadBloco {
  const payload: PayloadBloco = {};
  if (depois.inicioMin !== null && (depois.dia !== antes.dia || depois.inicioMin !== antes.inicioMin)) payload.inicio_em = instanteLocalISO(depois.dia, depois.inicioMin);
  if (depois.duracaoMin !== antes.duracaoMin) payload.duracao_min = depois.duracaoMin;
  return payload;
}

/** Aplica o mesmo payload no bloco em memória (atualização otimista). */
export function aplicarPayloadNoBloco(b: BlocoPlanejado, p: PayloadBloco): BlocoPlanejado {
  const novo = { ...b };
  if (p.inicio_em !== undefined) novo.inicio_em = p.inicio_em;
  if (p.duracao_min !== undefined) novo.duracao_min = p.duracao_min;
  return novo;
}

/** Quanto tempo alocar ao soltar uma Tarefa no calendário: o que ela precisa (`duration_min`), ou um padrão se não estimou. Nunca mexe na Tarefa. */
export function duracaoParaAlocar(duracaoMin: number | null | undefined): number {
  return duracaoMin && duracaoMin > 0 ? Math.min(duracaoMin, MINUTOS_DIA) : DURACAO_SEM_DADO_MIN;
}

// ---------------------------------------------------------------------------------------------------------------
// Sobreposição
// ---------------------------------------------------------------------------------------------------------------

export interface Faixa {
  chave: string;
  inicioMin: number;
  duracaoMin: number;
}

/**
 * Divide a largura entre blocos que se sobrepõem no mesmo dia: cada grupo de blocos que se tocam (mesmo que só em
 * cadeia) ganha N colunas iguais, e cada bloco fica na primeira coluna livre. Usa a duração VISUAL (mínimo legível).
 */
export function distribuirColunas(faixas: Faixa[]): Map<string, { coluna: number; colunas: number }> {
  const fim = (f: Faixa) => f.inicioMin + Math.max(f.duracaoMin, DURACAO_VISUAL_MINIMA_MIN);
  const ordenadas = [...faixas].sort((a, b) => a.inicioMin - b.inicioMin || fim(b) - fim(a) || a.chave.localeCompare(b.chave));
  const resultado = new Map<string, { coluna: number; colunas: number }>();
  let grupo: { faixa: Faixa; coluna: number }[] = [];
  let fimDoGrupo = -Infinity;
  const fechar = () => {
    const colunas = grupo.reduce((mx, g) => Math.max(mx, g.coluna + 1), 0);
    for (const g of grupo) resultado.set(g.faixa.chave, { coluna: g.coluna, colunas });
    grupo = [];
  };
  let fimsDasColunas: number[] = [];
  for (const f of ordenadas) {
    if (grupo.length && f.inicioMin >= fimDoGrupo) {
      fechar();
      fimsDasColunas = [];
    }
    let coluna = fimsDasColunas.findIndex((fimDaColuna) => fimDaColuna <= f.inicioMin);
    if (coluna === -1) coluna = fimsDasColunas.length;
    fimsDasColunas[coluna] = fim(f);
    grupo.push({ faixa: f, coluna });
    fimDoGrupo = Math.max(fimDoGrupo, fim(f));
  }
  if (grupo.length) fechar();
  return resultado;
}

// ---------------------------------------------------------------------------------------------------------------
// Gestos: do ponteiro para uma posição
// ---------------------------------------------------------------------------------------------------------------

export interface ColunaGeometria {
  dia: string;
  left: number;
  right: number;
  /** Topo da coluna de horas (00:00) na tela, já descontada a rolagem. */
  top: number;
}

export interface FaixaDiaTodoGeometria {
  dia: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function colunaMaisProxima<T extends { left: number; right: number }>(itens: T[], x: number): T | null {
  if (!itens.length) return null;
  const dentro = itens.find((c) => x >= c.left && x < c.right);
  if (dentro) return dentro;
  return x < itens[0].left ? itens[0] : itens[itens.length - 1];
}

/**
 * Posição para onde um item "de horário" arrastado cairia com o ponteiro em (x, y).
 * `deslocamentoMin` é onde, dentro do bloco, a pessoa o agarrou — sem ele o bloco pularia para ter o topo sob o dedo.
 * A duração é sempre a original: mover não a altera.
 */
export function posicaoDoPonteiro(g: {
  colunas: ColunaGeometria[];
  faixasDiaTodo: FaixaDiaTodoGeometria[];
  x: number;
  y: number;
  deslocamentoMin: number;
  duracaoMin: number;
  encaixe: number;
  /** `false` para blocos de tempo, que não têm "dia inteiro": a faixa é ignorada e o ponteiro sobre ela vira 00:00. */
  permiteDiaInteiro?: boolean;
}): Posicao | null {
  const faixa = g.permiteDiaInteiro !== false && g.faixasDiaTodo.length ? colunaMaisProxima(g.faixasDiaTodo, g.x) : null;
  if (faixa && g.y >= faixa.top && g.y < faixa.bottom) return { dia: faixa.dia, inicioMin: null, duracaoMin: g.duracaoMin };
  const coluna = colunaMaisProxima(g.colunas, g.x);
  if (!coluna) return null;
  const bruto = (g.y - coluna.top) / PX_POR_MINUTO - g.deslocamentoMin;
  const inicioMin = limitar(arredondar(bruto, g.encaixe), 0, MINUTOS_DIA - g.encaixe);
  return { dia: coluna.dia, inicioMin, duracaoMin: g.duracaoMin };
}

/** Nova duração de um bloco redimensionado pela borda de baixo com o ponteiro em `y`. Nunca menor que um encaixe nem além da meia-noite. */
export function duracaoDoPonteiro(g: { y: number; colunaTop: number; inicioMin: number; encaixe: number }): number {
  const fimMin = arredondar((g.y - g.colunaTop) / PX_POR_MINUTO, g.encaixe);
  return limitar(fimMin - g.inicioMin, g.encaixe, Math.max(g.encaixe, MINUTOS_DIA - g.inicioMin));
}

// ---------------------------------------------------------------------------------------------------------------
// Teclado e menu: as mesmas mudanças sem ponteiro
// ---------------------------------------------------------------------------------------------------------------

export type AcaoTeclado =
  | { tipo: "mover"; dDias: number; dEncaixes: number }
  | { tipo: "redimensionar"; dEncaixes: number }
  | { tipo: "alternarDiaInteiro" };

export function aplicarAcao(pos: Posicao, acao: AcaoTeclado, encaixe: number, permiteDiaInteiro = true): Posicao {
  switch (acao.tipo) {
    case "mover": {
      const dia = acao.dDias ? somarDiasISO(pos.dia, acao.dDias) : pos.dia;
      // Item de dia inteiro só anda entre dias; subir/descer não tem significado ali.
      if (pos.inicioMin === null) return { ...pos, dia };
      const inicioMin = limitar(arredondar(pos.inicioMin + acao.dEncaixes * encaixe, encaixe), 0, MINUTOS_DIA - encaixe);
      return { ...pos, dia, inicioMin };
    }
    case "redimensionar": {
      if (pos.inicioMin === null) return pos;
      const duracaoMin = limitar(arredondar(pos.duracaoMin + acao.dEncaixes * encaixe, encaixe), encaixe, Math.max(encaixe, MINUTOS_DIA - pos.inicioMin));
      return { ...pos, duracaoMin };
    }
    case "alternarDiaInteiro":
      if (!permiteDiaInteiro) return pos;
      return pos.inicioMin === null ? { ...pos, inicioMin: HORA_PADRAO_MIN } : { ...pos, inicioMin: null };
  }
}

/** Traduz uma tecla (com modificadores) na ação que ela faz num item da grade; `null` se a tecla não é nossa. */
export function acaoDaTecla(e: { key: string; shiftKey: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }): AcaoTeclado | null {
  if (e.altKey || e.ctrlKey || e.metaKey) return null;
  switch (e.key) {
    case "ArrowUp": return e.shiftKey ? { tipo: "redimensionar", dEncaixes: -1 } : { tipo: "mover", dDias: 0, dEncaixes: -1 };
    case "ArrowDown": return e.shiftKey ? { tipo: "redimensionar", dEncaixes: 1 } : { tipo: "mover", dDias: 0, dEncaixes: 1 };
    case "ArrowLeft": return { tipo: "mover", dDias: -1, dEncaixes: 0 };
    case "ArrowRight": return { tipo: "mover", dDias: 1, dEncaixes: 0 };
    case "a":
    case "A": return { tipo: "alternarDiaInteiro" };
    default: return null;
  }
}

export function posicaoIgual(a: Posicao, b: Posicao): boolean {
  return a.dia === b.dia && a.inicioMin === b.inicioMin && a.duracaoMin === b.duracaoMin;
}

/** Texto para leitor de tela e tooltip: "segunda-feira, 10:30 às 11:15" / "segunda-feira, dia inteiro". */
export function descreverPosicao(p: Posicao): string {
  const dia = meioDiaLocal(p.dia).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
  if (p.inicioMin === null) return `${dia}, dia inteiro`;
  return `${dia}, ${rotuloHorario(p.inicioMin)} às ${rotuloHorario(p.inicioMin + p.duracaoMin)}`;
}
