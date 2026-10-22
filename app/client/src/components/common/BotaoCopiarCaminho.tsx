import { Link2 } from "lucide-react";
import { copiarCaminho, type EntradaCaminho } from "@/lib/caminho-item";
import { useMinhasEquipes } from "@/lib/use-minhas-equipes";

interface Props extends Omit<EntradaCaminho, "equipes"> {
  /** `icone` = botão quadrado; `rotulo` = ícone + texto (cabeçalho mobile); `pequeno` = ícone compacto (modo Focus). */
  variante: "icone" | "rotulo" | "pequeno";
  className?: string;
}

const ROTULO = { nota: "Copiar caminho da nota", tarefa: "Copiar caminho da tarefa", evento: "Copiar caminho do evento" } as const;

/** Copia o caminho completo do item (espaço / tipo / pastas / título) para a área de transferência. */
export function BotaoCopiarCaminho({ variante, className = "", ...item }: Props) {
  const { equipes } = useMinhasEquipes();
  const rotulo = ROTULO[item.tipo];
  const base = variante === "icone"
    ? "flex min-h-[52px] min-w-[52px] shrink-0 items-center justify-center rounded-xl border border-border text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
    : variante === "pequeno"
      ? "flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-3 hover:text-text-primary"
      : "flex min-h-12 min-w-12 items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-medium text-text-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400";
  return (
    <button type="button" aria-label={rotulo} title={rotulo} onClick={() => void copiarCaminho({ ...item, equipes })} className={`${base} ${className}`}>
      <Link2 size={variante === "pequeno" ? 15 : variante === "icone" ? 17 : 18} />{variante === "rotulo" && "Copiar caminho"}
    </button>
  );
}
