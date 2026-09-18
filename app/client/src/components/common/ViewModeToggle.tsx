import { LayoutGrid, List, Table2 } from "lucide-react";
import { useState } from "react";
import { useIsDesktop } from "@/lib/use-viewport";

/**
 * `cards` (feed) e `lista` existem em qualquer tela; `tabela` e `grade` só no
 * desktop — no mobile eles caem para `cards`, e no desktop `lista` cai para `cards`.
 */
export type ModoVisualizacao = "cards" | "lista" | "tabela" | "grade";

const MODOS: ModoVisualizacao[] = ["cards", "lista", "tabela", "grade"];

/** O modo que de fato se aplica nesta tela: um modo guardado que o aparelho não suporta vira `cards`. */
export function modoEfetivo(modo: ModoVisualizacao, desktop: boolean): ModoVisualizacao {
  if (desktop) return modo === "lista" ? "cards" : modo;
  return modo === "tabela" || modo === "grade" ? "cards" : modo;
}

/** Persists per browsing context (`notas`/`tarefas`/`feed`) so the choice sticks
 * across screens, not just the one you made it on — user feedback:
 * "quero visualização de várias formas, cards, lista, etc etc.". */
export function useModoVisualizacao(chave: string): [ModoVisualizacao, (m: ModoVisualizacao) => void] {
  const [modo, setModoState] = useState<ModoVisualizacao>(() => {
    try {
      const salvo = localStorage.getItem(`ecos:visualizacao:${chave}`) as ModoVisualizacao | null;
      return salvo && MODOS.includes(salvo) ? salvo : "cards";
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

const OPCOES_DESKTOP = [
  { id: "cards", Icone: List, rotulo: "Feed" },
  { id: "tabela", Icone: Table2, rotulo: "Tabela" },
  { id: "grade", Icone: LayoutGrid, rotulo: "Grade" },
] as const;

export function ViewModeToggle({ modo, onMudar }: { modo: ModoVisualizacao; onMudar: (m: ModoVisualizacao) => void }) {
  const desktop = useIsDesktop();
  const atual = modoEfetivo(modo, desktop);

  if (desktop) {
    return (
      <div className="flex rounded-lg border border-border bg-surface-2 p-1" role="group" aria-label="Visualização">
        {OPCOES_DESKTOP.map(({ id, Icone, rotulo }) => (
          <button
            key={id}
            type="button"
            title={rotulo}
            aria-label={`Ver em ${rotulo.toLowerCase()}`}
            aria-pressed={atual === id}
            onClick={() => onMudar(id)}
            className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium ${
              atual === id ? "bg-surface-3 text-text-primary" : "text-text-muted hover:text-text-secondary"
            }`}
          >
            <Icone size={15} strokeWidth={1.75} />
            {rotulo}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex items-center rounded-pill bg-surface-2 p-1">
      <button
        onClick={() => onMudar("cards")}
        aria-label="Ver em cards"
        className={`flex h-7 w-7 items-center justify-center rounded-pill ${atual === "cards" ? "bg-steel-700 text-white" : "text-text-muted"}`}
      >
        <LayoutGrid size={14} strokeWidth={1.75} />
      </button>
      <button
        onClick={() => onMudar("lista")}
        aria-label="Ver em lista"
        className={`flex h-7 w-7 items-center justify-center rounded-pill ${atual === "lista" ? "bg-steel-700 text-white" : "text-text-muted"}`}
      >
        <List size={14} strokeWidth={1.75} />
      </button>
    </div>
  );
}
