import { useLayoutEffect, useRef, type ReactNode } from "react";
import { ChevronLeft } from "lucide-react";

export const DETAIL_ACTION = "flex min-h-12 min-w-12 items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400 disabled:opacity-40";

/** Shared safe-area header; its measured height keeps floating editors below it. */
export function DetailHeader({ onBack, actions }: { onBack: () => void; actions?: ReactNode }) {
  const header = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = header.current;
    const page = element?.closest<HTMLElement>(".ecos-detail-page");
    if (!element || !page) return;
    const measure = () => page.style.setProperty("--ecos-editor-sticky-top", `${element.getBoundingClientRect().height + 12}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element, { box: "border-box" });
    return () => { observer.disconnect(); page.style.removeProperty("--ecos-editor-sticky-top"); };
  }, []);

  return <header ref={header} className="ecos-detail-header sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-border bg-base" aria-label="Ações do documento">
    <button type="button" onClick={onBack} className={`${DETAIL_ACTION} text-text-secondary`}><ChevronLeft size={20} />Voltar</button>
    {actions && <div className="flex items-center gap-1 sm:gap-3">{actions}</div>}
  </header>;
}
