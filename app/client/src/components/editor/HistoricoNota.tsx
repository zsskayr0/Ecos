import { createPortal } from "react-dom";
import { useEffect, useId, useState } from "react";
import { ArrowLeft, History, RotateCcw, X } from "lucide-react";
import { useEscFecha } from "@/components/common/Dialog";
import { notas, type NotaDetalhe, type VersaoNota, type VersaoNotaResumo } from "@/lib/api";
import { formatDataHoraCompleta } from "@/lib/format";
import { mensagemDeErro } from "@/lib/erros";

const MOTIVOS: Record<string, string> = { fechamento: "Ao fechar a nota", autosave: "Salvamento automático", restauracao: "Antes de restaurar", conflito: "Conflito de edição" };
const rotuloMotivo = (m: string) => MOTIVOS[m] ?? m;
const tamanho = (b: number) => (b < 1024 ? `${b} B` : `${(b / 1024).toFixed(1)} KB`);

interface Props {
  notaId: string;
  aberto: boolean;
  onFechar: () => void;
  /** Depois de restaurar: a tela recarrega a nota com o que o servidor devolveu. */
  onRestaurada: (nota: NotaDetalhe) => void;
}

/** Versões anteriores da nota guardadas pelo servidor: lista, leitura e restauração (com confirmação). */
export function HistoricoNota({ notaId, aberto, onFechar, onRestaurada }: Props) {
  const titulo = useId();
  const [lista, setLista] = useState<VersaoNotaResumo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [vendo, setVendo] = useState<VersaoNota | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  useEscFecha(aberto, () => (confirmando ? setConfirmando(false) : vendo ? setVendo(null) : onFechar()));

  useEffect(() => {
    if (!aberto) return;
    let ativo = true;
    setLista(null); setErro(null); setVendo(null); setConfirmando(false);
    notas.versoes.listar(notaId)
      .then((v) => { if (ativo) setLista([...v].sort((a, b) => b.criado_em.localeCompare(a.criado_em))); })
      .catch((e) => { if (ativo) setErro(mensagemDeErro(e, "Não foi possível carregar o histórico.")); });
    return () => { ativo = false; };
  }, [aberto, notaId]);

  const abrirVersao = async (v: VersaoNotaResumo) => {
    setOcupado(true); setErro(null);
    try { setVendo(await notas.versoes.obter(notaId, v.id)); }
    catch (e) { setErro(mensagemDeErro(e, "Não foi possível abrir esta versão.")); }
    finally { setOcupado(false); }
  };

  const restaurar = async () => {
    if (!vendo) return;
    setOcupado(true); setErro(null);
    try {
      const nota = await notas.versoes.restaurar(notaId, vendo.id);
      onRestaurada(nota);
      onFechar();
    } catch (e) { setErro(mensagemDeErro(e, "Não foi possível restaurar esta versão.")); setConfirmando(false); }
    finally { setOcupado(false); }
  };

  if (!aberto) return null;
  return createPortal(
    <div role="dialog" aria-modal aria-labelledby={titulo} onMouseDown={(e) => { if (e.target === e.currentTarget && !ocupado) onFechar(); }}
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-4 backdrop-blur-md">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col gap-4 overflow-hidden rounded-2xl border border-steel-400/25 bg-surface-1 p-5 shadow-[0_24px_64px_rgb(0_0_0/0.5)]">
        <div className="flex items-center justify-between gap-3">
          <h2 id={titulo} className="flex items-center gap-2 font-display text-lg font-semibold text-text-primary">
            {vendo ? <button type="button" aria-label="Voltar à lista" onClick={() => { setVendo(null); setConfirmando(false); }} className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-surface-3 hover:text-text-primary"><ArrowLeft size={17} /></button> : <History size={18} className="text-text-muted" />}
            {vendo ? formatDataHoraCompleta(vendo.criado_em) : "Histórico"}
          </h2>
          <button type="button" aria-label="Fechar" disabled={ocupado} onClick={onFechar} className="flex h-9 w-9 items-center justify-center rounded-lg text-text-muted hover:bg-surface-3 hover:text-text-primary"><X size={17} /></button>
        </div>
        {erro && <p role="alert" className="rounded-lg border border-error/40 bg-error/10 p-2 text-sm text-error">{erro}</p>}
        {!vendo && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!lista && !erro && <p className="text-sm text-text-muted">Carregando…</p>}
            {lista && lista.length === 0 && <p className="text-sm text-text-muted">Ainda não há versões anteriores desta nota.</p>}
            {lista && lista.length > 0 && (
              <ul className="divide-y divide-border">
                {lista.map((v) => (
                  <li key={v.id}>
                    <button type="button" disabled={ocupado} onClick={() => void abrirVersao(v)} className="flex min-h-[48px] w-full items-center justify-between gap-3 rounded-lg px-2 text-left text-sm hover:bg-surface-2 disabled:opacity-60">
                      <span className="text-text-primary">{formatDataHoraCompleta(v.criado_em)}</span>
                      <span className="text-xs text-text-muted">{rotuloMotivo(v.motivo)} · {tamanho(v.tamanho_bytes)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {vendo && (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg bg-surface-2 p-3">
              <p className="mb-2 font-semibold text-text-primary">{vendo.titulo}</p>
              <pre className="whitespace-pre-wrap break-words font-sans text-sm text-text-secondary">{vendo.corpo || "Nota vazia."}</pre>
            </div>
            {confirmando ? (
              <div className="space-y-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
                <p className="text-text-primary">Restaurar esta versão? Ela substitui o texto atual da nota.</p>
                <div className="flex gap-2">
                  <button type="button" autoFocus disabled={ocupado} onClick={() => setConfirmando(false)} className="min-h-[40px] flex-1 rounded-xl bg-surface-2 px-3">Cancelar</button>
                  <button type="button" disabled={ocupado} onClick={() => void restaurar()} className="min-h-[40px] flex-1 rounded-xl bg-steel-500 px-3 font-semibold text-white disabled:opacity-60">{ocupado ? "Restaurando…" : "Restaurar"}</button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmando(true)} className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-border px-3 text-sm text-text-primary hover:bg-surface-2"><RotateCcw size={16} />Restaurar esta versão</button>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
