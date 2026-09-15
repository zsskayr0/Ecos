import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

/**
 * Estado vazio — "é onde a marca mais aparece" (seção 1.4). Copy calibrada
 * (humor sutil) deve vir de quem chama este componente, não daqui.
 */
export function EmptyState({ icon: Icon, title, subtitle, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-8 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-2">
        <Icon size={26} strokeWidth={1.5} className="text-text-muted" />
      </div>
      <p className="max-w-xs font-body text-[15px] font-medium leading-snug text-text-primary">{title}</p>
      {subtitle && <p className="max-w-xs text-sm leading-snug text-text-muted">{subtitle}</p>}
      {action}
    </div>
  );
}
