import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Trash2, CheckCircle2, Circle, AlertTriangle, ListX, Check, Loader2 } from "lucide-react";
import { DetailHeader, DETAIL_ACTION } from "@/components/layout/DetailHeader";
import { tarefas, ApiError, type TarefaDetalhe } from "@/lib/api";
import { TaskComposer } from "@/components/editor/TaskComposer";
import { TaskPriority } from "@/components/common/TaskPriority";
import { EmptyState } from "@/components/common/EmptyState";
import { ConfirmDeleteDialog } from "@/components/common/ConfirmDeleteDialog";
import { EMPTY_TASK, taskFromDetail, taskScheduledAt, taskTags, type TaskFields } from "@/lib/task-fields";
import { useRefreshBus } from "@/lib/refresh-bus";
import { useIsDesktop } from "@/lib/use-viewport";
import { FecharDocumentoContext, TituloJanelaContext } from "@/lib/documento-popup";

const chaveRascunho = (id: string) => `ecos.task-draft.v1:${id}`;
function lerRascunho(id: string): TaskFields | null { try { const draft = JSON.parse(localStorage.getItem(chaveRascunho(id)) ?? "null"); return draft && typeof draft.titulo === "string" ? draft as TaskFields : null; } catch { return null; } }
function guardarRascunho(id: string, value: TaskFields) { try { localStorage.setItem(chaveRascunho(id), JSON.stringify(value)); } catch { /* cache indisponível */ } }
function removerRascunho(id: string) { try { localStorage.removeItem(chaveRascunho(id)); } catch { /* cache indisponível */ } }
function iguais(a: TaskFields, b: TaskFields) { return JSON.stringify(a) === JSON.stringify(b); }
function payload(value: TaskFields) { return { titulo: value.titulo.trim(), prioridade: value.prioridade, scheduled_at: taskScheduledAt(value.data, value.horario), due_date: value.data || null, duration_min: value.duracao, corpo: value.corpo, tags: taskTags(value.tags, value.corpo), pasta: value.pasta ?? "", espaco: value.espaco, subtarefas: value.subtarefas }; }

export function TaskDetailScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { notificar } = useRefreshBus();
  const [tarefa, setTarefa] = useState<TarefaDetalhe | null>(null);
  const [value, setValue] = useState<TaskFields>(EMPTY_TASK);
  const [salvo, setSalvo] = useState<TaskFields>(EMPTY_TASK);
  const [naoEncontrada, setNaoEncontrada] = useState(false);
  const [confirmandoDelete, setConfirmandoDelete] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [atualizandoStatus, setAtualizandoStatus] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviandoArquivo, setEnviandoArquivo] = useState(false);
  const [timeEntries, setTimeEntries] = useState<{ id: string; tipo: "planejado" | "real"; inicio_em: string; duracao_min: number }[]>([]);
  const [registrandoTempo, setRegistrandoTempo] = useState(false);
  const desktop = useIsDesktop();
  const definirTituloJanela = useContext(TituloJanelaContext);
  const fecharDocumento = useContext(FecharDocumentoContext);
  const valueRef = useRef(value);
  const salvoRef = useRef(salvo);
  const salvamentoEmCurso = useRef<Promise<void> | null>(null);
  useEffect(() => { valueRef.current = value; }, [value]);
  useEffect(() => { salvoRef.current = salvo; }, [salvo]);
  const carregarTempo = useCallback(() => { if (id) tarefas.timeEntries.listar(id).then(setTimeEntries).catch(() => {}); }, [id]);
  useEffect(() => { carregarTempo(); }, [carregarTempo]);

  async function adicionarTempo(tipo: "planejado" | "real") {
    if (!id || registrandoTempo) return;
    setRegistrandoTempo(true);
    try { await tarefas.timeEntries.criar(id, { tipo, inicio_em: new Date().toISOString(), duracao_min: value.duracao }); await carregarTempo(); notificar(); }
    catch (e) { setErro(e instanceof ApiError ? e.message : "Não foi possível registrar o tempo."); }
    finally { setRegistrandoTempo(false); }
  }
  useEffect(() => { definirTituloJanela?.(value.titulo.trim()); }, [definirTituloJanela, value.titulo]);

  useEffect(() => {
    let active = true;
    setTarefa(null); setNaoEncontrada(false); setErro(null); setConfirmandoDelete(false);
    if (!id) return;
    tarefas.obter(id).then((t) => {
      if (!active) return;
      const original = taskFromDetail(t);
      const rascunho = lerRascunho(id);
      setTarefa(t); setSalvo(original); setValue(rascunho ?? original);
    }).catch((e) => {
      if (!active) return;
      if (e instanceof ApiError && e.status === 404) setNaoEncontrada(true);
      else setErro(e instanceof ApiError ? e.message : "Não foi possível carregar a tarefa.");
    });
    return () => { active = false; };
  }, [id, desktop]);

  // Cada edição vai para o cache local antes da próxima sincronização remota.
  useEffect(() => {
    if (!id || !tarefa) return;
    if (iguais(value, salvo)) removerRascunho(id);
    else guardarRascunho(id, value);
  }, [desktop, id, tarefa, value, salvo]);

  const sincronizar = useCallback(async () => {
    if (!id) return;
    if (salvamentoEmCurso.current) { await salvamentoEmCurso.current; return sincronizar(); }
    const snapshot = valueRef.current;
    if (!snapshot.titulo.trim() || iguais(snapshot, salvoRef.current)) return;
    const pedido = (async () => {
      setSalvando(true); setErro(null);
      try {
        await tarefas.atualizar(id, payload(snapshot));
        setSalvo(snapshot); notificar();
        setTarefa((t) => t ? { ...t, atualizado_em: new Date().toISOString() } : t);
        if (iguais(valueRef.current, snapshot)) removerRascunho(id);
      } catch (e) { setErro(e instanceof ApiError ? e.message : "Não foi possível sincronizar as alterações."); }
      finally { setSalvando(false); }
    })();
    salvamentoEmCurso.current = pedido;
    try { await pedido; } finally { salvamentoEmCurso.current = null; }
  }, [id, notificar]);

  const sujo = tarefa ? !iguais(value, salvo) : false;

  // Sincroniza logo após uma pausa curta de edição, além da tentativa ao fechar.
  useEffect(() => {
    if (!id || !tarefa || !sujo) return;
    const timer = window.setTimeout(() => { void sincronizar(); }, 600);
    const aoSair = () => { void sincronizar(); };
    window.addEventListener("pagehide", aoSair);
    return () => { window.clearTimeout(timer); window.removeEventListener("pagehide", aoSair); };
  }, [id, tarefa, sujo, value, sincronizar]);

  async function alternarStatus() {
    if (!id || !tarefa || atualizandoStatus) return;
    await sincronizar();
    const status = tarefa.status === "concluida" ? "pendente" : "concluida";
    setAtualizandoStatus(true); setErro(null);
    try { await tarefas.atualizarStatus(id, status); setTarefa((t) => t ? { ...t, status } : t); notificar(); if (status === "concluida") fecharDocumento?.(); }
    catch (e) { setErro(e instanceof ApiError ? e.message : "Não foi possível atualizar o status."); }
    finally { setAtualizandoStatus(false); }
  }
  async function excluir() {
    if (!id || salvando) return;
    setSalvando(true); setErro(null);
    try { await tarefas.excluir(id); removerRascunho(id); notificar(); navigate(-1); }
    catch (e) { setErro(e instanceof ApiError ? e.message : "Não foi possível apagar."); setSalvando(false); }
  }

  const conteudo = <div className="ecos-detail-content">
    {erro && <div role="alert" className="mb-5 flex items-start gap-2 rounded-xl border border-error/40 bg-error/10 p-3 text-sm text-error"><AlertTriangle size={17} className="mt-0.5 shrink-0" />{erro}</div>}
    {naoEncontrada ? <EmptyState icon={ListX} title="Essa tarefa sumiu." subtitle="Pode ter sido movida ou apagada." /> : !tarefa ? <p className="py-10 text-sm text-text-secondary">{erro ? "Volte e tente abrir a tarefa novamente." : "Carregando..."}</p> : <>
      <ConfirmDeleteDialog open={confirmandoDelete} title="Apagar esta tarefa?" busy={salvando} onCancel={() => setConfirmandoDelete(false)} onConfirm={excluir} />
      {!desktop && <div className="mb-6 flex items-center gap-3"><button type="button" onClick={alternarStatus} disabled={atualizandoStatus} aria-label={tarefa.status === "concluida" ? "Reabrir tarefa" : "Concluir tarefa"} aria-pressed={tarefa.status === "concluida"} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-text-secondary disabled:opacity-40">{tarefa.status === "concluida" ? <CheckCircle2 size={25} className="text-success" /> : <Circle size={25} />}</button><h1 className="font-display text-2xl text-text-primary">{tarefa.status === "concluida" ? "Tarefa concluída" : "Editar tarefa"}</h1></div>}
      <TaskComposer key={id} itemId={id} editing editedAt={tarefa.atualizado_em ?? tarefa.criado_em} dirty={sujo} value={value} onChange={(patch) => setValue((previous) => ({ ...previous, ...patch }))} onSave={sincronizar} saving={salvando && !confirmandoDelete} floatingSave={false} showPriority={!desktop} onUploadingChange={setEnviandoArquivo} timePanel={<><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-text-primary">Tempo</h2><p className="text-sm text-text-secondary">Planejado {timeEntries.filter((e) => e.tipo === "planejado").reduce((n, e) => n + e.duracao_min, 0)} min · Realizado {timeEntries.filter((e) => e.tipo === "real").reduce((n, e) => n + e.duracao_min, 0)} min</p></div><div className="flex gap-2"><button type="button" onClick={() => adicionarTempo("planejado")} disabled={registrandoTempo} className="min-h-10 rounded-lg border border-steel-400 px-3 text-sm text-steel-300 disabled:opacity-40">Planejar {value.duracao} min</button><button type="button" onClick={() => adicionarTempo("real")} disabled={registrandoTempo} className="min-h-10 rounded-lg border border-success px-3 text-sm text-success disabled:opacity-40">Registrar tempo</button></div></div>{timeEntries.length > 0 && <div className="overflow-hidden rounded-lg border border-border">{timeEntries.map((entry) => <div key={entry.id} className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 text-sm last:border-0"><span className="text-text-secondary">{new Date(entry.inicio_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span><span className={entry.tipo === "planejado" ? "text-steel-300" : "text-success"}>{entry.tipo === "planejado" ? "Planejado" : "Real"} · {entry.duracao_min} min</span></div>)}</div>}</>} titleActions={desktop && <div className="flex shrink-0 items-center gap-2">
        <TaskPriority compact value={value.prioridade} onChange={(prioridade) => setValue((anterior) => ({ ...anterior, prioridade }))} disabled={salvando} />
        <button type="button" onClick={alternarStatus} disabled={atualizandoStatus || enviandoArquivo || salvando} aria-pressed={tarefa.status === "concluida"} className="flex min-h-[52px] items-center justify-center gap-2 rounded-xl border border-success px-4 text-sm font-semibold text-success transition-colors hover:bg-success hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-success disabled:opacity-40">{atualizandoStatus ? <Loader2 size={16} className="animate-spin motion-reduce:animate-none" /> : <Check size={16} />}{tarefa.status === "concluida" ? "Reabrir tarefa" : "Concluir tarefa"}</button>
        <button type="button" disabled={salvando} onClick={() => setConfirmandoDelete(true)} aria-label="Apagar tarefa" title="Apagar tarefa" className="flex min-h-[52px] min-w-[52px] items-center justify-center rounded-xl border border-error text-error transition-colors hover:bg-error hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-error disabled:opacity-40"><Trash2 size={18} /></button>
      </div>} />
    </>}
  </div>;

  // Sem cabeçalho no desktop: a barra do editor gruda rente ao topo, sem fresta por onde o texto rolando aparece.
  if (desktop) return <div className="ecos-detail-page min-w-0" style={{ "--ecos-editor-sticky-top": "0px" } as React.CSSProperties}>{conteudo}</div>;

  return <div className="ecos-detail-page min-w-0"><DetailHeader onBack={() => navigate(-1)} actions={tarefa && <button type="button" disabled={salvando} onClick={() => setConfirmandoDelete(true)} className={`${DETAIL_ACTION} text-error`}><Trash2 size={18} />Apagar</button>} />{conteudo}</div>;
}
