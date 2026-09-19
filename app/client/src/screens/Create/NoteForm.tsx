import { useState } from "react";
import { Cloud } from "lucide-react";
import { CorpoEditor } from "@/components/editor/CorpoEditor";
import { AttachmentsField } from "@/components/editor/AttachmentsField";
import { NoteOrganizer } from "@/components/editor/NoteOrganizer";
import { TitleField } from "@/components/common/TitleField";
import { descriptionTags } from "@/lib/task-fields";
import type { CapturaDraft, SetDraft } from "./CreateFlow";

interface Props {
  draft: CapturaDraft;
  setDraft: SetDraft;
  onSalvar: () => void;
  salvando?: boolean;
}

/** Nova nota, no mesmo padrão da edição: título, pasta e tags à mão, anexos e o editor. */
export function NoteForm({ draft, setDraft, onSalvar, salvando }: Props) {
  const [enviandoAnexo, setEnviandoAnexo] = useState(false);
  return (
    <div className="flex min-w-0 flex-col gap-4 py-5 md:pt-4">
      <TitleField
        value={draft.texto}
        onChange={(texto) => setDraft((d) => ({ ...d, texto }))}
        placeholder="Título da nota"
        ariaLabel="Título da nota"
        className="ecos-input min-w-0 !rounded-lg border border-border !py-3 !text-xl text-text-primary focus-visible:!outline focus-visible:!outline-2 focus-visible:!outline-steel-400"
        autoFocus
      />

      <NoteOrganizer
        pasta={draft.pastaNota}
        onPasta={(pastaNota) => setDraft((d) => ({ ...d, pastaNota }))}
        tags={draft.tagsNota}
        tagsNoTexto={descriptionTags(draft.corpo)}
        onTags={(tagsNota) => setDraft((d) => ({ ...d, tagsNota }))}
        disabled={salvando}
      />

      <AttachmentsField tipo="nota" corpo={draft.corpo} onCorpoChange={(corpo) => setDraft((d) => ({ ...d, corpo }))} onBusyChange={setEnviandoAnexo} disabled={salvando} compact />

      <CorpoEditor
        corpo={draft.corpo}
        onCorpoChange={(corpo) => setDraft((d) => ({ ...d, corpo }))}
        tipo="nota"
        placeholder="Escreva sua nota… Use #tags e [[links]] para conectar ideias."
        rows={10}
        layout="document"
      />

      <p className="flex items-center gap-2 text-sm text-text-secondary"><Cloud size={16} className="text-steel-300" />{enviandoAnexo || salvando ? "Sincronizando…" : "Salva automaticamente enquanto você edita."}</p>
    </div>
  );
}
