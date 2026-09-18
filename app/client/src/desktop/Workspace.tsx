import { Fragment, useRef, type PointerEvent } from "react";
import { PaneView } from "./PaneView";
import { useWorkspace, type Pane } from "./workspace-store";

const LARGURA_MINIMA_PX = 320;

function Divisor({ esquerda, direita }: { esquerda: Pane; direita: Pane }) {
  const { dispatch } = useWorkspace();
  const inicio = useRef<{ x: number; larguraTotal: number; tamanhoEsquerda: number; soma: number } | null>(null);

  function aoPressionar(e: PointerEvent<HTMLDivElement>) {
    const container = e.currentTarget.parentElement;
    if (!container) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    inicio.current = {
      x: e.clientX,
      larguraTotal: container.getBoundingClientRect().width,
      tamanhoEsquerda: esquerda.size,
      soma: esquerda.size + direita.size,
    };
  }

  function aoMover(e: PointerEvent<HTMLDivElement>) {
    const ini = inicio.current;
    if (!ini) return;
    const minimo = Math.min(LARGURA_MINIMA_PX / ini.larguraTotal, ini.soma / 2);
    const desejado = ini.tamanhoEsquerda + (e.clientX - ini.x) / ini.larguraTotal;
    const leftSize = Math.min(Math.max(desejado, minimo), ini.soma - minimo);
    dispatch({ type: "resize", leftPaneId: esquerda.id, rightPaneId: direita.id, leftSize });
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={aoPressionar}
      onPointerMove={aoMover}
      onPointerUp={() => (inicio.current = null)}
      onPointerCancel={() => (inicio.current = null)}
      className="group relative z-20 w-px shrink-0 cursor-col-resize bg-border"
    >
      <span className="absolute inset-y-0 -left-1.5 -right-1.5 transition-colors group-hover:bg-cyan/25 group-active:bg-cyan/40" />
    </div>
  );
}

export function Workspace() {
  const { state } = useWorkspace();

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-x-auto">
      {state.panes.map((pane, i) => (
        <Fragment key={pane.id}>
          {i > 0 && <Divisor esquerda={state.panes[i - 1]} direita={pane} />}
          <PaneView pane={pane} focada={pane.id === state.focusedPaneId && state.panes.length > 1} />
        </Fragment>
      ))}
    </div>
  );
}
