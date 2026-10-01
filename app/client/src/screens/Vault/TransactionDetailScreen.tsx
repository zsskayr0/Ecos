import { useContext, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
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
import { SegmentedSlide } from "@/components/common/SegmentedSlide";
import { DatePicker } from "@/components/common/DatePicker";
import { formatMoeda, hojeISO } from "@/lib/format";
import { EmptyState } from "@/components/common/EmptyState";
import { useRefreshBus } from "@/lib/refresh-bus";
import { FecharDocumentoContext } from "@/lib/documento-popup";

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
  const params = useParams();
  const location = useLocation();
  // Na aba do desktop a tela vive dentro de `/cofre/*` (sem `:id` na rota): o id vem do próprio caminho.
  const id = params.id ?? (location.pathname.split("/")[2] === "transacao" ? location.pathname.split("/")[3] : undefined);
  const navigate = useNavigate();
  // Janela flutuante/aba do desktop: voltar = fechar. Sem shell desktop (mobile), volta no histórico.
  const fecharDocumento = useContext(FecharDocumentoContext);
  const voltar = () => (fecharDocumento ? fecharDocumento() : navigate(-1));
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

  // Retrato por padrão; se a janela ficar mais larga que alta, os campos se repartem em duas colunas.
  const raiz = useRef<HTMLDivElement>(null);
  const [largo, setLargo] = useState(false);
  useEffect(() => {
    const pai = raiz.current?.parentElement;
    if (!pai || typeof ResizeObserver === "undefined") return;
    const medir = () => setLargo(pai.clientWidth > pai.clientHeight);
    medir();
    const obs = new ResizeObserver(medir);
    obs.observe(pai);
    return () => obs.disconnect();
  }, [naoEncontrada, tx === null]);
  const [confirmandoDelete, setConfirmandoDelete] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!id) { setNaoEncontrada(true); return; }
    setNaoEncontrada(false);
    setTx(null);
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
      voltar();
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
      voltar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível apagar.");
      setSalvando(false);
    }
  }

  if (naoEncontrada) {
    return (
      <div className="px-4 pt-1">
        <button onClick={() => voltar()} className="mb-4 text-text-muted">
          <ChevronLeft />
        </button>
        <EmptyState icon={Receipt} title="Essa transação sumiu." subtitle="Pode ter sido apagada." />
      </div>
    );
  }

  if (!tx) {
    return (
      <div className="px-4 pt-1">
        <button onClick={() => voltar()} className="mb-4 text-text-muted">
          <ChevronLeft />
        </button>
        <p className="py-10 text-center text-sm text-text-muted">Carregando...</p>
      </div>
    );
  }

  const categoriasVisiveis = categorias.filter((c) => c.tipo === "ambos" || c.tipo === tipo);

  return (
    <div ref={raiz} className="px-4 pt-1 pb-nav-safe">
      <div className="mb-4 flex items-center justify-between">
        <button onClick={() => voltar()} className="flex items-center gap-1 text-sm text-text-muted">
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

      <div className={largo ? "grid grid-cols-2 items-start gap-x-8" : ""}>
      <div className={largo ? "" : "contents"}>
      <SegmentedSlide
        className="mx-auto mb-6 w-fit"
        ariaLabel="Tipo da transação"
        value={tipo}
        onChange={(v) => { setTipo(v); setCategoriaId(null); }}
        opcoes={[{ value: "saida", label: "Saída", cor: "ecos-error" }, { value: "entrada", label: "Entrada", cor: "ecos-success" }]}
      />

      <div className="mb-6 flex flex-col items-center gap-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Data</span>
        <DatePicker value={data} onChange={mudarData} />
      </div>

      <label className="mb-6 flex flex-col items-center gap-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Valor</span>
        <div className="flex items-center gap-1">
          <span className={`font-mono-value text-3xl font-bold ${tipo === "entrada" ? "text-success" : "text-error"}`}>R$</span>
          <input
            value={valorReais}
            onChange={(e) => setValorReais(e.target.value)}
            inputMode="decimal"
            className={`w-40 bg-transparent text-center font-mono-value text-3xl font-bold focus:outline-none ${
              tipo === "entrada" ? "text-success" : "text-error"
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

      <label className="mb-6 flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Observações</span>
        <textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={2} className="ecos-input resize-none" />
      </label>
      </div>

      <div className={largo ? "" : "contents"}>
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
        <SegmentedSlide
          className="self-start"
          ariaLabel="Status da transação"
          value={status}
          onChange={setStatus}
          opcoes={[{ value: "efetivada", label: "Efetivada", cor: "ecos-success" }, { value: "pendente", label: "Pendente", cor: "ecos-warning" }]}
        />
      </div>

      <button onClick={salvar} disabled={salvando} className="w-full rounded-2xl bg-violet py-3.5 text-center font-body text-[15px] font-semibold text-black disabled:opacity-40">
        {salvando ? "Salvando..." : "Salvar alterações"}
      </button>
      </div>
      </div>
    </div>
  );
}
