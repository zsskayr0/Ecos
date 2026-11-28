import type { AtividadeTimeline, PrioridadeTarefa, TarefaResumo } from "@/lib/api";
import { dataLocalISO, diaEMinutosLocais, somarDiasISO } from "@/lib/agenda-tempo";
import type { EventoLocal } from "@/lib/eventos-locais";

/**
 * Modelo da Timeline: junta a programação (tarefas com data, eventos, lançamentos do Cofre) e o registro do que
 * aconteceu (notas e tarefas criadas, editadas, concluídas) numa linha só, agrupada por dia e ordenada por horário.
 * Puro — a tela só busca os dados e desenha o resultado.
 */

/** `programado` = algo marcado para o dia (trilho principal); `registro` = algo que a pessoa fez (ramo ao lado). */
export type Natureza = "programado" | "registro";

export type Alvo =
  | { tipo: "tarefa" | "nota"; id: string }
  | { tipo: "evento"; id: string; ocorrencia?: string }
  | { tipo: "transacao"; id: string }
  | { tipo: "recorrencia"; id: string };

export type Situacao = "normal" | "atrasada" | "concluida";

export type Icone = "tarefa" | "prazo" | "evento" | "transacao" | "nota-criada" | "nota-editada" | "tarefa-criada" | "tarefa-editada" | "tarefa-concluida";

/** O que o cartão de detalhes mostra ao passar o mouse. Só vem preenchido o que a origem conhece. */
export interface InfoItem {
  pasta?: string | null;
  tags?: string[];
  prioridade?: PrioridadeTarefa;
  duracaoMin?: number | null;
  criadoEm?: string;
  /** Tarefa pendente: o cartão oferece concluir e reagendar. */
  pendente?: boolean;
  /** Tem horário marcado (reagendar mantém a hora). */
  scheduledAt?: string | null;
}

export interface ItemTimeline {
  chave: string;
  dia: string;
  /** Minutos desde a meia-noite local; `null` = dia todo / sem horário. */
  minutos: number | null;
  natureza: Natureza;
  situacao: Situacao;
  icone: Icone;
  titulo: string;
  /** Texto curto à direita (valor do lançamento, "Alta") ou, no registro, o que foi feito ("Criou a nota"). */
  detalhe?: string;
  /** Lançamento do Cofre: valor com sinal (entrada positiva). */
  valorCentavos?: number;
  /** Cor de destaque do marcador (`#RRGGBB`), quando o item tem uma. */
  cor?: string;
  alvo: Alvo | null;
  info?: InfoItem;
}

export interface DiaTimeline {
  dia: string;
  itens: ItemTimeline[];
}

export interface Janela { de: string; ate: string }

/** Janela inicial: uma semana para trás e duas para frente. */
export function janelaInicial(hoje: string): Janela {
  return { de: somarDiasISO(hoje, -7), ate: somarDiasISO(hoje, 14) };
}

/** Quantos dias a janela cresce a cada "ver mais", para o passado ou para o futuro. */
export const PASSO_DIAS = 14;

/** Teto de dias carregados de uma vez. */
export const MAX_DIAS = 180;

export function diasDaJanela({ de, ate }: Janela): string[] {
  const dias: string[] = [];
  for (let d = de; d <= ate && dias.length < MAX_DIAS; d = somarDiasISO(d, 1)) dias.push(d);
  return dias;
}

/** Janela que também cobre `dia` (para pular até um dia fora do que já foi carregado). */
export function janelaComDia(janela: Janela, dia: string): Janela {
  return { de: dia < janela.de ? dia : janela.de, ate: dia > janela.ate ? dia : janela.ate };
}

const ROTULO_ATIVIDADE: Record<AtividadeTimeline["acao"], Record<AtividadeTimeline["tipo"], string>> = {
  criada: { nota: "Criou a nota", tarefa: "Criou a tarefa" },
  editada: { nota: "Editou a nota", tarefa: "Editou a tarefa" },
  concluida: { nota: "Concluiu", tarefa: "Concluiu" },
};

export function rotuloAtividade(a: Pick<AtividadeTimeline, "acao" | "tipo">): string {
  return ROTULO_ATIVIDADE[a.acao][a.tipo];
}

function itemDaTarefa(t: TarefaResumo, agora: Date): ItemTimeline | null {
  if (t.status === "arquivada") return null;
  const concluida = t.status === "concluida";
  const hoje = dataLocalISO(agora);
  const base = {
    natureza: "programado" as const,
    titulo: t.privada ? "Tarefa privada" : t.titulo,
    alvo: t.privada ? null : { tipo: "tarefa" as const, id: t.id },
    detalhe: t.prioridade === "alta" && !concluida ? "Alta" : undefined,
    info: t.privada ? undefined : { pasta: t.pasta, tags: t.tags, prioridade: t.prioridade, duracaoMin: t.duration_min, criadoEm: t.criado_em, pendente: !concluida, scheduledAt: t.scheduled_at },
  };
  if (t.scheduled_at) {
    const { dia, minutos } = diaEMinutosLocais(t.scheduled_at);
    const passou = new Date(t.scheduled_at).getTime() < agora.getTime();
    return { ...base, chave: `tarefa:${t.id}`, dia, minutos, icone: "tarefa", situacao: concluida ? "concluida" : passou ? "atrasada" : "normal" };
  }
  if (!t.due_date) return null;
  const dia = t.due_date.slice(0, 10);
  return { ...base, chave: `tarefa:${t.id}`, dia, minutos: null, icone: "prazo", situacao: concluida ? "concluida" : dia < hoje ? "atrasada" : "normal" };
}

function itemDoEvento(e: EventoLocal): ItemTimeline {
  if (e.recorrenciaId) {
    return { chave: `${e.id}`, dia: e.inicio, minutos: null, natureza: "programado", situacao: "normal", icone: "transacao", titulo: e.titulo, detalhe: e.legenda, valorCentavos: e.valorCentavos, cor: e.corHex, alvo: { tipo: "recorrencia", id: e.recorrenciaId } };
  }
  if (e.transacaoId) {
    return { chave: `transacao:${e.transacaoId}`, dia: e.inicio, minutos: null, natureza: "programado", situacao: "normal", icone: "transacao", titulo: e.titulo, detalhe: e.legenda, valorCentavos: e.valorCentavos, cor: e.corHex, alvo: { tipo: "transacao", id: e.transacaoId } };
  }
  return {
    chave: `evento:${e.id}`, dia: e.inicio, minutos: e.minutos, natureza: "programado", situacao: "normal", icone: "evento", titulo: e.titulo, cor: e.corHex,
    alvo: e.servidorId ? { tipo: "evento", id: e.servidorId, ocorrencia: e.ocorrencia } : null,
    info: e.duracaoMin && e.minutos !== null ? { duracaoMin: e.duracaoMin } : undefined,
  };
}

function itemDaAtividade(a: AtividadeTimeline): ItemTimeline {
  const { dia, minutos } = diaEMinutosLocais(a.em);
  return {
    chave: `atividade:${a.tipo}:${a.id}:${a.acao}`, dia, minutos, natureza: "registro", situacao: a.acao === "concluida" ? "concluida" : "normal",
    icone: `${a.tipo}-${a.acao}` as Icone,
    titulo: a.titulo, detalhe: rotuloAtividade(a), alvo: { tipo: a.tipo, id: a.id },
  };
}

/** Dia todo antes; depois por horário; no empate o programado vem antes do registro. */
function comparar(a: ItemTimeline, b: ItemTimeline): number {
  const ma = a.minutos ?? -1;
  const mb = b.minutos ?? -1;
  if (ma !== mb) return ma - mb;
  if (a.natureza !== b.natureza) return a.natureza === "programado" ? -1 : 1;
  return a.titulo.localeCompare(b.titulo, "pt-BR");
}

export function montarTimeline(entrada: {
  janela: Janela;
  tarefas: TarefaResumo[];
  eventos: EventoLocal[];
  atividades: AtividadeTimeline[];
  agora: Date;
}): DiaTimeline[] {
  const { janela, agora } = entrada;
  const porDia = new Map<string, ItemTimeline[]>(diasDaJanela(janela).map((d) => [d, []]));
  const vistos = new Set<string>();
  const incluir = (item: ItemTimeline | null) => {
    if (!item || vistos.has(item.chave)) return;
    const lista = porDia.get(item.dia);
    if (!lista) return;
    vistos.add(item.chave);
    lista.push(item);
  };

  const programadas = entrada.tarefas.map((t) => itemDaTarefa(t, agora));
  programadas.forEach(incluir);
  entrada.eventos.forEach((e) => incluir(itemDoEvento(e)));
  // A conclusão de uma tarefa já programada no mesmo dia aparece riscada no próprio item: não repete no registro.
  const programadasNoDia = new Set(programadas.filter(Boolean).map((i) => `${i!.dia}|${i!.alvo?.id}`));
  entrada.atividades.forEach((a) => {
    const item = itemDaAtividade(a);
    if (a.acao === "concluida" && programadasNoDia.has(`${item.dia}|${a.id}`)) return;
    incluir(item);
  });

  return [...porDia.entries()].map(([dia, itens]) => ({ dia, itens: itens.sort(comparar) }));
}

/** Tarefas pendentes de dias anteriores a hoje — o grupo "Atrasadas", do mais antigo ao mais recente. */
export function atrasadasAteOntem(tarefas: TarefaResumo[], agora: Date): ItemTimeline[] {
  const hoje = dataLocalISO(agora);
  return tarefas
    .map((t) => itemDaTarefa(t, agora))
    .filter((i): i is ItemTimeline => !!i && i.situacao === "atrasada" && i.dia < hoje)
    .sort((a, b) => (a.dia === b.dia ? comparar(a, b) : a.dia.localeCompare(b.dia)));
}

/**
 * Ramo do registro numa linha do dia: o que a pessoa fez corre num trilho próprio, ao lado da programação, como um
 * ramo de commits. Para cada linha diz se o ramo passa na metade de cima/de baixo, se entra (curva saindo do trilho
 * principal) ou sai (curva voltando), e se a linha tem um ponto nele.
 */
export interface RamoDaLinha {
  cima: boolean; baixo: boolean; entra: boolean; sai: boolean; ponto: boolean;
  /** O dia tem registro: o trilho da programação é desenhado linha a linha, e não inteiro pelo grupo. */
  porLinha: boolean;
  /** Esta linha desenha o trilho da programação. Some em todo o trecho em que o ramo do registro desvia (a curva o substitui; item programado no meio fica só com o ponto). */
  trilho: boolean;
}

export function ramosDoRegistro(itens: Pick<ItemTimeline, "natureza">[]): RamoDaLinha[] {
  const primeiro = itens.findIndex((i) => i.natureza === "registro");
  let ultimo = -1;
  itens.forEach((i, n) => { if (i.natureza === "registro") ultimo = n; });
  return itens.map((item, n) => {
    const dentro = primeiro !== -1 && n >= primeiro && n <= ultimo;
    const registro = item.natureza === "registro";
    return { cima: dentro && n > primeiro, baixo: dentro && n < ultimo, entra: n === primeiro, sai: n === ultimo, ponto: registro,
      porLinha: primeiro !== -1, trilho: !dentro };
  });
}

/** Quanto aconteceu em cada dia (programado + registro), para o calendário de atividade. */
export function intensidadePorDia(dias: DiaTimeline[]): Map<string, number> {
  return new Map(dias.map(({ dia, itens }) => [dia, itens.length]));
}

/** Nível 0–4 de um dia, relativo ao dia mais cheio do período (como um mapa de contribuições). */
export function nivelDeIntensidade(quantidade: number, maximo: number): 0 | 1 | 2 | 3 | 4 {
  if (quantidade <= 0 || maximo <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((quantidade / maximo) * 4))) as 1 | 2 | 3 | 4;
}

export interface ResumoDia {
  /** Tarefas e prazos marcados para o dia. */
  programadas: number;
  concluidas: number;
  /** Pendentes de hoje que já passaram da hora, mais as atrasadas de dias anteriores. */
  atrasadas: number;
  eventos: number;
  notasCriadas: number;
  notasEditadas: number;
  entradasCentavos: number;
  saidasCentavos: number;
}

/** Números do painel ao lado da Timeline, tirados dos mesmos itens que ela desenha. */
export function resumirDia(dia: DiaTimeline | undefined, atrasadasAnteriores: number): ResumoDia {
  const r: ResumoDia = { programadas: 0, concluidas: 0, atrasadas: atrasadasAnteriores, eventos: 0, notasCriadas: 0, notasEditadas: 0, entradasCentavos: 0, saidasCentavos: 0 };
  for (const i of dia?.itens ?? []) {
    if (i.icone === "tarefa" || i.icone === "prazo") {
      r.programadas += 1;
      if (i.situacao === "concluida") r.concluidas += 1;
      if (i.situacao === "atrasada") r.atrasadas += 1;
    } else if (i.icone === "tarefa-concluida") r.concluidas += 1;
    else if (i.icone === "evento") r.eventos += 1;
    else if (i.icone === "nota-criada") r.notasCriadas += 1;
    else if (i.icone === "nota-editada") r.notasEditadas += 1;
    else if (i.icone === "transacao" && i.valorCentavos) {
      if (i.valorCentavos > 0) r.entradasCentavos += i.valorCentavos;
      else r.saidasCentavos -= i.valorCentavos;
    }
  }
  return r;
}

/** O que a lista desenha: um dia com itens (ou hoje), ou uma faixa de dias seguidos sem nada. */
export type TrechoTimeline = { tipo: "dia"; dia: DiaTimeline } | { tipo: "vazio"; de: string; ate: string };

/**
 * Some com os dias passados vazios e junta dias futuros vazios seguidos numa faixa só ("27 nov – 1 dez · nada
 * programado"), para a lista não virar uma sequência de "Nada programado". Hoje aparece sempre como dia.
 */
export function trechosDaTimeline(dias: DiaTimeline[], hoje: string, todosOsDias = false): TrechoTimeline[] {
  const trechos: TrechoTimeline[] = [];
  for (const d of dias) {
    // Ao lado da grade do mês (todosOsDias) cada dia aparece, mesmo vazio: a coluna acompanha a grade dia a dia.
    if (todosOsDias || d.itens.length > 0 || d.dia === hoje) { trechos.push({ tipo: "dia", dia: d }); continue; }
    if (d.dia < hoje) continue;
    const ultimo = trechos[trechos.length - 1];
    if (ultimo?.tipo === "vazio" && somarDiasISO(ultimo.ate, 1) === d.dia) ultimo.ate = d.dia;
    else trechos.push({ tipo: "vazio", de: d.dia, ate: d.dia });
  }
  return trechos;
}
