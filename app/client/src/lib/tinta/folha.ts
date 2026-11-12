/**
 * Estilo da folha do Modo de escrita (liso, pautado, quadriculado, pontilhado) e cor de fundo.
 * Fica por Nota, só neste aparelho (localStorage): não muda o `tinta.svg` nem as coordenadas dos traços.
 */
import { useCallback, useState } from "react";

export type EstiloFolha = "lisa" | "pautada" | "quadriculada" | "pontilhada";

export const ESTILOS_FOLHA: readonly { id: EstiloFolha; rotulo: string }[] = [
  { id: "lisa", rotulo: "Lisa" },
  { id: "pautada", rotulo: "Pautada" },
  { id: "quadriculada", rotulo: "Quadriculada" },
  { id: "pontilhada", rotulo: "Pontilhada" },
];

/** Fundos escuros: a tinta "cor do texto" continua legível em todos. `cor: null` = o cinza padrão do tema. */
export const FUNDOS_FOLHA: readonly { id: string; rotulo: string; cor: string | null }[] = [
  { id: "padrao", rotulo: "Padrão", cor: null },
  { id: "grafite", rotulo: "Grafite", cor: "#1f2024" },
  { id: "preto", rotulo: "Preto", cor: "#050505" },
  { id: "azul", rotulo: "Azul-noite", cor: "#101a2c" },
  { id: "verde", rotulo: "Verde-musgo", cor: "#10211b" },
  { id: "vinho", rotulo: "Vinho", cor: "#261519" },
];

export interface Folha { estilo: EstiloFolha; fundo: string }
const PADRAO: Folha = { estilo: "lisa", fundo: "padrao" };
const chave = (notaId: string) => `ecos.folha.v1:${notaId}`;

function ler(notaId?: string): Folha {
  if (!notaId) return PADRAO;
  try {
    const b = JSON.parse(localStorage.getItem(chave(notaId)) ?? "null") as Partial<Folha> | null;
    return {
      estilo: ESTILOS_FOLHA.some((e) => e.id === b?.estilo) ? (b!.estilo as EstiloFolha) : PADRAO.estilo,
      fundo: FUNDOS_FOLHA.some((f) => f.id === b?.fundo) ? (b!.fundo as string) : PADRAO.fundo,
    };
  } catch { return PADRAO; }
}

export const corDoFundo = (fundo: string) => FUNDOS_FOLHA.find((f) => f.id === fundo)?.cor ?? null;

export function useFolha(notaId?: string): [Folha, (parcial: Partial<Folha>) => void] {
  const [folha, setFolha] = useState(() => ler(notaId));
  const alterar = useCallback((parcial: Partial<Folha>) => {
    setFolha((atual) => {
      const nova = { ...atual, ...parcial };
      if (notaId) { try { localStorage.setItem(chave(notaId), JSON.stringify(nova)); } catch { /* sem armazenamento: vale só nesta abertura */ } }
      return nova;
    });
  }, [notaId]);
  return [folha, alterar];
}

/** Desenho da folha (linhas, quadrados ou pontos) como `background`, em px da coluna multiplicados por `escala`. */
export function desenhoFolha(estilo: EstiloFolha, escala: number): { backgroundImage?: string; backgroundSize?: string } {
  const cor = "rgb(var(--ecos-text-primary-rgb) / 0.09)";
  const passo = (n: number) => `${n * escala}px`;
  if (estilo === "pautada") return { backgroundImage: `linear-gradient(${cor} 1px, transparent 1px)`, backgroundSize: `100% ${passo(32)}` };
  if (estilo === "quadriculada") return { backgroundImage: `linear-gradient(${cor} 1px, transparent 1px), linear-gradient(90deg, ${cor} 1px, transparent 1px)`, backgroundSize: `${passo(28)} ${passo(28)}` };
  if (estilo === "pontilhada") return { backgroundImage: `radial-gradient(circle, rgb(var(--ecos-text-primary-rgb) / 0.22) 1.2px, transparent 1.6px)`, backgroundSize: `${passo(28)} ${passo(28)}` };
  return {};
}
