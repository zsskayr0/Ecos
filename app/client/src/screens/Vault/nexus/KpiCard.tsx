// Portado do Nexus: components/KpiCard.tsx. Mantém a composição e as interações originais.
import type { ModoValor } from "@/lib/exibicao-valores";
import { ValorComIndicador } from "./IndicadorValor";

export function KpiCard({
  label,
  value,
  icon,
  tone,
  modo = "numero",
  numero = 0,
  max = 0,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  tone?: "income" | "expense";
  /** Indicador ao lado do valor; `numero` é o valor em centavos e `max` o maior valor do painel (100%). */
  modo?: ModoValor;
  numero?: number;
  max?: number;
}) {
  const valueColor = tone === "expense" ? "text-[var(--cofre-expense)]" : tone === "income" ? "text-[var(--cofre-income)]" : "text-[var(--text)]";
  return (
    <div className="cofre-card rounded-2xl p-4 pb-3.5">
      <div className="mb-2.5 flex items-center gap-1.5 text-[0.71rem] font-semibold text-[var(--text-muted)]">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`cofre-mono text-[1.28rem] font-bold ${valueColor}`}><ValorComIndicador modo={modo} valor={numero} max={max} cor={tone === "expense" ? "var(--cofre-expense)" : tone === "income" ? "var(--cofre-income)" : undefined}>{value}</ValorComIndicador></div>
    </div>
  );
}
