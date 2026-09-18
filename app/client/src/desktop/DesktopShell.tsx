import { useCallback, useEffect, useRef, useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { Search } from "lucide-react";
import { Avatar } from "@/components/common/Avatar";
import logoIcone from "@/assets/brand/ecos-icone.svg";
import { CreateFlow } from "@/screens/Create/CreateFlow";
import { nomeExibicao, useAuth } from "@/lib/auth-context";
import { useAppUI } from "@/lib/ui-context";
import { DocumentoPopupContext } from "@/lib/documento-popup";
import { pastaDoCaminho } from "@/lib/pasta-contexto";
import { CommandPalette } from "./CommandPalette";
import { DocumentoJanela } from "./DocumentoJanela";
import { MenuCriar } from "./MenuCriar";
import { Rail } from "./Rail";
import { TabDragProvider } from "./tab-drag";
import { Workspace } from "./Workspace";
import { WorkspaceProvider, useWorkspace } from "./workspace-store";

const ehMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

function useAtalhosGlobais(alternarPaleta: () => void) {
  const { state, dispatch } = useWorkspace();

  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const tecla = e.key.toLowerCase();

      if (tecla === "k") {
        e.preventDefault();
        alternarPaleta();
      } else if (tecla === "w") {
        e.preventDefault();
        const pane = state.panes.find((p) => p.id === state.focusedPaneId);
        if (pane) dispatch({ type: "close-tab", paneId: pane.id, tabId: pane.activeTabId });
      } else if (e.key === "Tab") {
        e.preventDefault();
        dispatch({ type: "cycle-tab", dir: e.shiftKey ? -1 : 1 });
      } else if (e.key === "\\") {
        e.preventDefault();
        dispatch({ type: "split-active-right" });
      } else if (/^[1-9]$/.test(e.key)) {
        const pane = state.panes[Number(e.key) - 1];
        if (pane) {
          e.preventDefault();
          dispatch({ type: "focus-pane", paneId: pane.id });
        }
      }
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [state.panes, state.focusedPaneId, dispatch, alternarPaleta]);
}

function Barra({ abrirPaleta }: { abrirPaleta: () => void }) {
  const { perfil } = useAuth();
  const { dispatch } = useWorkspace();
  const nome = perfil ? nomeExibicao(perfil) : "?";

  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b border-border bg-surface-1 px-4">
      <span className="flex items-center gap-2 font-display text-base font-bold text-text-primary">
        <img src={logoIcone} alt="" className="h-6 w-6" />
        Ecos
      </span>

      <button
        type="button"
        onClick={abrirPaleta}
        className="mx-auto flex h-8 w-full max-w-xl items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 text-left text-sm text-text-muted transition-colors hover:border-cyan/40"
      >
        <Search size={14} strokeWidth={1.75} />
        <span className="flex-1">Buscar ou executar um comando</span>
        <kbd className="rounded border border-border bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">
          {ehMac ? "⌘" : "Ctrl"} K
        </kbd>
      </button>

      <MenuCriar />

      <button
        type="button"
        aria-label="Abrir perfil"
        onClick={() => dispatch({ type: "open", path: "/perfil", where: "focused", reuse: "modulo" })}
      >
        <Avatar nome={nome} tamanho={30} />
      </button>
    </header>
  );
}

interface JanelaAberta {
  id: number;
  path: string;
  ordem: number;
  z: number;
}

function Conteudo() {
  const { state, dispatch } = useWorkspace();
  const { capturaAberta, fecharCaptura } = useAppUI();
  // A pasta aberta na aba em foco vira a pasta padrão de quem for criada agora.
  const paneFocada = state.panes.find((p) => p.id === state.focusedPaneId);
  const abaFocada = paneFocada?.tabs.find((t) => t.id === paneFocada.activeTabId);
  const pastaContexto = abaFocada ? pastaDoCaminho(abaFocada.path) : null;
  const [paletaAberta, setPaletaAberta] = useState(false);
  const [tituloCaptura, setTituloCaptura] = useState("");
  const [janelas, setJanelas] = useState<JanelaAberta[]>([]);
  const contador = useRef(0);
  const alternarPaleta = () => setPaletaAberta((v) => !v);
  useAtalhosGlobais(alternarPaleta);

  const trazerParaFrente = useCallback(
    (id: number) => setJanelas((js) => js.map((j) => (j.id === id ? { ...j, z: ++contador.current } : j))),
    [],
  );
  const fecharJanela = useCallback((id: number) => setJanelas((js) => js.filter((j) => j.id !== id)), []);

  // Clique simples: janela flutuante (a mesma tarefa/nota não abre duas vezes — só vem para a frente). Ctrl/Cmd+clique: só uma aba.
  const abrirDocumento = useCallback(
    (path: string, emAba: boolean) => {
      if (emAba) {
        dispatch({ type: "open", path, where: "focused", reuse: "path" });
        return;
      }
      setJanelas((js) => {
        const existente = js.find((j) => j.path === path);
        if (existente) return js.map((j) => (j === existente ? { ...j, z: ++contador.current } : j));
        return [...js, { id: ++contador.current, path, ordem: js.length, z: ++contador.current }];
      });
    },
    [dispatch],
  );

  function fixarComoAba(janela: JanelaAberta, paneId?: string) {
    if (paneId) dispatch({ type: "focus-pane", paneId });
    dispatch({ type: "open", path: janela.path, where: "focused", reuse: "path" });
    fecharJanela(janela.id);
  }

  return (
    <DocumentoPopupContext.Provider value={abrirDocumento}>
    <div className="flex h-screen flex-col bg-base">
      <Barra abrirPaleta={() => setPaletaAberta(true)} />
      <div className="flex min-h-0 flex-1">
        <Rail />
        <Workspace />
      </div>
      {janelas.map((j) => (
        <DocumentoJanela
          key={j.id}
          path={j.path}
          ordem={j.ordem}
          z={j.z}
          aoFechar={() => fecharJanela(j.id)}
          aoFocar={() => trazerParaFrente(j.id)}
          aoFixar={(paneId) => fixarComoAba(j, paneId)}
        />
      ))}
      {(capturaAberta === "nota" || capturaAberta === "tarefa") && <DocumentoJanela
        path={capturaAberta === "nota" ? "/notas" : "/tarefas"}
        titulo={tituloCaptura || (capturaAberta === "nota" ? "Nova nota" : "Nova tarefa")}
        ordem={janelas.length}
        z={contador.current + 1}
        aoFechar={fecharCaptura}
        aoFocar={() => {}}
        aoFixar={() => {}}
        conteudo={<CreateFlow embedded onTitleChange={setTituloCaptura} pastaContexto={pastaContexto} />}
      />}
      <CommandPalette aberta={paletaAberta} aoFechar={() => setPaletaAberta(false)} aoAbrirDocumento={abrirDocumento} />
      {/* O fluxo de captura navega depois de salvar (`navigate("/feed")`) — num Router próprio isso não mexe nas abas. */}
      {capturaAberta !== "nota" && capturaAberta !== "tarefa" && <MemoryRouter><CreateFlow pastaContexto={pastaContexto} /></MemoryRouter>}
    </div>
    </DocumentoPopupContext.Provider>
  );
}

export function DesktopShell() {
  return (
    <WorkspaceProvider>
      <TabDragProvider>
        <Conteudo />
      </TabDragProvider>
    </WorkspaceProvider>
  );
}
