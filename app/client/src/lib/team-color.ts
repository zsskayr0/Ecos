/**
 * GAP-08: the real `equipe` schema (see ecos-arquitetura-tecnica.md,
 * section 1.3 "Equipe / Membro") only has `id` and `nome` — no identity
 * color. The front-end spec (section 3.2/3.7) asks for a "folder icon
 * colored by Team" and "Team avatar/color" as if that came from the
 * backend. Until the schema gets that field, the color is derived
 * deterministically from the Team's id (same id → always the same color,
 * nothing to persist) — never violet, reserved for the Vault everywhere
 * in the UI (rule 3).
 */
const PALETA = ["#5B8FC7", "#7DD3FC", "#22C55E", "#F59E0B", "#8FB4DC", "#3E6FA8"];

const CHAVE_COR = (equipeId: string) => `ecos:cor-equipe:${equipeId}`;

/** Cor escolhida pela pessoa para a equipe — preferência local (o schema ainda não tem o campo), como a cor do Pessoal. */
export function definirCorDaEquipe(equipeId: string, cor: string): void {
  try { localStorage.setItem(CHAVE_COR(equipeId), cor); } catch { /* preferência apenas desta sessão */ }
}

export function corDaEquipe(equipeId: string): string {
  try {
    const escolhida = localStorage.getItem(CHAVE_COR(equipeId));
    if (escolhida) return escolhida;
  } catch { /* usa a cor derivada */ }
  let hash = 0;
  for (let i = 0; i < equipeId.length; i++) {
    hash = (hash * 31 + equipeId.charCodeAt(i)) >>> 0;
  }
  return PALETA[hash % PALETA.length];
}
