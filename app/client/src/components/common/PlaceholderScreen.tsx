import { useNavigate } from "react-router-dom";
import { ChevronLeft, type LucideIcon } from "lucide-react";

/**
 * Minimal, honest screen for routes the screen inventory (section 3)
 * doesn't cover in detail — never invents a flow, just flags the gap and
 * gives a way back.
 */
export function PlaceholderScreen({ icon: Icon, titulo, gap }: { icon: LucideIcon; titulo: string; gap: string }) {
  const navigate = useNavigate();
  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)]">
      <button onClick={() => navigate(-1)} className="mb-8 flex items-center gap-1 text-sm text-text-muted">
        <ChevronLeft size={18} />
        Voltar
      </button>
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <Icon size={26} strokeWidth={1.5} className="text-text-muted" />
        <p className="font-body text-[15px] font-medium text-text-primary">{titulo}</p>
        <p className="max-w-xs text-sm text-text-muted">{gap}</p>
      </div>
    </div>
  );
}
