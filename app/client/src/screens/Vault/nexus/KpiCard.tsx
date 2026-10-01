// Portado do Nexus: components/KpiCard.tsx. Mantém a composição e as interações originais.
export function KpiCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  tone?: "income" | "expense";
}) {
  const valueColor = tone === "expense" ? "text-[var(--cofre-expense)]" : tone === "income" ? "text-[var(--cofre-income)]" : "text-[var(--text)]";
  return (
    <div className="cofre-card rounded-2xl p-4 pb-3.5">
      <div className="mb-2.5 flex items-center gap-1.5 text-[0.71rem] font-semibold text-[var(--text-muted)]">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`cofre-mono text-[1.28rem] font-bold ${valueColor}`}>{value}</div>
    </div>
  );
}
