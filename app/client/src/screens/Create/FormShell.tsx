import type { ReactNode } from "react";
import { AlertTriangle, X } from "lucide-react";
import { SegmentedSlide, type OpcaoSlide } from "@/components/common/SegmentedSlide";
import type { TipoCaptura } from "@/lib/ui-context";

/** Verde = notas, azul = tarefas, roxo = transações. */
const TIPOS: OpcaoSlide<TipoCaptura>[] = [
  { value: "nota", label: "Nota", cor: "ecos-success" },
  { value: "tarefa", label: "Tarefa", cor: "ecos-cyan" },
  { value: "transacao", label: "Transação", cor: "ecos-violet" },
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
  tiposPermitidos = ["nota", "tarefa", "transacao"],
}: {
  tipoAtivo: TipoCaptura;
  onTrocarTipo: (tipo: TipoCaptura) => void;
  onFechar: () => void;
  erro?: string | null;
  children: ReactNode;
  embedded?: boolean;
  tiposPermitidos?: TipoCaptura[];
}) {
  const tipos = TIPOS.filter((tipo) => tiposPermitidos.includes(tipo.value));
  return (
    <div className={`${embedded ? "flex h-full justify-center bg-base" : "fixed inset-0 z-50 flex justify-center bg-base"}`} data-capture-type={tipoAtivo}>
      <div className={`flex h-full min-w-0 w-full flex-col ${embedded ? tipoAtivo === "transacao" ? "max-w-none" : "max-w-6xl px-6" : tipoAtivo === "tarefa" ? "max-w-6xl md:px-6" : "max-w-md"}`}>
        {tipos.length > 1 && <div className="ecos-capture-header grid grid-cols-[1fr_auto_1fr] items-center">
          {/* Embutida numa janela do desktop, quem fecha é o X da própria janela; em tela cheia (mobile) este é o único jeito de sair. */}
          {embedded ? (
            <div className="w-12 shrink-0" />
          ) : (
            <button onClick={onFechar} aria-label="Fechar" className="flex min-h-12 min-w-12 items-center justify-center justify-self-start rounded-xl transition-colors hover:bg-surface-2 active:scale-95">
              <X size={22} className="text-text-muted" />
            </button>
          )}
          <SegmentedSlide className="ecos-capture-slide" ariaLabel="Tipo de captura" tamanho="lg" value={tipoAtivo} onChange={onTrocarTipo} opcoes={tipos} />
          <div className="w-12 shrink-0" />
        </div>}
        <div className="ecos-capture-content min-h-0 flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+16px)]">
          {erro && (
            <div role="alert" className="mb-4 flex items-start gap-2 rounded-2xl border border-error/40 bg-error/10 p-3 text-sm text-error">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" strokeWidth={1.75} />
              {erro}
            </div>
          )}
          <div key={tipoAtivo} className="ecos-tipo-entra">{children}</div>
        </div>
      </div>
    </div>
  );
}
