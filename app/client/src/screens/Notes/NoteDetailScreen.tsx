import { avisar } from "@/lib/toast";
import { avisarExcluido } from "@/lib/desfazer";
import { SkeletonNotaDetalhe } from "@/components/common/SkeletonTelas";
import { useContext, useEffect, useRef, useState } from "react";
import { lerPreferenciasAplicativo } from "@/lib/preferencias-aplicativo";
import { useNavigate, useParams } from "react-router-dom";
import { ChipTag } from "@/components/common/ChipTag";
import { Archive, ArchiveRestore, Eye, Hash, Plus, Type, Trash2, CheckCircle2, AlertTriangle, FileX } from "lucide-react";
import { DetailHeader, DETAIL_ACTION } from "@/components/layout/DetailHeader";
import { notas, ApiError } from "@/lib/api";
import { guardarRascunhoNota, lerRascunhoNota, removerRascunhoNota } from "@/lib/offline-store";
import { cabeNoKeepalive, lerConflito, quedaSuspeita, type NotaNoServidor } from "@/lib/nota-sincronia";
import { conflitoFalso, ehFalhaTransitoria, tituloEfetivo, useReenvioAutomatico } from "@/lib/salvamento-otimista";
import { ConflitoNota } from "@/components/editor/ConflitoNota";
import { HistoricoNota } from "@/components/editor/HistoricoNota";
import { TempoEdicao } from "@/components/common/TempoEdicao";
import { formatDataHoraCompleta } from "@/lib/format";
import { MarkdownPreview } from "@/lib/markdown-mini";
import { EmptyState } from "@/components/common/EmptyState";
import { ConfirmDeleteDialog } from "@/components/common/ConfirmDeleteDialog";
import { CorpoEditor } from "@/components/editor/CorpoEditor";
import { LeituraComTinta } from "@/components/tinta/LeituraComTinta";
import { RESERVA_TOPO_PX } from "@/components/tinta/PaletaFlutuante";
import { SeletorVisualizacao } from "@/components/editor/SeletorVisualizacao";
import { lembrarModoDaNota, modoInicialDaNota, type ModoVisualNota } from "@/lib/modo-visual-nota";
import { preservandoScroll } from "@/lib/preservar-scroll";
import { AtalhoTema } from "@/components/editor/AtalhoTema";
import { OpcoesNota } from "@/components/editor/OpcoesNota";
import { AttachmentsField } from "@/components/editor/AttachmentsField";
import { useRefreshBus } from "@/lib/refresh-bus";
import { TituloJanelaContext } from "@/lib/documento-popup";
import { useIsDesktop } from "@/lib/use-viewport";
import { NoteEditorDesktop } from "./NoteEditorDesktop";
import { BotaoCopiarCaminho } from "@/components/common/BotaoCopiarCaminho";
import { pastaDoArquivoDeNota } from "@/lib/caminho-item";

import { mensagemDeErro } from "@/lib/erros";
import { useAtraso } from "@/lib/use-atraso";
import { PRAZO_CARGA_MS } from "@/components/common/FalhaCarga";
interface NotaCompleta {
  arquivada?: boolean;
  id: string;
  titulo: string;
  tags: string[];
  espaco?: string;
  caminho_arquivo?: string;
  criado_em: string;
  atualizado_em: string;
  ultima_revisao_em: string | null;
  corpo: string;
  versao?: number;
}

/**
 * Real read + edit of a Nota (`GET`/`PATCH`/`DELETE /notas/:id`).
 * GAP-02: not one of the 12 screens in the inventory (which only
 * specifies the card and the Capture form) — built as the honest, minimal
 * destination for tapping the card, reusing the editor's Markdown preview
 * (section 3.6). Non-critical delete here — light humor is allowed
 * (section 1.4).
 */
function NoteDetailMobile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { notificar } = useRefreshBus();
  const definirTituloJanela = useContext(TituloJanelaContext);
  const [nota, setNota] = useState<NotaCompleta | null>(null);
  const [naoEncontrada, setNaoEncontrada] = useState(false);
  const [falhaCarga, setFalhaCarga] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const demorou = useAtraso(!nota && !naoEncontrada && !falhaCarga, PRAZO_CARGA_MS + tentativa);
  const [editando, setEditando] = useState(false);
  /** Janela da animação de saída da barra de formatação, antes de a edição dar lugar à visualização. */
  const [fechando, setFechando] = useState(false);
  const timerFechar = useRef(0);
  const anexarRef = useRef<(() => void) | null>(null);
  const [pulsoAnexo, setPulsoAnexo] = useState(false);
  /** Giro no hover de mouse ou caneta (o hover de CSS não vale na caneta); toque não gira, para não ficar preso. */
  const [giraAnexo, setGiraAnexo] = useState(false);
  // Modo Fluido/Página: a leitura e a edição seguem o mesmo (padrão das configurações; uma troca vale por 2 minutos depois de fechar a nota).
  const [modoNota, setModoNota] = useState<ModoVisualNota>(() => modoInicialDaNota(id, "leitura"));
  const [temTintaLeitura, setTemTintaLeitura] = useState(false);
  useEffect(() => { if (!editando) setModoNota(modoInicialDaNota(id, "leitura")); }, [editando, id]);
  const escolherModoNota = (m: ModoVisualNota) => { setModoNota(m); if (id) lembrarModoDaNota(id, "leitura", m); };
  const [tituloEdit, setTituloEdit] = useState("");
  const [corpoEdit, setCorpoEdit] = useState("");
  const [confirmandoDelete, setConfirmandoDelete] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [enviandoAnexo, setEnviandoAnexo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  /** Versão do servidor sobre a qual se edita; vai como `base_versao` em cada PATCH. */
  const baseVersaoRef = useRef<number | undefined>(undefined);
  const [conflito, setConflito] = useState<NotaNoServidor | null>(null);
  const [quedaPendente, setQuedaPendente] = useState(false);
  /** A confirmação de "apagar quase tudo" vale para o corpo salvo em que foi dada. */
  const quedaConfirmadaRef = useRef<string | null>(null);
  const [semRascunhoLocal, setSemRascunhoLocal] = useState(false);
  const gravacaoRascunho = useRef<Promise<boolean> | null>(null);
  const editouRef = useRef(false);
  const [historicoAberto, setHistoricoAberto] = useState(false);
  // Últimos valores para o `pagehide` (que roda fora do ciclo do React).
  const atualRef = useRef({ editando, tituloEdit, corpoEdit, nota, conflito, semRascunhoLocal });
  atualRef.current = { editando, tituloEdit, corpoEdit, nota, conflito, semRascunhoLocal };

  useEffect(() => {
    if (!id) return;
    let ativo = true;
    setNaoEncontrada(false);
    setFalhaCarga(null);
    notas
      .obter(id)
      .then((n) => { if (ativo) { baseVersaoRef.current = n.versao; setNota(n); } })
      .catch((e) => {
        if (!ativo) return;
        // Só 404 vira "sumiu"; queda de rede e demais falhas oferecem tentar de novo.
        if (e instanceof ApiError && e.status === 404) setNaoEncontrada(true);
        else setFalhaCarga(e instanceof ApiError && e.code === "CONEXAO_INDISPONIVEL" ? "Sem conexão com o servidor." : "Pode ser uma falha temporária.");
      });
    return () => { ativo = false; };
  }, [id, tentativa]);

  useEffect(() => { definirTituloJanela?.((editando ? tituloEdit : nota?.titulo ?? "").trim()); }, [definirTituloJanela, editando, nota?.titulo, tituloEdit]);

  /** 409: monta o "o que está no servidor" (do corpo do erro ou, se faltar, relendo a nota). */
  async function tratarConflito(e: unknown, base?: { titulo: string; corpo: string }, atual?: { titulo: string; corpo: string }): Promise<boolean | "falso"> {
    if (!id || !(e instanceof ApiError) || e.status !== 409) return false;
    const c = lerConflito(e.dados) ?? await notas.obter(id).then((n) => ({ titulo: n.titulo, corpo: n.corpo, versao: n.versao ?? 0, atualizado_em: n.atualizado_em })).catch(() => null);
    if (!c) return false;
    // Só a versão subiu (fila offline enviada depois, arquivar/revisar em outro lugar): adota e salva de novo, sem perguntar.
    if (base && atual && conflitosFalsos.current < 3 && conflitoFalso(c, base, atual)) { conflitosFalsos.current += 1; baseVersaoRef.current = c.versao; return "falso"; }
    setConflito(c);
    return true;
  }
  const conflitosFalsos = useRef(0);
  /** Falha que passa sozinha (limite de pedidos, servidor ocupado): o salvamento insiste sem a pessoa digitar de novo. */
  const [falhaPassageira, setFalhaPassageira] = useState(false);

  // Rascunho no aparelho (IndexedDB) imediato + envio após uma pequena pausa; voltar ou fechar
  // não descarta o texto enquanto o servidor estiver disponível.
  useEffect(() => {
    if (!editando || !id || !nota || (tituloEfetivo(tituloEdit, nota.titulo) === nota.titulo && corpoEdit === nota.corpo)) return;
    editouRef.current = true;
    // Título em branco não é uma edição a enviar (o servidor manteria o atual): o corpo segue salvando normalmente.
    const gravacao = guardarRascunhoNota(id, { titulo: tituloEfetivo(tituloEdit, nota.titulo), corpo: corpoEdit, baseVersao: baseVersaoRef.current });
    gravacaoRascunho.current = gravacao;
    void gravacao.then((ok) => { if (gravacaoRascunho.current === gravacao) gravacaoRascunho.current = null; setSemRascunhoLocal(!ok); });
    if (conflito || quedaPendente) return;
    const timer = window.setTimeout(async () => {
      if (quedaSuspeita(nota.corpo, corpoEdit) && quedaConfirmadaRef.current !== nota.corpo) { setQuedaPendente(true); return; }
      setSalvando(true); setErro(null); setFalhaPassageira(false);
      try {
        const r = await notas.atualizar(id, { ...(tituloEdit.trim() && tituloEdit !== nota.titulo ? { titulo: tituloEdit } : {}), ...(corpoEdit !== nota.corpo ? { corpo: corpoEdit } : {}), ...(baseVersaoRef.current !== undefined ? { base_versao: baseVersaoRef.current } : {}) });
        if (typeof r?.versao === "number") baseVersaoRef.current = r.versao;
        conflitosFalsos.current = 0;
        setNota((atual) => atual ? { ...atual, titulo: tituloEfetivo(tituloEdit, atual.titulo), corpo: corpoEdit, versao: baseVersaoRef.current } : atual);
        void removerRascunhoNota(id);
        notificar();
      } catch (e) {
        const tratado = await tratarConflito(e, nota, { titulo: tituloEdit, corpo: corpoEdit });
        // Falso conflito: a base nova já foi adotada; trocar o objeto da nota reexecuta este efeito e salva de novo.
        if (tratado === "falso") setNota((atual) => (atual ? { ...atual } : atual));
        else if (!tratado) { setErro(mensagemDeErro(e, "Não foi possível sincronizar as alterações.")); setFalhaPassageira(ehFalhaTransitoria(e)); }
      }
      finally { setSalvando(false); }
    }, 600);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, nota, editando, tituloEdit, corpoEdit, notificar, conflito, quedaPendente]);
  // Falha passageira: reexecuta o efeito acima com espera crescente, sem a pessoa precisar digitar de novo.
  useReenvioAutomatico(falhaPassageira && !conflito && !quedaPendente, () => setNota((atual) => (atual ? { ...atual } : atual)));

  // Fechar a página: último envio com `keepalive` quando cabe (< 60 KB); acima disso vale o rascunho no IndexedDB,
  // e o `beforeunload` segura a saída enquanto ele ainda está sendo gravado. Sair da nota marca um ponto no histórico.
  useEffect(() => {
    if (!id) return;
    const pendente = () => {
      const a = atualRef.current;
      if (!a.editando || !a.nota || (tituloEfetivo(a.tituloEdit, a.nota.titulo) === a.nota.titulo && a.corpoEdit === a.nota.corpo)) return null;
      return a;
    };
    const payload = (a: NonNullable<ReturnType<typeof pendente>>) => ({
      ...(a.tituloEdit.trim() && a.nota && a.tituloEdit !== a.nota.titulo ? { titulo: a.tituloEdit } : {}),
      ...(a.nota && a.corpoEdit !== a.nota.corpo ? { corpo: a.corpoEdit } : {}),
      ...(baseVersaoRef.current !== undefined ? { base_versao: baseVersaoRef.current } : {}),
    });
    const aoSair = () => {
      const a = pendente();
      if (a && a.nota) {
        void guardarRascunhoNota(id, { titulo: tituloEfetivo(a.tituloEdit, a.nota.titulo), corpo: a.corpoEdit, baseVersao: baseVersaoRef.current });
        const bloqueado = !!a.conflito || (quedaSuspeita(a.nota.corpo, a.corpoEdit) && quedaConfirmadaRef.current !== a.nota.corpo);
        if (!bloqueado) notas.atualizarAoSair(id, payload(a));
      }
      if (editouRef.current) notas.versoes.fecharAoSair(id);
    };
    const antesDeSair = (e: BeforeUnloadEvent) => {
      const a = pendente();
      if (a && !cabeNoKeepalive(JSON.stringify(payload(a))) && (gravacaoRascunho.current || a.semRascunhoLocal)) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("pagehide", aoSair);
    window.addEventListener("beforeunload", antesDeSair);
    return () => {
      window.removeEventListener("pagehide", aoSair);
      window.removeEventListener("beforeunload", antesDeSair);
      if (editouRef.current) void notas.versoes.fechar(id).catch(() => undefined);
      editouRef.current = false;
    };
  }, [id]);

  /** Otimista: a edição abre na hora com o texto da nota; o rascunho do aparelho (IndexedDB) é lido em seguida e só entra se a pessoa ainda não mexeu. */
  function entrarEdicao() {
    if (!nota) return;
    setTituloEdit(nota.titulo); setCorpoEdit(nota.corpo);
    preservandoScroll(document.querySelector(".ecos-detail-content"), () => setEditando(true));
    if (!id) return;
    void lerRascunhoNota(id).catch(() => undefined).then((lido) => {
      // Rascunho sem título ou todo vazio sobre uma nota com conteúdo é resíduo de um estado em branco, nunca uma edição: descarta.
      const r = lido && (!lido.titulo.trim() || (!lido.corpo.trim() && nota.corpo.trim())) ? undefined : lido;
      if (lido && !r) void removerRascunhoNota(id);
      if (!r) return;
      const a = atualRef.current;
      if (a.tituloEdit !== nota.titulo || a.corpoEdit !== nota.corpo) return; // já começou a editar: o texto da pessoa vale mais
      // Rascunho escrito sobre versão antiga: a base antiga faz o servidor acusar o conflito se a nota mudou.
      if (r.baseVersao !== undefined) baseVersaoRef.current = r.baseVersao;
      setTituloEdit(r.titulo); setCorpoEdit(r.corpo);
    });
  }

  const manterMeu = () => {
    if (!conflito) return;
    baseVersaoRef.current = conflito.versao;
    setConflito(null); // o efeito de autosave roda de novo com a base nova
  };
  const usarServidor = () => {
    if (!conflito || !id) return;
    const c = conflito;
    baseVersaoRef.current = c.versao;
    setNota((n) => (n ? { ...n, titulo: c.titulo, corpo: c.corpo, versao: c.versao, atualizado_em: c.atualizado_em ?? n.atualizado_em } : n));
    setTituloEdit(c.titulo); setCorpoEdit(c.corpo);
    setConflito(null);
    void removerRascunhoNota(id);
  };
  const confirmarQueda = () => { quedaConfirmadaRef.current = nota?.corpo ?? null; setQuedaPendente(false); };
  const desfazerQueda = () => { setQuedaPendente(false); if (nota) setCorpoEdit(nota.corpo); };

  const jaAbriu = useRef<string | null>(null);
  useEffect(() => {
    if (!nota || jaAbriu.current === nota.id) return;
    jaAbriu.current = nota.id;
    if (lerPreferenciasAplicativo().notaAbreEditando) { entrarEdicao(); return; }
    // Nota com escrita à mão abre direto na edição (o CorpoEditor entra no Modo de escrita), sem passar pela leitura.
    const abrindo = nota.id;
    void notas.tinta.obter(abrindo).then((t) => { if (jaAbriu.current === abrindo && t.tracos.some((x) => !x.apagado_em)) entrarEdicao(); }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nota]);

  /** Otimista: a tela já volta à visualização com o texto novo; o envio segue em segundo plano. Se falhar, volta à edição com o texto intacto. */
  async function salvar() {
    if (!id || !nota) return;
    setErro(null);
    if (conflito) { setErro("Escolha antes qual versão manter."); return; }
    if (quedaSuspeita(nota.corpo, corpoEdit) && quedaConfirmadaRef.current !== nota.corpo) { setQuedaPendente(true); return; }
    // Título em branco não renomeia: a nota guarda o que já tinha (o servidor faz o mesmo).
    const titulo = tituloEfetivo(tituloEdit, nota.titulo), corpo = corpoEdit, anterior = nota;
    setSalvando(true);
    setNota({ ...nota, titulo, corpo });
    setFechando(true);
    window.clearTimeout(timerFechar.current);
    timerFechar.current = window.setTimeout(() => { setFechando(false); preservandoScroll(document.querySelector(".ecos-detail-content"), () => setEditando(false)); }, 50);
    const voltarParaEdicao = (msg: string | null) => { window.clearTimeout(timerFechar.current); setFechando(false); setNota(anterior); setTituloEdit(titulo); setCorpoEdit(corpo); setEditando(true); if (msg) setErro(msg); };
    try {
      const enviar = () => notas.atualizar(id, { ...(titulo !== anterior.titulo ? { titulo } : {}), ...(corpo !== anterior.corpo ? { corpo } : {}), ...(baseVersaoRef.current !== undefined ? { base_versao: baseVersaoRef.current } : {}) });
      try {
        await enviar();
      } catch (e) {
        const tratado = await tratarConflito(e, anterior, { titulo, corpo });
        if (tratado === "falso") await enviar(); // só a versão tinha subido: a base nova já foi adotada
        else if (tratado) { voltarParaEdicao(null); return; }
        else throw e;
      }
      const atualizada = await notas.obter(id);
      baseVersaoRef.current = atualizada.versao;
      setNota((n) => (n && n.titulo === titulo && n.corpo === corpo ? atualizada : n));
      void removerRascunhoNota(id);
      notificar();
    } catch (e) {
      voltarParaEdicao(mensagemDeErro(e, "Não consegui salvar a nota. Confira sua conexão e tente de novo."));
    } finally {
      setSalvando(false);
    }
  }

  /** Arquivar guarda a nota fora das listas, sem apagar. Arquivada, o mesmo botão desarquiva. Otimista: muda na hora e desfaz se o servidor recusar. */
  async function alternarArquivada() {
    if (!id || !nota) return;
    const arquivada = !nota.arquivada;
    setNota((n) => (n ? { ...n, arquivada } : n));
    avisar(arquivada ? "Nota arquivada." : "Nota desarquivada.", "sucesso");
    try {
      const r = await notas.arquivar(id, arquivada) as { versao?: number };
      // Arquivar soma versão no servidor: sem atualizar a base, o próximo autosave daria conflito falso.
      baseVersaoRef.current = typeof r?.versao === "number" ? r.versao : (await notas.obter(id).catch(() => null))?.versao ?? baseVersaoRef.current;
      notificar();
    } catch (e) {
      setNota((n) => (n ? { ...n, arquivada: !arquivada } : n));
      avisar(mensagemDeErro(e, "Não foi possível arquivar a nota."), "erro");
    }
  }

  async function marcarRevisado() {
    if (!id || !nota) return;
    const anterior = nota.ultima_revisao_em;
    setNota((n) => (n ? { ...n, ultima_revisao_em: new Date().toISOString() } : n));
    avisar("Nota marcada como revisada.", "sucesso");
    try {
      const r = await notas.atualizar(id, { marcar_revisado: true, ...(baseVersaoRef.current !== undefined ? { base_versao: baseVersaoRef.current } : {}) });
      if (typeof r?.versao === "number") baseVersaoRef.current = r.versao;
      const atualizada = await notas.obter(id);
      setNota((n) => (n && editando ? { ...atualizada, titulo: n.titulo, corpo: n.corpo } : atualizada));
      notificar();
    } catch (e) {
      setNota((n) => (n ? { ...n, ultima_revisao_em: anterior } : n));
      avisar(mensagemDeErro(e, "Não foi possível marcar como revisada."), "erro");
    }
  }

  /** Otimista: sai da nota na hora; se o servidor recusar, avisa e atualiza as listas. */
  async function excluir() {
    if (!id) return;
    const titulo = nota?.titulo ?? "";
    setConfirmandoDelete(false);
    void removerRascunhoNota(id);
    editouRef.current = false;
    navigate(-1);
    try {
      await notas.excluir(id);
      notificar();
      avisarExcluido("nota", titulo, notificar);
    } catch (e) {
      notificar();
      avisar(mensagemDeErro(e, "Não consegui apagar a nota. Tente de novo em instantes."), "erro");
    }
  }

  if (naoEncontrada) {
    return (
      <div className="ecos-detail-page">
        <DetailHeader onBack={() => navigate(-1)} />
        <div className="ecos-detail-content">
        <EmptyState icon={FileX} title="Essa nota sumiu." subtitle="Pode ter sido movida ou apagada." />
        </div>
      </div>
    );
  }

  if (falhaCarga || demorou) {
    return (
      <div className="ecos-detail-page">
        <DetailHeader onBack={() => navigate(-1)} />
        <div className="ecos-detail-content">
          <EmptyState
            icon={AlertTriangle}
            title="Não consegui carregar."
            subtitle={`${falhaCarga ?? "Está demorando mais que o normal."} A nota não foi apagada.`}
            action={<button type="button" onClick={() => setTentativa((t) => t + 1)} className="rounded-2xl bg-surface-2 px-4 py-2 text-sm font-medium text-text-primary">Tentar de novo</button>}
          />
        </div>
      </div>
    );
  }

  if (!nota) {
    return (
      <div className="ecos-detail-page">
        <DetailHeader onBack={() => navigate(-1)} />
        <div className="ecos-detail-content">
        <SkeletonNotaDetalhe rotulo="Carregando…" />
        </div>
      </div>
    );
  }

  return (
    <div className="ecos-detail-page min-w-0">
      <DetailHeader onBack={() => navigate(-1)}
        titulo={editando ? <input aria-label="Título da nota" value={tituloEdit} onChange={(e) => setTituloEdit(e.target.value)} placeholder="Título da nota" enterKeyHint="done"
          className="block w-full min-w-0 truncate border-0 border-b border-transparent bg-transparent py-1 font-display text-xl text-text-primary caret-steel-300 transition-colors [outline:none!important] [box-shadow:none!important] placeholder:text-text-muted focus:border-steel-400" /> : <h1 className="touch-pan-x overflow-x-auto whitespace-nowrap [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden border-b border-transparent py-1 font-display text-xl text-text-primary">{nota.titulo}</h1>}
        actions={<>
        <button type="button" onClick={() => (editando ? void salvar() : entrarEdicao())} aria-label={editando ? "Salvar e voltar para a visualização" : "Editar texto da nota"} title={editando ? "Visualizar" : "Editar texto"} className={`${DETAIL_ACTION} relative text-steel-300`}>
          <Type size={18} aria-hidden className="transition-opacity duration-200 ease-in-out" style={{ opacity: editando ? 0 : 1 }} />
          <Eye size={18} aria-hidden className="absolute transition-opacity duration-200 ease-in-out" style={{ opacity: editando ? 1 : 0 }} />
        </button>
        <div {...(!editando ? ({ inert: "" } as object) : {})} aria-hidden={!editando} className="overflow-hidden transition-[width,opacity] duration-[250ms] ease-in-out motion-reduce:transition-none" style={{ width: editando ? 40 : 0, opacity: editando ? 1 : 0 }}>
          <button type="button" onPointerEnter={(e) => { if (e.pointerType !== "touch") setGiraAnexo(true); }} onPointerLeave={() => setGiraAnexo(false)} onPointerCancel={() => setGiraAnexo(false)} onClick={() => { setPulsoAnexo(true); window.setTimeout(() => setPulsoAnexo(false), 220); anexarRef.current?.(); }} aria-label="Anexar arquivo" title="Anexar arquivo (na linha do cursor)" className={`${DETAIL_ACTION} group w-10 px-0 text-text-secondary`}><Plus size={18} aria-hidden className={`transition-transform duration-200 ease-out motion-reduce:transition-none ${giraAnexo ? "rotate-90" : ""} ${pulsoAnexo ? "scale-125" : ""}`} /></button>
        </div>
        <OpcoesNota notaId={id} criadoEm={nota.criado_em} atualizadoEm={nota.atualizado_em} estado={enviandoAnexo ? "Enviando anexo…" : conflito ? "Conflito: escolha uma versão" : quedaPendente ? "Aguardando confirmação" : salvando ? "Salvando…" : editando ? "Editando" : "Salvo"} erro={!!erro} revisada={!!nota.ultima_revisao_em} onRevisar={marcarRevisado} onHistorico={() => setHistoricoAberto(true)} classeBotao={`${DETAIL_ACTION} text-text-secondary`}
          anexos={editando ? <AttachmentsField corpo={corpoEdit} onCorpoChange={setCorpoEdit} tipo="nota" espaco={nota.espaco} itemId={id} onBusyChange={setEnviandoAnexo} disabled={salvando} compact /> : undefined}
          acoes={(fechar) => <>
            {!editando && id && <SeletorVisualizacao modo={modoNota} travado={temTintaLeitura} aoEscolher={escolherModoNota} />}
            <AtalhoTema />
            <BotaoCopiarCaminho variante="linha" tipo="nota" espaco={nota.espaco} pasta={nota.caminho_arquivo ? pastaDoArquivoDeNota(nota.caminho_arquivo) : null} titulo={editando ? tituloEdit : nota.titulo} />
            <button type="button" disabled={salvando} onClick={() => { fechar(); void alternarArquivada(); }} className="flex min-h-[44px] w-full items-center gap-2 rounded-xl border border-border px-3 text-sm text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary disabled:opacity-40">{nota.arquivada ? <ArchiveRestore size={16} /> : <Archive size={16} />}{nota.arquivada ? "Desarquivar nota" : "Arquivar nota"}</button>
            <button type="button" disabled={salvando} onClick={() => { fechar(); setConfirmandoDelete(true); }} className="flex min-h-[44px] w-full items-center gap-2 rounded-xl border border-error/40 px-3 text-sm text-error transition-colors hover:bg-error/10 disabled:opacity-40"><Trash2 size={16} />Apagar nota</button>
          </>} />
      </>} />
      <div className="ecos-detail-content">

      {erro && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-2xl border border-error/40 bg-error/10 p-3 text-sm text-error">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" strokeWidth={1.75} />
          {erro}
        </div>
      )}

      {semRascunhoLocal && editando && <div role="status" className="mb-4 flex items-start gap-2 rounded-2xl border border-warning/40 bg-warning/10 p-3 text-sm text-text-primary"><AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" strokeWidth={1.75} />Não foi possível guardar o rascunho neste aparelho. Evite sair da nota antes de ela ser salva.</div>}
      {conflito && editando && <ConflitoNota servidor={conflito} meuTitulo={tituloEdit} meuCorpo={corpoEdit} ocupado={salvando} onManterMeu={manterMeu} onUsarServidor={usarServidor} />}
      <ConfirmDeleteDialog open={confirmandoDelete} title="Apagar esta nota?" busy={salvando} onCancel={() => setConfirmandoDelete(false)} onConfirm={excluir} />
      <ConfirmDeleteDialog open={quedaPendente} title="Apagar quase todo o texto?" busy={salvando} onCancel={desfazerQueda} onConfirm={confirmarQueda}
        description="O texto da nota ficou vazio ou bem menor de uma vez. Confirme para salvar assim, ou cancele para voltar o texto como estava." confirmLabel="Salvar assim" busyLabel="Salvando…" />
      {id && <HistoricoNota notaId={id} aberto={historicoAberto} onFechar={() => setHistoricoAberto(false)} onRestaurada={(n) => {
        void removerRascunhoNota(id);
        baseVersaoRef.current = n?.versao;
        setEditando(false);
        avisar("Versão restaurada.", "sucesso");
        notificar();
        setTentativa((t) => t + 1);
      }} />}

      {editando ? (
        <div className="flex min-w-0 flex-col gap-6">
          <CorpoEditor corpo={corpoEdit} onCorpoChange={setCorpoEdit} tipo="nota" itemId={id} rows={10} layout="document" tintaNotaId={id} fechando={fechando} anexarRef={anexarRef} />
        </div>
      ) : (
        <>
          <div style={{ minHeight: RESERVA_TOPO_PX }} className="flex flex-wrap content-center items-center gap-x-3 gap-y-1 px-4 text-sm text-text-secondary">
            <span>Criada em {formatDataHoraCompleta(nota.criado_em)} · Editada <TempoEdicao iso={nota.atualizado_em} /></span>
            {!nota.ultima_revisao_em && (
              <button onClick={marcarRevisado} className="flex items-center gap-1 text-steel-300">
                <CheckCircle2 size={12} />
                Marcar revisado
              </button>
            )}
          </div>

          <div className="mb-6 min-w-0 break-words text-sm [&_pre]:overflow-x-auto [&_img]:max-w-full">
            {id ? <LeituraComTinta notaId={id} corpo={nota.corpo} modo={modoNota} aoCarregar={setTemTintaLeitura} /> : nota.corpo.trim() ? <MarkdownPreview corpo={nota.corpo} itemId={id} tipo="nota" /> : <p className="text-text-muted">Nota vazia.</p>}
          </div>

          {nota.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 px-4 pb-6">
              {nota.tags.map((t) => (
                <ChipTag key={t} tag={t} espaco={nota.espaco} className="flex items-center gap-1 rounded-pill px-2.5 py-1 text-xs">
                  <Hash size={11} />
                  {t}
                </ChipTag>
              ))}
            </div>
          )}
        </>
      )}
      </div>
    </div>
  );
}

/** Desktop: editor direto no padrão da Tarefa; mobile: leitura com botão Editar, como antes. */
export function NoteDetailScreen() {
  return useIsDesktop() ? <NoteEditorDesktop /> : <NoteDetailMobile />;
}
