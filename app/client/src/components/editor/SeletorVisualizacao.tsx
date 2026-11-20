import { FileText, ScrollText } from "lucide-react";
import type { ModoVisualNota } from "@/lib/modo-visual-nota";

/** Fluido ou Página, para o menu "⋯" da nota (leitura e edição). Travado em Página quando há escrita à mão. */
export function SeletorVisualizacao({ modo, travado, aoEscolher }: { modo: ModoVisualNota; travado: boolean; aoEscolher: (m: ModoVisualNota) => void }) {
  return (
    <div>
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted">Visualização</span>
      <div className="flex gap-1.5" role="radiogroup" aria-label="Visualização da nota">
        {([["fluido", "Fluido", ScrollText], ["pagina", "Página", FileText]] as const).map(([id, rotulo, Icone]) => {
          const ativo = (travado ? "pagina" : modo) === id;
          return <button key={id} type="button" role="radio" aria-checked={ativo} disabled={travado} onClick={() => aoEscolher(id)}
            className={`flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm transition-colors disabled:opacity-60 ${ativo ? "border-steel-400 bg-steel-500/20 text-text-primary" : "border-border text-text-secondary hover:bg-surface-2"}`}><Icone size={15} aria-hidden />{rotulo}</button>;
        })}
      </div>
      {travado && <p className="mt-1.5 text-xs text-text-muted">Com escrita à mão a nota fica em Página.</p>}
    </div>
  );
}
