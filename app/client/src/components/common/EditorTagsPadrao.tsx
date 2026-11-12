import { useState } from "react";
import { X } from "lucide-react";
import { unirTags } from "@/lib/tags-pasta";

/** Lista de tags editável: digita e Enter (ou vírgula) para somar; o X tira. Usada nas tags padrão de pastas e das preferências. */
export function EditorTagsPadrao({ valor, onChange, label, placeholder = "Tag e Enter", id }: { valor: string[]; onChange: (tags: string[]) => void; label: string; placeholder?: string; id?: string }) {
  const [texto, setTexto] = useState("");
  function somar() {
    const novas = texto.split(",").map((t) => t.trim()).filter(Boolean);
    if (!novas.length) return;
    onChange(unirTags(valor, novas));
    setTexto("");
  }
  return (
    <div className="min-w-0">
      <input id={id} aria-label={label} value={texto} placeholder={placeholder} onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); somar(); } }} onBlur={somar}
        className="ecos-input w-full !rounded-lg" />
      {valor.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2" aria-label={`${label}: tags escolhidas`}>
          {valor.map((tag) => (
            <li key={tag} className="flex items-center gap-1 rounded-lg border border-border bg-surface-2 py-1 pl-2.5 pr-1 text-sm text-text-secondary">
              #{tag}
              <button type="button" aria-label={`Remover tag ${tag}`} onClick={() => onChange(valor.filter((t) => t !== tag))} className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted hover:bg-surface-3 hover:text-text-primary"><X size={13} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
