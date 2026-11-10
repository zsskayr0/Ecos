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

/** A janela do desktop pode trocar o tipo. No mobile, o tipo é escolhido antes de abrir o formulário. */
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
  const titulo = !embedded && tipoAtivo !== "transacao" ? (tipoAtivo === "nota" ? "Nova nota" : "Nova tarefa") : null;
  const largura = tipoAtivo === "transacao"
    ? (embedded ? "max-w-none" : "max-w-md")
    : (embedded ? "max-w-6xl px-6" : "max-w-6xl [--ecos-margem-captura:16px]");
  return (
    <div className={`${embedded ? "flex h-full justify-center bg-base" : "fixed inset-0 z-50 flex justify-center bg-base"}`} data-capture-type={tipoAtivo}>
      <div className={`flex h-full min-w-0 w-full flex-col ${largura}`}>
        {(!embedded || tipos.length > 1) && <div className={`ecos-capture-header flex items-center gap-2 ${embedded ? "justify-center" : ""} ${titulo ? "!pb-2" : ""}`}>
          {titulo && <h1 className="min-w-0 flex-1 font-display text-xl font-semibold text-text-primary">{titulo}</h1>}
          {embedded ? (
            <SegmentedSlide className="ecos-capture-slide" ariaLabel="Tipo de captura" tamanho="lg" value={tipoAtivo} onChange={onTrocarTipo} opcoes={tipos} />
          ) : (
            <button type="button" onClick={onFechar} aria-label="Fechar" className="flex min-h-12 min-w-12 shrink-0 items-center justify-center rounded-xl transition-colors hover:bg-surface-2 active:scale-95">
              <X size={22} className="text-text-muted" />
            </button>
          )}
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
