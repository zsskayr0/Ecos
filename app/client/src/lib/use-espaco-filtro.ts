import { useAppUI } from "./ui-context";

/** Espaço (Pessoal/equipe) que as listagens devem filtrar; `undefined` = todos (modo intercalado sem equipe). */
export function useEspacoFiltro(): string | undefined {
  const { espacoAtivo, intercalarEquipes, filtroEquipeId } = useAppUI();
  return intercalarEquipes ? (filtroEquipeId ? `equipe:${filtroEquipeId}` : undefined) : espacoAtivo;
}
