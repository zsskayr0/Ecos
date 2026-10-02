import { ChevronDown } from "lucide-react";
import { MenuSuspenso, type OpcaoMenu } from "./MenuSuspenso";

interface Props<T extends string> {
  valor: T;
  opcoes: readonly OpcaoMenu<T>[];
  onChange: (valor: T) => void;
  ariaLabel: string;
  /** Classes do botão (o visual do antigo `<select>`). */
  classe?: string;
  alinhar?: "esq" | "dir";
  disabled?: boolean;
}

/** Substituto direto do `<select>` nativo: botão com seta + MenuSuspenso do Ecos. */
export function SeletorEcos<T extends string>({ valor, opcoes, onChange, ariaLabel, classe = "ecos-input", alinhar, disabled }: Props<T>) {
  return (
    <MenuSuspenso fixo valor={valor} opcoes={opcoes} onChange={onChange} ariaLabel={ariaLabel} alinhar={alinhar}
      classeGatilho={`${classe} flex items-center justify-between gap-2 text-left ${disabled ? "pointer-events-none opacity-50" : ""}`}
      gatilho={({ aberto, atual }) => <><span className="min-w-0 truncate">{atual?.rotulo}</span><ChevronDown size={14} className={`shrink-0 text-text-muted transition-transform duration-150 ${aberto ? "rotate-180" : ""}`} /></>} />
  );
}
