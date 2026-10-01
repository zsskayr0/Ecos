import { useCallback, useEffect, useMemo, useState } from "react";
import { eventos as eventosApi, vault, type Evento, type ExcecaoEvento, type TransacaoApi } from "@/lib/api";
import { formatMoeda } from "@/lib/format";
import { dataLocalISO, instanteLocalISO, type Posicao } from "@/lib/agenda-tempo";
import type { EventoLocal } from "@/lib/eventos-locais";
import { expandir, lerExdates, lerRrule } from "@/lib/recorrencia";

/** Cor de quem não tem categoria (o ciano da marca, como o editor de eventos antigo). */
export const COR_EVENTO_PADRAO = "#0891B2";
const DIA_MS = 86_400_000;
const MAX_DIAS_POR_OCORRENCIA = 60;

const meiaNoite = (d: Date, dias = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + dias);
/** Duas datas são "a mesma ocorrência" se diferem menos de 1 minuto (o servidor compara do mesmo jeito). */
const mesmaOcorrencia = (a: Date, b: Date) => Math.abs(a.getTime() - b.getTime()) < 60_000;

function dataDoDia(dia: string): Date {
  const [a, m, d] = dia.split("-").map(Number);
  return new Date(a, m - 1, d);
}

interface Ocorrencia {
  inicio: Date;
  fim: Date;
  /** Início que a série previa (só em série): identifica a ocorrência no servidor. */
  original?: Date;
}

/**
 * Ocorrências de um evento que tocam `[de, ate)`. Série: expande a regra, tira as datas excluídas (EXDATE) e as
 * ocorrências com exceção, e põe no lugar as exceções (remarcadas/editadas), inclusive as que vieram de fora da janela.
 * Regra que não sabemos expandir: só a original (mais as exceções).
 */
function ocorrenciasDoEvento(e: Evento, de: Date, ate: Date): Ocorrencia[] {
  const inicio = new Date(e.inicio);
  const fim = new Date(e.fim);
  const duracao = fim.getTime() - inicio.getTime();
  const dias = Math.max(1, Math.round(duracao / DIA_MS));
  // Dia inteiro: o fim é sempre "meia-noite N dias depois" (não soma milissegundos: o horário de verão tem dias de 23/25 h).
  const fimDe = (i: Date) => (e.dia_inteiro ? meiaNoite(i, dias) : new Date(i.getTime() + duracao));
  const toca = (o: Ocorrencia) => o.inicio < ate && (o.fim > de || (o.fim.getTime() === o.inicio.getTime() && o.inicio >= de));

  if (!e.rrule) return [{ inicio, fim }].filter(toca);

  const regra = lerRrule(e.rrule);
  const excluidas = lerExdates(e.recorrencia_extra ?? []);
  const excecoes = e.excecoes ?? [];
  const daRegra = regra ? expandir(inicio, regra, de, ate, e.dia_inteiro ? dias * DIA_MS : duracao) : [inicio];

  const saida: Ocorrencia[] = [];
  for (const i of daRegra) {
    if (excluidas.some((x) => mesmaOcorrencia(x, i))) continue;
    if (excecoes.some((x) => mesmaOcorrencia(new Date(x.original), i))) continue; // entra abaixo, com as mudanças
    const o = { inicio: i, fim: fimDe(i), original: i };
    if (toca(o)) saida.push(o);
  }
  for (const x of excecoes) {
    if (x.cancelada) continue;
    const original = new Date(x.original);
    const ini = x.inicio ? new Date(x.inicio) : original;
    const o = { inicio: ini, fim: x.fim ? new Date(x.fim) : fimDe(ini), original };
    if (toca(o)) saida.push(o);
  }
  return saida.sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
}

interface Fatia { dia: string; minutos: number | null; duracaoMin: number }

function fatiasDaOcorrencia(o: Ocorrencia, diaInteiro: boolean): Fatia[] {
  const fatias: Fatia[] = [];
  if (diaInteiro) {
    const total = Math.max(1, Math.round((meiaNoite(o.fim).getTime() - meiaNoite(o.inicio).getTime()) / DIA_MS));
    for (let n = 0; n < Math.min(total, MAX_DIAS_POR_OCORRENCIA); n++) fatias.push({ dia: dataLocalISO(meiaNoite(o.inicio, n)), minutos: null, duracaoMin: 60 });
    return fatias;
  }
  for (let n = 0; n < MAX_DIAS_POR_OCORRENCIA; n++) {
    const inicioDoDia = meiaNoite(o.inicio, n);
    if (inicioDoDia > o.fim || (n > 0 && inicioDoDia >= o.fim)) break;
    const de = new Date(Math.max(o.inicio.getTime(), inicioDoDia.getTime()));
    const ate = new Date(Math.min(o.fim.getTime(), meiaNoite(o.inicio, n + 1).getTime()));
    fatias.push({ dia: dataLocalISO(inicioDoDia), minutos: Math.round((de.getTime() - inicioDoDia.getTime()) / 60_000), duracaoMin: Math.max(1, Math.round((ate.getTime() - de.getTime()) / 60_000)) });
  }
  return fatias;
}

/** Itens da grade de um evento do servidor dentro da janela: série expandida, vários dias e dia inteiro viram um item por dia. */
export function eventoParaItens(e: Evento, de: Date, ate: Date): EventoLocal[] {
  const cor = e.cor ?? e.categoria?.cor ?? COR_EVENTO_PADRAO;
  const itens: EventoLocal[] = [];
  for (const o of ocorrenciasDoEvento(e, de, ate)) {
    const fatias = fatiasDaOcorrencia(o, e.dia_inteiro);
    for (const f of fatias) {
      itens.push({
        // Numa série o dia sozinho não basta (uma exceção pode cair no dia de outra ocorrência): entra o original.
        id: o.original ? `${e.id}@${o.original.getTime()}@${f.dia}` : `${e.id}@${f.dia}`,
        servidorId: e.id, titulo: e.titulo, inicio: f.dia, cor: "", corHex: cor, minutos: f.minutos, duracaoMin: f.duracaoMin,
        local: e.local ?? undefined, visibilidade: e.visibilidade,
        movivel: fatias.length === 1,
        ocorrencia: o.original?.toISOString(),
      });
    }
  }
  // Título/local próprios da exceção (a data e a hora já vieram de `ocorrenciasDoEvento`).
  return itens.map((i) => {
    if (!i.ocorrencia) return i;
    const x = (e.excecoes ?? []).find((c) => mesmaOcorrencia(new Date(c.original), new Date(i.ocorrencia!)));
    if (!x) return i;
    return { ...i, titulo: x.titulo ?? i.titulo, local: x.local === null || x.local === undefined ? i.local : x.local || undefined };
  });
}

/** Como uma ocorrência aparece (com as mudanças da exceção por cima da série): o que o diálogo de "só esta" mostra. */
export function ocorrenciaEfetiva(e: Evento, original: string): { titulo: string; inicio: string; fim: string; local: string | null; descricao: string } {
  const x: ExcecaoEvento | undefined = (e.excecoes ?? []).find((c) => mesmaOcorrencia(new Date(c.original), new Date(original)));
  const duracao = new Date(e.fim).getTime() - new Date(e.inicio).getTime();
  const inicio = x?.inicio ?? original;
  return {
    titulo: x?.titulo ?? e.titulo,
    inicio,
    fim: x?.fim ?? new Date(new Date(inicio).getTime() + duracao).toISOString(),
    local: x?.local === null || x?.local === undefined ? e.local : x.local || null,
    descricao: x?.descricao ?? e.descricao ?? "",
  };
}

/** Janela `[de, ate)` que cobre os dois dias (`YYYY-MM-DD`, inclusivos) com 1 dia de folga de cada lado (fusos/horário de verão). */
export function janelaDosDias(de: string, ate: string): { de: Date; ate: Date } {
  return { de: meiaNoite(dataDoDia(de), -1), ate: meiaNoite(dataDoDia(ate), 2) };
}

/** Novo início/fim (ISO/UTC) de um evento (ou de uma ocorrência sua) solto em `destino`. Dia inteiro mantém a quantidade de dias. */
export function intervaloDoDestino(e: Evento, destino: Posicao): { inicio: string; fim: string } {
  if (e.dia_inteiro) {
    const dias = Math.max(1, Math.round((new Date(e.fim).getTime() - new Date(e.inicio).getTime()) / DIA_MS));
    const inicio = dataDoDia(destino.dia);
    return { inicio: inicio.toISOString(), fim: meiaNoite(inicio, dias).toISOString() };
  }
  const inicio = instanteLocalISO(destino.dia, destino.inicioMin ?? 9 * 60);
  return { inicio, fim: new Date(new Date(inicio).getTime() + destino.duracaoMin * 60_000).toISOString() };
}

interface Provisorio { inicio: string; fim: string; original?: string }

/** Aplica um movimento ainda não confirmado: evento simples muda de horário; ocorrência de série ganha uma exceção. */
function comProvisorio(e: Evento, p: Provisorio | undefined): Evento {
  if (!p) return e;
  if (!p.original) return { ...e, inicio: p.inicio, fim: p.fim };
  const original = p.original;
  const outras = (e.excecoes ?? []).filter((x) => !mesmaOcorrencia(new Date(x.original), new Date(original)));
  const anterior = (e.excecoes ?? []).find((x) => mesmaOcorrencia(new Date(x.original), new Date(original)));
  const nova: ExcecaoEvento = { titulo: null, local: null, descricao: null, sync_pendente: true, ...anterior, original, cancelada: false, inicio: p.inicio, fim: p.fim };
  return { ...e, excecoes: [...outras, nova] };
}

/**
 * Eventos do servidor que aparecem entre dois dias (inclusivos), já como itens da grade. `versao` (RefreshBus)
 * recarrega depois de qualquer criação/edição. `mover` atualiza na hora e desfaz se o servidor recusar; com `ocorrencia`
 * (início original) mexe só naquela ocorrência de uma série.
 */
/** Transação do Cofre como item de dia inteiro: verde = entrada, vermelho = saída. */
export function transacaoParaItem(t: TransacaoApi): EventoLocal {
  const sinal = t.tipo === "entrada" ? "+" : "−";
  return {
    id: `transacao:${t.id}`, transacaoId: t.id, inicio: t.data, minutos: null, duracaoMin: 60, cor: "", movivel: false,
    corHex: t.tipo === "entrada" ? "#22c55e" : "#ef4444",
    titulo: `${sinal}${formatMoeda(t.valor_centavos)} ${t.descricao}${t.status === "pendente" ? " (pendente)" : ""}`,
  };
}

export function useEventosDoPeriodo(de: string, ate: string, versao: number, espaco?: string, incluirTransacoes = false) {
  const [brutos, setBrutos] = useState<Evento[]>([]);
  const [transacoes, setTransacoes] = useState<TransacaoApi[]>([]);
  const comTransacoes = incluirTransacoes;
  // O Cofre é por equipe: cada espaço mostra as transações do seu próprio Cofre (sem filtro = o pessoal).
  const espacoDoCofre = espaco ?? "pessoal";

  // Transações do Cofre no mesmo calendário. Cofre desligado/trancado = sem transações, sem erro na Agenda.
  useEffect(() => {
    if (!comTransacoes) { setTransacoes([]); return; }
    let vivo = true;
    (async () => {
      const todas: TransacaoApi[] = [];
      let cursor: string | undefined;
      for (let pagina = 0; pagina < 5; pagina += 1) {
        const r = await vault.transacoes.listar({ data_de: de, data_ate: ate, limit: 200, cursor }, espacoDoCofre);
        todas.push(...r.items);
        if (!r.next_cursor) break;
        cursor = r.next_cursor;
      }
      return todas;
    })().then((l) => { if (vivo) setTransacoes(l); }).catch(() => { if (vivo) setTransacoes([]); });
    return () => { vivo = false; };
  }, [de, ate, versao, comTransacoes, espacoDoCofre]);
  const [provisorio, setProvisorio] = useState<Record<string, Provisorio>>({});

  useEffect(() => {
    let vivo = true;
    const janela = janelaDosDias(de, ate);
    eventosApi
      .listar({ de: janela.de.toISOString(), ate: janela.ate.toISOString(), espaco, limit: 2000 })
      .then((lista) => { if (vivo) { setBrutos(lista); setProvisorio({}); } })
      .catch(() => { if (vivo) setBrutos([]); });
    return () => { vivo = false; };
  }, [de, ate, versao, espaco]);

  const eventos = useMemo(() => {
    const janela = janelaDosDias(de, ate);
    const doCofre = transacoes.map(transacaoParaItem);
    return [...doCofre, ...brutos.flatMap((e) => {
      const provisorios = Object.entries(provisorio).filter(([chave]) => chave === e.id || chave.startsWith(`${e.id}|`));
      const atual = provisorios.reduce((acc, [, p]) => comProvisorio(acc, p), e);
      return eventoParaItens(atual, janela.de, janela.ate);
    })];
  }, [brutos, transacoes, provisorio, de, ate]);

  const mover = useCallback(async (servidorId: string, destino: Posicao, ocorrencia?: string) => {
    const evento = brutos.find((e) => e.id === servidorId);
    if (!evento) return;
    // Numa ocorrência de série o tamanho do bloco vem da série (ou da exceção), não do evento-mestre puro.
    const base = ocorrencia ? { ...evento, ...ocorrenciaEfetiva(evento, ocorrencia) } : evento;
    const novo = intervaloDoDestino(base, destino);
    const chave = ocorrencia ? `${servidorId}|${ocorrencia}` : servidorId;
    setProvisorio((p) => ({ ...p, [chave]: { ...novo, original: ocorrencia } }));
    try {
      if (ocorrencia) await eventosApi.atualizarOcorrencia(servidorId, { original: ocorrencia, ...novo });
      else await eventosApi.atualizar(servidorId, novo);
    } catch (erro) {
      setProvisorio((p) => { const { [chave]: _descartado, ...resto } = p; return resto; });
      throw erro;
    }
  }, [brutos]);

  return { eventos, mover };
}
