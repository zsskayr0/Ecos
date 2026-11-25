import { useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, PanelRightClose, PanelRightOpen, X } from "lucide-react";
import { SegmentedSlide, type OpcaoSlide } from "@/components/common/SegmentedSlide";
import { AcoesFocusContext, ModoFocusDocumentoContext, PainelFocusControleContext } from "@/lib/documento-popup";
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
  // Maximizada (Focus), o seletor de tipo vai para a barra da janela, como as ações da tarefa existente.
  const focoDocumento = useContext(ModoFocusDocumentoContext);
  const acoesFocus = useContext(AcoesFocusContext);
  const noCabecalho = embedded && focoDocumento && !!acoesFocus;
  const painelFocus = useContext(PainelFocusControleContext);
  const rotuloPainel = painelFocus.aberto ? "Recolher painel lateral" : "Expandir painel lateral";
  const tipos = TIPOS.filter((tipo) => tiposPermitidos.includes(tipo.value));
  const titulo = !embedded && tipoAtivo !== "transacao" ? (tipoAtivo === "nota" ? "Nova nota" : "Nova tarefa") : null;
  const largura = tipoAtivo === "transacao"
    ? (embedded ? "max-w-none" : "max-w-md")
    : (embedded ? (noCabecalho ? "max-w-none px-8" : "max-w-6xl px-6") : "max-w-6xl [--ecos-margem-captura:16px]");
  return (
    <div className={`${embedded ? "flex h-full justify-center bg-base" : "fixed inset-0 z-50 flex justify-center bg-base"}`} data-capture-type={tipoAtivo}>
      <div className={`flex h-full min-w-0 w-full flex-col ${largura}`}>
        {noCabecalho && createPortal(<>
          {tipoAtivo !== "transacao" && <>
            <button type="button" onClick={painelFocus.alternar} aria-pressed={painelFocus.aberto} aria-label={rotuloPainel} title={rotuloPainel} className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-3 hover:text-text-primary">{painelFocus.aberto ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}</button>
            <span aria-hidden className="mx-1 h-4 w-px bg-border" />
          </>}
        </>, acoesFocus!)}
        {!noCabecalho && !(tipoAtivo === "transacao" && !embedded) && (!embedded || tipos.length > 1) && <div className={`ecos-capture-header flex items-center gap-2 ${embedded ? "justify-center" : ""} ${titulo ? "!pb-2" : ""}`}>
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
