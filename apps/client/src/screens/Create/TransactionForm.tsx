import { useEffect, useState } from "react";
import * as Icons from "lucide-react";
import { Delete } from "lucide-react";
import { Chip } from "@/components/common/Chip";
import { DatePicker } from "@/components/common/DatePicker";
import { formatMoeda, hojeISO } from "@/lib/format";
import { vault, FORMAS_PAGAMENTO, type CategoriaApi, type ContaApi, type FormaPagamento } from "@/lib/api";
import type { CapturaDraft, SetDraft } from "./CreateFlow";

interface Props {
  draft: CapturaDraft;
  setDraft: SetDraft;
  onSalvar: () => void;
  salvando?: boolean;
}

const TECLAS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];

/** UI labels only — the wire value stays the backend's closed enum (`FORMAS_PAGAMENTO`, `lib/api.ts`). */
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
 * Transacao form — one continuous scroll, no collapsed "mais opções": every
 * field the backend stores is reachable directly while capturing on the go.
 * Field order follows what's actually useful to fill in a hurry — who was
 * paid/received-from before which category it falls under (user feedback:
 * "é mais util saber pra quem paguei ou de quem recebi, do que a qual
 * categoria pertence") — not the order the backend happens to store them in.
 */
export function TransactionForm({ draft, setDraft, onSalvar, salvando }: Props) {
  const [categorias, setCategorias] = useState<CategoriaApi[] | null>(null);
  const [contas, setContas] = useState<ContaApi[]>([]);

  useEffect(() => {
    vault.categorias
      .listar()
      .then(setCategorias)
      .catch(() => setCategorias([]));
    // Auto-selects the default Conta (or the first existing one) —
    // without this the Transaction never shows up in `saldos_por_conta`
    // (GAP-14, CreateFlow.tsx). Still overridable below, since removed
    // from behind "mais opções" (user feedback: keep it a single scroll).
    vault.contas
      .listar()
      .then((lista) => {
        setContas(lista);
        const escolhida = lista.find((c) => c.padrao) ?? lista[0] ?? null;
        if (escolhida && !draft.contaId) setDraft((d) => ({ ...d, contaId: escolhida.id }));
      })
      .catch(() => setContas([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const categoriasVisiveis = (categorias ?? []).filter((c) => c.tipo === "ambos" || c.tipo === draft.tipoTransacao);
  const contaAtual = contas.find((c) => c.id === draft.contaId);

  function apertar(tecla: string) {
    if (tecla === "") return;
    setDraft((prev) => {
      if (tecla === "del") return { ...prev, valorCentavos: Math.floor(prev.valorCentavos / 10) };
      const proximo = prev.valorCentavos * 10 + Number(tecla);
      return proximo > 999_999_999 ? prev : { ...prev, valorCentavos: proximo };
    });
  }

  /** A future date almost always means the transaction hasn't happened
   * yet — default the status accordingly so "pendente" isn't one more
   * thing to remember to toggle by hand, while still leaving it editable
   * below for the exception (e.g. a past transaction confirmed late). */
  function mudarData(novaData: string) {
    setDraft((prev) => ({
      ...prev,
      dataTransacao: novaData,
      statusTransacao: novaData > hojeISO() ? "pendente" : "efetivada",
    }));
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex rounded-pill bg-surface-2 p-1 self-center">
        <button
          onClick={() => setDraft((d) => ({ ...d, tipoTransacao: "saida" }))}
          className={`rounded-pill px-4 py-1.5 text-sm font-medium ${
            draft.tipoTransacao === "saida" ? "bg-error/20 text-error" : "text-text-muted"
          }`}
        >
          Saída
        </button>
        <button
          onClick={() => setDraft((d) => ({ ...d, tipoTransacao: "entrada" }))}
          className={`rounded-pill px-4 py-1.5 text-sm font-medium ${
            draft.tipoTransacao === "entrada" ? "bg-success/20 text-success" : "text-text-muted"
          }`}
        >
          Entrada
        </button>
      </div>

      <div className="flex flex-col items-center gap-1 self-center">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Data</span>
        <DatePicker value={draft.dataTransacao} onChange={mudarData} />
      </div>

      <p
        className={`text-center font-mono-value text-4xl font-bold ${
          draft.tipoTransacao === "entrada" ? "text-success" : "text-text-primary"
        }`}
      >
        {formatMoeda(draft.valorCentavos)}
      </p>

      <input
        value={draft.texto}
        onChange={(e) => setDraft((d) => ({ ...d, texto: e.target.value }))}
        placeholder="Descrição (ex: almoço, aluguel...)"
        className="w-full rounded-2xl bg-surface-2 px-4 py-3 text-[15px] text-text-primary placeholder:text-text-muted focus:outline-none"
      />
      {contaAtual && <p className="-mt-3 text-xs text-text-muted">Sai de: {contaAtual.nome}</p>}

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Beneficiário</span>
        <input
          value={draft.beneficiarioNome}
          onChange={(e) => setDraft((d) => ({ ...d, beneficiarioNome: e.target.value }))}
          placeholder="Quem pagou ou recebeu"
          className="ecos-input"
        />
      </label>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Categoria</p>
        {categorias === null ? (
          <p className="text-sm text-text-muted">Carregando categorias do Cofre...</p>
        ) : categoriasVisiveis.length === 0 ? (
          <p className="text-sm text-text-muted">
            Nenhuma categoria de {draft.tipoTransacao} cadastrada ainda — a Transação pode ser salva sem categoria.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {categoriasVisiveis.map((c) => {
              const IconCmp = (Icons as unknown as Record<string, Icons.LucideIcon>)[c.icone ?? ""] ?? Icons.Circle;
              return (
                <Chip
                  key={c.id}
                  selected={draft.categoriaId === c.id}
                  accentColor={c.cor}
                  icon={<IconCmp size={15} strokeWidth={1.75} style={{ color: c.cor }} />}
                  onClick={() => setDraft((d) => ({ ...d, categoriaId: c.id }))}
                >
                  {c.nome}
                </Chip>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {TECLAS.map((t, i) =>
          t === "" ? (
            <div key={i} />
          ) : (
            <button
              key={i}
              onClick={() => apertar(t)}
              className="flex h-12 items-center justify-center rounded-xl bg-surface-2 font-mono-value text-lg text-text-primary hover:bg-surface-3"
            >
              {t === "del" ? <Delete size={18} /> : t}
            </button>
          ),
        )}
      </div>

      {contas.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Conta</p>
          <div className="flex flex-wrap gap-2">
            {contas.map((c) => (
              <Chip key={c.id} selected={draft.contaId === c.id} accentColor={c.cor} onClick={() => setDraft((d) => ({ ...d, contaId: c.id }))}>
                {c.nome}
              </Chip>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Forma de pagamento</p>
        <div className="flex flex-wrap gap-2">
          {FORMAS_PAGAMENTO.map((fp) => (
            <Chip
              key={fp}
              selected={draft.formaPagamento === fp}
              onClick={() => setDraft((d) => ({ ...d, formaPagamento: d.formaPagamento === fp ? null : fp }))}
            >
              {LABEL_FORMA_PAGAMENTO[fp]}
            </Chip>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Status</span>
        <div className="flex rounded-pill bg-surface-2 p-1 self-start">
          <button
            onClick={() => setDraft((d) => ({ ...d, statusTransacao: "efetivada" }))}
            className={`rounded-pill px-4 py-1.5 text-sm font-medium ${
              draft.statusTransacao === "efetivada" ? "bg-success/20 text-success" : "text-text-muted"
            }`}
          >
            Efetivada
          </button>
          <button
            onClick={() => setDraft((d) => ({ ...d, statusTransacao: "pendente" }))}
            className={`rounded-pill px-4 py-1.5 text-sm font-medium ${
              draft.statusTransacao === "pendente" ? "bg-warning/20 text-warning" : "text-text-muted"
            }`}
          >
            Pendente
          </button>
        </div>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Observações</span>
        <textarea
          value={draft.observacoesTransacao}
          onChange={(e) => setDraft((d) => ({ ...d, observacoesTransacao: e.target.value }))}
          rows={2}
          className="ecos-input resize-none"
        />
      </label>

      <button
        onClick={onSalvar}
        disabled={!draft.texto.trim() || draft.valorCentavos === 0 || salvando}
        className="mt-1 rounded-2xl bg-violet py-3.5 text-center font-body text-[15px] font-semibold text-black disabled:opacity-40"
      >
        {salvando ? "Salvando..." : "Salvar Transação"}
      </button>
    </div>
  );
}
