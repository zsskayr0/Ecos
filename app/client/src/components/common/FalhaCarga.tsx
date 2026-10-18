import { AlertTriangle } from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";

/** Passou disso carregando um detalhe (tarefa, nota, evento), o skeleton dá lugar a um erro com "Tentar de novo". */
export const PRAZO_CARGA_MS = 8_000;

/** Carregamento que não terminou (ou falhou): nunca deixa a pessoa olhando um skeleton sem saída. `ressalva`: ex. "A tarefa não foi apagada." */
export function FalhaCarga({ motivo, ressalva, aoTentar }: { motivo?: string | null; ressalva: string; aoTentar: () => void }) {
  return (
    <div role="alert">
      <EmptyState
        icon={AlertTriangle}
        title="Não consegui carregar."
        subtitle={`${motivo ?? "Está demorando mais que o normal."} ${ressalva}`}
        action={<button type="button" onClick={aoTentar} className="rounded-2xl bg-surface-2 px-4 py-2 text-sm font-medium text-text-primary">Tentar de novo</button>}
      />
    </div>
  );
}
