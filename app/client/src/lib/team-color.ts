/**
 * Cor de identidade da equipe. A fonte da verdade é o servidor (`cor` em
 * `GET /equipes` e `GET /me`), então a cor é a mesma em todos os aparelhos e
 * para todos os membros. Este módulo guarda em memória o que o servidor
 * informou (`registrarCoresDasEquipes`) para que `corDaEquipe` continue
 * síncrono para os componentes.
 *
 * Fallbacks, nesta ordem: cor do servidor -> escolha antiga salva no
 * `localStorage` (`ecos:cor-equipe:<id>`, de antes de existir o campo) ->
 * cor derivada do id (mesma paleta e hash que o servidor usa). Nunca violeta,
 * reservado ao Cofre (regra 3).
 */
const PALETA = ["#5B8FC7", "#7DD3FC", "#22C55E", "#F59E0B", "#8FB4DC", "#3E6FA8"];
const EVENTO = "ecos:cores-equipes-atualizadas";

const CHAVE_COR = (equipeId: string) => `ecos:cor-equipe:${equipeId}`;
const doServidor = new Map<string, string>();

const lerLocal = (equipeId: string): string | null => {
  try { return localStorage.getItem(CHAVE_COR(equipeId)); } catch { return null; }
};

/** Guarda as cores que o servidor informou. Avisa os ouvintes só se algo mudou. */
export function registrarCoresDasEquipes(lista: { id: string; cor?: string | null }[]): void {
  let mudou = false;
  for (const { id, cor } of lista) {
    if (!cor || doServidor.get(id) === cor) continue;
    doServidor.set(id, cor);
    mudou = true;
  }
  if (mudou && typeof window !== "undefined") window.dispatchEvent(new Event(EVENTO));
}

/** Preferência antiga só deste aparelho que o servidor ainda não conhece (a cor do servidor é a derivada). */
export function corLocalPendente(equipeId: string, corServidor?: string | null): string | null {
  const local = lerLocal(equipeId);
  if (!local || (corServidor && local.toLowerCase() === corServidor.toLowerCase())) return null;
  return /^#[0-9a-fA-F]{6}$/.test(local) ? local : null;
}

export function limparCorLocal(equipeId: string): void {
  try { localStorage.removeItem(CHAVE_COR(equipeId)); } catch { /* armazenamento indisponível */ }
}

/** Ouve mudanças nas cores registradas (para componentes que precisam redesenhar). */
export function aoMudarCoresDasEquipes(callback: () => void): () => void {
  window.addEventListener(EVENTO, callback);
  return () => window.removeEventListener(EVENTO, callback);
}

export function corDaEquipe(equipeId: string): string {
  const servidor = doServidor.get(equipeId);
  if (servidor) return servidor;
  const escolhida = lerLocal(equipeId);
  if (escolhida) return escolhida;
  let hash = 0;
  for (let i = 0; i < equipeId.length; i++) {
    hash = (hash * 31 + equipeId.charCodeAt(i)) >>> 0;
  }
  return PALETA[hash % PALETA.length];
}
