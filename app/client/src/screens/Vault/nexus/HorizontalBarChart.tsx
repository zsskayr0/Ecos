// Portado do Nexus: components/charts/HorizontalBarChart.tsx. Mantém a composição e as interações originais.
import { formatMoeda as formatCentsToBRL } from "@/lib/format";
import { EmptyChart } from "./EmptyChart";

export interface HorizontalBarItem {
  label: string;
  valueCents: number;
}

/** Lista ordenada com barra proporcional — usada tanto pra "por forma de pagamento" quanto pro ranking de maiores despesas. */
export function HorizontalBarChart({ items, color, onSelect }: { items: HorizontalBarItem[]; color: string; onSelect?: (index: number) => void }) {
  if (items.length === 0) return <EmptyChart />;

  const max = Math.max(...items.map((i) => i.valueCents), 1);

  return (
    <div className="flex flex-col gap-2.5">
      {items.map((item, index) => (
        <button type="button" className="cofre-chart-row" onClick={()=>onSelect?.(index)} key={`${index}:${item.label}`} title={`${item.label} · ${formatCentsToBRL(item.valueCents)}`}>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="truncate text-[0.74rem] font-semibold text-[var(--text-muted)]">{item.label}</span>
            <span className="cofre-mono flex-none text-[0.74rem] font-bold text-[var(--text)]">{formatCentsToBRL(item.valueCents)}</span>
          </div>
          <div className="h-[6px] overflow-hidden rounded-full bg-[var(--bg)]">
            <div
              className="h-full rounded-full transition-[width] duration-300 ease-out"
              style={{ width: `${Math.max((item.valueCents / max) * 100, 3)}%`, background: color }}
            />
          </div>
        </button>
      ))}
    </div>
  );
}
