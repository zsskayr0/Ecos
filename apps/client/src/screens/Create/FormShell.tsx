import type { ReactNode } from "react";
import { AlertTriangle, X } from "lucide-react";
import type { TipoCaptura } from "@/lib/ui-context";

const TIPOS: { tipo: TipoCaptura; label: string }[] = [
  { tipo: "nota", label: "Nota" },
  { tipo: "tarefa", label: "Tarefa" },
  { tipo: "transacao", label: "Transação" },
];

/**
 * Casca comum dos 3 formulários de Captura. O segmented control de tipo
 * fica sempre visível e habilitado — trocar de tipo é sempre permitido
 * (regra 5), o `CreateFlow` é quem preserva o rascunho ao trocar.
 */
export function FormShell({
  tipoAtivo,
  onTrocarTipo,
  onFechar,
  erro,
  children,
}: {
  tipoAtivo: TipoCaptura;
  onTrocarTipo: (tipo: TipoCaptura) => void;
  onFechar: () => void;
  erro?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-base">
      <div className="flex h-full w-full max-w-md flex-col">
        <div className="flex items-center justify-between px-4 pt-[calc(env(safe-area-inset-top)+14px)] pb-3">
          <button onClick={onFechar} aria-label="Fechar">
            <X size={22} className="text-text-muted" />
          </button>
          <div className="flex rounded-pill bg-surface-2 p-1">
            {TIPOS.map(({ tipo, label }) => (
              <button
                key={tipo}
                onClick={() => onTrocarTipo(tipo)}
                className={`rounded-pill px-3 py-1.5 text-sm font-medium transition-colors ${
                  tipoAtivo === tipo ? "bg-surface-3 text-text-primary" : "text-text-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="w-[22px]" />
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-8">
          {erro && (
            <div className="mb-4 flex items-start gap-2 rounded-2xl border border-error/40 bg-error/10 p-3 text-sm text-error">
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
