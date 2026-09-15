import { Plus } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useAppUI } from "@/lib/ui-context";

/**
 * FAB flutuante, canto inferior direito, fora da nav (seção 2.1). Gradiente
 * cyan→violeta; inverte pra violeta→cyan dentro do Cofre. Comportamento
 * contextual por origem (seção 2.4): Feed abre popup de escolha, Agenda
 * abre Tarefa direto, Cofre abre Transação direto.
 */
export function Fab() {
  const location = useLocation();
  const { abrirCaptura } = useAppUI();
  const noCofre = location.pathname.startsWith("/cofre");
  const naAgenda = location.pathname.startsWith("/agenda");

  function onClick() {
    if (noCofre) abrirCaptura("transacao");
    else if (naAgenda) abrirCaptura("tarefa");
    else abrirCaptura("escolha");
  }

  return (
    <button
      onClick={onClick}
      aria-label="Criar"
      className="fixed bottom-24 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full text-white shadow-nav transition-transform active:scale-95"
      style={{
        background: noCofre
          ? "linear-gradient(135deg, var(--ecos-violet), var(--ecos-cyan))"
          : "linear-gradient(135deg, var(--ecos-cyan), var(--ecos-violet))",
      }}
    >
      <Plus size={26} strokeWidth={2} />
    </button>
  );
}
