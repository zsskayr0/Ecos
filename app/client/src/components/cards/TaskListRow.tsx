import { useAbrirDocumento } from "@/lib/documento-popup";
import { CheckCircle2, Circle } from "lucide-react";
import type { Tarefa } from "@/lib/types";
import { formatDuracao } from "@/lib/format";
import { TempoEdicao } from "@/components/common/TempoEdicao";

const PONTO_POR_PRIORIDADE = { baixa: "bg-cyan", media: "bg-warning", alta: "bg-error" } as const;

/** Compact single-line alternative to `TaskCard` (user feedback: "quero visualização de várias formas, cards, lista, etc etc. para tarefas também"). */
export function TaskListRow({ tarefa }: { tarefa: Tarefa }) {
  const abrirDocumento = useAbrirDocumento();
  const concluida = tarefa.status === "concluida";
  const hora = tarefa.scheduledAt ? new Date(tarefa.scheduledAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : null;

  return (
    <button draggable onDragStart={(e) => { e.dataTransfer.effectAllowed = "copy"; e.dataTransfer.setData("application/x-ecos-task", JSON.stringify({ id: tarefa.id, duracao: tarefa.durationMin || 30 })); e.dataTransfer.setData("text/plain", tarefa.titulo); }} onClick={(e) => abrirDocumento(`/tarefa/${tarefa.id}`, e)} className="flex w-full cursor-grab items-center gap-3 rounded-2xl bg-surface-1 px-3.5 py-3 text-left active:cursor-grabbing">
      {concluida ? (
        <CheckCircle2 size={16} strokeWidth={1.75} className="shrink-0 text-success" />
      ) : (
        <Circle size={16} strokeWidth={1.75} className="shrink-0 text-text-muted" />
      )}
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${PONTO_POR_PRIORIDADE[tarefa.prioridade]}`} />
      <div className="min-w-0 flex-1">
        <p className={`truncate text-[15px] font-medium ${concluida ? "text-text-muted line-through" : "text-text-primary"}`}>{tarefa.titulo}</p>
        <p className="truncate text-xs text-text-muted">{tarefa.dono.nome}{tarefa.atualizadoEm && <> · <TempoEdicao iso={tarefa.atualizadoEm} /></>}</p>
      </div>
      <span className="shrink-0 font-mono-value text-xs text-text-muted">{hora ?? (tarefa.durationMin ? formatDuracao(tarefa.durationMin) : "")}</span>
    </button>
  );
}
