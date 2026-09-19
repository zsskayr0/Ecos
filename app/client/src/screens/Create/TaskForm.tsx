import { TaskComposer } from "@/components/editor/TaskComposer";
import { TaskPriority } from "@/components/common/TaskPriority";
import { Cloud } from "lucide-react";
import { taskScheduledAt, type TaskFields } from "@/lib/task-fields";
import type { CapturaDraft, SetDraft } from "./CreateFlow";

function fieldsFromDraft(draft: CapturaDraft): TaskFields {
  return {
    titulo: draft.texto, prioridade: draft.prioridadeTarefa, data: draft.dataTarefa,
    horario: draft.scheduledAt ? new Date(draft.scheduledAt).toTimeString().slice(0, 5) : "",
    duracao: draft.duracaoMin, corpo: draft.corpo, tags: draft.tagsTarefa,
    pasta: draft.pastaTarefa, espaco: "pessoal", subtarefas: draft.subtarefasTarefa,
  };
}

export function TaskForm({ draft, setDraft, onSalvar, salvando }: {
  draft: CapturaDraft; setDraft: SetDraft; onSalvar: () => void; salvando?: boolean;
}) {
  return <div className="min-w-0 py-5 md:pt-4">
    <TaskComposer value={fieldsFromDraft(draft)} saving={salvando} onSave={onSalvar} showPriority={false}
      titleActions={<TaskPriority compact value={draft.prioridadeTarefa} onChange={(prioridade) => setDraft((previous) => ({ ...previous, prioridadeTarefa: prioridade }))} disabled={salvando} />}
      onChange={(patch) => setDraft((previous) => {
        const value = { ...fieldsFromDraft(previous), ...patch };
        return {
          ...previous, texto: value.titulo, prioridadeTarefa: value.prioridade,
          dataTarefa: value.data, scheduledAt: taskScheduledAt(value.data, value.horario),
          duracaoMin: value.duracao, corpo: value.corpo, tagsTarefa: value.tags,
          pastaTarefa: value.pasta, subtarefasTarefa: value.subtarefas,
        };
      })} />
    <p className="mt-3 flex items-center gap-2 text-sm text-text-secondary"><Cloud size={16} className="text-steel-300" />{salvando ? "Sincronizando…" : "Salva automaticamente enquanto você edita."}</p>
  </div>;
}
