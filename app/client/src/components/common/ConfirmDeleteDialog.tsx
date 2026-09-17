import { useId, useLayoutEffect, useRef } from "react";
import { Trash2 } from "lucide-react";

/** The native dialog manages focus, keyboard navigation and background inertness. */
export function ConfirmDeleteDialog({ open, title, busy, onCancel, onConfirm }: {
  open: boolean; title: string; busy: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
  }, [open]);

  return <dialog ref={dialog} role="alertdialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
    className="ecos-confirm-dialog border border-border bg-surface-1 text-text-primary backdrop:bg-black/60"
    onCancel={(e) => { e.preventDefault(); if (!busy) onCancel(); }}
    onClick={(e) => {
      if (e.target !== e.currentTarget || busy) return;
      const rect = e.currentTarget.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) onCancel();
    }}>
    <h2 id={`${id}-title`} className="mb-3 flex items-center gap-3 text-lg font-semibold"><Trash2 size={20} className="shrink-0 text-error" />{title}</h2>
    <p id={`${id}-description`} className="mb-6 text-sm text-text-secondary">Confirme a exclusão antes de continuar.</p>
    <div className="flex gap-3">
      <button type="button" autoFocus disabled={busy} onClick={onCancel} className="min-h-12 flex-1 rounded-xl bg-surface-2 px-4 text-sm font-medium disabled:opacity-40">Cancelar</button>
      <button type="button" disabled={busy} onClick={onConfirm} className="min-h-12 flex-1 rounded-xl bg-error px-4 text-sm font-semibold text-white disabled:opacity-40">{busy ? "Apagando..." : "Apagar"}</button>
    </div>
  </dialog>;
}
