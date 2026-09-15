import { useRef } from "react";
import { Bold, List, Link2, Code } from "lucide-react";
import type { CapturaDraft, SetDraft } from "./CreateFlow";
import { renderMarkdownMini } from "@/lib/markdown-mini";

interface Props {
  draft: CapturaDraft;
  setDraft: SetDraft;
  onSalvar: () => void;
  salvando?: boolean;
}

/** Nota form — Markdown toolbar + real preview (section 3.6). */
export function NoteForm({ draft, setDraft, onSalvar, salvando }: Props) {
  const areaRef = useRef<HTMLTextAreaElement>(null);

  function inserir(prefixo: string, sufixo = "") {
    const el = areaRef.current;
    if (!el) return;
    const inicio = el.selectionStart;
    const fim = el.selectionEnd;
    const selecionado = el.value.slice(inicio, fim);
    setDraft((prev) => ({
      ...prev,
      corpo: prev.corpo.slice(0, inicio) + prefixo + selecionado + sufixo + prev.corpo.slice(fim),
    }));
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = inicio + prefixo.length + selecionado.length;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <input
        value={draft.texto}
        onChange={(e) => setDraft({ ...draft, texto: e.target.value })}
        placeholder="Título da nota"
        className="w-full bg-transparent font-display text-2xl text-text-primary placeholder:text-text-muted focus:outline-none"
        autoFocus
      />

      <div className="flex items-center gap-1 rounded-xl bg-surface-2 p-1">
        <ToolbarBtn Icon={Bold} onClick={() => inserir("**", "**")} label="Negrito" />
        <ToolbarBtn Icon={List} onClick={() => inserir("- [ ] ")} label="Lista" />
        <ToolbarBtn Icon={Link2} onClick={() => inserir("[[", "]]")} label="Wikilink" />
        <ToolbarBtn Icon={Code} onClick={() => inserir("`", "`")} label="Código" />
      </div>

      <textarea
        ref={areaRef}
        value={draft.corpo}
        onChange={(e) => setDraft({ ...draft, corpo: e.target.value })}
        placeholder={"Escreva aqui. Use [[Nota]] pra linkar, `código` inline, - [ ] pra checkbox..."}
        rows={7}
        className="w-full resize-none rounded-2xl bg-surface-2 p-4 font-body text-[15px] text-text-primary placeholder:text-text-muted focus:outline-none"
      />

      {draft.corpo.trim() && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Preview</p>
          <div className="rounded-2xl border border-border bg-surface-1 p-4 text-sm">
            {renderMarkdownMini(draft.corpo)}
          </div>
        </div>
      )}

      <button
        onClick={onSalvar}
        disabled={!draft.texto.trim() || salvando}
        className="mt-2 rounded-2xl bg-steel-700 py-3.5 text-center font-body text-[15px] font-semibold text-white disabled:opacity-40"
      >
        {salvando ? "Salvando..." : "Salvar Nota"}
      </button>
    </div>
  );
}

function ToolbarBtn({ Icon, onClick, label }: { Icon: typeof Bold; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-3 hover:text-text-primary"
    >
      <Icon size={17} strokeWidth={1.75} />
    </button>
  );
}
