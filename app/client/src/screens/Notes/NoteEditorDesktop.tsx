import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, FileX, Trash2 } from "lucide-react";
import { ApiError, notas } from "@/lib/api";
import { TempoEdicao } from "@/components/common/TempoEdicao";
import { descriptionTags } from "@/lib/task-fields";
import { useRefreshBus } from "@/lib/refresh-bus";
import { AttachmentsField } from "@/components/editor/AttachmentsField";
import { CorpoEditor } from "@/components/editor/CorpoEditor";
import { NoteOrganizer } from "@/components/editor/NoteOrganizer";
import { ConfirmDeleteDialog } from "@/components/common/ConfirmDeleteDialog";
import { EmptyState } from "@/components/common/EmptyState";

type NotaApi = Awaited<ReturnType<typeof notas.obter>>;

interface CamposNota {
  titulo: string;
  corpo: string;
  /** Só as tags escolhidas na interface — as de `#hashtag` no texto são derivadas do corpo. */
  tags: string[];
  pasta: string | null;
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
  return { titulo: n.titulo, corpo: n.corpo, tags: n.tags.filter((t) => !noTexto.includes(t)), pasta: pastaDoCaminho(n.caminho_arquivo) };
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
  const [nota, setNota] = useState<NotaApi | null>(null);
  const [naoEncontrada, setNaoEncontrada] = useState(false);
  const [valor, setValor] = useState<CamposNota | null>(null);
  const [salvo, setSalvo] = useState<CamposNota | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [enviandoAnexo, setEnviandoAnexo] = useState(false);
  const [confirmandoDelete, setConfirmandoDelete] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const valorRef = useRef(valor);
  const salvoRef = useRef(salvo);
  const emCurso = useRef<Promise<void> | null>(null);
  useEffect(() => { valorRef.current = valor; }, [valor]);
  useEffect(() => { salvoRef.current = salvo; }, [salvo]);

  useEffect(() => {
    if (!id) return;
    let ativo = true;
    setNota(null); setValor(null); setSalvo(null); setNaoEncontrada(false); setErro(null);
    notas.obter(id).then((n) => {
      if (!ativo) return;
      const original = camposDaNota(n);
      setNota(n); setSalvo(original); setValor(lerRascunho(id) ?? original);
    }).catch(() => ativo && setNaoEncontrada(true));
    return () => { ativo = false; };
  }, [id]);

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
        });
        setSalvo(atual);
        setNota((n) => (n ? { ...n, atualizado_em: new Date().toISOString() } : n));
        if (valorRef.current && iguais(valorRef.current, atual)) removerRascunho(id);
        notificar();
      } catch (e) {
        setErro(e instanceof ApiError ? e.message : "Não foi possível sincronizar as alterações.");
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
    } catch { /* ação secundária */ }
  }

  async function excluir() {
    if (!id) return;
    setSalvando(true);
    try {
      await notas.excluir(id);
      removerRascunho(id);
      notificar();
      navigate(-1);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível apagar.");
      setSalvando(false);
    }
  }

  const mudar = (patch: Partial<CamposNota>) => setValor((v) => (v ? { ...v, ...patch } : v));

  if (naoEncontrada) return <div className="ecos-detail-content"><EmptyState icon={FileX} title="Essa nota sumiu." subtitle="Pode ter sido movida ou apagada." /></div>;
  if (!nota || !valor) return <div className="ecos-detail-content"><p className="py-10 text-center text-sm text-text-muted">Carregando...</p></div>;

  const noTexto = descriptionTags(valor.corpo);
  const estado = erro ? "Erro ao sincronizar" : salvando ? "Salvando…" : sujo ? "Alterações pendentes" : "Salvo";

  return (
    <div className="ecos-detail-page min-w-0" style={{ "--ecos-editor-sticky-top": "0px" } as React.CSSProperties}>
      <div className="ecos-detail-content">
        {erro && <div role="alert" className="mb-5 flex items-start gap-2 rounded-xl border border-error/40 bg-error/10 p-3 text-sm text-error"><AlertTriangle size={17} className="mt-0.5 shrink-0" />{erro}</div>}
        <ConfirmDeleteDialog open={confirmandoDelete} title="Apagar esta nota?" busy={salvando} onCancel={() => setConfirmandoDelete(false)} onConfirm={excluir} />

        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <input aria-label="Título da nota" value={valor.titulo} onChange={(e) => mudar({ titulo: e.target.value })} placeholder="Título da nota" className={CAMPO_TITULO} />
            <button type="button" disabled={salvando} onClick={() => setConfirmandoDelete(true)} aria-label="Apagar nota" title="Apagar nota"
              className="flex min-h-[52px] min-w-[52px] shrink-0 items-center justify-center rounded-xl border border-error text-error transition-colors hover:bg-error hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-error disabled:opacity-40"><Trash2 size={18} /></button>
          </div>

          <NoteOrganizer pasta={valor.pasta} onPasta={(pasta) => mudar({ pasta })} tags={valor.tags} tagsNoTexto={noTexto} onTags={(tags) => mudar({ tags })} disabled={salvando && !sujo} />

          <AttachmentsField tipo="nota" itemId={id} corpo={valor.corpo} onCorpoChange={(corpo) => mudar({ corpo })} onBusyChange={setEnviandoAnexo} disabled={salvando} compact />

          <CorpoEditor tipo="nota" itemId={id} corpo={valor.corpo} onCorpoChange={(corpo) => mudar({ corpo })} rows={14} layout="document" placeholder="Escreva sua nota… Use #tags e [[links]] para conectar ideias." />

          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-text-muted">
            <span>Editada <TempoEdicao iso={nota.atualizado_em} /></span>
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
