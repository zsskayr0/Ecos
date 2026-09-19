import type { CSSProperties } from "react";
import { corDaEquipe } from "@/lib/team-color";

/** Mesma chave da tela de Equipes: a cor do espaço pessoal é escolhida lá. */
const CHAVE_COR_PESSOAL = "ecos:cor-equipe-pessoal";
const COR_PESSOAL_PADRAO = "#3E6FA8";

/** "#RRGGBB" -> "R G B" (formato das variáveis de cor do tema) e cor de texto legível sobre ela. */
export function paraTriplete(hex: string): { rgb: string; contraste: string } {
  const n = /^#([0-9a-f]{6})$/i.exec(hex)?.[1] ?? "0891B2";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
  const luminancia = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return { rgb: `${r} ${g} ${b}`, contraste: luminancia > 0.6 ? "#000" : "#fff" };
}

/** Sobrescreve o acento ciano do tema por uma cor: use junto da classe `ecos-acento-evento` (texto sobre o acento). */
export function estiloAcento(hex: string): CSSProperties {
  const { rgb, contraste } = paraTriplete(hex);
  return { ["--ecos-cyan-rgb" as string]: rgb, ["--ev-contraste" as string]: contraste };
}

/** Cor da equipe do espaço ativo (mesma chave de `ui-context`): a escolhida em Equipes (pessoal) ou a derivada do id (equipe). */
export function useCorDoEspaco(): string {
  try {
    const espaco = localStorage.getItem("ecos:espaco-ativo") ?? "pessoal";
    if (espaco.startsWith("equipe:")) return corDaEquipe(espaco.slice("equipe:".length));
    return localStorage.getItem(CHAVE_COR_PESSOAL) ?? COR_PESSOAL_PADRAO;
  } catch { return COR_PESSOAL_PADRAO; }
}
