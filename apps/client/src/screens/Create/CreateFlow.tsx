import { useState, type Dispatch, type SetStateAction } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppUI, type TipoCaptura } from "@/lib/ui-context";
import { useRefreshBus } from "@/lib/refresh-bus";
import { captura, vault, ApiError } from "@/lib/api";
import { ChoicePopup } from "./ChoicePopup";
import { FormShell } from "./FormShell";
import { NoteForm } from "./NoteForm";
import { TaskForm } from "./TaskForm";
import { TransactionForm } from "./TransactionForm";

/**
 * Rascunho único e persistente da Captura (regra 5, seção 2.4): trocar de
 * tipo nunca perde o que já foi digitado. Cada form só mostra/edita o
 * subconjunto de campos relevante ao seu tipo — campos incompatíveis ficam
 * escondidos, não apagados; ao voltar pro tipo original, reaparecem
 * preenchidos.
 */
export interface CapturaDraft {
  /** Campo compatível entre os 3 tipos: título (Nota/Tarefa) ~ descrição (Transação). */
  texto: string;
  corpo: string;
  tags: string[];
  duracaoMin: number;
  scheduledAt: string | null;
  valorCentavos: number;
  categoriaId: string | null;
  /** GAP-14: sem conta vinculada, a transação nunca entra em `saldos_por_conta`
   * (`apps/vault/src/routes/ativacao.rs::config` soma por `conta_id`, uma
   * transação solta não aparece em conta nenhuma) — auto-selecionada em
   * `TransactionForm` a partir da primeira Conta existente. */
  contaId: string | null;
  tipoTransacao: "entrada" | "saida";
}

export type SetDraft = Dispatch<SetStateAction<CapturaDraft>>;

export const DRAFT_VAZIO: CapturaDraft = {
  texto: "",
  corpo: "",
  tags: [],
  duracaoMin: 30,
  scheduledAt: null,
  valorCentavos: 0,
  categoriaId: null,
  contaId: null,
  tipoTransacao: "saida",
};

function hoje(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Monta o payload real de `POST /api/v1/captura` (seção 11.3) — só nota/tarefa (ver GAP-13 em `lib/api.ts`). */
function payloadReal(tipo: "nota" | "tarefa", draft: CapturaDraft): Record<string, unknown> {
  if (tipo === "nota") {
    return { titulo: draft.texto.trim(), corpo: draft.corpo };
  }
  return {
    titulo: draft.texto.trim(),
    duration_min: draft.duracaoMin,
    scheduled_at: draft.scheduledAt ?? undefined,
  };
}

export function CreateFlow() {
  const { capturaAberta, fecharCaptura, trocarTipoCaptura } = useAppUI();
  const { notificar } = useRefreshBus();
  const navigate = useNavigate();
  const location = useLocation();
  const [draft, setDraft] = useState<CapturaDraft>(DRAFT_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (!capturaAberta) return null;

  function fecharTudo() {
    fecharCaptura();
    setDraft(DRAFT_VAZIO);
    setErro(null);
  }

  if (capturaAberta === "escolha") {
    return <ChoicePopup onEscolher={(tipo: TipoCaptura) => trocarTipoCaptura(tipo)} onFechar={fecharTudo} />;
  }

  async function salvar() {
    const tipo = capturaAberta as TipoCaptura;
    setErro(null);
    if (!draft.texto.trim()) {
      setErro("Preenche o campo principal antes de salvar.");
      return;
    }
    if (tipo === "transacao" && draft.valorCentavos <= 0) {
      setErro("O valor da transação deve ser maior que zero.");
      return;
    }
    setSalvando(true);
    try {
      if (tipo === "transacao") {
        await vault.transacoes.criar({
          tipo: draft.tipoTransacao,
          valor_centavos: draft.valorCentavos,
          descricao: draft.texto.trim(),
          categoria_id: draft.categoriaId ?? undefined,
          conta_id: draft.contaId ?? undefined,
          data: hoje(),
        });
      } else {
        await captura.capturar(tipo, payloadReal(tipo, draft));
      }
      notificar();
      fecharTudo();
      // Recompensa imediata: se a Captura aconteceu de outro lugar que não
      // a própria lista (ex. Agenda criando Tarefa), o usuário já vê o
      // resultado sem precisar navegar manualmente.
      if (tipo === "nota" && location.pathname !== "/feed") navigate("/feed");
      if (tipo === "transacao" && location.pathname.startsWith("/cofre")) navigate("/cofre");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar. O ecos-app está rodando?");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <FormShell tipoAtivo={capturaAberta} onTrocarTipo={trocarTipoCaptura} onFechar={fecharTudo} erro={erro}>
      {capturaAberta === "nota" && <NoteForm draft={draft} setDraft={setDraft} onSalvar={salvar} salvando={salvando} />}
      {capturaAberta === "tarefa" && <TaskForm draft={draft} setDraft={setDraft} onSalvar={salvar} salvando={salvando} />}
      {capturaAberta === "transacao" && <TransactionForm draft={draft} setDraft={setDraft} onSalvar={salvar} salvando={salvando} />}
    </FormShell>
  );
}
