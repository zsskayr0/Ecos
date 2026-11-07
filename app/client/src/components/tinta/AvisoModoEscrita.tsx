import { useId, useLayoutEffect, useRef } from "react";
import { PenLine } from "lucide-react";

/** 1ª ativação do Modo de escrita numa Nota: avisa que a largura passa a ser fixa. Recusar não muda nada. */
export function AvisoModoEscrita({ open, largura, onRecusar, onAceitar }: { open: boolean; largura: number; onRecusar: () => void; onAceitar: () => void }) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  return <dialog ref={dialog} role="alertdialog" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`}
    className="ecos-confirm-dialog border border-border bg-surface-1 text-text-primary backdrop:bg-black/60"
    onCancel={(e) => { e.preventDefault(); onRecusar(); }}
    onClick={(e) => {
      if (e.target !== e.currentTarget) return;
      const r = e.currentTarget.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onRecusar();
    }}>
    <h2 id={`${id}-t`} className="mb-3 flex items-center gap-3 text-lg font-semibold"><PenLine size={20} className="shrink-0 text-steel-300" />Ativar o Modo de escrita?</h2>
    <div id={`${id}-d`} className="mb-6 space-y-2 text-sm text-text-secondary">
      <p>A largura desta Nota passará a ser fixa (folha A4, {largura} px), também no modo texto, para a tinta ficar sempre no mesmo lugar sobre o texto.</p>
      <p>Editar o texto acima de uma anotação a desalinha. Apagando todas as anotações, a Nota volta à largura normal.</p>
    </div>
    <div className="flex gap-3">
      <button type="button" autoFocus onClick={onRecusar} className="min-h-12 flex-1 rounded-xl bg-surface-2 px-4 text-sm font-medium">Agora não</button>
      <button type="button" onClick={onAceitar} className="min-h-12 flex-1 rounded-xl bg-steel-500 px-4 text-sm font-semibold text-white">Ativar</button>
    </div>
  </dialog>;
}
