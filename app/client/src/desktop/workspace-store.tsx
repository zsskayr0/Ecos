import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type Dispatch, type ReactNode } from "react";
import { moduloDaRota } from "./modules";
import { DURACAO_SAIDA_ABA_MS, reduzMovimento } from "./movimento";

export interface Tab {
  id: string;
  path: string;
  title?: string;
}

export interface Pane {
  id: string;
  tabs: Tab[];
  activeTabId: string;
  /** Fração da largura do workspace (todas as panes somam 1). */
  size: number;
}

export interface WorkspaceState {
  panes: Pane[];
  focusedPaneId: string;
}

export type Side = "left" | "right";

export type WorkspaceAction =
  | { type: "open"; path: string; where: "focused" | "new-pane"; reuse: "modulo" | "path" }
  | { type: "close-tab"; paneId: string; tabId: string }
  | { type: "activate-tab"; paneId: string; tabId: string }
  | { type: "focus-pane"; paneId: string }
  | { type: "cycle-tab"; dir: 1 | -1 }
  | { type: "move-tab"; tabId: string; toPaneId: string; index?: number }
  | { type: "move-tab-to-new-pane"; tabId: string; nextToPaneId: string; side: Side }
  | { type: "split-active-right" }
  | { type: "resize"; leftPaneId: string; rightPaneId: string; leftSize: number }
  | { type: "navigated"; tabId: string; path: string }
  | { type: "set-tab-title"; tabId: string; title: string };

const STORAGE_KEY = "ecos.desktop.workspace.v1";

function novoId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function novaAba(path: string): Tab {
  return { id: novoId(), path };
}

function novaPane(path: string, size: number): Pane {
  const tab = novaAba(path);
  return { id: novoId(), tabs: [tab], activeTabId: tab.id, size };
}

export function estadoInicial(): WorkspaceState {
  const pane = novaPane("/agenda", 1);
  return { panes: [pane], focusedPaneId: pane.id };
}

/** Garante os invariantes: ≥1 pane, ≥1 aba por pane, aba ativa válida, foco válido, tamanhos somando 1. */
function normalizar(state: WorkspaceState): WorkspaceState {
  let panes = state.panes.filter((p) => p.tabs.length > 0);
  if (panes.length === 0) return estadoInicial();

  panes = panes.map((p) =>
    p.tabs.some((t) => t.id === p.activeTabId) ? p : { ...p, activeTabId: p.tabs[0].id },
  );
  const total = panes.reduce((soma, p) => soma + p.size, 0);
  panes = panes.map((p) => ({ ...p, size: total > 0 ? p.size / total : 1 / panes.length }));

  const focusedPaneId = panes.some((p) => p.id === state.focusedPaneId) ? state.focusedPaneId : panes[0].id;
  return { panes, focusedPaneId };
}

function inserirPaneAoLado(panes: Pane[], refId: string, side: Side, nova: Pane): Pane[] {
  const idx = panes.findIndex((p) => p.id === refId);
  const ref = panes[idx];
  // A nova pane nasce com metade da pane de referência — o resto do layout não se mexe.
  const metade = ref.size / 2;
  const reduzida = { ...ref, size: metade };
  const inserida = { ...nova, size: metade };
  const resultado = [...panes];
  resultado.splice(idx, 1, ...(side === "right" ? [reduzida, inserida] : [inserida, reduzida]));
  return resultado;
}

function removerAba(state: WorkspaceState, tabId: string): { state: WorkspaceState; tab: Tab | null } {
  let removida: Tab | null = null;
  const panes = state.panes.map((p) => {
    const idx = p.tabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return p;
    removida = p.tabs[idx];
    const tabs = p.tabs.filter((t) => t.id !== tabId);
    const activeTabId = p.activeTabId === tabId ? (tabs[idx] ?? tabs[idx - 1])?.id ?? "" : p.activeTabId;
    return { ...p, tabs, activeTabId };
  });
  return { state: { ...state, panes }, tab: removida };
}

export function reducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case "open": {
      const alvoModulo = moduloDaRota(action.path).id;
      if (action.where === "focused") {
        // Reaproveita uma aba já aberta em vez de duplicar: por módulo (clique no rail) ou por caminho exato (palette).
        for (const pane of state.panes) {
          const existente = pane.tabs.find((t) =>
            action.reuse === "path" ? t.path === action.path : moduloDaRota(t.path).id === alvoModulo,
          );
          if (existente) {
            return {
              focusedPaneId: pane.id,
              panes: state.panes.map((p) => (p.id === pane.id ? { ...p, activeTabId: existente.id } : p)),
            };
          }
        }
        const tab = novaAba(action.path);
        return normalizar({
          ...state,
          panes: state.panes.map((p) =>
            p.id === state.focusedPaneId ? { ...p, tabs: [...p.tabs, tab], activeTabId: tab.id } : p,
          ),
        });
      }
      const nova = novaPane(action.path, 0);
      return normalizar({
        focusedPaneId: nova.id,
        panes: inserirPaneAoLado(state.panes, state.focusedPaneId, "right", nova),
      });
    }

    case "close-tab": {
      const { state: semAba } = removerAba(state, action.tabId);
      return normalizar(semAba);
    }

    case "activate-tab":
      return {
        focusedPaneId: action.paneId,
        panes: state.panes.map((p) => (p.id === action.paneId ? { ...p, activeTabId: action.tabId } : p)),
      };

    case "focus-pane":
      return state.focusedPaneId === action.paneId ? state : { ...state, focusedPaneId: action.paneId };

    case "cycle-tab": {
      const pane = state.panes.find((p) => p.id === state.focusedPaneId);
      if (!pane || pane.tabs.length < 2) return state;
      const atual = pane.tabs.findIndex((t) => t.id === pane.activeTabId);
      const proximo = pane.tabs[(atual + action.dir + pane.tabs.length) % pane.tabs.length];
      return {
        ...state,
        panes: state.panes.map((p) => (p.id === pane.id ? { ...p, activeTabId: proximo.id } : p)),
      };
    }

    case "move-tab": {
      const { state: semAba, tab } = removerAba(state, action.tabId);
      if (!tab) return state;
      const panes = semAba.panes.map((p) => {
        if (p.id !== action.toPaneId) return p;
        const tabs = [...p.tabs];
        tabs.splice(action.index ?? tabs.length, 0, tab);
        return { ...p, tabs, activeTabId: tab.id };
      });
      return normalizar({ panes, focusedPaneId: action.toPaneId });
    }

    case "move-tab-to-new-pane": {
      const { state: semAba, tab } = removerAba(state, action.tabId);
      if (!tab) return state;
      const nova: Pane = { id: novoId(), tabs: [tab], activeTabId: tab.id, size: 0 };
      // A pane de referência pode ter sumido se a aba arrastada era a única dela.
      if (!semAba.panes.some((p) => p.id === action.nextToPaneId) || semAba.panes.find((p) => p.id === action.nextToPaneId)!.tabs.length === 0) {
        return state;
      }
      return normalizar({
        focusedPaneId: nova.id,
        panes: inserirPaneAoLado(semAba.panes, action.nextToPaneId, action.side, nova),
      });
    }

    case "split-active-right": {
      const pane = state.panes.find((p) => p.id === state.focusedPaneId);
      if (!pane || pane.tabs.length < 2) return state;
      return reducer(state, {
        type: "move-tab-to-new-pane",
        tabId: pane.activeTabId,
        nextToPaneId: pane.id,
        side: "right",
      });
    }

    case "resize": {
      const par = state.panes.filter((p) => p.id === action.leftPaneId || p.id === action.rightPaneId);
      if (par.length !== 2) return state;
      const soma = par[0].size + par[1].size;
      return {
        ...state,
        panes: state.panes.map((p) => {
          if (p.id === action.leftPaneId) return { ...p, size: action.leftSize };
          if (p.id === action.rightPaneId) return { ...p, size: soma - action.leftSize };
          return p;
        }),
      };
    }

    case "navigated":
      return {
        ...state,
        panes: state.panes.map((p) => ({
          ...p,
          tabs: p.tabs.map((t) => (t.id === action.tabId && t.path !== action.path ? { ...t, path: action.path } : t)),
        })),
      };

    case "set-tab-title":
      return {
        ...state,
        panes: state.panes.map((p) => ({ ...p, tabs: p.tabs.map((t) => t.id === action.tabId ? { ...t, title: action.title } : t) })),
      };
  }
}

function lerPersistido(): WorkspaceState {
  try {
    const bruto = localStorage.getItem(STORAGE_KEY);
    if (!bruto) return estadoInicial();
    const parsed = JSON.parse(bruto) as WorkspaceState;
    const valido =
      Array.isArray(parsed.panes) &&
      parsed.panes.every(
        (p) =>
          typeof p.id === "string" &&
          typeof p.size === "number" &&
          Array.isArray(p.tabs) &&
          p.tabs.every((t) => typeof t.id === "string" && typeof t.path === "string"),
      );
    return valido ? normalizar(parsed) : estadoInicial();
  } catch {
    return estadoInicial();
  }
}

interface WorkspaceContextValue {
  state: WorkspaceState;
  dispatch: Dispatch<WorkspaceAction>;
  /** Abas em animação de saída — ainda existem no estado, saem ao fim da animação. */
  fechando: string[];
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, despachar] = useReducer(reducer, undefined, lerPersistido);
  const [fechando, setFechando] = useState<string[]>([]);
  const fechandoRef = useRef<string[]>([]);

  // Toda forma de fechar aba (X, botão do meio, Ctrl+W, paleta) passa por aqui: a aba anima e só então sai do estado.
  const dispatch = useCallback<Dispatch<WorkspaceAction>>((acao) => {
    if (acao.type !== "close-tab" || reduzMovimento()) {
      despachar(acao);
      return;
    }
    if (fechandoRef.current.includes(acao.tabId)) return;
    fechandoRef.current = [...fechandoRef.current, acao.tabId];
    setFechando(fechandoRef.current);
    window.setTimeout(() => {
      despachar(acao);
      fechandoRef.current = fechandoRef.current.filter((id) => id !== acao.tabId);
      setFechando(fechandoRef.current);
    }, DURACAO_SAIDA_ABA_MS);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* layout é só conveniência de sessão — sem localStorage, apenas não persiste */
    }
  }, [state]);

  const value = useMemo(() => ({ state, dispatch, fechando }), [state, dispatch, fechando]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return ctx;
}
