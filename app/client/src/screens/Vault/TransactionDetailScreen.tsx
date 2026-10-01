import { useContext, useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, Receipt } from "lucide-react";
import { vault, ApiError, type TransacaoApi, type FormaPagamento } from "@/lib/api";
import { EmptyState } from "@/components/common/EmptyState";
import { useRefreshBus } from "@/lib/refresh-bus";
import { FecharDocumentoContext } from "@/lib/documento-popup";
import { TransactionForm } from "@/screens/Create/TransactionForm";
import { DRAFT_VAZIO, type CapturaDraft } from "@/screens/Create/CreateFlow";

/**
 * Real `GET`/`PATCH`/`DELETE /vault/transacoes/:id`. Usa o mesmo formulário
 * do novo lançamento (`TransactionForm`), preenchido com a transação. Apagar
 * dado financeiro continua com a cópia literal da spec (seção 1.4): sem humor.
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
  const [draft, setDraft] = useState<CapturaDraft>(DRAFT_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!id) { setNaoEncontrada(true); return; }
    setNaoEncontrada(false);
    setTx(null);
    Promise.all([vault.transacoes.obter(id), vault.beneficiarios.listar().catch(() => [])])
      .then(([t, bens]) => {
        setTx(t);
        setDraft({
          ...DRAFT_VAZIO,
          texto: t.descricao,
          valorCentavos: t.valor_centavos,
          tipoTransacao: t.tipo,
          categoriaId: t.categoria_id,
          contaId: t.conta_id,
          formaPagamento: (t.forma_pagamento as FormaPagamento | null) ?? null,
          beneficiarioNome: bens.find((b) => b.id === t.beneficiario_id)?.nome ?? "",
          statusTransacao: t.status,
          dataTransacao: t.data,
          observacoesTransacao: t.observacoes ?? "",
        });
      })
      .catch(() => setNaoEncontrada(true));
  }, [id]);

  async function salvar() {
    if (!id || !tx) return;
    setSalvando(true);
    setErro(null);
    try {
      let beneficiarioId: string | undefined;
      if (draft.beneficiarioNome.trim()) {
        const b = await vault.beneficiarios.criarOuEncontrar({ nome: draft.beneficiarioNome.trim() });
        beneficiarioId = b.id;
      }
      await vault.transacoes.atualizar(id, {
        tipo: draft.tipoTransacao,
        valor_centavos: draft.valorCentavos,
        data: draft.dataTransacao,
        descricao: draft.texto.trim(),
        categoria_id: draft.categoriaId ?? undefined,
        conta_id: draft.contaId ?? undefined,
        beneficiario_id: beneficiarioId,
        forma_pagamento: draft.formaPagamento ?? undefined,
        status: draft.statusTransacao,
        observacoes: draft.observacoesTransacao.trim() || undefined,
      });
      notificar();
      voltar();
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
      voltar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível apagar.");
      setSalvando(false);
    }
  }

  if (naoEncontrada || !tx) {
    return (
      <div className="px-4 pt-1">
        <button onClick={() => voltar()} className="mb-4 text-text-muted">
          <ChevronLeft />
        </button>
        {naoEncontrada
          ? <EmptyState icon={Receipt} title="Essa transação sumiu." subtitle="Pode ter sido apagada." />
          : <p className="py-10 text-center text-sm text-text-muted">Carregando...</p>}
      </div>
    );
  }

  return (
    <div className="cofre-app cofre-capture-scope">
      <TransactionForm
        draft={draft}
        setDraft={setDraft}
        onSalvar={() => { void salvar(); }}
        onFechar={voltar}
        salvando={salvando}
        eyebrow="EDITAR REGISTRO"
        titulo="Editar lançamento"
        rotuloSalvar="Salvar alterações"
        erro={erro}
        onExcluir={() => { void excluir(); }}
      />
    </div>
  );
}
