import { useSyncExternalStore } from "react";

/** Regra de repetição (só o desenho por enquanto: a grade ainda não expande as ocorrências). `diasSemana`: 0 = domingo. */
export type Repeticao = {
  freq: "dia" | "semana" | "mes" | "ano";
  intervalo: number;
  diasSemana: number[];
  fim: { tipo: "nunca" } | { tipo: "data"; data: string } | { tipo: "vezes"; vezes: number };
};

/**
 * Evento como a Agenda o desenha: um item por dia (um evento de vários dias ou uma série vira vários itens); `minutos ===
 * null` = dia inteiro. Vem do servidor (`lib/eventos-agenda.ts`); `id` é único por item (`<idDoServidor>@<dia>`).
 */
export type EventoLocal = {
  id: number | string;
  titulo: string;
  /** Dia LOCAL (`YYYY-MM-DD`) deste item. */
  inicio: string;
  cor: string;
  minutos: number | null;
  duracaoMin: number;
  local?: string;
  descricao?: string;
  repete?: Repeticao;
  /** Cor da categoria (#RRGGBB); `cor` guarda só a classe de reserva. */
  corHex?: string;
  /** Id do evento no servidor (o mesmo para todos os itens de uma série ou de um evento de vários dias). */
  servidorId?: string;
  /** Cabe no arrasto: ocupa um dia só. Ocorrência de série se move como exceção (só ela); evento de vários dias não. */
  movivel?: boolean;
  /** Início ORIGINAL (ISO) desta ocorrência, se o item vem de uma série: é o que identifica a ocorrência no servidor. */
  ocorrencia?: string;
  visibilidade?: "privado" | "google";
  /** Item que vem de uma transação do Cofre (dia inteiro, só leitura): abrir leva ao lançamento. */
  transacaoId?: string;
};

// Estado compartilhado entre a Agenda e a tela Hoje: um evento criado/movido num lado aparece imediatamente no outro.
let eventos: EventoLocal[] = [];
const ouvintes = new Set<() => void>();

export function definirEventosLocais(proximo: EventoLocal[] | ((atuais: EventoLocal[]) => EventoLocal[])) {
  eventos = typeof proximo === "function" ? proximo(eventos) : proximo;
  ouvintes.forEach((o) => o());
}

export function lerEventosLocais() { return eventos; }

export function useEventosLocais(): [EventoLocal[], typeof definirEventosLocais] {
  const atuais = useSyncExternalStore(
    (o) => { ouvintes.add(o); return () => { ouvintes.delete(o); }; },
    lerEventosLocais,
  );
  return [atuais, definirEventosLocais];
}
