import { Loader2 } from "lucide-react";

/** Único indicador de carregamento das telas: anuncia o estado a leitores de tela e respeita "reduzir movimento". */
export function EstadoCarregando({ texto = "Carregando…" }: { texto?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center justify-center gap-2 px-8 py-10 text-sm text-text-muted">
      <Loader2 size={16} aria-hidden className="animate-spin motion-reduce:animate-none" />
      {texto}
    </div>
  );
}
