import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * Barramento minúsculo de "algo mudou" — sem cache/query lib de propósito
 * (escopo do front não pede isso). Qualquer tela que precisa refletir uma
 * mutação feita em outro lugar (Captura criando Nota/Tarefa/Transação,
 * por exemplo) inclui `versao` no array de dependências do próprio
 * `useEffect` de busca.
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
  if (!ctx) throw new Error("useRefreshBus precisa estar dentro de <RefreshProvider>");
  return ctx;
}
