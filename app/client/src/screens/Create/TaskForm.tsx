import { TaskComposer } from "@/components/editor/TaskComposer";
import { taskScheduledAt, type TaskFields } from "@/lib/task-fields";
import type { CapturaDraft, SetDraft } from "./CreateFlow";

function fieldsFromDraft(draft: CapturaDraft): TaskFields {
  return {
    titulo: draft.texto, prioridade: draft.prioridadeTarefa, data: draft.dataTarefa,
    horario: draft.scheduledAt ? new Date(draft.scheduledAt).toTimeString().slice(0, 5) : "",
    duracao: draft.duracaoMin, corpo: draft.corpo, tags: draft.tagsTarefa,
    pasta: draft.pastaTarefa, subtarefas: draft.subtarefasTarefa,
  };
}

export function TaskForm({ draft, setDraft, onSalvar, salvando }: {
  draft: CapturaDraft; setDraft: SetDraft; onSalvar: () => void; salvando?: boolean;
}) {
  return <div className="min-w-0 md:pt-4">
    <h1 className="mb-2 font-display text-2xl text-text-primary">Nova tarefa</h1>
    <p className="mb-6 hidden text-sm text-text-secondary md:block">Capture uma ideia. Desenvolva quando precisar.</p>
    <div className="pt-5 md:pt-0"><TaskComposer value={fieldsFromDraft(draft)} saving={salvando} onSave={onSalvar}
      onChange={(patch) => setDraft((previous) => {
        const value = { ...fieldsFromDraft(previous), ...patch };
        return {
          ...previous, texto: value.titulo, prioridadeTarefa: value.prioridade,
          dataTarefa: value.data, scheduledAt: taskScheduledAt(value.data, value.horario),
          duracaoMin: value.duracao, corpo: value.corpo, tagsTarefa: value.tags,
          pastaTarefa: value.pasta, subtarefasTarefa: value.subtarefas,
        };
      })} /></div>
  </div>;
}
