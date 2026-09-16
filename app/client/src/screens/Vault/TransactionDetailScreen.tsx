import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import * as Icons from "lucide-react";
import { ChevronLeft, Trash2, AlertTriangle, Receipt } from "lucide-react";
import {
  vault,
  ApiError,
  FORMAS_PAGAMENTO,
  type TransacaoApi,
  type CategoriaApi,
  type ContaApi,
  type BeneficiarioApi,
  type FormaPagamento,
} from "@/lib/api";
import { Chip } from "@/components/common/Chip";
import { DatePicker } from "@/components/common/DatePicker";
import { formatMoeda, hojeISO } from "@/lib/format";
import { EmptyState } from "@/components/common/EmptyState";
import { useRefreshBus } from "@/lib/refresh-bus";

const LABEL_FORMA_PAGAMENTO: Record<FormaPagamento, string> = {
  pix: "Pix",
  pix_automatico: "Pix Automático",
  ted: "TED",
  cartao: "Cartão",
  dinheiro: "Dinheiro",
  boleto: "Boleto",
  outro: "Outro",
};

/**
 * Real `GET`/`PATCH`/`DELETE /vault/transacoes/:id`, now editing every
 * field the backend actually stores (`TransacaoPayload`) — not just
 * descrição/status. Deleting financial data is the only action in the app
 * with literal copy already locked in by the spec (section 1.4): zero
 * humor, straight to the point.
 */
export function TransactionDetailScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { notificar } = useRefreshBus();
  const [tx, setTx] = useState<TransacaoApi | null>(null);
  const [naoEncontrada, setNaoEncontrada] = useState(false);
  const [categorias, setCategorias] = useState<CategoriaApi[]>([]);
  const [contas, setContas] = useState<ContaApi[]>([]);
  const [beneficiarios, setBeneficiarios] = useState<BeneficiarioApi[]>([]);

  const [tipo, setTipo] = useState<"entrada" | "saida">("saida");
  const [valorReais, setValorReais] = useState("0,00");
  const [descricao, setDescricao] = useState("");
  const [categoriaId, setCategoriaId] = useState<string | null>(null);
  const [contaId, setContaId] = useState<string | null>(null);
  const [beneficiarioNome, setBeneficiarioNome] = useState("");
  const [formaPagamento, setFormaPagamento] = useState<FormaPagamento | null>(null);
  const [status, setStatus] = useState<"efetivada" | "pendente">("efetivada");
  const [data, setData] = useState("");
  const [observacoes, setObservacoes] = useState("");

  const [confirmandoDelete, setConfirmandoDelete] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      vault.transacoes.obter(id),
      vault.categorias.listar().catch(() => []),
      vault.contas.listar().catch(() => []),
      vault.beneficiarios.listar().catch(() => []),
    ])
      .then(([t, cats, cts, bens]) => {
        setTx(t);
        setCategorias(cats);
        setContas(cts);
        setBeneficiarios(bens);
        setTipo(t.tipo);
        setValorReais((t.valor_centavos / 100).toFixed(2).replace(".", ","));
        setDescricao(t.descricao);
        setCategoriaId(t.categoria_id);
        setContaId(t.conta_id);
        setBeneficiarioNome(bens.find((b) => b.id === t.beneficiario_id)?.nome ?? "");
        setFormaPagamento((t.forma_pagamento as FormaPagamento | null) ?? null);
        setStatus(t.status);
        setData(t.data);
        setObservacoes(t.observacoes ?? "");
      })
      .catch(() => setNaoEncontrada(true));
  }, [id]);

  async function salvar() {
    if (!id || !tx) return;
    setSalvando(true);
    setErro(null);
    try {
      let beneficiarioId: string | undefined;
      if (beneficiarioNome.trim()) {
        const b = await vault.beneficiarios.criarOuEncontrar({ nome: beneficiarioNome.trim() });
        beneficiarioId = b.id;
      }
      const valorCentavos = Math.round(parseFloat(valorReais.replace(/\./g, "").replace(",", ".")) * 100);
      const atualizada = await vault.transacoes.atualizar(id, {
        tipo,
        valor_centavos: Number.isFinite(valorCentavos) ? valorCentavos : tx.valor_centavos,
        data,
        descricao,
        categoria_id: categoriaId ?? undefined,
        conta_id: contaId ?? undefined,
        beneficiario_id: beneficiarioId,
        forma_pagamento: formaPagamento ?? undefined,
        status,
        observacoes: observacoes.trim() || undefined,
      });
      setTx(atualizada);
      notificar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  /** Same rule as the create form (TransactionForm.tsx): a future date
   * defaults the status to "pendente" instead of leaving it to remember by
   * hand — still overridable via the Status toggle below. */
  function mudarData(novaData: string) {
    setData(novaData);
    setStatus(novaData > hojeISO() ? "pendente" : "efetivada");
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

  const categoriasVisiveis = categorias.filter((c) => c.tipo === "ambos" || c.tipo === tipo);

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
          {/* Literal copy from the spec (section 1.4) — zero humor, financial data. */}
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

      <div className="mb-6 flex rounded-pill bg-surface-2 p-1 self-center w-fit mx-auto">
        <button
          onClick={() => setTipo("saida")}
          className={`rounded-pill px-4 py-1.5 text-sm font-medium ${tipo === "saida" ? "bg-error/20 text-error" : "text-text-muted"}`}
        >
          Saída
        </button>
        <button
          onClick={() => setTipo("entrada")}
          className={`rounded-pill px-4 py-1.5 text-sm font-medium ${tipo === "entrada" ? "bg-success/20 text-success" : "text-text-muted"}`}
        >
          Entrada
        </button>
      </div>

      <div className="mb-6 flex flex-col items-center gap-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Data</span>
        <DatePicker value={data} onChange={mudarData} />
      </div>

      <label className="mb-6 flex flex-col items-center gap-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Valor</span>
        <div className="flex items-center gap-1">
          <span className={`font-mono-value text-3xl font-bold ${tipo === "entrada" ? "text-success" : "text-text-primary"}`}>R$</span>
          <input
            value={valorReais}
            onChange={(e) => setValorReais(e.target.value)}
            inputMode="decimal"
            className={`w-40 bg-transparent text-center font-mono-value text-3xl font-bold focus:outline-none ${
              tipo === "entrada" ? "text-success" : "text-text-primary"
            }`}
          />
        </div>
      </label>

      <label className="mb-4 flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Descrição</span>
        <input value={descricao} onChange={(e) => setDescricao(e.target.value)} className="ecos-input" />
      </label>

      <label className="mb-4 flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Beneficiário</span>
        <input
          value={beneficiarioNome}
          onChange={(e) => setBeneficiarioNome(e.target.value)}
          placeholder="Quem pagou ou recebeu"
          className="ecos-input"
          list="beneficiarios-conhecidos"
        />
        <datalist id="beneficiarios-conhecidos">
          {beneficiarios.map((b) => (
            <option key={b.id} value={b.nome} />
          ))}
        </datalist>
      </label>

      {categoriasVisiveis.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Categoria</p>
          <div className="flex flex-wrap gap-2">
            {categoriasVisiveis.map((c) => {
              const IconCmp = (Icons as unknown as Record<string, Icons.LucideIcon>)[c.icone ?? ""] ?? Icons.Circle;
              return (
                <Chip
                  key={c.id}
                  selected={categoriaId === c.id}
                  accentColor={c.cor}
                  icon={<IconCmp size={15} strokeWidth={1.75} style={{ color: c.cor }} />}
                  onClick={() => setCategoriaId(categoriaId === c.id ? null : c.id)}
                >
                  {c.nome}
                </Chip>
              );
            })}
          </div>
        </div>
      )}

      {contas.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Conta</p>
          <div className="flex flex-wrap gap-2">
            {contas.map((c) => (
              <Chip key={c.id} selected={contaId === c.id} accentColor={c.cor} onClick={() => setContaId(contaId === c.id ? null : c.id)}>
                {c.nome}
              </Chip>
            ))}
          </div>
        </div>
      )}

      <div className="mb-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Forma de pagamento</p>
        <div className="flex flex-wrap gap-2">
          {FORMAS_PAGAMENTO.map((fp) => (
            <Chip key={fp} selected={formaPagamento === fp} onClick={() => setFormaPagamento(formaPagamento === fp ? null : fp)}>
              {LABEL_FORMA_PAGAMENTO[fp]}
            </Chip>
          ))}
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Status</span>
        <div className="flex rounded-pill bg-surface-2 p-1 self-start">
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
      </div>

      <label className="mb-6 flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Observações</span>
        <textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={2} className="ecos-input resize-none" />
      </label>

      <button onClick={salvar} disabled={salvando} className="w-full rounded-2xl bg-violet py-3.5 text-center font-body text-[15px] font-semibold text-black disabled:opacity-40">
        {salvando ? "Salvando..." : "Salvar alterações"}
      </button>
    </div>
  );
}
