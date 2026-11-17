import { useEffect } from "react";

/** Controles que não abrem nada (ações, campos, alternadores): o clique do meio passa por eles sem fazer nada. */
const SEM_ABRIR = 'input,textarea,select,label,[contenteditable="true"],[data-ecos-selection-control],[role="checkbox"],[role="switch"],[role="menuitem"],[role="tab"],[role="slider"],[aria-pressed],[aria-checked],[aria-haspopup],[aria-expanded],[data-pane-tabbar],[role="dialog"] [data-sem-clique-do-meio]';

/**
 * Alvo que um clique do meio deve abrir: item clicável (cartão, linha, título, miniatura) com texto ou imagem.
 * Botões só de ícone (concluir, menus, ações) ficam de fora para o clique do meio nunca disparar uma ação por engano.
 */
export function alvoDoCliqueDoMeio(alvo: EventTarget | null): HTMLElement | null {
  if (!(alvo instanceof Element) || alvo.closest(SEM_ABRIR)) return null;
  const clicavel = alvo.closest<HTMLElement>("button,a,[role='button'],[role='row'],[role='link'],tr,li,article");
  if (!clicavel) return null;
  if (clicavel.closest(SEM_ABRIR)) return null;
  if (!clicavel.textContent?.trim() && !clicavel.querySelector("img,canvas")) return null;
  return clicavel;
}

/**
 * Clique do meio em tarefa, nota ou mídia abre uma guia (modo fixo), como o Ctrl+clique.
 * Quem já tratava o clique do meio (menu lateral, guias) marca o evento como tratado e fica de fora.
 */
export function useCliqueDoMeio() {
  useEffect(() => {
    // Sem isso o Windows liga a rolagem automática no clique do meio.
    const aoPressionar = (e: MouseEvent) => { if (e.button === 1 && !e.defaultPrevented && alvoDoCliqueDoMeio(e.target)) e.preventDefault(); };
    const aoSoltar = (e: MouseEvent) => {
      if (e.button !== 1 || e.defaultPrevented) return;
      const alvo = alvoDoCliqueDoMeio(e.target);
      if (!alvo) return;
      e.preventDefault();
      // Reentra como clique de botão 1: `useAbrirDocumento` abre em guia e as listas não tratam como seleção.
      alvo.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true, button: 1, buttons: 0, clientX: e.clientX, clientY: e.clientY }));
    };
    document.addEventListener("mousedown", aoPressionar);
    document.addEventListener("auxclick", aoSoltar);
    return () => { document.removeEventListener("mousedown", aoPressionar); document.removeEventListener("auxclick", aoSoltar); };
  }, []);
}
