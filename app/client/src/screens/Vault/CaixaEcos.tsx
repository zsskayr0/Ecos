import type { KeyboardEvent, MouseEvent } from "react";

/**
 * Caixa de seleção no desenho do Ecos (a nativa do navegador não combina com o resto). Botão com `role="checkbox"`:
 * Espaço alterna, e o clique entrega o evento para quem chamou saber se Shift/Ctrl estavam apertados (seleção em
 * faixa). Só aparece quando a linha pede (passar o mouse ou modo de seleção): a regra de visibilidade mora no CSS.
 */
export function CaixaEcos({ marcada, rotulo, aoAlternar }: {
  marcada: boolean;
  rotulo: string;
  aoAlternar: (e: MouseEvent | KeyboardEvent) => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={marcada}
      aria-label={rotulo}
      className="cofre-caixa"
      data-marcada={marcada || undefined}
      onClick={(e) => { e.stopPropagation(); aoAlternar(e); }}
      onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }}
    >
      <svg viewBox="0 0 16 16" aria-hidden focusable="false"><path d="M3.6 8.6l2.9 2.9 6-6.6" /></svg>
    </button>
  );
}
