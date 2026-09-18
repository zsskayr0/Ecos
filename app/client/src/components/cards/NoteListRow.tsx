import { useAbrirDocumento } from "@/lib/documento-popup";
import { FileText } from "lucide-react";
import type { Nota } from "@/lib/types";
import { TempoEdicao } from "@/components/common/TempoEdicao";

/** Compact single-line alternative to `NoteCard` — same data, denser scan (user feedback: "quero visualização de várias formas, cards, lista"). */
export function NoteListRow({ nota }: { nota: Nota }) {
  const abrirDocumento = useAbrirDocumento();
  return (
    <button onClick={(e) => abrirDocumento(`/notas/nota/${nota.id}`, e)} className="flex w-full items-center gap-3 rounded-2xl bg-surface-1 px-3.5 py-3 text-left">
      <FileText size={16} strokeWidth={1.75} className="shrink-0 text-steel-300" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium text-text-primary">{nota.titulo}</p>
        <p className="truncate text-xs text-text-muted">{nota.dono.nome}{nota.atualizadoEm && <> · <TempoEdicao iso={nota.atualizadoEm} /></>}</p>
      </div>
    </button>
  );
}
