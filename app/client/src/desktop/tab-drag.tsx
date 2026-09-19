import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useWorkspace } from "./workspace-store";

export interface TabArrastada {
  tabId: string;
  paneId: string;
  titulo: string;
}

/** Onde a aba cairia se fosse solta agora: entre as abas de uma barra, ou numa zona do conteúdo de uma pane. */
export type AlvoArraste =
  | { tipo: "aba"; paneId: string; indice: number }
  | { tipo: "zona"; paneId: string; zona: "left" | "center" | "right" };

interface TabDragState {
  arrastando: TabArrastada | null;
  alvo: AlvoArraste | null;
  /** Liga o `onPointerDown` de uma aba: se o ponteiro andar o bastante, vira arrasto; senão continua sendo um clique. */
  aoPressionarAba: (e: ReactPointerEvent<HTMLElement>, tab: TabArrastada) => void;
}

const TabDragContext = createContext<TabDragState | null>(null);

/** Distância (px) que o ponteiro precisa andar antes de o clique virar arrasto. */
const LIMIAR_PX = 6;

/**
 * Arrasto de abas por eventos de ponteiro (mouse, toque e caneta), sem a API nativa de arrastar e soltar do HTML — que
 * o navegador cancela por conta própria em alguns ambientes e não existe de fato no toque. O alvo sai de
 * `elementsFromPoint`: barras de abas (`data-pane-tabbar`) dão a posição entre as abas (`data-tab-id`); o conteúdo de
 * uma pane (`data-pane-conteudo`) dá as zonas esquerda/centro/direita.
 */
export function TabDragProvider({ children }: { children: ReactNode }) {
  const { state, dispatch } = useWorkspace();
  const stateRef = useRef(state);
  stateRef.current = state;
  const [arrastando, setArrastando] = useState<TabArrastada | null>(null);
  const [alvo, setAlvo] = useState<AlvoArraste | null>(null);
  const [ponteiro, setPonteiro] = useState<{ x: number; y: number } | null>(null);
  const encerrarGesto = useRef<(() => void) | null>(null);

  useEffect(() => () => encerrarGesto.current?.(), []);

  const aoPressionarAba = useCallback(
    (e: ReactPointerEvent<HTMLElement>, tab: TabArrastada) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
      encerrarGesto.current?.();
      const pointerId = e.pointerId;
      const inicio = { x: e.clientX, y: e.clientY };
      let comecou = false;
      let alvoAtual: AlvoArraste | null = null;

      function descobrirAlvo(x: number, y: number): AlvoArraste | null {
        const seletor = "[data-pane-tabbar],[data-pane-conteudo]";
        const topo = document.elementsFromPoint(x, y).find((el) => el.closest(seletor));
        const el = topo?.closest<HTMLElement>(seletor);
        if (!el) return null;
        const paneBarra = el.getAttribute("data-pane-tabbar");
        if (paneBarra) {
          const abas = [...el.querySelectorAll<HTMLElement>("[data-tab-id]")].filter((t) => t.dataset.tabId !== tab.tabId);
          const indice = abas.filter((t) => {
            const r = t.getBoundingClientRect();
            return x > r.left + r.width / 2;
          }).length;
          return { tipo: "aba", paneId: paneBarra, indice };
        }
        const r = el.getBoundingClientRect();
        const fracao = (x - r.left) / r.width;
        return { tipo: "zona", paneId: el.getAttribute("data-pane-conteudo") ?? "", zona: fracao < 0.25 ? "left" : fracao > 0.75 ? "right" : "center" };
      }

      function aplicar(destino: AlvoArraste) {
        if (destino.tipo === "aba") {
          dispatch({ type: "move-tab", tabId: tab.tabId, toPaneId: destino.paneId, index: destino.indice });
          return;
        }
        const propria = tab.paneId === destino.paneId;
        const unicaAbaDaPane = propria && stateRef.current.panes.find((p) => p.id === destino.paneId)?.tabs.length === 1;
        if (destino.zona === "center") {
          if (!propria) dispatch({ type: "move-tab", tabId: tab.tabId, toPaneId: destino.paneId });
        } else if (!unicaAbaDaPane) {
          dispatch({ type: "move-tab-to-new-pane", tabId: tab.tabId, nextToPaneId: destino.paneId, side: destino.zona });
        }
      }

      function aoMover(ev: PointerEvent) {
        if (ev.pointerId !== pointerId) return;
        if (!comecou) {
          if (Math.hypot(ev.clientX - inicio.x, ev.clientY - inicio.y) < LIMIAR_PX) return;
          comecou = true;
          document.body.style.cursor = "grabbing";
          document.body.style.userSelect = "none";
          setArrastando(tab);
        }
        alvoAtual = descobrirAlvo(ev.clientX, ev.clientY);
        setAlvo(alvoAtual);
        setPonteiro({ x: ev.clientX, y: ev.clientY });
      }

      function finalizar(soltar: boolean) {
        window.removeEventListener("pointermove", aoMover);
        window.removeEventListener("pointerup", aoSoltar);
        window.removeEventListener("pointercancel", aoCancelar);
        window.removeEventListener("keydown", aoTecla);
        encerrarGesto.current = null;
        if (comecou) {
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
          if (soltar && alvoAtual) aplicar(alvoAtual);
          // O clique que o navegador dispara depois de soltar não pode ativar a aba nem fechar nada.
          const engolir = (ev: MouseEvent) => {
            ev.stopPropagation();
            ev.preventDefault();
          };
          window.addEventListener("click", engolir, { capture: true, once: true });
          window.setTimeout(() => window.removeEventListener("click", engolir, true), 0);
        }
        setArrastando(null);
        setAlvo(null);
        setPonteiro(null);
      }
      function aoSoltar(ev: PointerEvent) {
        if (ev.pointerId === pointerId) finalizar(true);
      }
      function aoCancelar(ev: PointerEvent) {
        if (ev.pointerId === pointerId) finalizar(false);
      }
      function aoTecla(ev: KeyboardEvent) {
        if (ev.key === "Escape") finalizar(false);
      }

      window.addEventListener("pointermove", aoMover);
      window.addEventListener("pointerup", aoSoltar);
      window.addEventListener("pointercancel", aoCancelar);
      window.addEventListener("keydown", aoTecla);
      encerrarGesto.current = () => finalizar(false);
    },
    [dispatch],
  );

  const value = useMemo<TabDragState>(() => ({ arrastando, alvo, aoPressionarAba }), [arrastando, alvo, aoPressionarAba]);
  return (
    <TabDragContext.Provider value={value}>
      {children}
      {arrastando && ponteiro && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-[1000] max-w-[220px] truncate rounded-md border border-cyan/50 bg-surface-2 px-3 py-1.5 text-xs text-text-primary shadow-nav"
          style={{ left: ponteiro.x + 12, top: ponteiro.y + 12 }}
        >
          {arrastando.titulo}
        </div>
      )}
    </TabDragContext.Provider>
  );
}

export function useTabDrag() {
  const ctx = useContext(TabDragContext);
  if (!ctx) throw new Error("useTabDrag must be used inside <TabDragProvider>");
  return ctx;
}
