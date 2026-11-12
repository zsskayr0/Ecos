import { createPortal } from "react-dom";
import { useEffect, useId, useState, type ReactNode } from "react";
import { CheckCircle2, Ellipsis, X } from "lucide-react";
import { useEscFecha } from "@/components/common/Dialog";
import { TempoEdicao } from "@/components/common/TempoEdicao";
import { formatDataHoraCompleta } from "@/lib/format";

interface Props {
  criadoEm: string;
  atualizadoEm: string;
  /** Texto do estado de gravação ("Salvo", "Salvando…"). */
  estado: string;
  erro?: boolean;
  revisada: boolean;
  onRevisar: () => void;
  /** Anexos da nota. Fica montado mesmo com o painel fechado, para um envio em andamento não ser cancelado. */
  anexos?: ReactNode;
  /** Ações da nota (copiar caminho, apagar…) listadas no fim do menu. Quem as passa fecha o menu se precisar: elas recebem `fechar`. */
  acoes?: (fechar: () => void) => ReactNode;
  /** Classes do botão (tamanho/borda variam entre mobile, desktop e Focus). */
  classeBotao: string;
}

/** Menu "⋯" da nota: anexos e informações (criação, edição, estado), que antes ficavam soltos abaixo do editor. */
export function OpcoesNota({ criadoEm, atualizadoEm, estado, erro = false, revisada, onRevisar, anexos, acoes, classeBotao }: Props) {
  const [aberto, setAberto] = useState(false);
  const titulo = useId();
  useEscFecha(aberto, () => setAberto(false));
  // Itens que o editor da nota coloca aqui (ex.: "Limpar anotações") fecham o menu antes de abrir o próprio diálogo.
  useEffect(() => {
    const fechar = () => setAberto(false);
    document.addEventListener("ecos:fechar-opcoes-nota", fechar);
    return () => document.removeEventListener("ecos:fechar-opcoes-nota", fechar);
  }, []);

  return <>
    <button type="button" aria-haspopup="dialog" aria-expanded={aberto} aria-label="Opções da nota" title="Opções da nota" onClick={() => setAberto(true)} className={classeBotao}><Ellipsis size={18} /></button>
    {createPortal(<div role="dialog" aria-modal={aberto || undefined} aria-labelledby={titulo} aria-hidden={!aberto || undefined} {...(aberto ? {} : ({ inert: "" } as object))}
      onMouseDown={(e) => { if (e.target === e.currentTarget) setAberto(false); }}
      className={`fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-md transition-[opacity,visibility] duration-300 ease-out motion-reduce:transition-none ${aberto ? "visible opacity-100" : "invisible opacity-0"}`}>
      <div className={`max-h-[85vh] w-full max-w-md space-y-5 overflow-y-auto rounded-2xl border border-steel-400/25 bg-surface-1/80 p-5 shadow-[0_24px_64px_rgb(0_0_0/0.5)] backdrop-blur-xl backdrop-saturate-150 transition-[transform,opacity] duration-[380ms] ease-[cubic-bezier(0.2,0.9,0.25,1.1)] motion-reduce:transition-none ${aberto ? "translate-y-0 scale-100 opacity-100" : "translate-y-4 scale-95 opacity-0"}`}>
        <div className="flex items-center justify-between gap-3">
          <h2 id={titulo} className="font-display text-lg font-semibold text-text-primary">Opções da nota</h2>
          <button type="button" aria-label="Fechar" onClick={() => setAberto(false)} className="flex h-9 w-9 items-center justify-center rounded-lg text-text-muted hover:bg-surface-3 hover:text-text-primary"><X size={17} /></button>
        </div>
        {anexos && <section aria-label="Anexos">{anexos}</section>}
        <section aria-label="Informações" className="space-y-2 border-t border-border pt-4 text-sm text-text-secondary">
          <p>Criada em {formatDataHoraCompleta(criadoEm)}</p>
          <p>Editada <TempoEdicao iso={atualizadoEm} /></p>
          <p aria-live="polite" className={erro ? "text-error" : "text-text-muted"}>{estado}</p>
          {!revisada && <button type="button" onClick={() => { onRevisar(); setAberto(false); }} className="flex min-h-[44px] items-center gap-2 rounded-xl border border-border px-3 text-steel-300 transition-colors hover:bg-surface-2 hover:text-text-primary"><CheckCircle2 size={16} />Marcar revisada</button>}
        </section>
        <section aria-label="Escrita e folha" data-slot-opcoes-escrita className="space-y-4 border-t border-border pt-4 empty:hidden" />
        {acoes && <section aria-label="Ações" className="space-y-2 border-t border-border pt-4">{acoes(() => setAberto(false))}</section>}
      </div>
    </div>, document.body)}
  </>;
}
