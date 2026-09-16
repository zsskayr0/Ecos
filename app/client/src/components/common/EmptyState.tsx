import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

/**
 * Empty state — "it's where the brand shows up the most" (section 1.4).
 * Calibrated copy (subtle humor) should come from the caller, not from
 * here.
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
