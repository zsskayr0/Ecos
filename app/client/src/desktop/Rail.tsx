import { RAIL_PRINCIPAL, RAIL_UTILITARIOS, moduloDaRota, moduloPorId, type ModuloId } from "./modules";
import { useWorkspace } from "./workspace-store";

/** Rail fino: lança módulos no painel em foco; Ctrl/Cmd+clique abre numa nova coluna. */
export function Rail() {
  const { state, dispatch } = useWorkspace();
  const focada = state.panes.find((p) => p.id === state.focusedPaneId);
  const abaAtiva = focada?.tabs.find((t) => t.id === focada.activeTabId);
  const moduloAtivo = abaAtiva ? moduloDaRota(abaAtiva.path).id : null;

  function botao(id: ModuloId) {
    const modulo = moduloPorId(id);
    const ativo = moduloAtivo === id;
    return (
      <button
        key={id}
        type="button"
        aria-label={modulo.titulo}
        aria-current={ativo ? "page" : undefined}
        title={`${modulo.titulo} — Ctrl+clique abre ao lado`}
        onClick={(e) =>
          dispatch({
            type: "open",
            path: modulo.raiz,
            where: e.ctrlKey || e.metaKey ? "new-pane" : "focused",
            reuse: "modulo",
          })
        }
        className={`relative flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
          ativo ? "bg-surface-2 text-text-primary" : "text-text-muted hover:bg-surface-2 hover:text-text-primary"
        }`}
      >
        {ativo && <span className="absolute -left-2 top-2 bottom-2 w-0.5 rounded-full bg-cyan" />}
        <modulo.icone size={19} strokeWidth={1.75} />
      </button>
    );
  }

  return (
    <nav aria-label="Módulos" className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-border bg-surface-1 py-2.5">
      {RAIL_PRINCIPAL.map(botao)}
      <div className="mt-auto flex flex-col items-center gap-1">{RAIL_UTILITARIOS.map(botao)}</div>
    </nav>
  );
}
