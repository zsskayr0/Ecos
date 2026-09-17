import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Trash2, CheckCircle2, Circle, AlertTriangle, ListX } from "lucide-react";
import { DetailHeader, DETAIL_ACTION } from "@/components/layout/DetailHeader";
import { tarefas, ApiError, type TarefaDetalhe } from "@/lib/api";
import { TaskComposer } from "@/components/editor/TaskComposer";
import { EmptyState } from "@/components/common/EmptyState";
import { ConfirmDeleteDialog } from "@/components/common/ConfirmDeleteDialog";
import { EMPTY_TASK, taskFromDetail, taskScheduledAt, taskTags, type TaskFields } from "@/lib/task-fields";
import { useRefreshBus } from "@/lib/refresh-bus";

export function TaskDetailScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { notificar } = useRefreshBus();
  const [tarefa, setTarefa] = useState<TarefaDetalhe | null>(null);
  const [value, setValue] = useState<TaskFields>(EMPTY_TASK);
  const [naoEncontrada, setNaoEncontrada] = useState(false);
  const [confirmandoDelete, setConfirmandoDelete] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [atualizandoStatus, setAtualizandoStatus] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setTarefa(null); setNaoEncontrada(false); setErro(null); setConfirmandoDelete(false);
    if (!id) return;
    tarefas.obter(id).then((t) => {
      if (active) { setTarefa(t); setValue(taskFromDetail(t)); }
    }).catch((e) => {
      if (!active) return;
      if (e instanceof ApiError && e.status === 404) setNaoEncontrada(true);
      else setErro(e instanceof ApiError ? e.message : "Não foi possível carregar a tarefa.");
    });
    return () => { active = false; };
  }, [id]);

  async function salvar() {
    if (!id || !value.titulo.trim() || salvando) return;
    setSalvando(true); setErro(null);
    try {
      await tarefas.atualizar(id, {
        titulo: value.titulo.trim(), prioridade: value.prioridade,
        scheduled_at: taskScheduledAt(value.data, value.horario), due_date: value.data || null,
        duration_min: value.duracao, corpo: value.corpo, tags: taskTags(value.tags, value.corpo),
        pasta: value.pasta ?? "", subtarefas: value.subtarefas,
      });
      notificar(); navigate(-1);
    } catch (e) { setErro(e instanceof ApiError ? e.message : "Não foi possível salvar."); }
    finally { setSalvando(false); }
  }

  async function alternarStatus() {
    if (!id || !tarefa || atualizandoStatus) return;
    const status = tarefa.status === "concluida" ? "pendente" : "concluida";
    setAtualizandoStatus(true); setErro(null);
    try { await tarefas.atualizarStatus(id, status); setTarefa((t) => t ? { ...t, status } : t); notificar(); }
    catch (e) { setErro(e instanceof ApiError ? e.message : "Não foi possível atualizar o status."); }
    finally { setAtualizandoStatus(false); }
  }

  async function excluir() {
    if (!id || salvando) return;
    setSalvando(true); setErro(null);
    try { await tarefas.excluir(id); notificar(); navigate(-1); }
    catch (e) { setErro(e instanceof ApiError ? e.message : "Não foi possível apagar."); setSalvando(false); }
  }

  return <div className="ecos-detail-page min-w-0">
    <DetailHeader onBack={() => navigate(-1)} actions={tarefa && <button type="button" disabled={salvando} onClick={() => setConfirmandoDelete(true)} className={`${DETAIL_ACTION} text-error`}><Trash2 size={18} />Apagar</button>} />
    <div className="ecos-detail-content">
    {erro && <div role="alert" className="mb-5 flex items-start gap-2 rounded-xl border border-error/40 bg-error/10 p-3 text-sm text-error"><AlertTriangle size={17} className="mt-0.5 shrink-0" />{erro}</div>}
    {naoEncontrada ? <EmptyState icon={ListX} title="Essa tarefa sumiu." subtitle="Pode ter sido movida ou apagada." /> : !tarefa ? <p className="py-10 text-sm text-text-secondary">{erro ? "Volte e tente abrir a tarefa novamente." : "Carregando..."}</p> : <>
      <ConfirmDeleteDialog open={confirmandoDelete} title="Apagar esta tarefa?" busy={salvando} onCancel={() => setConfirmandoDelete(false)} onConfirm={excluir} />
      <div className="mb-6 flex items-center gap-3">
        <button type="button" onClick={alternarStatus} disabled={atualizandoStatus} aria-label={tarefa.status === "concluida" ? "Reabrir tarefa" : "Concluir tarefa"} aria-pressed={tarefa.status === "concluida"} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-text-secondary disabled:opacity-40">{tarefa.status === "concluida" ? <CheckCircle2 size={25} className="text-success" /> : <Circle size={25} />}</button>
        <h1 className="font-display text-2xl text-text-primary">{tarefa.status === "concluida" ? "Tarefa concluída" : "Editar tarefa"}</h1>
      </div>
      <TaskComposer key={id} itemId={id} editing dirty={JSON.stringify(value) !== JSON.stringify(taskFromDetail(tarefa))} value={value} onChange={(patch) => setValue((previous) => ({ ...previous, ...patch }))} onSave={salvar} saving={salvando && !confirmandoDelete} />
    </>}
    </div>
  </div>;
}
