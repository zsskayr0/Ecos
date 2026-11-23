import { useSyncExternalStore } from "react";
import { lerPreferenciasAplicativo } from "@/lib/preferencias-aplicativo";

/**
 * Painel do sumário aberto ou fechado, compartilhado entre o botão e o editor.
 * Cada nota/tarefa aberta começa como pede a preferência (Configurações > Editor e escrita >
 * "Sumário aberto ao abrir", desligada por padrão); o botão alterna dali em diante.
 */
const ouvintes = new Set<() => void>();
const padrao = () => { try { return lerPreferenciasAplicativo().sumarioAbertoAoAbrir; } catch { return false; } };
let aberto = padrao();
const avisar = () => ouvintes.forEach((f) => f());

export function alternarSumarioLateral(valor = !aberto) {
  if (aberto === valor) return;
  aberto = valor;
  avisar();
}

/** Volta ao estado inicial da preferência (ao abrir outra nota ou tarefa). */
export function reiniciarSumarioLateral() { alternarSumarioLateral(padrao()); }

export function useSumarioLateralAberto(): boolean {
  return useSyncExternalStore((f) => { ouvintes.add(f); return () => ouvintes.delete(f); }, () => aberto, () => false);
}

/** Faixa à esquerda do texto reservada para o trilho de tracinhos (px); o Focus alarga a janela nessa medida. */
export const MARGEM_TRILHO = 32;
