import { useNavigate } from "react-router-dom";
import { FileText } from "lucide-react";
import type { Nota } from "@/lib/types";
import { formatTempoRelativo } from "@/lib/format";

/** Compact single-line alternative to `NoteCard` — same data, denser scan (user feedback: "quero visualização de várias formas, cards, lista"). */
export function NoteListRow({ nota }: { nota: Nota }) {
  const navigate = useNavigate();
  return (
    <button onClick={() => navigate(`/notas/nota/${nota.id}`)} className="flex w-full items-center gap-3 rounded-2xl bg-surface-1 px-3.5 py-3 text-left">
      <FileText size={16} strokeWidth={1.75} className="shrink-0 text-steel-300" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium text-text-primary">{nota.titulo}</p>
        <p className="truncate text-xs text-text-muted">{nota.dono.nome}</p>
      </div>
      <span className="shrink-0 text-xs text-text-muted">{formatTempoRelativo(nota.atualizadoEm)}</span>
    </button>
  );
}
