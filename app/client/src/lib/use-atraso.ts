import { useEffect, useState } from "react";

/** Atraso padrão antes de mostrar um skeleton: carregamentos mais rápidos que isso não devem piscar. */
export const ATRASO_SKELETON_MS = 150;

/**
 * Vira `true` só depois de `ms` com `ativo` ligado; volta a `false` assim que `ativo` desliga.
 * Com `ms <= 0` responde `ativo` na hora.
 */
export function useAtraso(ativo: boolean, ms: number = ATRASO_SKELETON_MS): boolean {
  const [passou, setPassou] = useState(false);
  useEffect(() => {
    if (!ativo || ms <= 0) {
      setPassou(false);
      return;
    }
    const id = window.setTimeout(() => setPassou(true), ms);
    return () => {
      window.clearTimeout(id);
      setPassou(false);
    };
  }, [ativo, ms]);
  return ativo && (ms <= 0 || passou);
}
