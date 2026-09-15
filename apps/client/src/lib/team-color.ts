/**
 * GAP-08: o schema real de `equipe` (ver ecos-arquitetura-tecnica.md, seção
 * 1.3 "Equipe / Membro") só tem `id` e `nome` — sem cor de identidade. A
 * especificação de front (seção 3.2/3.7) pede "ícone de pasta colorido por
 * Equipe" e "avatar/cor da Equipe" como se isso viesse do backend. Até o
 * schema ganhar esse campo, a cor é derivada deterministicamente do id da
 * Equipe (mesmo id → mesma cor sempre, sem precisar persistir nada) —
 * nunca usa violeta, reservado ao Cofre em qualquer lugar da UI (regra 3).
 */
const PALETA = ["#5B8FC7", "#7DD3FC", "#22C55E", "#F59E0B", "#8FB4DC", "#3E6FA8"];

export function corDaEquipe(equipeId: string): string {
  let hash = 0;
  for (let i = 0; i < equipeId.length; i++) {
    hash = (hash * 31 + equipeId.charCodeAt(i)) >>> 0;
  }
  return PALETA[hash % PALETA.length];
}
