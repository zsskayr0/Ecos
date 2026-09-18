import { useContext, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Hash, Pencil, Trash2, CheckCircle2, AlertTriangle, FileX } from "lucide-react";
import { DetailHeader, DETAIL_ACTION } from "@/components/layout/DetailHeader";
import { notas, ApiError } from "@/lib/api";
import { TempoEdicao } from "@/components/common/TempoEdicao";
import { MarkdownPreview } from "@/lib/markdown-mini";
import { EmptyState } from "@/components/common/EmptyState";
import { ConfirmDeleteDialog } from "@/components/common/ConfirmDeleteDialog";
import { CorpoEditor } from "@/components/editor/CorpoEditor";
import { AttachmentsField } from "@/components/editor/AttachmentsField";
import { useRefreshBus } from "@/lib/refresh-bus";
import { TituloJanelaContext } from "@/lib/documento-popup";
import { useIsDesktop } from "@/lib/use-viewport";
import { NoteEditorDesktop } from "./NoteEditorDesktop";

interface NotaCompleta {
  id: string;
  titulo: string;
  tags: string[];
  atualizado_em: string;
  ultima_revisao_em: string | null;
  corpo: string;
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
  const [editando, setEditando] = useState(false);
  const [tituloEdit, setTituloEdit] = useState("");
  const [corpoEdit, setCorpoEdit] = useState("");
  const [confirmandoDelete, setConfirmandoDelete] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [enviandoAnexo, setEnviandoAnexo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    notas
      .obter(id)
      .then((n) => setNota(n))
      .catch(() => setNaoEncontrada(true));
  }, [id]);

  useEffect(() => { definirTituloJanela?.((editando ? tituloEdit : nota?.titulo ?? "").trim()); }, [definirTituloJanela, editando, nota?.titulo, tituloEdit]);

  // Rascunho local imediato + envio após uma pequena pausa; voltar ou fechar
  // não descarta o texto enquanto o servidor estiver disponível.
  useEffect(() => {
    if (!editando || !id || !nota || (tituloEdit === nota.titulo && corpoEdit === nota.corpo)) return;
    try { localStorage.setItem(`ecos.note-draft.v1:${id}`, JSON.stringify({ titulo: tituloEdit, corpo: corpoEdit })); } catch { /* cache indisponível */ }
    const timer = window.setTimeout(async () => {
      setSalvando(true); setErro(null);
      try {
        await notas.atualizar(id, { titulo: tituloEdit, corpo: corpoEdit });
        setNota((atual) => atual ? { ...atual, titulo: tituloEdit, corpo: corpoEdit } : atual);
        try { localStorage.removeItem(`ecos.note-draft.v1:${id}`); } catch { /* cache indisponível */ }
        notificar();
      } catch (e) { setErro(e instanceof ApiError ? e.message : "Não foi possível sincronizar as alterações."); }
      finally { setSalvando(false); }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [id, nota, editando, tituloEdit, corpoEdit, notificar]);

  function entrarEdicao() {
    if (!nota) return;
    try {
      const rascunho = id ? JSON.parse(localStorage.getItem(`ecos.note-draft.v1:${id}`) ?? "null") : null;
      setTituloEdit(typeof rascunho?.titulo === "string" ? rascunho.titulo : nota.titulo);
      setCorpoEdit(typeof rascunho?.corpo === "string" ? rascunho.corpo : nota.corpo);
    } catch { setTituloEdit(nota.titulo); setCorpoEdit(nota.corpo); }
    setEditando(true);
  }

  async function salvar() {
    if (!id) return;
    setSalvando(true);
    setErro(null);
    try {
      await notas.atualizar(id, { titulo: tituloEdit, corpo: corpoEdit });
      const atualizada = await notas.obter(id);
      setNota(atualizada);
      setEditando(false);
      notificar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  async function marcarRevisado() {
    if (!id) return;
    try {
      await notas.atualizar(id, { marcar_revisado: true });
      const atualizada = await notas.obter(id);
      setNota(atualizada);
      notificar();
    } catch {
      /* silent — a secondary, non-critical action */
    }
  }

  async function excluir() {
    if (!id) return;
    setSalvando(true);
    try {
      await notas.excluir(id);
      notificar();
      navigate(-1);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível apagar.");
      setSalvando(false);
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

  if (!nota) {
    return (
      <div className="ecos-detail-page">
        <DetailHeader onBack={() => navigate(-1)} />
        <div className="ecos-detail-content">
        <p className="py-10 text-center text-sm text-text-muted">Carregando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="ecos-detail-page min-w-0">
      <DetailHeader onBack={() => navigate(-1)} actions={<>
        {!editando && <button type="button" onClick={entrarEdicao} className={`${DETAIL_ACTION} text-steel-300`}><Pencil size={18} />Editar</button>}
        {editando && <button type="button" disabled={salvando || enviandoAnexo} onClick={() => setEditando(false)} className={`${DETAIL_ACTION} text-text-secondary`}>Cancelar</button>}
        <button type="button" disabled={salvando} onClick={() => setConfirmandoDelete(true)} className={`${DETAIL_ACTION} text-error`}><Trash2 size={18} />Apagar</button>
      </>} />
      <div className="ecos-detail-content">

      {erro && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-2xl border border-error/40 bg-error/10 p-3 text-sm text-error">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" strokeWidth={1.75} />
          {erro}
        </div>
      )}

      <ConfirmDeleteDialog open={confirmandoDelete} title="Apagar esta nota?" busy={salvando} onCancel={() => setConfirmandoDelete(false)} onConfirm={excluir} />

      {editando ? (
        <div className="flex min-w-0 flex-col gap-6">
          <input aria-label="Título da nota" value={tituloEdit} onChange={(e) => setTituloEdit(e.target.value)} className="w-full rounded-xl border border-border bg-surface-2 p-4 font-display text-2xl text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400" />
          <CorpoEditor corpo={corpoEdit} onCorpoChange={setCorpoEdit} tipo="nota" itemId={id} rows={10} layout="document" />
          <AttachmentsField corpo={corpoEdit} onCorpoChange={setCorpoEdit} tipo="nota" itemId={id} onBusyChange={setEnviandoAnexo} disabled={salvando} compact />
        </div>
      ) : (
        <>
          <h1 className="mb-3 break-words font-display text-2xl text-text-primary">{nota.titulo}</h1>
          <div className="mb-6 flex flex-wrap items-center gap-3 text-sm text-text-secondary">
            <span>Editada <TempoEdicao iso={nota.atualizado_em} /></span>
            {!nota.ultima_revisao_em && (
              <button onClick={marcarRevisado} className="flex items-center gap-1 text-steel-300">
                <CheckCircle2 size={12} />
                Marcar revisado
              </button>
            )}
          </div>

          <div className="mb-6 min-w-0 break-words rounded-2xl border border-border bg-surface-1 p-5 text-sm [&_pre]:overflow-x-auto [&_img]:max-w-full">
            {nota.corpo.trim() ? <MarkdownPreview corpo={nota.corpo} itemId={id} tipo="nota" /> : <p className="text-text-muted">Nota vazia.</p>}
          </div>

          {nota.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {nota.tags.map((t) => (
                <span key={t} className="flex items-center gap-1 rounded-pill bg-surface-2 px-2.5 py-1 text-xs text-text-secondary">
                  <Hash size={11} />
                  {t}
                </span>
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
