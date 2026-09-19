import { useEffect, useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { RAIL_PRINCIPAL, RAIL_UTILITARIOS, moduloDaRota, moduloPorId, type ModuloId } from "./modules";
import { useWorkspace } from "./workspace-store";

const CHAVE_EXPANDIDA = "ecos.desktop.rail.expandida";

function lerExpandida(): boolean {
  try { return localStorage.getItem(CHAVE_EXPANDIDA) === "1"; } catch { return false; }
}

/** Rail lateral: fino (só ícones) ou expandido (ícone + nome). Ctrl/Cmd+B alterna; a escolha é lembrada. */
export function Rail() {
  const [expandida, setExpandida] = useState(lerExpandida);
  useEffect(() => { try { localStorage.setItem(CHAVE_EXPANDIDA, expandida ? "1" : "0"); } catch { /* cache indisponível */ } }, [expandida]);
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setExpandida((v) => !v);
      }
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, []);
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
        title={expandida ? "Ctrl+clique abre ao lado" : `${modulo.titulo} — Ctrl+clique abre ao lado`}
        onClick={(e) =>
          dispatch({
            type: "open",
            path: modulo.raiz,
            where: e.ctrlKey || e.metaKey ? "new-pane" : "focused",
            reuse: "modulo",
          })
        }
        className={`relative flex h-10 items-center rounded-xl transition-colors ${expandida ? "w-full gap-3 px-3" : "w-10 justify-center"} ${
          ativo ? "bg-surface-2 text-text-primary" : "text-text-muted hover:bg-surface-2 hover:text-text-primary"
        }`}
      >
        {ativo && <span className="absolute -left-2 top-2 bottom-2 w-0.5 rounded-full bg-cyan" />}
        <modulo.icone size={19} strokeWidth={1.75} className="shrink-0" />
        {expandida && <span className="truncate text-sm font-medium">{modulo.titulo}</span>}
      </button>
    );
  }

  return (
    <nav aria-label="Módulos" data-expandida={expandida}
      className={`flex shrink-0 flex-col gap-1 overflow-hidden border-r border-border bg-surface-1 py-2.5 transition-[width] duration-200 motion-reduce:transition-none ${expandida ? "w-52 items-stretch px-2" : "w-14 items-center"}`}>
      {RAIL_PRINCIPAL.map(botao)}
      <div className={`mt-auto flex flex-col gap-1 ${expandida ? "items-stretch" : "items-center"}`}>
        {RAIL_UTILITARIOS.map(botao)}
        <button type="button" onClick={() => setExpandida((v) => !v)} aria-expanded={expandida}
          aria-label={expandida ? "Recolher menu lateral" : "Expandir menu lateral"} title={`${expandida ? "Recolher" : "Expandir"} menu (Ctrl+B)`}
          className={`flex h-10 items-center rounded-xl text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary ${expandida ? "w-full gap-3 px-3" : "w-10 justify-center"}`}>
          {expandida ? <PanelLeftClose size={19} strokeWidth={1.75} className="shrink-0" /> : <PanelLeftOpen size={19} strokeWidth={1.75} className="shrink-0" />}
          {expandida && <span className="truncate text-sm font-medium">Recolher menu</span>}
        </button>
      </div>
    </nav>
  );
}
