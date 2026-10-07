import { definirEspacoDoCofre } from "./api";
import type { CapturaDraft } from "@/screens/Create/CreateFlow";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type TipoCaptura = "nota" | "tarefa" | "transacao";

interface AppUIState {
  drawerAberto: boolean;
  abrirDrawer: () => void;
  fecharDrawer: () => void;

  /** null = no create popup/form open; string = the type being edited. */
  capturaAberta: TipoCaptura | "escolha" | null;
  abrirCaptura: (inicial: TipoCaptura | "escolha", data?: string | null, rascunho?: Partial<CapturaDraft> | null) => void;
  /** Campos já preenchidos do próximo lançamento (ex.: a cópia de outro). */
  rascunhoCaptura: Partial<CapturaDraft> | null;
  /** Data (AAAA-MM-DD) com que a próxima Transação nasce — ex.: o dia aberto no calendário do Cofre. */
  dataCaptura: string | null;
  /** Dia em foco no calendário do Cofre; o botão de criar usa como data padrão. */
  diaCofre: string | null;
  setDiaCofre: (dia: string | null) => void;
  trocarTipoCaptura: (tipo: TipoCaptura) => void;
  fecharCaptura: () => void;
  /** Linhas Markdown de anexos (ex.: imagens compartilhadas) à espera de entrar no corpo da captura aberta. */
  anexosDeCaptura: string[];
  empilharAnexosDeCaptura: (linhas: string[]) => void;
  limparAnexosDeCaptura: () => void;

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
  const [dataCaptura, setDataCaptura] = useState<string | null>(null);
  const [rascunhoCaptura, setRascunhoCaptura] = useState<Partial<CapturaDraft> | null>(null);
  const [diaCofre, setDiaCofre] = useState<string | null>(null);
  const [anexosDeCaptura, setAnexosDeCaptura] = useState<string[]>([]);
  const [filtroEquipeId, setFiltroEquipeId] = useState<string | null>(null);
  const [espacoAtivo, setEspacoAtivoState] = useState(() => { let e = "pessoal"; try { e = localStorage.getItem("ecos:espaco-ativo") ?? "pessoal"; } catch { /* cache indisponível */ } definirEspacoDoCofre(e); return e; });
  const [intercalarEquipes, setIntercalarEquipesState] = useState(() => { try { return localStorage.getItem("ecos:intercalar-equipes") === "true"; } catch { return false; } });
  const setEspacoAtivo = (espaco: string) => { definirEspacoDoCofre(espaco); setEspacoAtivoState(espaco); try { localStorage.setItem("ecos:espaco-ativo", espaco); } catch {} };
  const setIntercalarEquipes = (ativo: boolean) => { setIntercalarEquipesState(ativo); try { localStorage.setItem("ecos:intercalar-equipes", String(ativo)); } catch {} };

  const value = useMemo<AppUIState>(
    () => ({
      drawerAberto,
      abrirDrawer: () => setDrawerAberto(true),
      fecharDrawer: () => setDrawerAberto(false),

      capturaAberta,
      abrirCaptura: (inicial, data = null, rascunho = null) => { setDataCaptura(data); setRascunhoCaptura(rascunho); setCapturaAberta(inicial); },
      dataCaptura,
      rascunhoCaptura,
      diaCofre,
      setDiaCofre,
      trocarTipoCaptura: (tipo) => setCapturaAberta(tipo),
      fecharCaptura: () => { setCapturaAberta(null); setRascunhoCaptura(null); },
      anexosDeCaptura,
      empilharAnexosDeCaptura: (linhas) => setAnexosDeCaptura((atual) => [...atual, ...linhas]),
      limparAnexosDeCaptura: () => setAnexosDeCaptura([]),

      filtroEquipeId,
      setFiltroEquipeId,
      espacoAtivo,
      setEspacoAtivo,
      intercalarEquipes,
      setIntercalarEquipes,
    }),
    [drawerAberto, capturaAberta, dataCaptura, rascunhoCaptura, diaCofre, anexosDeCaptura, filtroEquipeId, espacoAtivo, intercalarEquipes],
  );

  return <AppUIContext.Provider value={value}>{children}</AppUIContext.Provider>;
}

export function useAppUI() {
  const ctx = useContext(AppUIContext);
  if (!ctx) throw new Error("useAppUI must be used inside <AppUIProvider>");
  return ctx;
}
