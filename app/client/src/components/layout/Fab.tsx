import { Plus } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useAppUI } from "@/lib/ui-context";

/**
 * Floating FAB, bottom-right corner, outside the nav (section 2.1).
 * Cyan→violet gradient; flips to violet→cyan inside the Vault. Contextual
 * behavior by origin (section 2.4): Feed opens the choice popup, Agenda
 * opens the Tarefa form directly, Vault opens the Transacao form directly.
 */
export function Fab() {
  const location = useLocation();
  const { abrirCaptura, diaCofre } = useAppUI();
  const noCofre = location.pathname.startsWith("/cofre");
  const naAgenda = location.pathname.startsWith("/agenda");

  function onClick() {
    if (noCofre) abrirCaptura("transacao", diaCofre);
    else if (naAgenda) abrirCaptura("tarefa");
    else abrirCaptura("escolha");
  }

  return (
    <button
      onClick={onClick}
      aria-label={noCofre ? "Nova transação" : "Criar"}
      className={`ecos-fab fixed right-[max(1.25rem,calc(var(--ecos-safe-right)+1rem))] z-40 flex h-14 w-14 items-center justify-center rounded-full text-on-accent shadow-nav ${noCofre ? "bottom-[calc(5rem+var(--ecos-safe-bottom))] md:bottom-[calc(2rem+var(--ecos-safe-bottom))]" : "bottom-[calc(6rem+var(--ecos-safe-bottom))]"}`}
      style={{
        background: noCofre
          ? "linear-gradient(135deg, var(--ecos-violet), var(--ecos-cyan))"
          : "linear-gradient(135deg, var(--ecos-cyan), var(--ecos-violet))",
      }}
    >
      <Plus size={26} strokeWidth={2} className="ecos-fab-icone" />
    </button>
  );
}
