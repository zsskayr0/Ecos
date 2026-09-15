import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, Trash2, AlertTriangle, Receipt } from "lucide-react";
import { vault, ApiError, type TransacaoApi } from "@/lib/api";
import { formatMoeda } from "@/lib/format";
import { EmptyState } from "@/components/common/EmptyState";
import { useRefreshBus } from "@/lib/refresh-bus";

/**
 * `GET`/`PATCH`/`DELETE /vault/transacoes/:id` de verdade. Delete de dado
 * financeiro é a única ação do app com copy literal já fechada pela
 * especificação (seção 1.4): zero humor, direto ao ponto.
 */
export function TransactionDetailScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { notificar } = useRefreshBus();
  const [tx, setTx] = useState<TransacaoApi | null>(null);
  const [naoEncontrada, setNaoEncontrada] = useState(false);
  const [status, setStatus] = useState<"efetivada" | "pendente">("efetivada");
  const [descricao, setDescricao] = useState("");
  const [confirmandoDelete, setConfirmandoDelete] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    vault.transacoes
      .obter(id)
      .then((t) => {
        setTx(t);
        setStatus(t.status);
        setDescricao(t.descricao);
      })
      .catch(() => setNaoEncontrada(true));
  }, [id]);

  async function salvar() {
    if (!id || !tx) return;
    setSalvando(true);
    setErro(null);
    try {
      const atualizada = await vault.transacoes.atualizar(id, {
        tipo: tx.tipo,
        valor_centavos: tx.valor_centavos,
        data: tx.data,
        descricao,
        categoria_id: tx.categoria_id ?? undefined,
        conta_id: tx.conta_id ?? undefined,
        status,
      });
      setTx(atualizada);
      notificar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  async function excluir() {
    if (!id) return;
    setSalvando(true);
    try {
      await vault.transacoes.excluir(id);
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
        <EmptyState icon={Receipt} title="Essa transação sumiu." subtitle="Pode ter sido apagada." />
      </div>
    );
  }

  if (!tx) {
    return (
      <div className="px-4 pt-1">
        <button onClick={() => navigate(-1)} className="mb-4 text-text-muted">
          <ChevronLeft />
        </button>
        <p className="py-10 text-center text-sm text-text-muted">Carregando...</p>
      </div>
    );
  }

  const positivo = tx.tipo === "entrada";

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
          {/* Copy literal da especificação (seção 1.4) — zero humor, dado financeiro. */}
          <p className="mb-3 text-sm font-medium text-text-primary">
            Apagar transação de {formatMoeda(tx.valor_centavos)}? Essa ação não pode ser desfeita.
          </p>
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

      <p className={`text-center font-mono-value text-4xl font-bold ${positivo ? "text-success" : "text-text-primary"}`}>
        {positivo ? "+" : "-"}
        {formatMoeda(tx.valor_centavos)}
      </p>
      <p className="mb-6 text-center text-xs text-text-muted">{tx.data}</p>

      <label className="mb-4 flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Descrição</span>
        <input value={descricao} onChange={(e) => setDescricao(e.target.value)} className="ecos-input" />
      </label>

      <div className="mb-6 flex rounded-pill bg-surface-2 p-1 self-start">
        <button
          onClick={() => setStatus("efetivada")}
          className={`rounded-pill px-4 py-1.5 text-sm font-medium ${status === "efetivada" ? "bg-success/20 text-success" : "text-text-muted"}`}
        >
          Efetivada
        </button>
        <button
          onClick={() => setStatus("pendente")}
          className={`rounded-pill px-4 py-1.5 text-sm font-medium ${status === "pendente" ? "bg-warning/20 text-warning" : "text-text-muted"}`}
        >
          Pendente
        </button>
      </div>

      <button onClick={salvar} disabled={salvando} className="w-full rounded-2xl bg-violet py-3.5 text-center font-body text-[15px] font-semibold text-black disabled:opacity-40">
        {salvando ? "Salvando..." : "Salvar alterações"}
      </button>
    </div>
  );
}
