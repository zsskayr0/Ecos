import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { dataPadraoNovaTarefa, lerPreferenciasAplicativo } from "@/lib/preferencias-aplicativo";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppUI, type TipoCaptura } from "@/lib/ui-context";
import { useRefreshBus } from "@/lib/refresh-bus";
import { notas, pastas, tarefas, vault, type FormaPagamento, type PrioridadeTarefa, type SubtarefaInput } from "@/lib/api";
import { avisar } from "@/lib/toast";
import { ehFalhaTransitoria, esperaDoReenvio, tituloParaCriar } from "@/lib/salvamento-otimista";
import { hojeISO } from "@/lib/format";
import { taskScheduledAt, taskTags } from "@/lib/task-fields";
import { tagsPadraoDaPasta, unirTags } from "@/lib/tags-pasta";
import { pastaDoCaminho, type PastaContexto } from "@/lib/pasta-contexto";
import { inserirReferencia } from "@/components/editor/AttachmentsField";
import { ChoicePopup } from "./ChoicePopup";
import { FormShell } from "./FormShell";
import { NoteForm } from "./NoteForm";
import { TaskForm } from "./TaskForm";
import { TransactionForm } from "./TransactionForm";
import { EventoDialog } from "@/screens/Eventos/EventoDialog";
import { AnexosPendentes, enviarAnexosPendentes } from "@/screens/Vault/comprovantes/AnexosPendentes";

import { mensagemDeErro } from "@/lib/erros";
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
  /** null = espaço ativo do app. */
  espacoNota: string | null;
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
  espacoNota: null,
};

let cacheVazio: { chave: string; draft: CapturaDraft } | null = null;
/** Rascunho em branco já com a prioridade e a duração padrão das preferências. Estável enquanto elas não mudam (a identidade é comparada). */
export function rascunhoVazio(): CapturaDraft {
  const p = lerPreferenciasAplicativo();
  const dataTarefa = dataPadraoNovaTarefa(p.tarefaNovaData);
  const chave = `${p.tarefaPrioridade}|${p.tarefaDuracaoMin}|${dataTarefa}|${p.tarefaNovaHorario}`;
  if (!cacheVazio || cacheVazio.chave !== chave) {
    cacheVazio = { chave, draft: { ...DRAFT_VAZIO, prioridadeTarefa: p.tarefaPrioridade, duracaoMin: p.tarefaDuracaoMin, dataTarefa, scheduledAt: taskScheduledAt(dataTarefa, p.tarefaNovaHorario) } };
  }
  return cacheVazio.draft;
}

const CHAVE_RASCUNHO = "ecos.capture-draft.v1";
/** Nota/Tarefa que não pôde ser gravada (servidor fora do ar): guardada aqui para a pessoa recuperar na próxima captura. */
export const CHAVE_RASCUNHO_FALHA = "ecos.capture-draft-falha.v1";

/** Título mínimo para o autosave criar a Nota/Tarefa: digitar "R" e parar não pode virar item no servidor. */
export const MIN_CARACTERES_CRIACAO = 3;
export function temConteudoMinimo(texto: string): boolean {
  return texto.trim().length >= MIN_CARACTERES_CRIACAO;
}
/** Ao fechar vale tudo o que a pessoa escreveu: título com o mínimo ou qualquer texto no corpo (o servidor tira o título dele). */
export function podeSalvarAoFechar(draft: Pick<CapturaDraft, "texto" | "corpo">): boolean {
  return temConteudoMinimo(draft.texto) || draft.corpo.trim().length > 0;
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

export function CreateFlow({ embedded = false, onTitleChange, pastaContexto, contextoDesktop }: {
  embedded?: boolean;
  onTitleChange?: (title: string) => void;
  /** No desktop as rotas das abas não são a do app: o shell diz em que pasta a pessoa está (`null` = em nenhuma). No mobile vem da rota. */
  pastaContexto?: PastaContexto | null;
  contextoDesktop?: "ecos" | "cofre";
}) {
  const { capturaAberta, idCaptura, dataCaptura, rascunhoCaptura, abrirCaptura, fecharCaptura, trocarTipoCaptura, espacoAtivo, anexosDeCaptura, limparAnexosDeCaptura } = useAppUI();
  const { notificar } = useRefreshBus();
  const navigate = useNavigate();
  const location = useLocation();
  const [draft, setDraft] = useState<CapturaDraft>(rascunhoVazio);
  /** Anexos escolhidos para um lançamento novo; vão para o Cofre assim que ele é criado. */
  const [anexosPendentes, setAnexosPendentes] = useState<File[]>([]);
  const [notasPendentes, setNotasPendentes] = useState<File[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [itemCriado, setItemCriadoEstado] = useState<{ tipo: "nota" | "tarefa"; id: string } | null>(null);
  /** Espelho síncrono de `itemCriado`: um envio que termina depois de a tela fechar ainda precisa saber que o item já existe (senão criaria outro). */
  const itemCriadoRef = useRef<{ tipo: "nota" | "tarefa"; id: string } | null>(null);
  const setItemCriado = (v: { tipo: "nota" | "tarefa"; id: string } | null) => { itemCriadoRef.current = v; setItemCriadoEstado(v); };
  const ultimoEnvio = useRef<string | null>(null);
  const envioEmCurso = useRef(false);
  /** Pedido de salvar que chegou com outro envio em voo: roda assim que ele termina, com o texto mais novo (nada é descartado). */
  const refazer = useRef<TipoCaptura | null>(null);
  const salvarRef = useRef<(tipo?: TipoCaptura) => Promise<boolean>>(async () => false);
  /** Tipo da última captura aberta (nota/tarefa): depois que `capturaAberta` vira `null` ainda é preciso saber o que gravar. */
  const ultimoTipoAberto = useRef<TipoCaptura | null>(null);
  if (capturaAberta === "nota" || capturaAberta === "tarefa") ultimoTipoAberto.current = capturaAberta;
  /** Falhas seguidas do autosave (espera crescente entre tentativas) e o rascunho que o servidor recusou de vez (só uma edição nova tenta de novo). */
  const falhasSeguidas = useRef(0);
  const chaveRecusada = useRef<string | null>(null);
  // Sobe a cada captura encerrada: um envio ainda em voo não pode "reviver" o item da captura anterior na próxima.
  const sessaoCaptura = useRef(0);

  useEffect(() => { onTitleChange?.(draft.texto.trim()); }, [draft.texto, onTitleChange]);
  // Texto que não chegou ao servidor na captura anterior: oferece recuperar (uma vez por montagem).
  const ofereceuRecuperar = useRef(false);
  useEffect(() => {
    if ((capturaAberta !== "nota" && capturaAberta !== "tarefa") || ofereceuRecuperar.current) return;
    let guardado: { tipo: "nota" | "tarefa"; draft: CapturaDraft } | null = null;
    try { guardado = JSON.parse(localStorage.getItem(CHAVE_RASCUNHO_FALHA) ?? "null"); } catch { /* cache indisponível */ }
    if (!guardado?.draft?.texto) return;
    ofereceuRecuperar.current = true;
    const { tipo, draft: salvo } = guardado;
    avisar("Há texto que não foi salvo da última vez.", "neutro", {
      rotulo: "Recuperar",
      aoClicar: () => {
        try { localStorage.removeItem(CHAVE_RASCUNHO_FALHA); } catch { /* cache indisponível */ }
        if (tipo !== capturaAberta) trocarTipoCaptura(tipo);
        setDraft({ ...DRAFT_VAZIO, ...salvo });
      },
    });
  }, [capturaAberta, trocarTipoCaptura]);
  // Rascunho de versões antigas: já não é reaberto (toda captura começa em branco), então some.
  useEffect(() => { try { localStorage.removeItem(CHAVE_RASCUNHO); } catch { /* cache indisponível */ } }, []);

  // Cada `abrirCaptura` é uma sessão nova. Se a anterior não chegou a passar por `capturaAberta === null` (fechar e abrir
  // no mesmo ciclo, clique rápido), grava o que ela tinha e começa em branco. Vem antes dos efeitos que aplicam pasta/data/cópia.
  const idVisto = useRef(idCaptura);
  const tipoVisto = useRef(capturaAberta);
  useEffect(() => {
    const mesmoTipo = tipoVisto.current === capturaAberta;
    tipoVisto.current = capturaAberta;
    if (idVisto.current === idCaptura) return;
    idVisto.current = idCaptura;
    if (mesmoTipo) aoDesmontar.current(); // com o tipo trocado junto, o rascunho antigo não casaria com o novo tipo
    padraoAplicado.current = { nota: false, tarefa: false };
    sessaoCaptura.current += 1;
    setDraft(rascunhoVazio());
    setAnexosPendentes([]);
    setNotasPendentes([]);
    setItemCriado(null);
    ultimoEnvio.current = null;
    setErro(null);
  }, [idCaptura, capturaAberta]);

  // Dentro de uma pasta, a Tarefa/Nota nova já nasce nela — uma vez por captura, para não brigar com a escolha da pessoa.
  const contexto = pastaContexto !== undefined ? pastaContexto : pastaDoCaminho(location.pathname);
  const padraoAplicado = useRef({ nota: false, tarefa: false });
  useEffect(() => {
    if (capturaAberta !== "nota" && capturaAberta !== "tarefa") return;
    if (padraoAplicado.current[capturaAberta]) return;
    padraoAplicado.current[capturaAberta] = true;
    // Preferência "Nova tarefa/Nova nota": pasta atual (padrão), uma pasta fixa ou nenhuma.
    const prefs = lerPreferenciasAplicativo();
    const modo = capturaAberta === "tarefa" ? prefs.tarefaNovaPasta : prefs.notaNovaPasta;
    const fixa = (capturaAberta === "tarefa" ? prefs.tarefaNovaPastaFixa : prefs.notaNovaPastaFixa).trim();
    const pasta = modo === "nenhuma" ? null : modo === "fixa" ? (fixa || null) : contexto?.tipo === capturaAberta || contexto?.tipo === "arquivos" ? contexto.pasta : null;
    if (!pasta) return;
    setDraft((d) => (capturaAberta === "tarefa" ? (d.pastaTarefa ? d : { ...d, pastaTarefa: pasta }) : d.pastaNota ? d : { ...d, pastaNota: pasta }));
  }, [capturaAberta, idCaptura, contexto?.tipo, contexto?.pasta]);

  // Padrões que vêm da pasta escolhida: tags (as dela e das de cima, ou a lista manual das preferências) e, nas tarefas,
  // prioridade e duração. Acompanham a pasta enquanto a pessoa troca de pasta; o que ela mesma mexeu fica. Cada captura recomeça do zero.
  const padroesAuto = useRef<{ id: number; tarefa: string[]; nota: string[]; prio: string; dur: number; chave: string }>({ id: -1, tarefa: [], nota: [], prio: "", dur: 0, chave: "" });
  const pastaAtual = capturaAberta === "tarefa" ? draft.pastaTarefa : capturaAberta === "nota" ? draft.pastaNota : null;
  const espacoDaCaptura = (capturaAberta === "tarefa" ? draft.espacoTarefa : capturaAberta === "nota" ? draft.espacoNota : null) ?? espacoAtivo;
  useEffect(() => {
    if (capturaAberta !== "nota" && capturaAberta !== "tarefa") return;
    const tipo = capturaAberta;
    const estado = padroesAuto.current;
    const prefs = lerPreferenciasAplicativo();
    if (estado.id !== idCaptura) { estado.id = idCaptura; estado.tarefa = []; estado.nota = []; estado.prio = prefs.tarefaPrioridade; estado.dur = prefs.tarefaDuracaoMin; estado.chave = ""; }
    const chave = `${tipo}|${pastaAtual ?? ""}|${espacoDaCaptura}`;
    if (estado.chave === chave) return;
    estado.chave = chave;
    const modo = tipo === "tarefa" ? prefs.tarefaNovaTagsModo : prefs.notaNovaTagsModo;
    const global = { prioridade: prefs.tarefaPrioridade, duracao: prefs.tarefaDuracaoMin };
    const aplicar = (lista: string[], padroes: { prioridade: PrioridadeTarefa; duracao: number } = global) => {
      if (estado.chave !== chave) return; // a pasta mudou enquanto a lista vinha: vale a resposta mais nova
      const anteriores = estado[tipo];
      const prioAnterior = estado.prio;
      const durAnterior = estado.dur;
      estado[tipo] = lista;
      estado.prio = padroes.prioridade;
      estado.dur = padroes.duracao;
      setDraft((d) => {
        const atuais = tipo === "tarefa" ? d.tagsTarefa : d.tagsNota;
        const novas = unirTags(atuais.filter((t) => !anteriores.includes(t)), lista);
        let proximo = d;
        if (novas.length !== atuais.length || novas.some((t, i) => t !== atuais[i])) proximo = tipo === "tarefa" ? { ...proximo, tagsTarefa: novas } : { ...proximo, tagsNota: novas };
        if (tipo === "tarefa") {
          if (d.prioridadeTarefa === prioAnterior && d.prioridadeTarefa !== padroes.prioridade) proximo = { ...proximo, prioridadeTarefa: padroes.prioridade };
          if (d.duracaoMin === durAnterior && d.duracaoMin !== padroes.duracao) proximo = { ...proximo, duracaoMin: padroes.duracao };
        }
        return proximo;
      });
    };
    const manual = tipo === "tarefa" ? prefs.tarefaNovaTags : prefs.notaNovaTags;
    if (!pastaAtual || (modo === "manual" && tipo === "nota")) { aplicar(modo === "manual" ? manual : []); return; }
    Promise.resolve().then(() => pastas.listar({ tipo, espaco: espacoDaCaptura, recursivo: true }))
      .then((r) => {
        const propria = r.subpastas.find((p) => p.caminho === pastaAtual);
        const prioridade = (propria?.prioridade_padrao ?? global.prioridade) as PrioridadeTarefa;
        const duracao = propria?.duracao_padrao_min || global.duracao;
        aplicar(modo === "manual" ? manual : tagsPadraoDaPasta(pastaAtual, modo, r.subpastas), { prioridade, duracao });
      })
      .catch(() => aplicar(modo === "manual" ? manual : []));
  }, [capturaAberta, idCaptura, pastaAtual, espacoDaCaptura]);

  // Transação aberta a partir de um dia do calendário nasce naquele dia.
  useEffect(() => {
    if (capturaAberta === "transacao" && dataCaptura) setDraft((d) => ({ ...d, dataTransacao: dataCaptura }));
  }, [capturaAberta, idCaptura, dataCaptura]);

  // Cópia de outro lançamento: já nasce preenchida, para editar antes de salvar.
  useEffect(() => {
    if (capturaAberta === "transacao" && rascunhoCaptura) setDraft((d) => ({ ...d, ...rascunhoCaptura }));
  }, [capturaAberta, idCaptura, rascunhoCaptura]);

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
    setDraft(rascunhoVazio());
    setAnexosPendentes([]);
    setNotasPendentes([]);
    setItemCriado(null);
    ultimoEnvio.current = null;
    try { localStorage.removeItem(CHAVE_RASCUNHO); } catch { /* cache indisponível */ }
    setErro(null);
  }

  // A captura pode ser encerrada por fora (botão voltar, Esc, fechar a janela) sem passar por `fecharTudo`.
  // Criar é sempre criar: a próxima captura não herda texto nem id da anterior (senão sobrescreveria a nota/tarefa antiga).
  useEffect(() => {
    if (capturaAberta !== null || (!itemCriado && ultimoEnvio.current === null && draft === rascunhoVazio())) return;
    // Antes de recomeçar em branco: o que foi digitado nos últimos 600 ms (antes do autosave) também precisa ser gravado.
    const tipoAberto = ultimoTipoAberto.current;
    const faltaGravar = (tipoAberto === "nota" || tipoAberto === "tarefa") && (!!itemCriadoRef.current || podeSalvarAoFechar(draft)) && ultimoEnvio.current !== JSON.stringify({ tipo: tipoAberto, draft });
    if (faltaGravar && tipoAberto) {
      const onde = tipoAberto === "nota" ? "Salvo em Notas" : "Salvo em Tarefas";
      void salvarRef.current(tipoAberto).then((ok) => {
        if (ok) avisar(onde);
        else avisar(`Não consegui salvar a ${tipoAberto}. O texto ficou guardado neste aparelho.`, "erro", { rotulo: "Recuperar", aoClicar: () => abrirCaptura(tipoAberto) });
      });
    } else if (itemCriado) avisar(itemCriado.tipo === "nota" ? "Salvo em Notas" : "Salvo em Tarefas");
    padraoAplicado.current = { nota: false, tarefa: false };
    sessaoCaptura.current += 1;
    setDraft(rascunhoVazio());
    setItemCriado(null);
    ultimoEnvio.current = null;
    setErro(null);
    try { localStorage.removeItem(CHAVE_RASCUNHO); } catch { /* cache indisponível */ }
  }, [capturaAberta, itemCriado, draft]);

  const salvarComo = useCallback(async (tipoForcado?: TipoCaptura): Promise<boolean> => {
    const tipo = (tipoForcado ?? capturaAberta) as TipoCaptura;
    setErro(null);
    // Nota/tarefa sem título mas com texto no corpo passa: o servidor tira o título do começo do corpo.
    if (!draft.texto.trim() && !((tipo === "nota" || tipo === "tarefa") && draft.corpo.trim())) {
      setErro("Preenche o campo principal antes de salvar.");
      return false;
    }
    if (tipo === "transacao" && draft.valorCentavos <= 0) {
      setErro("O valor da transação deve ser maior que zero.");
      return false;
    }
    // Já há um envio em voo: este fica para logo depois, com o texto mais novo (antes era descartado e o final do título se perdia).
    if (envioEmCurso.current) { if (tipo === "nota" || tipo === "tarefa") refazer.current = tipo; return false; }
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
        const criada = await vault.transacoes.criar({
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
        if (anexosPendentes.length || notasPendentes.length) {
          const falhas = [...await enviarAnexosPendentes(criada.id, anexosPendentes), ...await enviarAnexosPendentes(criada.id, notasPendentes, "nota_fiscal")];
          // O lançamento já existe; só os anexos que falharam precisam de nova tentativa (pelo próprio lançamento).
          if (falhas.length) avisar(`Lançamento salvo, mas ${falhas.length === 1 ? "1 anexo não foi enviado" : `${falhas.length} anexos não foram enviados`}: ${falhas[0]} Anexe de novo pelo lançamento.`);
        }
      } else if (tipo === "nota") {
        const dados = payloadReal("nota", draft, draft.espacoNota ?? espacoAtivo);
        const jaCriada = itemCriadoRef.current?.tipo === "nota" ? itemCriadoRef.current : null;
        if (jaCriada) await notas.atualizar(jaCriada.id, dados);
        else {
          const criado = await notas.criar({ ...(dados as { titulo: string; corpo?: string; pasta?: string; tags?: string[] }), titulo: tituloParaCriar(String(dados.titulo ?? ""), String(dados.corpo ?? "")) });
          if (sessao === sessaoCaptura.current) setItemCriado({ tipo: "nota", id: criado.id });
        }
      } else {
        const dados = payloadReal("tarefa", draft, draft.espacoTarefa ?? espacoAtivo);
        const jaCriada = itemCriadoRef.current?.tipo === "tarefa" ? itemCriadoRef.current : null;
        if (jaCriada) await tarefas.atualizar(jaCriada.id, dados);
        else {
          const criado = await tarefas.criar({ ...(dados as unknown as Parameters<typeof tarefas.criar>[0]), titulo: tituloParaCriar(String(dados.titulo ?? ""), String(dados.corpo ?? "")) });
          if (sessao === sessaoCaptura.current) setItemCriado({ tipo: "tarefa", id: criado.id });
        }
      }
      falhasSeguidas.current = 0; chaveRecusada.current = null;
      notificar();
      // Chegou ao servidor: o texto guardado por uma falha anterior não precisa mais ser oferecido (vale mesmo com a
      // captura já fechada, que é o caso do salvar otimista ao fechar).
      if (tipo === "nota" || tipo === "tarefa") {
        try { localStorage.removeItem(CHAVE_RASCUNHO); localStorage.removeItem(CHAVE_RASCUNHO_FALHA); } catch { /* cache indisponível */ }
      }
      if (sessao !== sessaoCaptura.current) return true;
      ultimoEnvio.current = JSON.stringify({ tipo, draft });
      if (tipo === "nota" || tipo === "tarefa") return true;
      fecharTudo();
      if (tipo === "transacao" && location.pathname.startsWith("/cofre")) navigate("/cofre");
      return true;
    } catch (e) {
      setErro(mensagemDeErro(e, "Não consegui falar com o servidor. Confira o endereço e sua conexão."));
      // Falha passageira: o autosave tenta de novo com espera crescente. Recusa do servidor: só uma edição nova tenta de novo.
      falhasSeguidas.current += 1;
      chaveRecusada.current = ehFalhaTransitoria(e) ? null : JSON.stringify({ tipo: capturaAberta, draft });
      // Com o servidor fora do ar, o texto não pode sumir se a janela for fechada: fica neste aparelho até ser recuperado.
      if ((tipo === "nota" || tipo === "tarefa") && (draft.texto.trim() || draft.corpo.trim())) {
        try { localStorage.setItem(CHAVE_RASCUNHO_FALHA, JSON.stringify({ tipo, draft })); } catch { /* cache indisponível */ }
      }
      return false;
    } finally {
      envioEmCurso.current = false;
      setSalvando(false);
      // Havia outro pedido esperando: sai agora, com o texto mais novo.
      const pendente = refazer.current;
      refazer.current = null;
      if (pendente) window.setTimeout(() => { void salvarRef.current(pendente); }, 0);
    }
  }, [capturaAberta, draft, espacoAtivo, fecharTudo, location.pathname, navigate, notificar]);
  salvarRef.current = salvarComo;
  const salvar = useCallback(() => salvarComo(), [salvarComo]);

  // Fechar pelo X: com conteúdo mínimo, grava o que falta e avisa onde ficou; abaixo disso, descarta sem criar nada.
  // Se a gravação falhar, a captura continua aberta (com o erro na tela) em vez de perder o texto.
  // Otimista: a captura fecha na hora e o envio segue em segundo plano. Se falhar, o texto já ficou guardado neste
  // aparelho (CHAVE_RASCUNHO_FALHA) e o aviso oferece reabrir para tentar de novo.
  function encerrar() {
    // Um autosave em andamento ainda pode estar criando o item: espera ele terminar (o render seguinte já conhece o
    // item criado) para não criar de novo nem acusar uma falha que não houve.
    if (envioEmCurso.current) {
      const espera = window.setInterval(() => { if (!envioEmCurso.current) { window.clearInterval(espera); window.setTimeout(() => encerrarRef.current(), 0); } }, 50);
      return;
    }
    const tipo = capturaAberta;
    if ((tipo === "nota" || tipo === "tarefa") && (itemCriado || podeSalvarAoFechar(draft))) {
      const emDia = ultimoEnvio.current === JSON.stringify({ tipo, draft });
      const onde = tipo === "nota" ? "Salvo em Notas" : "Salvo em Tarefas";
      if (emDia) avisar(onde);
      else {
        const envio = salvar();
        void envio.then((ok) => {
          if (ok) avisar(onde);
          else avisar(`Não consegui salvar a ${tipo}. O texto ficou guardado neste aparelho.`, "erro", { rotulo: "Recuperar", aoClicar: () => abrirCaptura(tipo) });
        });
      }
    }
    fecharTudo();
  }
  const encerrarRef = useRef(encerrar);
  encerrarRef.current = encerrar;

  // No desktop o X da janela desmonta este componente (e monta outro do zero): sem passar por `encerrar`, o aviso
  // e a gravação do que ainda estava no intervalo dos 600 ms teriam de acontecer aqui.
  const aoDesmontar = useRef<() => void>(() => {});
  aoDesmontar.current = () => {
    const tipo = capturaAberta;
    if (tipo !== "nota" && tipo !== "tarefa") return;
    if (!itemCriadoRef.current && !podeSalvarAoFechar(draft)) return;
    if (ultimoEnvio.current !== JSON.stringify({ tipo, draft })) void salvar();
    avisar(tipo === "nota" ? "Salvo em Notas" : "Salvo em Tarefas");
  };
  useEffect(() => () => aoDesmontar.current(), []);

  // O item só nasce depois que o título passa do mínimo (uma vez criado, as pausas seguintes o atualizam).
  // O rascunho local é escrito imediatamente, portanto fechar a janela não perde texto.
  useEffect(() => {
    if (capturaAberta !== "nota" && capturaAberta !== "tarefa") return;
    // Com o item já criado, até o título apagado (para reescrever) deixa o corpo seguir salvando.
    if (!draft.texto.trim() && !(itemCriado && draft.corpo.trim())) return;
    if (!itemCriado && !temConteudoMinimo(draft.texto)) return;
    const chave = JSON.stringify({ tipo: capturaAberta, draft });
    if (ultimoEnvio.current === chave || salvando || chaveRecusada.current === chave) return;
    // Depois de uma falha passageira, espera crescente (2 s, 5 s, 15 s, 30 s) em vez de insistir a cada 600 ms.
    const espera = falhasSeguidas.current > 0 ? esperaDoReenvio(falhasSeguidas.current - 1) : 600;
    const timer = window.setTimeout(() => { void salvar(); }, espera);
    return () => window.clearTimeout(timer);
  }, [capturaAberta, draft, itemCriado, salvar, salvando]);

  if (!capturaAberta) return null;

  if (capturaAberta === "evento") {
    return <EventoDialog sobreTudo aberto eventoId={null} categorias={[]} onFechar={fecharTudo} onSalvo={() => { notificar(); fecharTudo(); }} />;
  }

  if (capturaAberta === "escolha") {
    return <ChoicePopup onEscolher={(tipo) => { if (tipo === "evento") abrirCaptura("evento"); else trocarTipoCaptura(tipo); }} onFechar={fecharTudo} />;
  }

  return (
    <FormShell tipoAtivo={capturaAberta} onTrocarTipo={trocarTipoCaptura} onFechar={() => { void encerrar(); }} erro={erro} embedded={embedded} tiposPermitidos={contextoDesktop==="cofre"?["transacao"]:contextoDesktop==="ecos"?(capturaAberta==="transacao"?["transacao"]:["nota","tarefa"]):undefined}>
      {capturaAberta === "nota" && <NoteForm draft={draft} setDraft={setDraft} onSalvar={salvar} salvando={salvando} embedded={embedded} notaId={itemCriado?.tipo === "nota" ? itemCriado.id : undefined} />}
      {capturaAberta === "tarefa" && <TaskForm draft={draft} setDraft={setDraft} onSalvar={salvar} salvando={salvando} embedded={embedded} />}
      {capturaAberta === "transacao" && <TransactionForm draft={draft} setDraft={setDraft} onSalvar={salvar} onFechar={() => { void encerrar(); }} salvando={salvando} anexos={<div className="cofre-anexos-par"><AnexosPendentes arquivos={anexosPendentes} onChange={setAnexosPendentes} /><AnexosPendentes arquivos={notasPendentes} onChange={setNotasPendentes} tipo="nota_fiscal" /></div>} />}
    </FormShell>
  );
}
