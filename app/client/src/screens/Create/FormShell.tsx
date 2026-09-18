import type { ReactNode } from "react";
import { AlertTriangle, X } from "lucide-react";
import type { TipoCaptura } from "@/lib/ui-context";

const TIPOS: { tipo: TipoCaptura; label: string }[] = [
  { tipo: "nota", label: "Nota" },
  { tipo: "tarefa", label: "Tarefa" },
  { tipo: "transacao", label: "Transação" },
];

/**
 * Common shell for the 3 Capture forms. The type segmented control stays
 * visible and enabled at all times — switching type is always allowed
 * (rule 5), `CreateFlow` is what preserves the draft when switching.
 */
export function FormShell({
  tipoAtivo,
  onTrocarTipo,
  onFechar,
  erro,
  children,
  embedded = false,
}: {
  tipoAtivo: TipoCaptura;
  onTrocarTipo: (tipo: TipoCaptura) => void;
  onFechar: () => void;
  erro?: string | null;
  children: ReactNode;
  embedded?: boolean;
}) {
  return (
    <div className={`${embedded ? "flex h-full justify-center bg-base" : "fixed inset-0 z-50 flex justify-center bg-base"}`}>
      <div className={`flex h-full min-w-0 w-full flex-col ${tipoAtivo === "tarefa" ? "max-w-6xl md:px-6" : "max-w-md"}`}>
        <div className="ecos-capture-header flex items-center justify-between">
          <button onClick={onFechar} aria-label="Fechar" className="flex min-h-12 min-w-12 items-center justify-center rounded-xl">
            <X size={22} className="text-text-muted" />
          </button>
          <div className="flex rounded-pill bg-surface-2 p-1">
            {TIPOS.map(({ tipo, label }) => (
              <button
                key={tipo}
                onClick={() => onTrocarTipo(tipo)}
                className={`min-h-11 rounded-pill px-3 py-1.5 text-sm font-medium transition-colors ${
                  tipoAtivo === tipo ? "bg-surface-3 text-text-primary" : "text-text-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="hidden w-12 shrink-0 sm:block" />
        </div>
        <div className="ecos-capture-content min-h-0 flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+16px)]">
          {erro && (
            <div role="alert" className="mb-4 flex items-start gap-2 rounded-2xl border border-error/40 bg-error/10 p-3 text-sm text-error">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" strokeWidth={1.75} />
              {erro}
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
