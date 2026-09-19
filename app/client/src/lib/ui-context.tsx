import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type TipoCaptura = "nota" | "tarefa" | "transacao";

interface AppUIState {
  drawerAberto: boolean;
  abrirDrawer: () => void;
  fecharDrawer: () => void;

  /** null = no create popup/form open; string = the type being edited. */
  capturaAberta: TipoCaptura | "escolha" | null;
  abrirCaptura: (inicial: TipoCaptura | "escolha") => void;
  trocarTipoCaptura: (tipo: TipoCaptura) => void;
  fecharCaptura: () => void;

  /** Topbar's Team filter (section 2.3) — null = "All". */
  filtroEquipeId: string | null;
  setFiltroEquipeId: (id: string | null) => void;
  espacoAtivo: string;
  setEspacoAtivo: (espaco: string) => void;
  intercalarEquipes: boolean;
  setIntercalarEquipes: (ativo: boolean) => void;
}

const AppUIContext = createContext<AppUIState | null>(null);

export function AppUIProvider({ children }: { children: ReactNode }) {
  const [drawerAberto, setDrawerAberto] = useState(false);
  const [capturaAberta, setCapturaAberta] = useState<TipoCaptura | "escolha" | null>(null);
  const [filtroEquipeId, setFiltroEquipeId] = useState<string | null>(null);
  const [espacoAtivo, setEspacoAtivoState] = useState(() => { try { return localStorage.getItem("ecos:espaco-ativo") ?? "pessoal"; } catch { return "pessoal"; } });
  const [intercalarEquipes, setIntercalarEquipesState] = useState(() => { try { return localStorage.getItem("ecos:intercalar-equipes") === "true"; } catch { return false; } });
  const setEspacoAtivo = (espaco: string) => { setEspacoAtivoState(espaco); try { localStorage.setItem("ecos:espaco-ativo", espaco); } catch {} };
  const setIntercalarEquipes = (ativo: boolean) => { setIntercalarEquipesState(ativo); try { localStorage.setItem("ecos:intercalar-equipes", String(ativo)); } catch {} };

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
      espacoAtivo,
      setEspacoAtivo,
      intercalarEquipes,
      setIntercalarEquipes,
    }),
    [drawerAberto, capturaAberta, filtroEquipeId, espacoAtivo, intercalarEquipes],
  );

  return <AppUIContext.Provider value={value}>{children}</AppUIContext.Provider>;
}

export function useAppUI() {
  const ctx = useContext(AppUIContext);
  if (!ctx) throw new Error("useAppUI must be used inside <AppUIProvider>");
  return ctx;
}
