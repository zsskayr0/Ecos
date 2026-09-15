import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type TipoCaptura = "nota" | "tarefa" | "transacao";

interface AppUIState {
  drawerAberto: boolean;
  abrirDrawer: () => void;
  fecharDrawer: () => void;

  /** null = nenhum popup/form de criação aberto; string = tipo em edição. */
  capturaAberta: TipoCaptura | "escolha" | null;
  abrirCaptura: (inicial: TipoCaptura | "escolha") => void;
  trocarTipoCaptura: (tipo: TipoCaptura) => void;
  fecharCaptura: () => void;

  /** Filtro de Equipe do topbar (seção 2.3) — null = "Tudo". */
  filtroEquipeId: string | null;
  setFiltroEquipeId: (id: string | null) => void;
}

const AppUIContext = createContext<AppUIState | null>(null);

export function AppUIProvider({ children }: { children: ReactNode }) {
  const [drawerAberto, setDrawerAberto] = useState(false);
  const [capturaAberta, setCapturaAberta] = useState<TipoCaptura | "escolha" | null>(null);
  const [filtroEquipeId, setFiltroEquipeId] = useState<string | null>(null);

  const value = useMemo<AppUIState>(
    () => ({
      drawerAberto,
      abrirDrawer: () => setDrawerAberto(true),
      fecharDrawer: () => setDrawerAberto(false),

      capturaAberta,
      abrirCaptura: (inicial) => setCapturaAberta(inicial),
      trocarTipoCaptura: (tipo) => setCapturaAberta(tipo),
      fecharCaptura: () => setCapturaAberta(null),

      filtroEquipeId,
      setFiltroEquipeId,
    }),
    [drawerAberto, capturaAberta, filtroEquipeId],
  );

  return <AppUIContext.Provider value={value}>{children}</AppUIContext.Provider>;
}

export function useAppUI() {
  const ctx = useContext(AppUIContext);
  if (!ctx) throw new Error("useAppUI precisa estar dentro de <AppUIProvider>");
  return ctx;
}
