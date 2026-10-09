import { useEffect, type RefObject } from "react";

const FOCAVEIS = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Foco preso dentro do diálogo, Esc fecha, e ao sair o foco volta para quem abriu. */
export function useModalFoco(ref: RefObject<HTMLElement>, aoFechar: () => void) {
  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); aoFechar(); return; }
      if (e.key !== "Tab" || !ref.current) return;
      const itens = [...ref.current.querySelectorAll<HTMLElement>(FOCAVEIS)].filter((el) => el.offsetParent !== null);
      if (itens.length === 0) return;
      const primeiro = itens[0]!, ultimo = itens[itens.length - 1]!;
      if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
    };
    window.addEventListener("keydown", tecla);
    return () => { window.removeEventListener("keydown", tecla); anterior?.focus?.(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Falha sem resposta confiável (rede/5xx): a operação pode ter acontecido. */
export function resultadoIndeterminado(e: unknown): boolean {
  const status = (e as { status?: number } | null)?.status;
  return typeof status !== "number" || status === 0 || status >= 500;
}
