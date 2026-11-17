import { useContext, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Cloud } from "lucide-react";
import { CorpoEditor } from "@/components/editor/CorpoEditor";
import { AttachmentsField } from "@/components/editor/AttachmentsField";
import { EquipeSelector } from "@/components/editor/EquipeSelector";
import { NoteOrganizer } from "@/components/editor/NoteOrganizer";
import { TitleField } from "@/components/common/TitleField";
import { BotaoCopiarCaminho } from "@/components/common/BotaoCopiarCaminho";
import { AcoesFocusContext, ModoFocusDocumentoContext, PainelFocusTarefaContext } from "@/lib/documento-popup";
import { descriptionTags } from "@/lib/task-fields";
import { useAppUI } from "@/lib/ui-context";
import type { CapturaDraft, SetDraft } from "./CreateFlow";

interface Props {
  draft: CapturaDraft;
  setDraft: SetDraft;
  onSalvar: () => void;
  salvando?: boolean;
  embedded?: boolean;
}

/** Mesmos campos de título da nota existente (ver `NoteEditorDesktop`). */
const CAMPO_TITULO_FOCUS = "ecos-input min-w-0 flex-1 !rounded-none !border-0 !bg-transparent !shadow-none !px-0 !py-0 font-display !text-[2rem] font-semibold leading-tight text-text-primary placeholder:text-text-muted focus-visible:!outline-none";
const CAMPO_TITULO = "ecos-input min-w-0 !rounded-lg border border-border !py-3 !text-xl text-text-primary focus-visible:!outline focus-visible:!outline-2 focus-visible:!outline-steel-400";

/**
 * Nova nota, no mesmo padrão da edição. Maximizada (Focus): título grande com divisória, editor sem moldura e as opções
 * (equipe, pasta, tags, anexos) no painel lateral; na janela comum e no mobile, tudo fica à mão acima do editor.
 */
export function NoteForm({ draft, setDraft, salvando, embedded = false }: Props) {
  const { espacoAtivo } = useAppUI();
  const focoDocumento = useContext(ModoFocusDocumentoContext);
  const modoFocus = embedded && focoDocumento;
  const montagemPainel = useContext(PainelFocusTarefaContext);
  const acoesFocus = useContext(AcoesFocusContext);
  const [enviandoAnexo, setEnviandoAnexo] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const espaco = draft.espacoNota ?? espacoAtivo;
  const noPainel = modoFocus && !!montagemPainel;
  const mudarCorpo = (corpo: string) => setDraft((d) => ({ ...d, corpo }));
  const organizador = (
    <NoteOrganizer
      espaco={espaco}
      pasta={draft.pastaNota}
      onPasta={(pastaNota) => setDraft((d) => ({ ...d, pastaNota }))}
      tags={draft.tagsNota}
      tagsNoTexto={descriptionTags(draft.corpo)}
      onTags={(tagsNota) => setDraft((d) => ({ ...d, tagsNota }))}
      disabled={salvando}
    />
  );
  return (
    <div ref={raiz} className={`flex min-w-0 flex-col gap-4 pb-5 ${embedded ? "pt-5 md:pt-4" : "pt-1"}`}>
      {modoFocus && acoesFocus && createPortal(<BotaoCopiarCaminho variante="pequeno" tipo="nota" espaco={espaco} pasta={draft.pastaNota} titulo={draft.texto} />, acoesFocus)}
      {noPainel && createPortal(
        <aside aria-label="Opções da nota" className="flex min-w-0 flex-col gap-6">
          <h2 className="font-display text-lg font-semibold text-text-primary">Opções</h2>
          <section className="space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Organização</h2>
            <EquipeSelector espaco={espaco} onChange={(espacoNota) => setDraft((d) => ({ ...d, espacoNota, pastaNota: null }))} disabled={salvando} />
            {organizador}
          </section>
          <section className="border-t border-border pt-6" aria-label="Anexos">
            <AttachmentsField tipo="nota" espaco={espaco} corpo={draft.corpo} onCorpoChange={mudarCorpo} onBusyChange={setEnviandoAnexo} disabled={salvando} escopoRef={raiz} estilo="grade" compact />
          </section>
          <section aria-label="Informações" className="space-y-2 border-t border-border pt-6 text-sm text-text-secondary">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Informações</h2>
            <p aria-live="polite" className="text-text-muted">{enviandoAnexo || salvando ? "Sincronizando…" : "Salva automaticamente enquanto você edita."}</p>
          </section>
        </aside>,
        montagemPainel!,
      )}

      <div className={`flex min-w-0 items-center gap-3 ${modoFocus ? "border-b border-border pb-2" : ""}`}>
        <TitleField
          value={draft.texto}
          onChange={(texto) => setDraft((d) => ({ ...d, texto }))}
          placeholder="Título da nota"
          ariaLabel="Título da nota"
          className={modoFocus ? CAMPO_TITULO_FOCUS : `${CAMPO_TITULO} flex-1`}
          autoFocus
        />
      </div>

      {!noPainel && organizador}
      {!noPainel && <AttachmentsField tipo="nota" espaco={espaco} corpo={draft.corpo} onCorpoChange={mudarCorpo} onBusyChange={setEnviandoAnexo} disabled={salvando} compact />}

      <CorpoEditor
        corpo={draft.corpo}
        onCorpoChange={mudarCorpo}
        tipo="nota"
        espaco={espaco}
        placeholder="Escreva sua nota… Use #tags e [[links]] para conectar ideias."
        rows={modoFocus ? 18 : 10}
        layout="document"
        semBorda={modoFocus}
      />

      {!noPainel && <p className="flex items-center gap-2 text-sm text-text-secondary"><Cloud size={16} className="text-steel-300" />{enviandoAnexo || salvando ? "Sincronizando…" : "Salva automaticamente enquanto você edita."}</p>}
    </div>
  );
}
