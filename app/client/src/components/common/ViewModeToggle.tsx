import { Columns3, Grid2x2, LayoutGrid, List, ListTree, Table2 } from "lucide-react";
import { useState } from "react";
import { useIsDesktop } from "@/lib/use-viewport";
import { lerPreferenciasAplicativo } from "@/lib/preferencias-aplicativo";

/**
 * `cards` (feed) e `lista` existem em qualquer tela; `tabela`, `grade`, `kanban` e `matriz` só no
 * desktop — no mobile eles caem para `cards`, e no desktop `lista` cai para `cards`.
 * Em telas de tarefas o Feed também é só do mobile (no desktop vira `tabela`). `agrupada` é só do mobile (no desktop cai para `cards`). `kanban`, `agrupada` e `matriz` são visões de tarefas.
 */
export type ModoVisualizacao = "cards" | "lista" | "tabela" | "grade" | "kanban" | "agrupada" | "matriz";

const MODOS: ModoVisualizacao[] = ["cards", "lista", "tabela", "grade", "kanban", "agrupada", "matriz"];

/** O modo que de fato se aplica nesta tela: um modo guardado que o aparelho não suporta vira `cards`. */
export function modoEfetivo(modo: ModoVisualizacao, desktop: boolean, semFeedNoDesktop = false): ModoVisualizacao {
  // Telas de tarefas não têm Feed no desktop: o que seria cards vira tabela.
  if (desktop && semFeedNoDesktop && (modo === "cards" || modo === "lista" || modo === "agrupada")) return "tabela";
  if (desktop) return modo === "lista" || modo === "agrupada" ? "cards" : modo;
  return modo === "tabela" || modo === "grade" || modo === "kanban" || modo === "matriz" ? "cards" : modo;
}

/** Persists per browsing context (`notas`/`tarefas`/`feed`) so the choice sticks
 * across screens, not just the one you made it on — user feedback:
 * "quero visualização de várias formas, cards, lista, etc etc.". */
export function limparEscolhaDeVisualizacao(chave = "tarefas") {
  try { localStorage.removeItem(`ecos:visualizacao:${chave}`); } catch { /* sem armazenamento */ }
}

export function useModoVisualizacao(chave: string): [ModoVisualizacao, (m: ModoVisualizacao) => void] {
  const desktop = useIsDesktop();
  const [modo, setModoState] = useState<ModoVisualizacao>(() => {
    // Sem escolha feita na tela, vale o padrão das preferências (só Tarefas tem padrão configurável).
    const padrao: ModoVisualizacao = chave === "tarefas"
      ? (desktop ? lerPreferenciasAplicativo().visualizacaoTarefasDesktop : lerPreferenciasAplicativo().visualizacaoTarefasMobile)
      : "cards";
    try {
      const salvo = localStorage.getItem(`ecos:visualizacao:${chave}`) as ModoVisualizacao | null;
      return salvo && MODOS.includes(salvo) ? salvo : padrao;
    } catch {
      return padrao;
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

const OPCOES_TAREFAS = [
  { id: "kanban", Icone: Columns3, rotulo: "Kanban" },
  { id: "matriz", Icone: Grid2x2, rotulo: "Matriz" },
] as const;

/** `tarefas` liga as visões que só fazem sentido para tarefas (Kanban, Agrupada e Matriz). */
export function ViewModeToggle({ modo, onMudar, tarefas = false }: { modo: ModoVisualizacao; onMudar: (m: ModoVisualizacao) => void; tarefas?: boolean }) {
  const desktop = useIsDesktop();
  const atual = modoEfetivo(modo, desktop, tarefas);

  if (desktop) {
    return (
      <div className="flex rounded-lg border border-border bg-surface-2 p-1" role="group" aria-label="Visualização">
        {[...(tarefas ? OPCOES_DESKTOP.filter((o) => o.id !== "cards") : OPCOES_DESKTOP), ...(tarefas ? OPCOES_TAREFAS : [])].map(({ id, Icone, rotulo }) => (
          <button
            key={id}
            type="button"
            title={rotulo}
            aria-label={`Ver em ${rotulo.toLowerCase()}`}
            aria-pressed={atual === id}
            onClick={() => onMudar(id)}
            className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium ${
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
      {tarefas && (
        <button
          onClick={() => onMudar("agrupada")}
          aria-label="Ver agrupada"
          className={`flex h-7 w-7 items-center justify-center rounded-pill ${atual === "agrupada" ? "bg-steel-700 text-white" : "text-text-muted"}`}
        >
          <ListTree size={14} strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
}
