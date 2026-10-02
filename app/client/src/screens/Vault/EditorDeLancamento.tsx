import { useEffect, useState } from "react";
import { ChevronLeft, Receipt } from "lucide-react";
import { vault, ApiError, type TransacaoApi, type FormaPagamento } from "@/lib/api";
import { EmptyState } from "@/components/common/EmptyState";
import { useRefreshBus } from "@/lib/refresh-bus";
import { TransactionForm } from "@/screens/Create/TransactionForm";
import { useAutoriaDoCofre } from "@/lib/use-autoria-cofre";
import { DRAFT_VAZIO, type CapturaDraft } from "@/screens/Create/CreateFlow";
import { ComprovantesDaTransacao } from "./comprovantes/ComprovantesDaTransacao";

/**
 * Edição de um lançamento: carrega, edita, salva e apaga (`GET`/`PATCH`/`DELETE /vault/transacoes/:id`). Usa o mesmo
 * formulário do novo lançamento, preenchido com a transação. Apagar dado financeiro continua com a cópia literal da
 * spec (seção 1.4): sem humor. Vive em dois lugares: a tela de detalhe e o painel ao lado do comprovante.
 */
export function EditorDeLancamento({ id, aoSalvar, aoExcluir, aoFechar, aninhado = false, comComprovantes = true }: {
  id?: string;
  aoSalvar: () => void;
  aoExcluir: () => void;
  aoFechar: () => void;
  /** Dentro de outra janela do Cofre (o painel do comprovante): não repete o contêiner de página inteira. */
  aninhado?: boolean;
  /** `false` esconde o container de anexos do formulário. */
  comComprovantes?: boolean;
}) {
  const { notificar } = useRefreshBus();
  const autoria = useAutoriaDoCofre();
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
      aoSalvar();
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
      aoExcluir();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível apagar.");
      setSalvando(false);
    }
  }

  if (naoEncontrada || !tx) {
    return (
      <div className="px-4 pt-1">
        <button onClick={() => aoFechar()} className="mb-4 text-text-muted" aria-label="Voltar">
          <ChevronLeft />
        </button>
        {naoEncontrada
          ? <EmptyState icon={Receipt} title="Essa transação sumiu." subtitle="Pode ter sido apagada." />
          : <p className="py-10 text-center text-sm text-text-muted" role="status">Carregando...</p>}
      </div>
    );
  }

  return (
    <div className={aninhado ? "cofre-capture-scope" : "cofre-app cofre-capture-scope"}>
      <TransactionForm
        draft={draft}
        setDraft={setDraft}
        onSalvar={() => { void salvar(); }}
        onFechar={aoFechar}
        salvando={salvando}
        eyebrow="EDITAR REGISTRO"
        titulo="Editar lançamento"
        rotuloSalvar="Salvar alterações"
        erro={erro}
        onExcluir={() => { void excluir(); }}
        criadoPor={autoria.nomeDe(tx.criado_por)}
        anexos={comComprovantes ? <ComprovantesDaTransacao transacaoId={tx.id} aoMudar={notificar} /> : undefined}
      />
    </div>
  );
}
