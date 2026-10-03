import { memo, useEffect, useRef, useState } from "react";
import { MemoryRouter, Routes, useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { LIMITE_HISTORICO, registrarNavegacao } from "./navegacao-abas";
import { screenRoutes } from "@/routes/screen-routes";
import { rotaPai } from "./modules";
import { useWorkspace } from "./workspace-store";
import { FecharDocumentoContext, TituloJanelaContext } from "@/lib/documento-popup";

/** Uma aba aberta direto num detalhe recebe a rota-pai como histórico anterior — é o que faz o `navigate(-1)` das telas funcionar. */
function historicoInicial(path: string): string[] {
  const pai = rotaPai(path.split("?")[0]);
  return pai ? [pai, path] : [path];
}

/** Acompanha o histórico do MemoryRouter (que não expõe a pilha) e o grava na aba; também registra voltar/avançar dela. */
export function PathReporter({ tabId, hist, idx, chave }: { tabId?: string; hist: string[]; idx: number; chave: string }) {
  const location = useLocation();
  const tipo = useNavigationType();
  const navigate = useNavigate();
  const { dispatch } = useWorkspace();
  const pilha = useRef({ hist, idx });
  const caminho = location.pathname + location.search;

  useEffect(() => {
    const p = pilha.current;
    if (p.hist[p.idx] !== caminho) {
      if (tipo === "PUSH") {
        p.hist = [...p.hist.slice(0, p.idx + 1), caminho].slice(-LIMITE_HISTORICO);
        p.idx = p.hist.length - 1;
      } else if (tipo === "REPLACE") {
        p.hist = p.hist.map((h, i) => (i === p.idx ? caminho : h));
      } else if (p.hist[p.idx - 1] === caminho) p.idx -= 1;
      else if (p.hist[p.idx + 1] === caminho) p.idx += 1;
      else { p.hist = [...p.hist.slice(0, p.idx + 1), caminho]; p.idx = p.hist.length - 1; }
    }
    if (chave === "cofre") { try { sessionStorage.setItem("ecos.desktop.cofre-rota.v1", caminho); } catch { /* só conveniência */ } }
    if (tabId) dispatch({ type: "navigated", tabId, path: caminho, hist: p.hist, idx: p.idx });
  }, [dispatch, tabId, caminho, tipo]);

  useEffect(() => registrarNavegacao(chave, {
    ir: (d) => navigate(d),
    podeVoltar: () => pilha.current.idx > 0,
    podeAvancar: () => pilha.current.idx < pilha.current.hist.length - 1,
  }), [chave, navigate]);
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
  const { dispatch, state } = useWorkspace();
  const [inicio] = useState(() => {
    const aba = state.panes.flatMap((p) => p.tabs).find((t) => t.id === tabId);
    if (aba?.hist?.length && typeof aba.idx === "number" && aba.hist[aba.idx] === path) return { entradas: aba.hist, idx: aba.idx };
    const e = historicoInicial(path);
    return { entradas: e, idx: e.length - 1 };
  });

  return (
    <div hidden={!visible} className={`h-full overflow-y-auto ${fechando ? "ecos-conteudo-saindo" : ""}`}>
      <MemoryRouter initialEntries={inicio.entradas} initialIndex={inicio.idx}>
        <PathReporter tabId={tabId} chave={`aba:${tabId}`} hist={inicio.entradas} idx={inicio.idx} />
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
