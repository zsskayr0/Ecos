import { useSyncExternalStore } from "react";

/** Regra de repetição (só o desenho por enquanto: a grade ainda não expande as ocorrências). `diasSemana`: 0 = domingo. */
export type Repeticao = {
  freq: "dia" | "semana" | "mes" | "ano";
  intervalo: number;
  diasSemana: number[];
  fim: { tipo: "nunca" } | { tipo: "data"; data: string } | { tipo: "vezes"; vezes: number };
};

/** Evento criado na Agenda. Vive só nesta sessão (ainda não há backend de eventos); `minutos === null` = dia inteiro. */
export type EventoLocal = { id: number; titulo: string; inicio: string; cor: string; minutos: number | null; duracaoMin: number; local?: string; descricao?: string; repete?: Repeticao; /** Cor livre (#RRGGBB) escolhida no editor; `cor` guarda só a classe de reserva. */ corHex?: string };

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
