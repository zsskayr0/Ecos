import { useSyncExternalStore } from "react";
import { CHAVE_PREFERENCIAS_APLICATIVO, lerPreferenciasAplicativo, type FormatoData } from "./preferencias-aplicativo";

const EVENTO = "ecos:preferencias-aplicativo";

/** Reage na hora quando a pessoa muda a preferência (mesma janela ou outra). */
function assinar(aviso: () => void) {
  const aoArmazenar = (e: StorageEvent) => { if (e.key === null || e.key === CHAVE_PREFERENCIAS_APLICATIVO) aviso(); };
  window.addEventListener(EVENTO, aviso);
  window.addEventListener("storage", aoArmazenar);
  return () => { window.removeEventListener(EVENTO, aviso); window.removeEventListener("storage", aoArmazenar); };
}
let texto: string | null | undefined;
let valor = lerPreferenciasAplicativo();
function instantaneo() {
  let atual: string | null = null;
  try { atual = localStorage.getItem(CHAVE_PREFERENCIAS_APLICATIVO); } catch { /* sem armazenamento */ }
  if (atual !== texto) { texto = atual; valor = lerPreferenciasAplicativo(); }
  return valor;
}

/** 0 = domingo, 1 = segunda: primeiro dia da semana nos calendários. */
export function primeiroDiaDaSemana(): 0 | 1 { return lerPreferenciasAplicativo().semanaComecaSegunda ? 1 : 0; }
/** Quantas células vazias antes do dia 1 numa grade de mês, respeitando o início da semana. */
export function deslocamentoDoMes(primeiroDiaDoMes: Date): number { return (primeiroDiaDoMes.getDay() - primeiroDiaDaSemana() + 7) % 7; }
/** Letras do cabeçalho da grade (D S T Q Q S S), já rotacionadas. */
export function cabecalhoDaSemana(): string[] { const l = ["D", "S", "T", "Q", "Q", "S", "S"]; return primeiroDiaDaSemana() ? [...l.slice(1), l[0]] : l; }
export function usePrimeiroDiaDaSemana(): 0 | 1 { return useSyncExternalStore(assinar, instantaneo, instantaneo).semanaComecaSegunda ? 1 : 0; }
export function useFormatoData(): FormatoData { return useSyncExternalStore(assinar, instantaneo, instantaneo).formatoData; }

/** Formata uma data (sem hora) conforme o formato escolhido; `relativo` cai em data curta quando longe de hoje. */
export function formatarData(data: Date, formato: FormatoData = lerPreferenciasAplicativo().formatoData, agora = new Date()): string {
  const dd = String(data.getDate()).padStart(2, "0"), mm = String(data.getMonth() + 1).padStart(2, "0"), aaaa = data.getFullYear();
  switch (formato) {
    case "completa": return data.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
    case "curta": return data.toLocaleDateString("pt-BR", { day: "numeric", month: "short" }).replace(/\./g, "").replace(" de ", " ");
    case "mdy": return `${mm}/${dd}/${aaaa}`;
    case "dmy": return `${dd}/${mm}/${aaaa}`;
    case "ymd": return `${aaaa}/${mm}/${dd}`;
    case "relativo": {
      const dia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const diff = Math.round((dia(data) - dia(agora)) / 86400000);
      if (diff === 0) return "hoje";
      if (diff === 1) return "amanhã";
      if (diff === -1) return "ontem";
      return data.toLocaleDateString("pt-BR", { day: "numeric", month: "short", ...(data.getFullYear() === agora.getFullYear() ? {} : { year: "numeric" }) }).replace(/\./g, "").replace(/ de /g, " ");
    }
  }
}
