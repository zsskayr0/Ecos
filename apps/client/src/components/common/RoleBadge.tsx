import type { Cargo } from "@/lib/types";

/**
 * Cargo de Equipe — cores distintas, sem hierarquia visual excessiva
 * (seção 3.7): âmbar só pro Dono, os outros dois discretos em cinza-azulado.
 */
const estilos: Record<Cargo, { label: string; className: string }> = {
  dono: { label: "Dono", className: "text-warning border-warning/40 bg-warning/10" },
  admin: { label: "Administrador", className: "text-steel-300 border-steel-500/40 bg-steel-700/20" },
  membro: { label: "Membro", className: "text-text-secondary border-border bg-surface-2" },
};

export function RoleBadge({ cargo }: { cargo: Cargo }) {
  const s = estilos[cargo];
  return (
    <span className={`rounded-pill border px-2.5 py-0.5 text-xs font-medium ${s.className}`}>{s.label}</span>
  );
}
