import { TabBar } from "./TabBar";
import { TabContent } from "./TabContent";
import { useTabDrag } from "./tab-drag";
import { useWorkspace, type Pane } from "./workspace-store";

/** Só existe durante um arraste de aba, e só desenha: bordas laterais dividem o painel, o centro move a aba para dentro dele. Quem decide o alvo é `tab-drag.tsx`. */
function DropZones({ pane }: { pane: Pane }) {
  const { arrastando, alvo } = useTabDrag();
  if (!arrastando) return null;

  const propria = arrastando.paneId === pane.id;
  const unicaAbaDaPane = propria && pane.tabs.length === 1;
  const zona = alvo?.tipo === "zona" && alvo.paneId === pane.id ? alvo.zona : null;

  const destaque = "absolute inset-y-2 rounded-lg border border-cyan/60 bg-cyan/10 transition-all";
  return (
    <div className="pointer-events-none absolute inset-0 top-9 z-30">
      {zona === "left" && !unicaAbaDaPane && <div className={`${destaque} left-2 w-1/2`} />}
      {zona === "right" && !unicaAbaDaPane && <div className={`${destaque} right-2 w-1/2`} />}
      {zona === "center" && !propria && <div className={`${destaque} inset-x-2`} />}
    </div>
  );
}

export function PaneView({ pane, focada }: { pane: Pane; focada: boolean }) {
  const { state, dispatch, fechando } = useWorkspace();
  const recolhendo = state.panes.length > 1 && pane.tabs.length > 0 && pane.tabs.every((t) => fechando.includes(t.id));

  return (
    <section
      aria-label="Painel"
      onPointerDownCapture={() => dispatch({ type: "focus-pane", paneId: pane.id })}
      className={`relative flex min-w-[320px] flex-col bg-base ${focada ? "" : "opacity-[0.97]"}`}
      style={
        recolhendo
          ? { flex: "0 1 0px", minWidth: 0, opacity: 0, overflow: "hidden", transition: "flex-grow 180ms ease, opacity 180ms ease" }
          : { flex: `${pane.size} 1 0px` }
      }
    >
      <TabBar pane={pane} />
      {focada && <span aria-hidden className="pointer-events-none absolute inset-x-0 top-[35px] z-10 h-px bg-cyan/60" />}
      <div data-pane-conteudo={pane.id} className="relative min-h-0 flex-1">
        {pane.tabs.map((tab) => (
          <TabContent key={tab.id} tabId={tab.id} path={tab.path} visible={tab.id === pane.activeTabId} fechando={fechando.includes(tab.id)} />
        ))}
      </div>
      <DropZones pane={pane} />
    </section>
  );
}
