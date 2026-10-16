import { dataLocalISO } from "./agenda-tempo";

/** Aparelho cujo ponteiro principal é o dedo: teclado virtual, sem Ctrl/Shift+Enter. */
export function ehDispositivoDeToque(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

export type PrazoRapido = "hoje" | "amanha";

/** Data local (AAAA-MM-DD) do atalho de prazo, relativa a `agora`. */
export function dataDoPrazoRapido(prazo: PrazoRapido, agora: Date = new Date()): string {
  const d = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + (prazo === "amanha" ? 1 : 0));
  return dataLocalISO(d);
}
