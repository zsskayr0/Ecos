import { Check, Loader2 } from "lucide-react";

export function FloatingSaveButton({ onSave, disabled, saving = false }: {
  onSave: () => void; disabled?: boolean; saving?: boolean;
}) {
  return <button type="button" onClick={onSave} disabled={disabled || saving}
    className="ecos-floating-save fixed z-30 flex min-h-12 items-center justify-center gap-2 rounded-full border border-steel-400/30 bg-steel-700 px-5 py-3 text-sm font-semibold text-white shadow-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-steel-400 disabled:opacity-50"
    aria-label="Salvar alterações" aria-busy={saving}>
    {saving ? <Loader2 size={18} className="animate-spin motion-reduce:animate-none" /> : <Check size={18} />}
    {saving ? "Salvando..." : "Salvar"}
  </button>;
}
