import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppUI, type TipoCaptura } from "@/lib/ui-context";
import { useRefreshBus } from "@/lib/refresh-bus";
import { notas, tarefas, vault, ApiError, type FormaPagamento, type PrioridadeTarefa, type SubtarefaInput } from "@/lib/api";
import { hojeISO } from "@/lib/format";
import { taskTags } from "@/lib/task-fields";
import { pastaDoCaminho, type PastaContexto } from "@/lib/pasta-contexto";
import { inserirReferencia } from "@/components/editor/AttachmentsField";
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
   * `saldos_por_conta` (`app/vault/src/routes/ativacao.rs::config` sums
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
  /** Optional task properties; mobile capture reveals these on demand. */
  dataTarefa: string;
  prioridadeTarefa: PrioridadeTarefa;
  tagsTarefa: string[];
  pastaTarefa: string | null;
  /** null = espaço ativo do app. */
  espacoTarefa: string | null;
  subtarefasTarefa: SubtarefaInput[];
  /** Pasta e tags escolhidas na Nota (as `#hashtags` do texto são somadas ao salvar). */
  pastaNota: string | null;
  tagsNota: string[];
}

export type SetDraft = Dispatch<SetStateAction<CapturaDraft>>;

export const DRAFT_VAZIO: CapturaDraft = {
  texto: "",
  corpo: "",
  tags: [],
  duracaoMin: 5,
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
  dataTarefa: "",
  prioridadeTarefa: "baixa",
  tagsTarefa: [],
  pastaTarefa: null,
  espacoTarefa: null,
  subtarefasTarefa: [],
  pastaNota: null,
  tagsNota: [],
};

const CHAVE_RASCUNHO = "ecos.capture-draft.v1";
function lerRascunho(): CapturaDraft {
  try { return { ...DRAFT_VAZIO, ...JSON.parse(localStorage.getItem(CHAVE_RASCUNHO) ?? "null") }; }
  catch { return DRAFT_VAZIO; }
}

/** Keep the explicitly selected date and local time together on the wire. */
function scheduledAtReal(draft: CapturaDraft): string | undefined {
  if (!draft.scheduledAt || !draft.dataTarefa) return undefined;
  const hora = new Date(draft.scheduledAt);
  const [ano, mes, dia] = draft.dataTarefa.split("-").map(Number);
  return new Date(ano, mes - 1, dia, hora.getHours(), hora.getMinutes()).toISOString();
}

/** Builds the real `POST /api/v1/captura` payload (section 11.3) — note/task only (see GAP-13 in `lib/api.ts`). */
function payloadReal(tipo: "nota" | "tarefa", draft: CapturaDraft, espaco: string): Record<string, unknown> {
  if (tipo === "nota") {
    return {
      titulo: draft.texto.trim(),
      corpo: draft.corpo,
      tags: taskTags(draft.tagsNota, draft.corpo),
      pasta: draft.pastaNota ?? undefined,
      espaco,
    };
  }
  return {
    titulo: draft.texto.trim(),
    corpo: draft.corpo.trim() || undefined,
    duration_min: draft.duracaoMin,
    scheduled_at: scheduledAtReal(draft),
    due_date: draft.dataTarefa || undefined,
    tags: taskTags(draft.tagsTarefa, draft.corpo),
    prioridade: draft.prioridadeTarefa,
    pasta: draft.pastaTarefa ?? undefined,
    subtarefas: draft.subtarefasTarefa,
    espaco,
  };
}

export function CreateFlow({ embedded = false, onTitleChange, pastaContexto }: {
  embedded?: boolean;
  onTitleChange?: (title: string) => void;
  /** No desktop as rotas das abas não são a do app: o shell diz em que pasta a pessoa está (`null` = em nenhuma). No mobile vem da rota. */
  pastaContexto?: PastaContexto | null;
}) {
  const { capturaAberta, fecharCaptura, trocarTipoCaptura, espacoAtivo, anexosDeCaptura, limparAnexosDeCaptura } = useAppUI();
  const { notificar } = useRefreshBus();
  const navigate = useNavigate();
  const location = useLocation();
  const [draft, setDraft] = useState<CapturaDraft>(lerRascunho);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [itemCriado, setItemCriado] = useState<{ tipo: "nota" | "tarefa"; id: string } | null>(null);
  const ultimoEnvio = useRef<string | null>(null);
  const envioEmCurso = useRef(false);
  // Sobe a cada captura encerrada: um envio ainda em voo não pode "reviver" o item da captura anterior na próxima.
  const sessaoCaptura = useRef(0);

  useEffect(() => { onTitleChange?.(draft.texto.trim()); }, [draft.texto, onTitleChange]);
  // Item já criado no servidor não é "rascunho": guardá-lo faz a próxima captura reabrir (e duplicar) a tarefa/nota anterior.
  useEffect(() => {
    try {
      if (itemCriado) localStorage.removeItem(CHAVE_RASCUNHO);
      else localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify(draft));
    } catch { /* cache indisponível */ }
  }, [draft, itemCriado]);

  // Dentro de uma pasta, a Tarefa/Nota nova já nasce nela — uma vez por captura, para não brigar com a escolha da pessoa.
  const contexto = pastaContexto !== undefined ? pastaContexto : pastaDoCaminho(location.pathname);
  const padraoAplicado = useRef({ nota: false, tarefa: false });
  useEffect(() => {
    if (capturaAberta !== "nota" && capturaAberta !== "tarefa") return;
    if (padraoAplicado.current[capturaAberta]) return;
    padraoAplicado.current[capturaAberta] = true;
    if (contexto?.tipo !== capturaAberta) return;
    const pasta = contexto.pasta;
    setDraft((d) => (capturaAberta === "tarefa" ? (d.pastaTarefa ? d : { ...d, pastaTarefa: pasta }) : d.pastaNota ? d : { ...d, pastaNota: pasta }));
  }, [capturaAberta, contexto?.tipo, contexto?.pasta]);

  // Anexos que chegam de fora (imagens compartilhadas com o app) entram no corpo da nota/tarefa aberta.
  useEffect(() => {
    if (!anexosDeCaptura.length || (capturaAberta !== "nota" && capturaAberta !== "tarefa")) return;
    const linhas = anexosDeCaptura;
    limparAnexosDeCaptura();
    setDraft((d) => ({ ...d, corpo: linhas.reduce((corpo, linha) => inserirReferencia(corpo, linha), d.corpo) }));
  }, [anexosDeCaptura, capturaAberta, limparAnexosDeCaptura]);

  function fecharTudo() {
    padraoAplicado.current = { nota: false, tarefa: false };
    sessaoCaptura.current += 1;
    fecharCaptura();
    setDraft(DRAFT_VAZIO);
    setItemCriado(null);
    ultimoEnvio.current = null;
    try { localStorage.removeItem(CHAVE_RASCUNHO); } catch { /* cache indisponível */ }
    setErro(null);
  }

  // A captura pode ser encerrada por fora (botão voltar, Esc, fechar a janela) sem passar por `fecharTudo`.
  // Se já existe um item criado, a próxima captura não pode herdar o rascunho nem o id dele: senão o novo texto
  // sobrescreve a tarefa/nota anterior. Sem item criado, o rascunho digitado continua guardado (contingência).
  useEffect(() => {
    if (capturaAberta !== null || (!itemCriado && ultimoEnvio.current === null)) return;
    padraoAplicado.current = { nota: false, tarefa: false };
    sessaoCaptura.current += 1;
    setDraft(DRAFT_VAZIO);
    setItemCriado(null);
    ultimoEnvio.current = null;
    setErro(null);
    try { localStorage.removeItem(CHAVE_RASCUNHO); } catch { /* cache indisponível */ }
  }, [capturaAberta, itemCriado]);

  const salvar = useCallback(async () => {
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
    if (envioEmCurso.current) return;
    envioEmCurso.current = true;
    setSalvando(true);
    const sessao = sessaoCaptura.current;
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
      } else if (tipo === "nota") {
        const dados = payloadReal("nota", draft, espacoAtivo);
        if (itemCriado?.tipo === "nota") await notas.atualizar(itemCriado.id, dados);
        else {
          const criado = await notas.criar(dados as { titulo: string; corpo?: string; pasta?: string; tags?: string[] });
          if (sessao === sessaoCaptura.current) setItemCriado({ tipo: "nota", id: criado.id });
        }
      } else {
        const dados = payloadReal("tarefa", draft, draft.espacoTarefa ?? espacoAtivo);
        if (itemCriado?.tipo === "tarefa") await tarefas.atualizar(itemCriado.id, dados);
        else {
          const criado = await tarefas.criar(dados as unknown as Parameters<typeof tarefas.criar>[0]);
          if (sessao === sessaoCaptura.current) setItemCriado({ tipo: "tarefa", id: criado.id });
        }
      }
      notificar();
      if (sessao !== sessaoCaptura.current) return;
      ultimoEnvio.current = JSON.stringify({ tipo, draft });
      if (tipo === "nota" || tipo === "tarefa") {
        try { localStorage.removeItem(CHAVE_RASCUNHO); } catch { /* cache indisponível */ }
        return;
      }
      fecharTudo();
      if (tipo === "transacao" && location.pathname.startsWith("/cofre")) navigate("/cofre");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar. O ecos-app está rodando?");
    } finally {
      envioEmCurso.current = false;
      setSalvando(false);
    }
  }, [capturaAberta, draft, espacoAtivo, fecharTudo, itemCriado, location.pathname, navigate, notificar]);

  // A primeira pausa após digitar cria o item; as pausas seguintes o atualizam.
  // O rascunho local é escrito imediatamente, portanto fechar a janela não perde texto.
  useEffect(() => {
    if (capturaAberta !== "nota" && capturaAberta !== "tarefa") return;
    if (!draft.texto.trim()) return;
    const chave = JSON.stringify({ tipo: capturaAberta, draft });
    if (ultimoEnvio.current === chave || salvando) return;
    const timer = window.setTimeout(() => { void salvar(); }, 600);
    return () => window.clearTimeout(timer);
  }, [capturaAberta, draft, salvar, salvando]);

  if (!capturaAberta) return null;

  if (capturaAberta === "escolha") {
    return <ChoicePopup onEscolher={(tipo: TipoCaptura) => trocarTipoCaptura(tipo)} onFechar={fecharTudo} />;
  }

  return (
    <FormShell tipoAtivo={capturaAberta} onTrocarTipo={trocarTipoCaptura} onFechar={fecharTudo} erro={erro} embedded={embedded}>
      {capturaAberta === "nota" && <NoteForm draft={draft} setDraft={setDraft} onSalvar={salvar} salvando={salvando} />}
      {capturaAberta === "tarefa" && <TaskForm draft={draft} setDraft={setDraft} onSalvar={salvar} salvando={salvando} />}
      {capturaAberta === "transacao" && <TransactionForm draft={draft} setDraft={setDraft} onSalvar={salvar} salvando={salvando} />}
    </FormShell>
  );
}
