import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, Hash, Pencil, Trash2, CheckCircle2, AlertTriangle, FileX } from "lucide-react";
import { notas, ApiError } from "@/lib/api";
import { formatTempoRelativo } from "@/lib/format";
import { renderMarkdownMini } from "@/lib/markdown-mini";
import { EmptyState } from "@/components/common/EmptyState";
import { useRefreshBus } from "@/lib/refresh-bus";

interface NotaCompleta {
  id: string;
  titulo: string;
  tags: string[];
  atualizado_em: string;
  ultima_revisao_em: string | null;
  corpo: string;
}

/**
 * Leitura + edição real de uma Nota (`GET`/`PATCH`/`DELETE /notas/:id`).
 * GAP-02: não é uma das 12 telas do inventário (que só especifica o card e
 * o formulário de Captura) — construída como o destino honesto e mínimo do
 * toque no card, reaproveitando o preview de Markdown do editor (seção 3.6).
 * Delete não-crítico aqui — humor leve permitido (seção 1.4).
 */
export function NoteDetailScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { notificar } = useRefreshBus();
  const [nota, setNota] = useState<NotaCompleta | null>(null);
  const [naoEncontrada, setNaoEncontrada] = useState(false);
  const [editando, setEditando] = useState(false);
  const [tituloEdit, setTituloEdit] = useState("");
  const [corpoEdit, setCorpoEdit] = useState("");
  const [confirmandoDelete, setConfirmandoDelete] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    notas
      .obter(id)
      .then((n) => setNota(n))
      .catch(() => setNaoEncontrada(true));
  }, [id]);

  function entrarEdicao() {
    if (!nota) return;
    setTituloEdit(nota.titulo);
    setCorpoEdit(nota.corpo);
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
      /* silencioso — ação secundária, não crítica */
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
      <div className="px-4 pt-1">
        <button onClick={() => navigate(-1)} className="mb-4 text-text-muted">
          <ChevronLeft />
        </button>
        <EmptyState icon={FileX} title="Essa nota sumiu." subtitle="Pode ter sido movida ou apagada." />
      </div>
    );
  }

  if (!nota) {
    return (
      <div className="px-4 pt-1">
        <button onClick={() => navigate(-1)} className="mb-4 text-text-muted">
          <ChevronLeft />
        </button>
        <p className="py-10 text-center text-sm text-text-muted">Carregando...</p>
      </div>
    );
  }

  return (
    <div className="px-4 pt-1 pb-nav-safe">
      <div className="mb-3 flex items-center justify-between">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-text-muted">
          <ChevronLeft size={18} />
          Voltar
        </button>
        {!editando && (
          <div className="flex items-center gap-3">
            <button onClick={entrarEdicao} className="flex items-center gap-1.5 text-sm text-steel-300">
              <Pencil size={14} />
              Editar
            </button>
            <button onClick={() => setConfirmandoDelete(true)} className="flex items-center gap-1.5 text-sm text-error">
              <Trash2 size={14} />
              Apagar
            </button>
          </div>
        )}
      </div>

      {erro && (
        <div className="mb-4 flex items-start gap-2 rounded-2xl border border-error/40 bg-error/10 p-3 text-sm text-error">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" strokeWidth={1.75} />
          {erro}
        </div>
      )}

      {confirmandoDelete && (
        <div className="mb-4 rounded-2xl border border-error/40 bg-error/[0.06] p-4">
          <p className="mb-3 text-sm text-text-primary">
            Apagar essa nota? Ela não vai sentir sua falta, mas confirma mesmo assim.
          </p>
          <div className="flex gap-2">
            <button onClick={() => setConfirmandoDelete(false)} className="flex-1 rounded-2xl bg-surface-2 py-2.5 text-sm font-medium text-text-primary">
              Cancelar
            </button>
            <button onClick={excluir} disabled={salvando} className="flex-1 rounded-2xl bg-error py-2.5 text-sm font-semibold text-white disabled:opacity-40">
              {salvando ? "Apagando..." : "Apagar"}
            </button>
          </div>
        </div>
      )}

      {editando ? (
        <div className="flex flex-col gap-4">
          <input value={tituloEdit} onChange={(e) => setTituloEdit(e.target.value)} className="w-full bg-transparent font-display text-2xl text-text-primary focus:outline-none" />
          <textarea
            value={corpoEdit}
            onChange={(e) => setCorpoEdit(e.target.value)}
            rows={10}
            className="w-full resize-none rounded-2xl bg-surface-2 p-4 font-body text-[15px] text-text-primary focus:outline-none"
          />
          <div className="flex gap-2">
            <button onClick={() => setEditando(false)} className="flex-1 rounded-2xl bg-surface-2 py-3 text-sm font-medium text-text-primary">
              Cancelar
            </button>
            <button onClick={salvar} disabled={salvando} className="flex-1 rounded-2xl bg-steel-700 py-3 text-sm font-semibold text-white disabled:opacity-40">
              {salvando ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <h1 className="mb-1 font-display text-2xl text-text-primary">{nota.titulo}</h1>
          <div className="mb-4 flex items-center gap-3 text-xs text-text-muted">
            <span>Atualizada {formatTempoRelativo(nota.atualizado_em)}</span>
            {!nota.ultima_revisao_em && (
              <button onClick={marcarRevisado} className="flex items-center gap-1 text-steel-300">
                <CheckCircle2 size={12} />
                Marcar revisado
              </button>
            )}
          </div>

          <div className="mb-4 rounded-2xl border border-border bg-surface-1 p-4 text-sm">
            {nota.corpo.trim() ? renderMarkdownMini(nota.corpo) : <p className="text-text-muted">Nota vazia.</p>}
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
  );
}
