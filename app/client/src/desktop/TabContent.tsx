import { memo, useEffect, useState } from "react";
import { MemoryRouter, Routes, useLocation } from "react-router-dom";
import { screenRoutes } from "@/routes/screen-routes";
import { rotaPai } from "./modules";
import { useWorkspace } from "./workspace-store";
import { FecharDocumentoContext, TituloJanelaContext } from "@/lib/documento-popup";

/** Uma aba aberta direto num detalhe recebe a rota-pai como histórico anterior — é o que faz o `navigate(-1)` das telas funcionar. */
function historicoInicial(path: string): string[] {
  const pai = rotaPai(path.split("?")[0]);
  return pai ? [pai, path] : [path];
}

function PathReporter({ tabId }: { tabId: string }) {
  const location = useLocation();
  const { dispatch } = useWorkspace();
  useEffect(() => {
    dispatch({ type: "navigated", tabId, path: location.pathname + location.search });
  }, [dispatch, tabId, location.pathname, location.search]);
  return null;
}

interface Props {
  tabId: string;
  path: string;
  visible: boolean;
  /** Aba em animação de saída. */
  fechando?: boolean;
}

/**
 * Cada aba tem o próprio MemoryRouter (histórico independente) e continua
 * montada quando não está ativa — trocar de aba não perde rascunho de nota
 * nem posição de rolagem.
 */
export const TabContent = memo(function TabContent({ tabId, path, visible, fechando }: Props) {
  const [entradas] = useState(() => historicoInicial(path));
  const { dispatch, state } = useWorkspace();

  return (
    <div hidden={!visible} className={`h-full overflow-y-auto ${fechando ? "ecos-conteudo-saindo" : ""}`}>
      <MemoryRouter initialEntries={entradas} initialIndex={entradas.length - 1}>
        <PathReporter tabId={tabId} />
        <TituloJanelaContext.Provider value={(title) => dispatch({ type: "set-tab-title", tabId, title })}>
        <FecharDocumentoContext.Provider value={() => {
          const pane = state.panes.find((item) => item.tabs.some((tab) => tab.id === tabId));
          if (pane) dispatch({ type: "close-tab", paneId: pane.id, tabId });
        }}>
          <Routes>{screenRoutes}</Routes>
        </FecharDocumentoContext.Provider>
        </TituloJanelaContext.Provider>
      </MemoryRouter>
    </div>
  );
});
