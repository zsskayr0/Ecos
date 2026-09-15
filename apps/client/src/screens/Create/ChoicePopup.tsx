import { FileText, ListChecks, Wallet } from "lucide-react";
import type { TipoCaptura } from "@/lib/ui-context";

const OPCOES: { tipo: TipoCaptura; label: string; Icon: typeof FileText }[] = [
  { tipo: "nota", label: "Nota", Icon: FileText },
  { tipo: "tarefa", label: "Tarefa", Icon: ListChecks },
  { tipo: "transacao", label: "Transação", Icon: Wallet },
];

/**
 * Feed's choice popup (section 2.4/3.6) — 3 cards of equal visual weight,
 * no bias between them by order/size/color.
 */
export function ChoicePopup({
  onEscolher,
  onFechar,
}: {
  onEscolher: (tipo: TipoCaptura) => void;
  onFechar: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button aria-label="Fechar" onClick={onFechar} className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" />
      <div className="relative z-10 w-full max-w-md rounded-t-[28px] bg-surface-1 p-6 pb-10 ecos-fade-in sm:rounded-[28px]">
        <div className="mx-auto mb-5 h-1 w-10 rounded-pill bg-border sm:hidden" />
        <p className="mb-5 text-center font-body text-[15px] font-semibold text-text-primary">O que vamos capturar?</p>
        <div className="grid grid-cols-3 gap-3">
          {OPCOES.map(({ tipo, label, Icon }) => (
            <button
              key={tipo}
              onClick={() => onEscolher(tipo)}
              className="flex flex-col items-center gap-2.5 rounded-2xl border border-border bg-surface-2 px-2 py-5 text-text-primary transition-colors hover:border-steel-500/60"
            >
              <Icon size={24} strokeWidth={1.75} className="text-steel-300" />
              <span className="text-sm font-medium">{label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
