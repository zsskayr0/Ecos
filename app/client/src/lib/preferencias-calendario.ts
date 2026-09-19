import { useSyncExternalStore } from "react";

/**
 * Preferências de calendário (tela Configurações → Calendário e localização), guardadas neste dispositivo.
 * A Agenda as lê por `usePreferenciasCalendario`, que reage na hora quando a pessoa salva — na mesma janela (evento próprio)
 * ou em outra (evento `storage`) — sem recarregar nada.
 */
export const CHAVE_PREFERENCIAS_CALENDARIO = "ecos.config.calendario";
export const EVENTO_PREFERENCIAS_CALENDARIO = "ecos:preferencias-calendario";

export interface PreferenciasCalendario {
  pais: string;
  fuso: string;
  /** Início do período acordado, `HH:MM`: onde a Agenda começa a rolagem nas visões de horário. */
  inicio: string;
  /** "Mostrar prazos no calendário": marca as tarefas que têm `due_date`. */
  deadlines: boolean;
}

export const PREFERENCIAS_PADRAO: PreferenciasCalendario = { pais: "Brasil", fuso: "America/Sao_Paulo", inicio: "06:00", deadlines: true };

/** `HH:MM` → minutos desde 00:00; valor inválido cai no padrão (nunca dá `NaN` para quem calcula posição). */
export function minutosDoInicio(inicio: string | undefined | null): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(inicio ?? "");
  if (m && Number(m[1]) < 24 && Number(m[2]) < 60) return Number(m[1]) * 60 + Number(m[2]);
  return 6 * 60;
}

function normalizar(bruto: unknown): PreferenciasCalendario {
  const o = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  return {
    pais: typeof o.pais === "string" ? o.pais : PREFERENCIAS_PADRAO.pais,
    fuso: typeof o.fuso === "string" ? o.fuso : PREFERENCIAS_PADRAO.fuso,
    inicio: typeof o.inicio === "string" && /^\d{1,2}:\d{2}$/.test(o.inicio) ? o.inicio : PREFERENCIAS_PADRAO.inicio,
    deadlines: typeof o.deadlines === "boolean" ? o.deadlines : PREFERENCIAS_PADRAO.deadlines,
  };
}

function lerBruto(): string | null {
  try {
    return localStorage.getItem(CHAVE_PREFERENCIAS_CALENDARIO);
  } catch {
    return null;
  }
}

export function lerPreferenciasCalendario(): PreferenciasCalendario {
  try {
    return normalizar(JSON.parse(lerBruto() ?? "{}"));
  } catch {
    return { ...PREFERENCIAS_PADRAO };
  }
}

/** Grava (mesclando com o que já existia) e avisa quem está ouvindo, para a Agenda mudar sem recarregar. */
export function salvarPreferenciasCalendario(novas: Partial<PreferenciasCalendario>): void {
  const mescladas = { ...lerPreferenciasCalendario(), ...novas };
  try {
    localStorage.setItem(CHAVE_PREFERENCIAS_CALENDARIO, JSON.stringify(mescladas));
  } catch {
    /* armazenamento indisponível: a mudança vale só até recarregar */
  }
  window.dispatchEvent(new Event(EVENTO_PREFERENCIAS_CALENDARIO));
}

// `useSyncExternalStore` exige um retorno estável entre chamadas: só recalcula quando o texto guardado muda.
let textoEmCache: string | null | undefined;
let valorEmCache: PreferenciasCalendario = { ...PREFERENCIAS_PADRAO };
function instantaneo(): PreferenciasCalendario {
  const texto = lerBruto();
  if (texto !== textoEmCache) {
    textoEmCache = texto;
    valorEmCache = lerPreferenciasCalendario();
  }
  return valorEmCache;
}

function assinar(aviso: () => void) {
  const aoArmazenar = (e: StorageEvent) => { if (e.key === null || e.key === CHAVE_PREFERENCIAS_CALENDARIO) aviso(); };
  window.addEventListener(EVENTO_PREFERENCIAS_CALENDARIO, aviso);
  window.addEventListener("storage", aoArmazenar);
  return () => {
    window.removeEventListener(EVENTO_PREFERENCIAS_CALENDARIO, aviso);
    window.removeEventListener("storage", aoArmazenar);
  };
}

export function usePreferenciasCalendario(): { preferencias: PreferenciasCalendario; inicioMin: number; mostrarPrazos: boolean } {
  const preferencias = useSyncExternalStore(assinar, instantaneo, instantaneo);
  return { preferencias, inicioMin: minutosDoInicio(preferencias.inicio), mostrarPrazos: preferencias.deadlines };
}
