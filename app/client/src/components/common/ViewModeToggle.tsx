import { LayoutGrid, List } from "lucide-react";
import { useState } from "react";

export type ModoVisualizacao = "cards" | "lista";

/** Persists per browsing context (`notas`/`tarefas`) so the choice sticks
 * across screens, not just the one you made it on — user feedback:
 * "quero visualização de várias formas, cards, lista, etc etc.". */
export function useModoVisualizacao(chave: string): [ModoVisualizacao, (m: ModoVisualizacao) => void] {
  const [modo, setModoState] = useState<ModoVisualizacao>(() => {
    try {
      const salvo = localStorage.getItem(`ecos:visualizacao:${chave}`);
      return salvo === "lista" ? "lista" : "cards";
    } catch {
      return "cards";
    }
  });

  function setModo(m: ModoVisualizacao) {
    setModoState(m);
    try {
      localStorage.setItem(`ecos:visualizacao:${chave}`, m);
    } catch {
      // Private window / blocked storage — the toggle still works for this session, just doesn't stick.
    }
  }

  return [modo, setModo];
}

export function ViewModeToggle({ modo, onMudar }: { modo: ModoVisualizacao; onMudar: (m: ModoVisualizacao) => void }) {
  return (
    <div className="flex items-center rounded-pill bg-surface-2 p-1">
      <button
        onClick={() => onMudar("cards")}
        aria-label="Ver em cards"
        className={`flex h-7 w-7 items-center justify-center rounded-pill ${modo === "cards" ? "bg-steel-700 text-white" : "text-text-muted"}`}
      >
        <LayoutGrid size={14} strokeWidth={1.75} />
      </button>
      <button
        onClick={() => onMudar("lista")}
        aria-label="Ver em lista"
        className={`flex h-7 w-7 items-center justify-center rounded-pill ${modo === "lista" ? "bg-steel-700 text-white" : "text-text-muted"}`}
      >
        <List size={14} strokeWidth={1.75} />
      </button>
    </div>
  );
}
