import { useContext } from "react";
import { ModoFocusDocumentoContext } from "@/lib/documento-popup";
import { TaskComposer } from "@/components/editor/TaskComposer";
import { TaskPriority } from "@/components/common/TaskPriority";
import { Cloud } from "lucide-react";
import { taskScheduledAt, type TaskFields } from "@/lib/task-fields";
import { useAppUI } from "@/lib/ui-context";
import type { CapturaDraft, SetDraft } from "./CreateFlow";

function fieldsFromDraft(draft: CapturaDraft, espacoAtivo: string): TaskFields {
  return {
    titulo: draft.texto, prioridade: draft.prioridadeTarefa, data: draft.dataTarefa,
    horario: draft.scheduledAt ? new Date(draft.scheduledAt).toTimeString().slice(0, 5) : "",
    duracao: draft.duracaoMin, corpo: draft.corpo, tags: draft.tagsTarefa,
    pasta: draft.pastaTarefa, espaco: draft.espacoTarefa ?? espacoAtivo, subtarefas: draft.subtarefasTarefa,
  };
}

export function TaskForm({ draft, setDraft, onSalvar, salvando, embedded = false }: {
  draft: CapturaDraft; setDraft: SetDraft; onSalvar: () => void; salvando?: boolean; embedded?: boolean;
}) {
  const { espacoAtivo } = useAppUI();
  // Criação maximizada (preferência "Nova tarefa"): as opções vão para o painel lateral do Focus.
  const focoDocumento = useContext(ModoFocusDocumentoContext);
  return <div className={`min-w-0 pb-5 ${embedded ? "pt-5 md:pt-4" : "pt-1"}`}>
    <TaskComposer value={fieldsFromDraft(draft, espacoAtivo)} saving={salvando} onSave={onSalvar} showPriority={!embedded} organizacaoCompacta={!embedded} focusMode={embedded && focoDocumento}
      titleActions={embedded && <TaskPriority compact value={draft.prioridadeTarefa} onChange={(prioridade) => setDraft((previous) => ({ ...previous, prioridadeTarefa: prioridade }))} disabled={salvando} />}
      onChange={(patch) => setDraft((previous) => {
        const value = { ...fieldsFromDraft(previous, espacoAtivo), ...patch };
        return {
          ...previous, texto: value.titulo, prioridadeTarefa: value.prioridade,
          dataTarefa: value.data, scheduledAt: taskScheduledAt(value.data, value.horario),
          duracaoMin: value.duracao, corpo: value.corpo, tagsTarefa: value.tags,
          pastaTarefa: value.pasta, espacoTarefa: value.espaco, subtarefasTarefa: value.subtarefas,
        };
      })} />
    <p className="mt-3 flex items-center gap-2 text-sm text-text-secondary"><Cloud size={16} className="text-steel-300" />{salvando ? "Sincronizando…" : "Salva automaticamente enquanto você edita."}</p>
  </div>;
}
