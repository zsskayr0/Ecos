import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export interface TabArrastada {
  tabId: string;
  paneId: string;
}

interface TabDragState {
  arrastando: TabArrastada | null;
  iniciar: (t: TabArrastada) => void;
  encerrar: () => void;
}

const TabDragContext = createContext<TabDragState | null>(null);

/** Estado do arraste de abas — `dataTransfer` não é legível durante `dragover`, então o alvo precisa saber de fora quem está sendo arrastado. */
export function TabDragProvider({ children }: { children: ReactNode }) {
  const [arrastando, setArrastando] = useState<TabArrastada | null>(null);
  const value = useMemo<TabDragState>(
    () => ({ arrastando, iniciar: setArrastando, encerrar: () => setArrastando(null) }),
    [arrastando],
  );
  return <TabDragContext.Provider value={value}>{children}</TabDragContext.Provider>;
}

export function useTabDrag() {
  const ctx = useContext(TabDragContext);
  if (!ctx) throw new Error("useTabDrag must be used inside <TabDragProvider>");
  return ctx;
}
