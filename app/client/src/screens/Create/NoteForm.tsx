import type { CapturaDraft, SetDraft } from "./CreateFlow";
import { CorpoEditor } from "@/components/editor/CorpoEditor";
import { AttachmentsField } from "@/components/editor/AttachmentsField";
import { useState } from "react";

interface Props {
  draft: CapturaDraft;
  setDraft: SetDraft;
  onSalvar: () => void;
  salvando?: boolean;
}

/** Nota form: título, corpo e campo Anexos independente do primeiro save. */
export function NoteForm({ draft, setDraft, onSalvar, salvando }: Props) {
  const [enviandoAnexo, setEnviandoAnexo] = useState(false);
  return (
    <div className="flex min-w-0 flex-col gap-6 pt-6">
      <input
        value={draft.texto}
        onChange={(e) => setDraft((d) => ({ ...d, texto: e.target.value }))}
        placeholder="Título da nota"
        aria-label="Título da nota"
        className="w-full rounded-xl border border-border bg-surface-2 p-4 font-display text-2xl text-text-primary placeholder:text-text-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400"
        autoFocus
      />

      <CorpoEditor
        corpo={draft.corpo}
        onCorpoChange={(corpo) => setDraft((d) => ({ ...d, corpo }))}
        tipo="nota"
        placeholder={"Escreva aqui. Use [[Nota]] pra linkar, `código` inline, - [ ] pra checkbox..."}
        rows={7}
        layout="document"
      />

      <AttachmentsField tipo="nota" corpo={draft.corpo} onCorpoChange={(corpo) => setDraft((d) => ({ ...d, corpo }))} onBusyChange={setEnviandoAnexo} />
      <button
        onClick={onSalvar}
        disabled={!draft.texto.trim() || salvando || enviandoAnexo}
        className="mt-2 min-h-12 rounded-2xl border-8 border-base bg-steel-700 py-3.5 text-center font-body text-[15px] font-semibold text-white disabled:opacity-40"
      >
        {salvando ? "Salvando..." : "Salvar Nota"}
      </button>
    </div>
  );
}
