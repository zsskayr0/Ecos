import { pastaDoArquivo } from "@/lib/caminho-item";
import { avisar } from "@/lib/toast";
import { exportarDocumentosEmPdf } from "@/lib/exportar-pdf";
import { avisarExcluido } from "@/lib/desfazer";
import { SkeletonNotaDetalhe } from "@/components/common/SkeletonTelas";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";
import { BotaoCopiarCaminho } from "@/components/common/BotaoCopiarCaminho";
import { AlertTriangle, Archive, ArchiveRestore, CheckCircle2, Copy, FileX, PanelRightClose, PanelRightOpen, Trash2, FileDown, PanelRight, X } from "lucide-react";
import { AcoesFocusContext, AcoesJanelaContext, ModoFocusDocumentoContext, PainelFocusControleContext, PainelFocusTarefaContext } from "@/lib/documento-popup";
import { MiniGrafo } from "@/screens/Grafico/MiniGrafo";
import { ApiError, lixeira, notas, type AtualizarNotaPayload } from "@/lib/api";
import { guardarRascunhoNota, lerRascunhoNota, removerRascunhoNota, type RascunhoNota } from "@/lib/offline-store";
import { cabeNoKeepalive, lerConflito, quedaSuspeita, type NotaNoServidor } from "@/lib/nota-sincronia";
import { ConflitoNota } from "@/components/editor/ConflitoNota";
import { HistoricoNota } from "@/components/editor/HistoricoNota";
import { NotasLaterais } from "@/components/editor/NotasLaterais";
import { EVENTO_IR_NOTA } from "@/lib/notas-rodape";
import { OpcoesNota } from "@/components/editor/OpcoesNota";
import { formatDataHoraCompleta } from "@/lib/format";
import { TempoEdicao } from "@/components/common/TempoEdicao";
import { descriptionTags } from "@/lib/task-fields";
import { useRefreshBus } from "@/lib/refresh-bus";
import { AttachmentsField } from "@/components/editor/AttachmentsField";
import { CorpoEditor } from "@/components/editor/CorpoEditor";
import { lerPreferenciasAplicativo } from "@/lib/preferencias-aplicativo";
import { NoteOrganizer } from "@/components/editor/NoteOrganizer";
import { Conexoes } from "@/components/common/Conexoes";
import { EquipeSelector } from "@/components/editor/EquipeSelector";
import { ConfirmDeleteDialog } from "@/components/common/ConfirmDeleteDialog";
import { EmptyState } from "@/components/common/EmptyState";

import { mensagemDeErro } from "@/lib/erros";
import { useAtraso } from "@/lib/use-atraso";
import { PRAZO_CARGA_MS } from "@/components/common/FalhaCarga";
type NotaApi = Awaited<ReturnType<typeof notas.obter>>;

interface CamposNota {
  titulo: string;
  corpo: string;
  /** Só as tags escolhidas na interface — as de `#hashtag` no texto são derivadas do corpo. */
  tags: string[];
  pasta: string | null;
  espaco: string;
}

const iguais = (a: CamposNota, b: CamposNota) => JSON.stringify(a) === JSON.stringify(b);
const tagsFinais = (c: CamposNota) => [...new Set([...c.tags, ...descriptionTags(c.corpo)])];

/** O backend não devolve a pasta: ela vem do caminho do arquivo (ver `pastaDoArquivo`). */
function pastaDoCaminho(caminho: string): string | null {
  return pastaDoArquivo(caminho);
}

function camposDaNota(n: NotaApi): CamposNota {
  const noTexto = descriptionTags(n.corpo);
  return { titulo: n.titulo, corpo: n.corpo, tags: n.tags.filter((t) => !noTexto.includes(t)), pasta: pastaDoCaminho(n.caminho_arquivo), espaco: n.espaco };
}

/** Rascunho do celular só tem título e corpo: o resto vem da nota. */
function aplicarRascunho(original: CamposNota, r: RascunhoNota | undefined): CamposNota {
  if (!r) return original;
  return {
    titulo: r.titulo,
    corpo: r.corpo,
    tags: Array.isArray(r.tags) ? r.tags : original.tags,
    pasta: r.pasta !== undefined ? r.pasta : original.pasta,
    espaco: typeof r.espaco === "string" ? r.espaco : original.espaco,
  };
}

/** Só manda o que mudou: mover de pasta renomeia o arquivo no servidor. */
function montarPayload(atual: CamposNota, base: CamposNota, baseVersao: number | undefined): AtualizarNotaPayload {
  return {
    titulo: atual.titulo,
    corpo: atual.corpo,
    ...(JSON.stringify(tagsFinais(atual)) !== JSON.stringify(tagsFinais(base)) ? { tags: tagsFinais(atual) } : {}),
    ...(atual.pasta !== base.pasta ? { pasta: atual.pasta ?? "" } : {}),
    ...(atual.espaco !== base.espaco ? { espaco: atual.espaco } : {}),
    ...(baseVersao !== undefined ? { base_versao: baseVersao } : {}),
  };
}

const CAMPO_TITULO_FOCUS = "ecos-input min-w-0 flex-1 !rounded-none !border-0 !bg-transparent !shadow-none !px-0 !py-0 font-display !text-[2rem] font-semibold leading-tight text-text-primary placeholder:text-text-muted focus-visible:!outline-none";
const CAMPO_TITULO = "ecos-input min-w-0 flex-1 !rounded-lg border border-border !py-3 !text-xl text-text-primary focus-visible:!outline focus-visible:!outline-2 focus-visible:!outline-steel-400";

/**
 * Nota no desktop, no mesmo padrão da Tarefa: título, pasta e tags à mão,
 * anexos, e o editor — sem botão de salvar (as alterações sincronizam sozinhas
 * logo após uma pausa na digitação e ao fechar).
 */
export function NoteEditorDesktop() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { notificar, versao } = useRefreshBus();
  const modoFocus = useContext(ModoFocusDocumentoContext);
  const painelFocus = useContext(PainelFocusControleContext);
  const montagemPainel = useContext(PainelFocusTarefaContext);
  const acoesFocus = useContext(AcoesFocusContext);
  const acoesJanela = useContext(AcoesJanelaContext);
  const [nota, setNota] = useState<NotaApi | null>(null);
  const [naoEncontrada, setNaoEncontrada] = useState(false);
  const [falhaCarga, setFalhaCarga] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const demorou = useAtraso(!nota && !naoEncontrada && !falhaCarga, PRAZO_CARGA_MS + tentativa);
  const [valor, setValor] = useState<CamposNota | null>(null);
  const [salvo, setSalvo] = useState<CamposNota | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [enviandoAnexo, setEnviandoAnexo] = useState(false);
  const [confirmandoDelete, setConfirmandoDelete] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const raizNota = useRef<HTMLDivElement>(null);
  const valorRef = useRef(valor);
  const salvoRef = useRef(salvo);
  const emCurso = useRef<Promise<void> | null>(null);
  /** Versão do servidor sobre a qual esta tela edita; vai como `base_versao` em cada PATCH. */
  const baseVersaoRef = useRef<number | undefined>(undefined);
  const [conflito, setConflitoEstado] = useState<NotaNoServidor | null>(null);
  const conflitoRef = useRef<NotaNoServidor | null>(null);
  const setConflito = (c: NotaNoServidor | null) => { conflitoRef.current = c; setConflitoEstado(c); };
  /** Corpo encolheu demais: o autosave espera a confirmação. A confirmação vale para a base (`salvo.corpo`) em que foi dada. */
  const [quedaPendente, setQuedaPendente] = useState(false);
  const quedaConfirmadaRef = useRef<string | null>(null);
  const [semRascunhoLocal, setSemRascunhoLocal] = useState(false);
  const semRascunhoRef = useRef(false);
  const gravacaoRascunho = useRef<Promise<boolean> | null>(null);
  const editouRef = useRef(false);
  const [historicoAberto, setHistoricoAberto] = useState(false);
  const [escrevendo, setEscrevendo] = useState(false);
  const [detalhesAbertos, setDetalhesAbertos] = useState(false);
  useEffect(() => { valorRef.current = valor; }, [valor]);
  useEffect(() => { salvoRef.current = salvo; }, [salvo]);

  useEffect(() => {
    if (!id) return;
    let ativo = true;
    setNota(null); setValor(null); setSalvo(null); setNaoEncontrada(false); setFalhaCarga(null); setErro(null); setConflito(null); setQuedaPendente(false);
    quedaConfirmadaRef.current = null;
    Promise.all([notas.obter(id), lerRascunhoNota(id).catch(() => undefined)]).then(([n, rascunhoLido]) => {
      let rascunho = rascunhoLido;
      if (!ativo) return;
      const original = camposDaNota(n);
      // Rascunho totalmente vazio sobre uma nota com conteúdo é resíduo de um estado em branco, nunca uma edição: descarta.
      if (rascunho && !rascunho.titulo.trim() && !rascunho.corpo.trim() && (original.titulo.trim() || original.corpo.trim())) { void removerRascunhoNota(id); rascunho = undefined; }
      // Rascunho escrito sobre uma versão antiga: manda a base antiga, e o servidor acusa o conflito se a nota mudou.
      baseVersaoRef.current = rascunho?.baseVersao ?? n.versao;
      setNota(n); setSalvo(original); setValor(aplicarRascunho(original, rascunho));
    }).catch((e) => {
      if (!ativo) return;
      // Só 404 vira "sumiu"; queda de rede e demais falhas oferecem tentar de novo.
      if (e instanceof ApiError && e.status === 404) setNaoEncontrada(true);
      else setFalhaCarga(e instanceof ApiError && e.code === "CONEXAO_INDISPONIVEL" ? "Sem conexão com o servidor." : "Pode ser uma falha temporária.");
    });
    return () => { ativo = false; };
  }, [id, tentativa]);

  // Exclusão feita fora desta janela (outra aba, outro aparelho, API): confere
  // se a nota ainda existe quando a janela volta ao foco e a cada mudança no app.
  const carregada = !!nota;
  useEffect(() => {
    if (!id || !carregada) return;
    let ativo = true;
    const conferir = () => {
      if (document.visibilityState === "hidden") return;
      notas.obter(id).catch((e) => { if (ativo && e instanceof ApiError && e.status === 404) setNaoEncontrada(true); });
    };
    conferir();
    window.addEventListener("focus", conferir);
    document.addEventListener("visibilitychange", conferir);
    return () => { ativo = false; window.removeEventListener("focus", conferir); document.removeEventListener("visibilitychange", conferir); };
  }, [id, carregada, versao]);

  const [restaurando, setRestaurando] = useState(false);
  const restaurarDaLixeira = async () => {
    setRestaurando(true);
    try {
      const itens = (await lixeira.listar()).filter((i) => i.tipo === "nota");
      const caminho = nota?.caminho_arquivo;
      const titulo = nota?.titulo ?? valorRef.current?.titulo;
      const alvo = itens
        .filter((i) => (caminho && i.caminho_original === caminho) || (!!titulo && i.nome.replace(/\.md$/i, "").endsWith(titulo)))
        .sort((a, b) => b.excluido_em.localeCompare(a.excluido_em))[0];
      if (!alvo) { avisar("Não achei esta nota na Lixeira.", "erro"); return; }
      await lixeira.restaurar(alvo.id);
      avisar("Nota restaurada.", "sucesso");
      notificar();
      setTentativa((t) => t + 1);
    } catch (e) { avisar(mensagemDeErro(e, "Não foi possível restaurar a nota."), "erro"); }
    finally { setRestaurando(false); }
  };

  const sujo = !!valor && !!salvo && !iguais(valor, salvo);

  // Cada edição vai antes para o rascunho no aparelho (IndexedDB); a rede vem depois.
  useEffect(() => {
    if (!id || !valor || !salvo) return;
    if (iguais(valor, salvo)) { void removerRascunhoNota(id); return; }
    if (!valor.titulo.trim() && !valor.corpo.trim() && (salvo.titulo.trim() || salvo.corpo.trim())) return;
    const gravacao = guardarRascunhoNota(id, { ...valor, baseVersao: baseVersaoRef.current });
    gravacaoRascunho.current = gravacao;
    void gravacao.then((ok) => {
      if (gravacaoRascunho.current === gravacao) gravacaoRascunho.current = null;
      semRascunhoRef.current = !ok;
      setSemRascunhoLocal(!ok);
    });
  }, [id, valor, salvo]);

  const sincronizar = useCallback(async () => {
    if (!id) return;
    if (emCurso.current) { await emCurso.current; return sincronizar(); }
    const atual = valorRef.current;
    const base = salvoRef.current;
    if (conflitoRef.current || !atual || !base || !atual.titulo.trim() || iguais(atual, base)) return;
    if (quedaSuspeita(base.corpo, atual.corpo) && quedaConfirmadaRef.current !== base.corpo) { setQuedaPendente(true); return; }
    const pedido = (async () => {
      setSalvando(true); setErro(null);
      try {
        const resposta = await notas.atualizar(id, montarPayload(atual, base, baseVersaoRef.current));
        if (typeof resposta?.versao === "number") baseVersaoRef.current = resposta.versao;
        setSalvo(atual);
        setNota((n) => (n ? { ...n, atualizado_em: new Date().toISOString() } : n));
        if (valorRef.current && iguais(valorRef.current, atual)) void removerRascunhoNota(id);
        notificar();
      } catch (e) {
        // Nota apagada em outro lugar: o servidor recusa (nunca recria); o rascunho local fica guardado.
        if (e instanceof ApiError && e.status === 404) { setNaoEncontrada(true); return; }
        // Mudou em outro lugar desde a nossa base: para o autosave e deixa a pessoa escolher (o rascunho fica).
        if (e instanceof ApiError && e.status === 409) {
          const c = lerConflito(e.dados) ?? await notas.obter(id).then((n) => ({ titulo: n.titulo, corpo: n.corpo, versao: n.versao ?? 0, atualizado_em: n.atualizado_em })).catch(() => null);
          if (c) { setConflito(c); return; }
        }
        setErro(mensagemDeErro(e, "Não foi possível sincronizar as alterações."));
      } finally { setSalvando(false); }
    })();
    emCurso.current = pedido;
    try { await pedido; } finally { emCurso.current = null; }
  }, [id, notificar]);

  useEffect(() => {
    if (!sujo || conflito || quedaPendente) return;
    const timer = window.setTimeout(() => { void sincronizar(); }, 600);
    return () => window.clearTimeout(timer);
  }, [sujo, valor, sincronizar, conflito, quedaPendente]);

  // Fechar a janela/aba: o último envio vai com `keepalive` (sobrevive ao fechamento) quando cabe; acima de ~60 KB
  // vale o rascunho no IndexedDB, e o `beforeunload` segura a saída enquanto ele ainda está sendo gravado.
  useEffect(() => {
    const pendenteNaSaida = () => {
      const atual = valorRef.current, base = salvoRef.current;
      if (!id || !atual || !base || iguais(atual, base)) return null;
      return { atual, base };
    };
    const aoSair = () => {
      const p = pendenteNaSaida();
      if (p && id) {
        void guardarRascunhoNota(id, { ...p.atual, baseVersao: baseVersaoRef.current });
        const bloqueado = !!conflitoRef.current || !p.atual.titulo.trim() || (quedaSuspeita(p.base.corpo, p.atual.corpo) && quedaConfirmadaRef.current !== p.base.corpo);
        if (!bloqueado) notas.atualizarAoSair(id, montarPayload(p.atual, p.base, baseVersaoRef.current));
      }
      if (id && editouRef.current) notas.versoes.fecharAoSair(id);
    };
    const antesDeSair = (e: BeforeUnloadEvent) => {
      const p = pendenteNaSaida();
      if (!p) return;
      const grande = !cabeNoKeepalive(JSON.stringify(montarPayload(p.atual, p.base, baseVersaoRef.current)));
      if (grande && (gravacaoRascunho.current || semRascunhoRef.current)) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("pagehide", aoSair);
    window.addEventListener("beforeunload", antesDeSair);
    return () => {
      window.removeEventListener("pagehide", aoSair);
      window.removeEventListener("beforeunload", antesDeSair);
      // Saiu da nota dentro do app: envia o que faltava e marca um ponto de fechamento no histórico.
      const editou = editouRef.current;
      editouRef.current = false;
      void sincronizar().finally(() => { if (editou && id) void notas.versoes.fechar(id).catch(() => undefined); });
    };
  }, [id, sincronizar]);

  const manterMeu = () => {
    if (!conflito) return;
    baseVersaoRef.current = conflito.versao;
    setConflito(null);
    void sincronizar();
  };
  const usarServidor = () => {
    if (!conflito || !id) return;
    const c = conflito;
    baseVersaoRef.current = c.versao;
    setSalvo((s) => (s ? { ...s, titulo: c.titulo, corpo: c.corpo } : s));
    setValor((v) => (v ? { ...v, titulo: c.titulo, corpo: c.corpo } : v));
    setNota((n) => (n ? { ...n, titulo: c.titulo, corpo: c.corpo, versao: c.versao, atualizado_em: c.atualizado_em ?? n.atualizado_em } : n));
    setConflito(null);
    void removerRascunhoNota(id);
  };
  const confirmarQueda = () => {
    quedaConfirmadaRef.current = salvoRef.current?.corpo ?? null;
    setQuedaPendente(false);
    void sincronizar();
  };
  const desfazerQueda = () => {
    const base = salvoRef.current;
    setQuedaPendente(false);
    if (base) setValor((v) => (v ? { ...v, corpo: base.corpo } : v));
  };
  const aoRestaurarVersao = () => {
    if (!id) return;
    avisar("Versão restaurada.", "sucesso");
    notificar();
    void removerRascunhoNota(id).then(() => setTentativa((t) => t + 1));
  };

  /** Arquivar guarda a nota fora das listas, sem apagar. Arquivada, o mesmo botão desarquiva. */
  async function alternarArquivada() {
    if (!id || !nota) return;
    const arquivada = !nota.arquivada;
    try {
      const r = await notas.arquivar(id, arquivada) as { versao?: number };
      // Arquivar soma versão no servidor: sem atualizar a base, o próximo autosave daria conflito falso.
      baseVersaoRef.current = typeof r?.versao === "number" ? r.versao : (await notas.obter(id).catch(() => null))?.versao ?? baseVersaoRef.current;
      setNota((n) => (n ? { ...n, arquivada } : n));
      notificar();
      avisar(arquivada ? "Nota arquivada." : "Nota desarquivada.", "sucesso");
    } catch (e) { avisar(mensagemDeErro(e, "Não foi possível arquivar a nota."), "erro"); }
  }

  async function marcarRevisado() {
    if (!id) return;
    try {
      const r = await notas.atualizar(id, { marcar_revisado: true, ...(baseVersaoRef.current !== undefined ? { base_versao: baseVersaoRef.current } : {}) });
      if (typeof r?.versao === "number") baseVersaoRef.current = r.versao;
      setNota(await notas.obter(id));
      notificar();
      avisar("Nota marcada como revisada.", "sucesso");
    } catch (e) { avisar(mensagemDeErro(e, "Não foi possível marcar como revisada."), "erro"); }
  }

  async function excluir() {
    if (!id) return;
    setSalvando(true);
    try {
      await notas.excluir(id);
      avisarExcluido("nota", nota?.titulo ?? "", notificar);
      void removerRascunhoNota(id);
      editouRef.current = false;
      notificar();
      navigate(-1);
    } catch (e) {
      setErro(mensagemDeErro(e, "Não foi possível apagar."));
      setSalvando(false);
    }
  }

  async function duplicar() {
    if (!valor) return;
    try {
      const criada = await notas.criar({ titulo: `${valor.titulo} (cópia)`, corpo: valor.corpo, tags: tagsFinais(valor), pasta: valor.pasta ?? undefined, espaco: valor.espaco });
      notificar();
      avisar("Nota duplicada.", "sucesso");
      navigate(`/notas/${criada.id}`);
    } catch (e) { setErro(mensagemDeErro(e, "Não foi possível duplicar a nota.")); }
  }

  const mudar = (patch: Partial<CamposNota>) => { editouRef.current = true; setValor((v) => (v ? { ...v, ...patch } : v)); };

  if (naoEncontrada) {
    // Se a nota estava aberta, foi excluída; se nem carregou, pode só não existir.
    if (!nota) return <div className="ecos-detail-content"><EmptyState icon={FileX} title="Essa nota sumiu." subtitle="Pode ter sido movida ou apagada." /></div>;
    return (
      <div className="ecos-detail-content">
        <EmptyState icon={Trash2} title="Esta nota foi excluída." subtitle="O que você digitou depois ficou guardado neste aparelho."
          action={<button type="button" className="rounded-2xl bg-surface-2 px-4 py-2 text-sm font-medium text-text-primary disabled:opacity-60" disabled={restaurando} onClick={() => void restaurarDaLixeira()}>{restaurando ? "Restaurando…" : "Restaurar da Lixeira"}</button>} />
      </div>
    );
  }
  if (falhaCarga || demorou) {
    return (
      <div className="ecos-detail-content">
        <EmptyState
          icon={AlertTriangle}
          title="Não consegui carregar."
          subtitle={`${falhaCarga ?? "Está demorando mais que o normal."} A nota não foi apagada.`}
          action={<button type="button" onClick={() => setTentativa((t) => t + 1)} className="rounded-2xl bg-surface-2 px-4 py-2 text-sm font-medium text-text-primary">Tentar de novo</button>}
        />
      </div>
    );
  }
  const painelLateral = modoFocus && !!montagemPainel;
  // Clique numa chamada `[^n]`/`[@x]` no editor: abre o menu lateral onde as notas ficam.
  const painelAbertoRef = useRef(painelFocus.aberto);
  painelAbertoRef.current = painelFocus.aberto;
  useEffect(() => {
    const abrir = () => { if (painelLateral) { if (!painelAbertoRef.current) painelFocus.alternar(); } else setDetalhesAbertos(true); };
    window.addEventListener(EVENTO_IR_NOTA, abrir);
    return () => window.removeEventListener(EVENTO_IR_NOTA, abrir);
  }, [painelLateral, painelFocus]);
  if (!nota || !valor) return <div className="ecos-detail-content"><SkeletonNotaDetalhe rotulo="Carregando…" /></div>;

  const noTexto = descriptionTags(valor.corpo);
  const estado = conflito ? "Conflito: escolha uma versão" : quedaPendente ? "Aguardando confirmação" : erro ? "Erro ao sincronizar" : salvando ? "Salvando…" : sujo ? "Alterações pendentes" : "Salvo";

  const aoMudarEscrita = (v: boolean) => { setEscrevendo(v); if (!v) setDetalhesAbertos(false); };
  const noPainel = modoFocus && !!montagemPainel;
  const exportarPdfDaNota = () => { if (id) void exportarDocumentosEmPdf([{ tipo: "nota", id }]).catch((e) => avisar(mensagemDeErro(e, "Não foi possível exportar o PDF."), "erro")); };
  const opcoesNota = (classeBotao: string) => <OpcoesNota criadoEm={nota.criado_em} atualizadoEm={nota.atualizado_em} estado={enviandoAnexo ? "Enviando anexo…" : estado} erro={!!erro} revisada={!!nota.ultima_revisao_em} onRevisar={marcarRevisado} onExportarPdf={exportarPdfDaNota} onHistorico={() => setHistoricoAberto(true)} classeBotao={classeBotao}
    anexos={noPainel ? undefined : <AttachmentsField tipo="nota" espaco={valor.espaco} itemId={id} corpo={valor.corpo} onCorpoChange={(corpo) => mudar({ corpo })} onBusyChange={setEnviandoAnexo} disabled={salvando} compact />} />;
  const rotuloPainel = painelFocus.aberto ? "Recolher painel lateral" : "Expandir painel lateral";
  return (
    <div className="ecos-detail-page min-w-0" style={{ "--ecos-editor-sticky-top": "0px" } as React.CSSProperties}>
      {!modoFocus && acoesJanela && createPortal(<BotaoCopiarCaminho variante="pequeno" tipo="nota" espaco={valor.espaco} pasta={valor.pasta} titulo={valor.titulo} />, acoesJanela)}
      {modoFocus && acoesFocus && createPortal(
        <>
          <BotaoCopiarCaminho variante="pequeno" tipo="nota" espaco={valor.espaco} pasta={valor.pasta} titulo={valor.titulo} />
          <button type="button" onClick={exportarPdfDaNota} aria-label="Exportar PDF" title="Exportar PDF" className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-3 hover:text-text-primary"><FileDown size={15} /></button>
          {opcoesNota("flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-3 hover:text-text-primary")}
          <button type="button" disabled={salvando} onClick={() => void alternarArquivada()} aria-pressed={!!nota?.arquivada} aria-label={nota?.arquivada ? "Desarquivar nota" : "Arquivar nota"} title={nota?.arquivada ? "Desarquivar nota" : "Arquivar nota"} className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-3 hover:text-text-primary disabled:opacity-40">{nota?.arquivada ? <ArchiveRestore size={15} /> : <Archive size={15} />}</button>
          <button type="button" disabled={salvando} onClick={() => setConfirmandoDelete(true)} aria-label="Apagar nota" title="Apagar nota" className="flex h-7 w-7 items-center justify-center rounded-md text-error transition-colors hover:bg-error/15 disabled:opacity-40"><Trash2 size={15} /></button>
          <button type="button" onClick={painelFocus.alternar} aria-pressed={painelFocus.aberto} aria-label={rotuloPainel} title={rotuloPainel} className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-3 hover:text-text-primary">{painelFocus.aberto ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}</button>
          <span aria-hidden className="mx-1 h-4 w-px bg-border" />
        </>,
        acoesFocus,
      )}
      {noPainel && id && createPortal(
        <aside aria-label="Opções da nota" className="flex min-w-0 flex-col gap-6">
          <h2 className="font-display text-lg font-semibold text-text-primary">Opções</h2>
          <MiniGrafo itemId={id} />
          <div className="border-t border-border pt-6 empty:hidden"><NotasLaterais corpo={valor.corpo} /></div>
          <section className="space-y-4 border-t border-border pt-6">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Organização</h2>
            <EquipeSelector espaco={valor.espaco} onChange={(espaco) => mudar({ espaco, pasta: null })} disabled={salvando} />
            <NoteOrganizer espaco={valor.espaco} pasta={valor.pasta} onPasta={(pasta) => mudar({ pasta })} tags={valor.tags} tagsNoTexto={noTexto} onTags={(tags) => mudar({ tags })} disabled={salvando && !sujo} />
          </section>
          <section className="border-t border-border pt-6" aria-label="Anexos">
            <AttachmentsField tipo="nota" espaco={valor.espaco} itemId={id} corpo={valor.corpo} onCorpoChange={(corpo) => mudar({ corpo })} onBusyChange={setEnviandoAnexo} disabled={salvando} escopoRef={raizNota} estilo="grade" compact />
          </section>
          <section aria-label="Informações" className="space-y-2 border-t border-border pt-6 text-sm text-text-secondary">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Informações</h2>
            <p>Criada em {formatDataHoraCompleta(nota.criado_em)}</p>
            <p>Editada <TempoEdicao iso={nota.atualizado_em} /></p>
            <p aria-live="polite" className={erro ? "text-error" : "text-text-muted"}>{enviandoAnexo ? "Enviando anexo…" : estado}</p>
          </section>
          <section className="space-y-3 border-t border-border pt-6">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Ações</h2>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={salvando} onClick={() => void duplicar()} className="flex min-h-[44px] items-center gap-2 rounded-xl border border-border px-3 text-sm text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary disabled:opacity-40"><Copy size={16} />Duplicar nota</button>
              {!nota.ultima_revisao_em && <button type="button" onClick={marcarRevisado} className="flex min-h-[44px] items-center gap-2 rounded-xl border border-border px-3 text-sm text-steel-300 transition-colors hover:bg-surface-2 hover:text-text-primary"><CheckCircle2 size={16} />Marcar revisada</button>}
            </div>
          </section>
        </aside>,
        montagemPainel!,
      )}
      <div className="ecos-detail-content">
        {erro && <div role="alert" className="mb-5 flex items-start gap-2 rounded-xl border border-error/40 bg-error/10 p-3 text-sm text-error"><AlertTriangle size={17} className="mt-0.5 shrink-0" />{erro}</div>}
        {semRascunhoLocal && <div role="status" className="mb-5 flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-text-primary"><AlertTriangle size={17} className="mt-0.5 shrink-0 text-warning" />Não foi possível guardar o rascunho neste aparelho. Evite fechar a nota antes de aparecer “Salvo”.</div>}
        {conflito && <ConflitoNota servidor={conflito} meuTitulo={valor.titulo} meuCorpo={valor.corpo} ocupado={salvando} onManterMeu={manterMeu} onUsarServidor={usarServidor} />}
        <ConfirmDeleteDialog open={confirmandoDelete} title="Apagar esta nota?" busy={salvando} onCancel={() => setConfirmandoDelete(false)} onConfirm={excluir} />
        <ConfirmDeleteDialog open={quedaPendente} title="Apagar quase todo o texto?" busy={salvando} onCancel={desfazerQueda} onConfirm={confirmarQueda}
          description="O texto da nota ficou vazio ou bem menor de uma vez. Confirme para salvar assim, ou cancele para voltar o texto como estava." confirmLabel="Salvar assim" busyLabel="Salvando…" />
        {id && <HistoricoNota notaId={id} aberto={historicoAberto} onFechar={() => setHistoricoAberto(false)} onRestaurada={aoRestaurarVersao} />}

        <div ref={raizNota} className="flex min-w-0 flex-col gap-4">
          <div className={`flex min-w-0 items-center gap-3 ${modoFocus ? "border-b border-border pb-2" : ""} ${escrevendo && modoFocus ? "px-6 pt-4" : ""}`}>
            <input aria-label="Título da nota" value={valor.titulo} onChange={(e) => mudar({ titulo: e.target.value })} placeholder="Título da nota" className={modoFocus ? CAMPO_TITULO_FOCUS : CAMPO_TITULO} />
            {!modoFocus && !acoesJanela && <BotaoCopiarCaminho variante="icone" tipo="nota" espaco={valor.espaco} pasta={valor.pasta} titulo={valor.titulo} />}
            {!modoFocus && escrevendo && !noPainel && <button type="button" onClick={() => setDetalhesAbertos((v) => !v)} aria-pressed={detalhesAbertos} aria-label="Detalhes da nota" title="Detalhes: pasta, tags, equipe e conexões" className="flex min-h-[52px] min-w-[52px] shrink-0 items-center justify-center rounded-xl border border-border text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary aria-pressed:bg-surface-2"><PanelRight size={17} /></button>}
            {!modoFocus && opcoesNota("flex min-h-[52px] min-w-[52px] shrink-0 items-center justify-center rounded-xl border border-border text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary")}
            {!modoFocus && <button type="button" disabled={salvando} onClick={() => void duplicar()} aria-label="Duplicar nota" title="Duplicar nota" className="flex min-h-[52px] min-w-[52px] shrink-0 items-center justify-center rounded-xl border border-border text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary disabled:opacity-40"><Copy size={17} /></button>}
            {!modoFocus && <button type="button" disabled={salvando} onClick={() => void alternarArquivada()} aria-pressed={!!nota?.arquivada} aria-label={nota?.arquivada ? "Desarquivar nota" : "Arquivar nota"} title={nota?.arquivada ? "Desarquivar nota" : "Arquivar nota"} className="flex min-h-[52px] min-w-[52px] shrink-0 items-center justify-center rounded-xl border border-border text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary disabled:opacity-40">{nota?.arquivada ? <ArchiveRestore size={17} /> : <Archive size={17} />}</button>}
            {!modoFocus && <button type="button" disabled={salvando} onClick={() => setConfirmandoDelete(true)} aria-label="Apagar nota" title="Apagar nota" className="flex min-h-[52px] min-w-[52px] shrink-0 items-center justify-center rounded-xl border border-error text-error transition-colors hover:bg-error hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-error disabled:opacity-40"><Trash2 size={18} /></button>}
          </div>

          {!noPainel && !escrevendo && <div className="flex min-w-0 flex-col gap-4"><NoteOrganizer espaco={valor.espaco} pasta={valor.pasta} onPasta={(pasta) => mudar({ pasta })} tags={valor.tags} tagsNoTexto={noTexto} onTags={(tags) => mudar({ tags })} disabled={salvando && !sujo} />
            <EquipeSelector espaco={valor.espaco} onChange={(espaco) => mudar({ espaco, pasta: null })} disabled={salvando} /></div>}

          <CorpoEditor tipo="nota" itemId={id} espaco={valor.espaco} corpo={valor.corpo} onCorpoChange={(corpo) => mudar({ corpo })} rows={modoFocus ? 18 : 14} layout="document" semBorda={modoFocus} placeholder="Escreva sua nota… Use #tags e [[links]] para conectar ideias." initialPreview={!lerPreferenciasAplicativo().notaAbreEditando} tintaNotaId={id} aoMudarEscrita={aoMudarEscrita} />

          {!escrevendo && <Conexoes tipo="nota" id={id} versao={nota.atualizado_em} />}
          {escrevendo && detalhesAbertos && !noPainel && id && (
            <aside aria-label="Detalhes da nota" className="fixed bottom-0 right-0 top-9 z-40 flex w-[min(22rem,100%)] flex-col gap-5 overflow-y-auto border-l border-border bg-surface-1 p-4 shadow-2xl">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-base font-semibold text-text-primary">Detalhes</h2>
                <button type="button" onClick={() => setDetalhesAbertos(false)} aria-label="Fechar detalhes" className="flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-3 hover:text-text-primary"><X size={16} /></button>
              </div>
              <NoteOrganizer espaco={valor.espaco} pasta={valor.pasta} onPasta={(pasta) => mudar({ pasta })} tags={valor.tags} tagsNoTexto={noTexto} onTags={(tags) => mudar({ tags })} disabled={salvando && !sujo} />
              <EquipeSelector espaco={valor.espaco} onChange={(espaco) => mudar({ espaco, pasta: null })} disabled={salvando} />
              <NotasLaterais corpo={valor.corpo} />
              <p className="text-xs text-text-muted">{valor.corpo.trim() ? valor.corpo.trim().split(/\s+/).length : 0} palavras · {valor.corpo.length} caracteres</p>
              <Conexoes tipo="nota" id={id} versao={nota.atualizado_em} />
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
