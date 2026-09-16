import type { Cargo } from "@/lib/types";

/**
 * Team role — distinct colors, without excessive visual hierarchy
 * (section 3.7): amber only for the Owner, the other two discreet in
 * blue-gray.
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
