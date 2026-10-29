import { avisar } from "@/lib/toast";
import { avisarExcluido } from "@/lib/desfazer";
import { SkeletonNotaDetalhe } from "@/components/common/SkeletonTelas";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";
import { BotaoCopiarCaminho } from "@/components/common/BotaoCopiarCaminho";
import { AlertTriangle, CheckCircle2, Copy, FileX, PanelRightClose, PanelRightOpen, Trash2 } from "lucide-react";
import { AcoesFocusContext, AcoesJanelaContext, ModoFocusDocumentoContext, PainelFocusControleContext, PainelFocusTarefaContext } from "@/lib/documento-popup";
import { MiniGrafo } from "@/screens/Grafico/MiniGrafo";
import { ApiError, notas } from "@/lib/api";
import { TempoEdicao } from "@/components/common/TempoEdicao";
import { formatDataHoraCompleta } from "@/lib/format";
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

const chaveRascunho = (id: string) => `ecos.note-draft.v2:${id}`;
const iguais = (a: CamposNota, b: CamposNota) => JSON.stringify(a) === JSON.stringify(b);
const tagsFinais = (c: CamposNota) => [...new Set([...c.tags, ...descriptionTags(c.corpo)])];

/** O backend não devolve a pasta: ela é o trecho do caminho do arquivo entre `Notas/` e o nome do arquivo. */
function pastaDoCaminho(caminho: string): string | null {
  const partes = caminho.split("/");
  const i = partes.indexOf("Notas");
  if (i === -1) return null;
  const pasta = partes.slice(i + 1, -1).join("/");
  return pasta || null;
}

function camposDaNota(n: NotaApi): CamposNota {
  const noTexto = descriptionTags(n.corpo);
  return { titulo: n.titulo, corpo: n.corpo, tags: n.tags.filter((t) => !noTexto.includes(t)), pasta: pastaDoCaminho(n.caminho_arquivo), espaco: n.espaco };
}

function lerRascunho(id: string): CamposNota | null {
  try {
    const r = JSON.parse(localStorage.getItem(chaveRascunho(id)) ?? "null");
    return r && typeof r.titulo === "string" && typeof r.corpo === "string" && Array.isArray(r.tags) ? (r as CamposNota) : null;
  } catch {
    return null;
  }
}
const guardarRascunho = (id: string, c: CamposNota) => { try { localStorage.setItem(chaveRascunho(id), JSON.stringify(c)); } catch { /* cache indisponível */ } };
const removerRascunho = (id: string) => { try { localStorage.removeItem(chaveRascunho(id)); } catch { /* cache indisponível */ } };

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
  const { notificar } = useRefreshBus();
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
  useEffect(() => { valorRef.current = valor; }, [valor]);
  useEffect(() => { salvoRef.current = salvo; }, [salvo]);

  useEffect(() => {
    if (!id) return;
    let ativo = true;
    setNota(null); setValor(null); setSalvo(null); setNaoEncontrada(false); setFalhaCarga(null); setErro(null);
    notas.obter(id).then((n) => {
      if (!ativo) return;
      const original = camposDaNota(n);
      setNota(n); setSalvo(original); setValor(lerRascunho(id) ?? original);
    }).catch((e) => {
      if (!ativo) return;
      // Só 404 vira "sumiu"; queda de rede e demais falhas oferecem tentar de novo.
      if (e instanceof ApiError && e.status === 404) setNaoEncontrada(true);
      else setFalhaCarga(e instanceof ApiError && e.code === "CONEXAO_INDISPONIVEL" ? "Sem conexão com o servidor." : "Pode ser uma falha temporária.");
    });
    return () => { ativo = false; };
  }, [id, tentativa]);

  const sujo = !!valor && !!salvo && !iguais(valor, salvo);

  // Cada edição vai antes para o cache local; a rede vem depois.
  useEffect(() => {
    if (!id || !valor || !salvo) return;
    if (iguais(valor, salvo)) removerRascunho(id);
    else guardarRascunho(id, valor);
  }, [id, valor, salvo]);

  const sincronizar = useCallback(async () => {
    if (!id) return;
    if (emCurso.current) { await emCurso.current; return sincronizar(); }
    const atual = valorRef.current;
    const base = salvoRef.current;
    if (!atual || !base || !atual.titulo.trim() || iguais(atual, base)) return;
    const pedido = (async () => {
      setSalvando(true); setErro(null);
      try {
        // Só manda o que mudou: mover de pasta renomeia o arquivo no servidor.
        await notas.atualizar(id, {
          titulo: atual.titulo,
          corpo: atual.corpo,
          ...(JSON.stringify(tagsFinais(atual)) !== JSON.stringify(tagsFinais(base)) ? { tags: tagsFinais(atual) } : {}),
          ...(atual.pasta !== base.pasta ? { pasta: atual.pasta ?? "" } : {}),
          ...(atual.espaco !== base.espaco ? { espaco: atual.espaco } : {}),
        });
        setSalvo(atual);
        setNota((n) => (n ? { ...n, atualizado_em: new Date().toISOString() } : n));
        if (valorRef.current && iguais(valorRef.current, atual)) removerRascunho(id);
        notificar();
      } catch (e) {
        setErro(mensagemDeErro(e, "Não foi possível sincronizar as alterações."));
      } finally { setSalvando(false); }
    })();
    emCurso.current = pedido;
    try { await pedido; } finally { emCurso.current = null; }
  }, [id, notificar]);

  useEffect(() => {
    if (!sujo) return;
    const timer = window.setTimeout(() => { void sincronizar(); }, 600);
    return () => window.clearTimeout(timer);
  }, [sujo, valor, sincronizar]);

  // Fechar a janela/aba envia o que ainda estava na espera da pausa.
  useEffect(() => {
    const aoSair = () => { void sincronizar(); };
    window.addEventListener("pagehide", aoSair);
    return () => { window.removeEventListener("pagehide", aoSair); void sincronizar(); };
  }, [sincronizar]);

  async function marcarRevisado() {
    if (!id) return;
    try {
      await notas.atualizar(id, { marcar_revisado: true });
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
      removerRascunho(id);
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

  const mudar = (patch: Partial<CamposNota>) => setValor((v) => (v ? { ...v, ...patch } : v));

  if (naoEncontrada) return <div className="ecos-detail-content"><EmptyState icon={FileX} title="Essa nota sumiu." subtitle="Pode ter sido movida ou apagada." /></div>;
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
  if (!nota || !valor) return <div className="ecos-detail-content"><SkeletonNotaDetalhe rotulo="Carregando…" /></div>;

  const noTexto = descriptionTags(valor.corpo);
  const estado = erro ? "Erro ao sincronizar" : salvando ? "Salvando…" : sujo ? "Alterações pendentes" : "Salvo";

  const noPainel = modoFocus && !!montagemPainel;
  const rotuloPainel = painelFocus.aberto ? "Recolher painel lateral" : "Expandir painel lateral";
  return (
    <div className="ecos-detail-page min-w-0" style={{ "--ecos-editor-sticky-top": "0px" } as React.CSSProperties}>
      {!modoFocus && acoesJanela && createPortal(<BotaoCopiarCaminho variante="pequeno" tipo="nota" espaco={valor.espaco} pasta={valor.pasta} titulo={valor.titulo} />, acoesJanela)}
      {modoFocus && acoesFocus && createPortal(
        <>
          <BotaoCopiarCaminho variante="pequeno" tipo="nota" espaco={valor.espaco} pasta={valor.pasta} titulo={valor.titulo} />
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
          <section className="space-y-4 border-t border-border pt-6">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Organização</h2>
            <EquipeSelector espaco={valor.espaco} onChange={(espaco) => mudar({ espaco, pasta: null })} disabled={salvando} />
            <NoteOrganizer espaco={valor.espaco} pasta={valor.pasta} onPasta={(pasta) => mudar({ pasta })} tags={valor.tags} tagsNoTexto={noTexto} onTags={(tags) => mudar({ tags })} disabled={salvando && !sujo} />
          </section>
          <section className="border-t border-border pt-6" aria-label="Anexos">
            <AttachmentsField tipo="nota" espaco={valor.espaco} itemId={id} corpo={valor.corpo} onCorpoChange={(corpo) => mudar({ corpo })} onBusyChange={setEnviandoAnexo} disabled={salvando} escopoRef={raizNota} estilo="grade" compact />
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
        <ConfirmDeleteDialog open={confirmandoDelete} title="Apagar esta nota?" busy={salvando} onCancel={() => setConfirmandoDelete(false)} onConfirm={excluir} />

        <div ref={raizNota} className="flex min-w-0 flex-col gap-4">
          <div className={`flex min-w-0 items-center gap-3 ${modoFocus ? "border-b border-border pb-2" : ""}`}>
            <input aria-label="Título da nota" value={valor.titulo} onChange={(e) => mudar({ titulo: e.target.value })} placeholder="Título da nota" className={modoFocus ? CAMPO_TITULO_FOCUS : CAMPO_TITULO} />
            {!modoFocus && !acoesJanela && <BotaoCopiarCaminho variante="icone" tipo="nota" espaco={valor.espaco} pasta={valor.pasta} titulo={valor.titulo} />}
            {!modoFocus && <button type="button" disabled={salvando} onClick={() => void duplicar()} aria-label="Duplicar nota" title="Duplicar nota" className="flex min-h-[52px] min-w-[52px] shrink-0 items-center justify-center rounded-xl border border-border text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary disabled:opacity-40"><Copy size={17} /></button>}
            {!modoFocus && <button type="button" disabled={salvando} onClick={() => setConfirmandoDelete(true)} aria-label="Apagar nota" title="Apagar nota" className="flex min-h-[52px] min-w-[52px] shrink-0 items-center justify-center rounded-xl border border-error text-error transition-colors hover:bg-error hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-error disabled:opacity-40"><Trash2 size={18} /></button>}
          </div>

          {!noPainel && <NoteOrganizer espaco={valor.espaco} pasta={valor.pasta} onPasta={(pasta) => mudar({ pasta })} tags={valor.tags} tagsNoTexto={noTexto} onTags={(tags) => mudar({ tags })} disabled={salvando && !sujo} />}
          {!noPainel && <EquipeSelector espaco={valor.espaco} onChange={(espaco) => mudar({ espaco, pasta: null })} disabled={salvando} />}

          {!noPainel && <AttachmentsField tipo="nota" espaco={valor.espaco} itemId={id} corpo={valor.corpo} onCorpoChange={(corpo) => mudar({ corpo })} onBusyChange={setEnviandoAnexo} disabled={salvando} compact />}

          <CorpoEditor tipo="nota" itemId={id} espaco={valor.espaco} corpo={valor.corpo} onCorpoChange={(corpo) => mudar({ corpo })} rows={modoFocus ? 18 : 14} layout="document" semBorda={modoFocus} placeholder="Escreva sua nota… Use #tags e [[links]] para conectar ideias." initialPreview={!lerPreferenciasAplicativo().notaAbreEditando} />

          <Conexoes tipo="nota" id={id} versao={nota.atualizado_em} />

          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-text-muted">
            <span>Criada em {formatDataHoraCompleta(nota.criado_em)} · Editada <TempoEdicao iso={nota.atualizado_em} /></span>
            <span className="flex items-center gap-3">
              {!nota.ultima_revisao_em && (
                <button type="button" onClick={marcarRevisado} className="flex items-center gap-1 text-steel-300 hover:text-text-primary"><CheckCircle2 size={12} />Marcar revisado</button>
              )}
              <span aria-live="polite" className={erro ? "text-error" : ""}>{enviandoAnexo ? "Enviando anexo…" : estado}</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
