import { useEffect } from "react";

const FOCAVEIS = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

const visivel = (el: HTMLElement) => el.getClientRects().length > 0;
const focaveisEm = (raiz: HTMLElement) => [...raiz.querySelectorAll<HTMLElement>(FOCAVEIS)].filter(visivel);
const modalAtivo = () => {
  const todos = document.querySelectorAll<HTMLElement>('[aria-modal="true"]');
  return todos.length ? todos[todos.length - 1] : null;
};

/**
 * Armadilha de foco para todo diálogo `aria-modal="true"`: ao abrir, o foco entra no diálogo;
 * Tab/Shift+Tab circulam dentro dele; ao fechar, o foco volta ao elemento que o abriu.
 * Montada uma vez na raiz — vale para qualquer diálogo, sem cada tela repetir a lógica.
 */
export function ArmadilhaFoco() {
  useEffect(() => {
    const abertura = new Map<HTMLElement, HTMLElement | null>();
    let ultimoFocoFora: HTMLElement | null = null;

    const aoFocar = (e: FocusEvent) => {
      const alvo = e.target as HTMLElement;
      if (!alvo.closest?.('[aria-modal="true"]')) ultimoFocoFora = alvo;
    };

    const varrer = () => {
      const atuais = new Set(document.querySelectorAll<HTMLElement>('[aria-modal="true"]'));
      for (const m of atuais) {
        if (abertura.has(m)) continue;
        abertura.set(m, ultimoFocoFora ?? (document.activeElement as HTMLElement | null));
        if (!m.contains(document.activeElement)) {
          // Espera o diálogo terminar de montar (alguns focam um campo por conta própria).
          requestAnimationFrame(() => {
            if (m.contains(document.activeElement)) return;
            (focaveisEm(m)[0] ?? m).focus({ preventScroll: true });
          });
        }
      }
      for (const [m, origem] of [...abertura]) {
        if (atuais.has(m)) continue;
        abertura.delete(m);
        const ativo = document.activeElement;
        if (origem?.isConnected && (!ativo || ativo === document.body || !document.contains(ativo))) origem.focus({ preventScroll: true });
      }
    };

    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const m = modalAtivo();
      if (!m) return;
      const itens = focaveisEm(m);
      if (!itens.length) { e.preventDefault(); m.focus(); return; }
      const primeiro = itens[0];
      const ultimo = itens[itens.length - 1];
      const ativo = document.activeElement as HTMLElement | null;
      if (!ativo || !m.contains(ativo)) { e.preventDefault(); (e.shiftKey ? ultimo : primeiro).focus(); }
      else if (e.shiftKey && ativo === primeiro) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && ativo === ultimo) { e.preventDefault(); primeiro.focus(); }
    };

    const obs = new MutationObserver(varrer);
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-modal"] });
    document.addEventListener("focusin", aoFocar);
    document.addEventListener("keydown", aoTeclar, true);
    varrer();
    return () => { obs.disconnect(); document.removeEventListener("focusin", aoFocar); document.removeEventListener("keydown", aoTeclar, true); };
  }, []);
  return null;
}
