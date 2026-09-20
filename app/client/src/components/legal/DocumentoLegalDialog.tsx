import { useId, useLayoutEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import termos from "@/legal/termos.md?raw";
import privacidade from "@/legal/privacidade.md?raw";

export type DocumentoLegal = "termos" | "privacidade";

const DOCUMENTOS: Record<DocumentoLegal, { titulo: string; texto: string }> = {
  termos: { titulo: "Termos de uso", texto: termos },
  privacidade: { titulo: "Política de privacidade", texto: privacidade },
};

/** Texto dos Termos ou da Política num diálogo nativo (funciona antes do login, fora do roteador). */
export function DocumentoLegalDialog({ documento, onClose }: { documento: DocumentoLegal | null; onClose: () => void }) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (documento && !el.open) el.showModal();
    else if (!documento && el.open) el.close();
  }, [documento]);
  const doc = documento ? DOCUMENTOS[documento] : null;

  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-titulo`}
      onClose={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="m-auto max-h-[85dvh] w-[min(640px,calc(100%-32px))] rounded-2xl border border-border bg-surface-1 p-0 text-text-primary backdrop:bg-black/60"
    >
      {doc && (
        <div className="flex max-h-[85dvh] flex-col">
          <div className="overflow-y-auto p-6">
            <h2 id={`${id}-titulo`} className="sr-only">{doc.titulo}</h2>
            <div className="flex flex-col gap-3 text-sm leading-relaxed text-text-secondary">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: (p) => <h3 className="font-display text-xl text-text-primary">{p.children}</h3>,
                  h2: (p) => <h4 className="mt-2 font-semibold text-text-primary">{p.children}</h4>,
                  strong: (p) => <strong className="font-semibold text-text-primary">{p.children}</strong>,
                  blockquote: (p) => <blockquote className="rounded-lg border-l-2 border-steel-400 bg-surface-2 px-3 py-2 text-text-muted">{p.children}</blockquote>,
                }}
              >
                {doc.texto}
              </ReactMarkdown>
            </div>
          </div>
          <div className="border-t border-border p-4">
            <button type="button" autoFocus onClick={onClose} className="min-h-11 w-full rounded-xl bg-surface-2 px-4 text-sm font-medium text-text-primary hover:bg-surface-3">
              Fechar
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
