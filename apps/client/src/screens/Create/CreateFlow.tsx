import { useState, type Dispatch, type SetStateAction } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppUI, type TipoCaptura } from "@/lib/ui-context";
import { useRefreshBus } from "@/lib/refresh-bus";
import { captura, vault, ApiError, type FormaPagamento, type PrioridadeTarefa, type SubtarefaInput } from "@/lib/api";
import { hojeISO } from "@/lib/format";
import { ChoicePopup } from "./ChoicePopup";
import { FormShell } from "./FormShell";
import { NoteForm } from "./NoteForm";
import { TaskForm } from "./TaskForm";
import { TransactionForm } from "./TransactionForm";

/**
 * A single, persistent Capture draft (rule 5, section 2.4): switching
 * type never loses what's already been typed. Each form only shows/edits
 * the subset of fields relevant to its type — incompatible fields stay
 * hidden, not erased; switching back to the original type, they reappear
 * filled in.
 */
export interface CapturaDraft {
  /** The field shared by all 3 types: title (Nota/Tarefa) ~ description (Transacao). */
  texto: string;
  corpo: string;
  tags: string[];
  duracaoMin: number;
  scheduledAt: string | null;
  valorCentavos: number;
  categoriaId: string | null;
  /** GAP-14: without a linked account, the transaction never shows up in
   * `saldos_por_conta` (`apps/vault/src/routes/ativacao.rs::config` sums
   * by `conta_id`; a standalone transaction shows up in no account at
   * all) — auto-selected in `TransactionForm` from the first existing
   * Conta. */
  contaId: string | null;
  tipoTransacao: "entrada" | "saida";
  /** All optional on the backend (`TransacaoPayload`) — surfaced in
   * TransactionForm's "Mais opções" so the quick chip-based form (section
   * 3.6) stays fast by default without hiding data the Vault already
   * supports. */
  formaPagamento: FormaPagamento | null;
  beneficiarioNome: string;
  statusTransacao: "efetivada" | "pendente";
  dataTransacao: string;
  observacoesTransacao: string;
  /** Tarefa extras (user feedback: "tarefas tá muito simples") — surfaced
   * directly in the create form, not buried behind a collapse, since
   * prioridade/data/pasta are exactly the "most important" fields the
   * feedback asked to keep on-the-go capture focused on. */
  dataTarefa: string;
  prioridadeTarefa: PrioridadeTarefa;
  tagsTarefa: string[];
  pastaTarefa: string | null;
  subtarefasTarefa: SubtarefaInput[];
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
  formaPagamento: null,
  beneficiarioNome: "",
  statusTransacao: "efetivada",
  dataTransacao: hojeISO(),
  observacoesTransacao: "",
  dataTarefa: hojeISO(),
  prioridadeTarefa: "media",
  tagsTarefa: [],
  pastaTarefa: null,
  subtarefasTarefa: [],
};

/** `draft.scheduledAt` only ever carries a time-of-day (`TaskForm`'s time
 * input sets it against `new Date()`) — this swaps in the actually-chosen
 * date (`dataTarefa`, from the cyan `DatePicker`) before it goes over the
 * wire, so picking a future date doesn't get silently discarded. */
function scheduledAtReal(draft: CapturaDraft): string | undefined {
  if (!draft.scheduledAt) return undefined;
  const hora = new Date(draft.scheduledAt);
  const [ano, mes, dia] = draft.dataTarefa.split("-").map(Number);
  return new Date(ano, mes - 1, dia, hora.getHours(), hora.getMinutes()).toISOString();
}

/** Builds the real `POST /api/v1/captura` payload (section 11.3) — note/task only (see GAP-13 in `lib/api.ts`). */
function payloadReal(tipo: "nota" | "tarefa", draft: CapturaDraft): Record<string, unknown> {
  if (tipo === "nota") {
    return { titulo: draft.texto.trim(), corpo: draft.corpo };
  }
  return {
    titulo: draft.texto.trim(),
    corpo: draft.corpo.trim() || undefined,
    duration_min: draft.duracaoMin,
    scheduled_at: scheduledAtReal(draft),
    tags: draft.tagsTarefa,
    prioridade: draft.prioridadeTarefa,
    pasta: draft.pastaTarefa ?? undefined,
    subtarefas: draft.subtarefasTarefa,
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
        let beneficiarioId: string | undefined;
        if (draft.beneficiarioNome.trim()) {
          const b = await vault.beneficiarios.criarOuEncontrar({ nome: draft.beneficiarioNome.trim() });
          beneficiarioId = b.id;
        }
        await vault.transacoes.criar({
          tipo: draft.tipoTransacao,
          valor_centavos: draft.valorCentavos,
          descricao: draft.texto.trim(),
          categoria_id: draft.categoriaId ?? undefined,
          conta_id: draft.contaId ?? undefined,
          beneficiario_id: beneficiarioId,
          forma_pagamento: draft.formaPagamento ?? undefined,
          status: draft.statusTransacao,
          observacoes: draft.observacoesTransacao.trim() || undefined,
          data: draft.dataTransacao,
        });
      } else {
        await captura.capturar(tipo, payloadReal(tipo, draft));
      }
      notificar();
      fecharTudo();
      // Immediate payoff: if the Capture happened somewhere other than
      // the list itself (e.g. Agenda creating a Tarefa), the user already
      // sees the result without having to navigate manually.
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
