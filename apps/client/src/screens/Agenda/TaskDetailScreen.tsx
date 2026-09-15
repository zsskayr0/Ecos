import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, Trash2, CheckCircle2, Circle, AlertTriangle, ListX } from "lucide-react";
import { tarefas, ApiError, type TarefaResumo } from "@/lib/api";
import { Chip } from "@/components/common/Chip";
import { EmptyState } from "@/components/common/EmptyState";
import { formatDuracao } from "@/lib/format";
import { useRefreshBus } from "@/lib/refresh-bus";

const DURACOES = [15, 30, 45, 60, 120];

/**
 * GAP-11: não existe `GET /tarefas/:id` no backend real (só
 * `listar`/`atualizar`/`excluir`/`status`, ver `routes/mod.rs`) — a tela
 * busca na primeira página de `GET /tarefas` e procura pelo id. Funciona
 * bem na escala pessoal do Ecos (seção 0.2), mas é uma varredura, não uma
 * consulta direta; sinalizado em vez de fingir que o endpoint existe.
 */
export function TaskDetailScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { notificar } = useRefreshBus();
  const [tarefa, setTarefa] = useState<TarefaResumo | null>(null);
  const [naoEncontrada, setNaoEncontrada] = useState(false);
  const [duracao, setDuracao] = useState(30);
  const [horario, setHorario] = useState("");
  const [confirmandoDelete, setConfirmandoDelete] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    tarefas
      .listar({ limit: 200 })
      .then((pagina) => {
        const encontrada = pagina.items.find((t) => t.id === id);
        if (!encontrada) return setNaoEncontrada(true);
        setTarefa(encontrada);
        setDuracao(encontrada.duration_min ?? 30);
        setHorario(encontrada.scheduled_at ? new Date(encontrada.scheduled_at).toTimeString().slice(0, 5) : "");
      })
      .catch(() => setNaoEncontrada(true));
  }, [id]);

  async function salvar() {
    if (!id) return;
    setSalvando(true);
    setErro(null);
    try {
      const payload: { duration_min: number; scheduled_at?: string } = { duration_min: duracao };
      if (horario) {
        const data = new Date();
        const [h, m] = horario.split(":").map(Number);
        data.setHours(h, m, 0, 0);
        payload.scheduled_at = data.toISOString();
      }
      await tarefas.atualizar(id, payload);
      notificar();
      navigate(-1);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  async function alternarStatus() {
    if (!id || !tarefa) return;
    const novo = tarefa.status === "concluida" ? "pendente" : "concluida";
    try {
      await tarefas.atualizarStatus(id, novo);
      setTarefa({ ...tarefa, status: novo });
      notificar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível atualizar o status.");
    }
  }

  async function excluir() {
    if (!id) return;
    setSalvando(true);
    try {
      await tarefas.excluir(id);
      notificar();
      navigate(-1);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível apagar.");
      setSalvando(false);
    }
  }

  if (naoEncontrada) {
    return (
      <div className="px-4 pt-1">
        <button onClick={() => navigate(-1)} className="mb-4 text-text-muted">
          <ChevronLeft />
        </button>
        <EmptyState icon={ListX} title="Essa tarefa sumiu." subtitle="Pode ter sido movida ou apagada." />
      </div>
    );
  }

  if (!tarefa) {
    return (
      <div className="px-4 pt-1">
        <button onClick={() => navigate(-1)} className="mb-4 text-text-muted">
          <ChevronLeft />
        </button>
        <p className="py-10 text-center text-sm text-text-muted">Carregando...</p>
      </div>
    );
  }

  return (
    <div className="px-4 pt-1 pb-nav-safe">
      <div className="mb-4 flex items-center justify-between">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-text-muted">
          <ChevronLeft size={18} />
          Voltar
        </button>
        <button onClick={() => setConfirmandoDelete(true)} className="flex items-center gap-1.5 text-sm text-error">
          <Trash2 size={14} />
          Apagar
        </button>
      </div>

      {erro && (
        <div className="mb-4 flex items-start gap-2 rounded-2xl border border-error/40 bg-error/10 p-3 text-sm text-error">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" strokeWidth={1.75} />
          {erro}
        </div>
      )}

      {confirmandoDelete && (
        <div className="mb-4 rounded-2xl border border-error/40 bg-error/[0.06] p-4">
          <p className="mb-3 text-sm text-text-primary">Apagar essa tarefa? Ela some da Agenda pra sempre (ou até você criar de novo).</p>
          <div className="flex gap-2">
            <button onClick={() => setConfirmandoDelete(false)} className="flex-1 rounded-2xl bg-surface-2 py-2.5 text-sm font-medium text-text-primary">
              Cancelar
            </button>
            <button onClick={excluir} disabled={salvando} className="flex-1 rounded-2xl bg-error py-2.5 text-sm font-semibold text-white disabled:opacity-40">
              {salvando ? "Apagando..." : "Apagar"}
            </button>
          </div>
        </div>
      )}

      <button onClick={alternarStatus} className="mb-4 flex items-center gap-3">
        {tarefa.status === "concluida" ? (
          <CheckCircle2 size={26} strokeWidth={1.75} className="text-success" />
        ) : (
          <Circle size={26} strokeWidth={1.75} className="text-text-muted" />
        )}
        <h1 className={`font-display text-2xl ${tarefa.status === "concluida" ? "text-text-muted line-through" : "text-text-primary"}`}>{tarefa.titulo}</h1>
      </button>

      <div className="mb-5">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Duração</p>
        <div className="flex flex-wrap gap-2">
          {DURACOES.map((min) => (
            <Chip key={min} selected={duracao === min} onClick={() => setDuracao(min)}>
              {min < 60 ? `${min}min` : min === 60 ? "1h" : "2h+"}
            </Chip>
          ))}
        </div>
      </div>

      <div className="mb-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Horário</p>
        <input type="time" value={horario} onChange={(e) => setHorario(e.target.value)} className="ecos-input font-mono-value" />
        <p className="mt-1.5 text-xs text-text-muted">
          {tarefa.duration_min ? `Hoje: ${formatDuracao(tarefa.duration_min)} reservados.` : "Sem duração definida ainda."}
        </p>
      </div>

      <button onClick={salvar} disabled={salvando} className="w-full rounded-2xl bg-steel-700 py-3.5 text-center font-body text-[15px] font-semibold text-white disabled:opacity-40">
        {salvando ? "Salvando..." : "Salvar alterações"}
      </button>
    </div>
  );
}
