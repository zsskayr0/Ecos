import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * Tiny "something changed" bus — deliberately no cache/query lib (the
 * front-end scope doesn't call for one). Any screen that needs to reflect
 * a mutation made elsewhere (Capture creating a Nota/Tarefa/Transacao, for
 * example) includes `versao` in its own data-fetching `useEffect`'s
 * dependency array.
 */
interface RefreshBus {
  versao: number;
  notificar: () => void;
}

const RefreshContext = createContext<RefreshBus | null>(null);

export function RefreshProvider({ children }: { children: ReactNode }) {
  const [versao, setVersao] = useState(0);
  const notificar = useCallback(() => setVersao((v) => v + 1), []);
  const value = useMemo(() => ({ versao, notificar }), [versao, notificar]);
  return <RefreshContext.Provider value={value}>{children}</RefreshContext.Provider>;
}

export function useRefreshBus() {
  const ctx = useContext(RefreshContext);
  if (!ctx) throw new Error("useRefreshBus must be used inside <RefreshProvider>");
  return ctx;
}
