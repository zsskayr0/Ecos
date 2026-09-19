import { useCallback, useEffect, useRef, useState } from "react";
import { MemoryRouter, Routes } from "react-router-dom";
import { Bell, ChevronDown, LogOut, Search, User, Users, Settings, X } from "lucide-react";
import { Avatar } from "@/components/common/Avatar";
import logoIcone from "@/assets/brand/ecos-icone.svg";
import { CreateFlow } from "@/screens/Create/CreateFlow";
import { nomeExibicao, useAuth } from "@/lib/auth-context";
import { useAppUI } from "@/lib/ui-context";
import { DocumentoPopupContext } from "@/lib/documento-popup";
import { pastaDoCaminho } from "@/lib/pasta-contexto";
import { fotoPerfil } from "@/lib/profile-avatar";
import { CommandPalette } from "./CommandPalette";
import { DocumentoJanela } from "./DocumentoJanela";
import { MenuCriar } from "./MenuCriar";
import { Rail } from "./Rail";
import { TabDragProvider } from "./tab-drag";
import { Workspace } from "./Workspace";
import { WorkspaceProvider, useWorkspace } from "./workspace-store";
import { screenRoutes } from "@/routes/screen-routes";

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
  const { perfil, logout } = useAuth();
  const nome = perfil ? nomeExibicao(perfil) : "?";
  const [menuPerfilAberto, setMenuPerfilAberto] = useState(false);
  const [painelConta, setPainelConta] = useState<string | null>(null);
  const abrir = (path: string) => {
    setPainelConta(path);
    setMenuPerfilAberto(false);
  };

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

      <div className="flex items-center gap-1">
        <button type="button" onClick={() => abrir("/notificacoes")} aria-label="Notificações" title="Notificações" className="flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"><Bell size={17} /></button>
        <div className="relative">
          <button type="button" aria-label="Abrir menu da conta" aria-expanded={menuPerfilAberto} onClick={() => setMenuPerfilAberto((aberto) => !aberto)} className="flex h-9 items-center gap-1 rounded-lg px-1 transition-colors hover:bg-surface-2">
            <Avatar nome={nome} tamanho={30} url={fotoPerfil(perfil?.id)} />
            <ChevronDown size={13} className={`text-text-muted transition-transform duration-200 ${menuPerfilAberto ? "rotate-180" : ""}`} />
          </button>
          {menuPerfilAberto && <div className="ecos-fade-in absolute right-0 top-11 z-50 w-64 overflow-hidden rounded-xl border border-border bg-surface-1 p-1.5 shadow-nav">
          <button type="button" onClick={() => abrir("/perfil")} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-surface-2"><Avatar nome={nome} tamanho={32} url={fotoPerfil(perfil?.id)} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-text-primary">{nome}</span><span className="block text-xs text-text-muted">Ver e editar perfil</span></span></button>
          <div className="my-1 border-t border-border" />
          <MenuContaItem Icon={User} label="Perfil" onClick={() => abrir("/perfil")} />
          <MenuContaItem Icon={Users} label="Equipes" onClick={() => abrir("/perfil")} />
          <MenuContaItem Icon={Settings} label="Configurações" onClick={() => abrir("/configuracoes")} />
          <div className="my-1 border-t border-border" />
          <button type="button" onClick={() => { setMenuPerfilAberto(false); void logout(); }} className="flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-error transition-colors hover:bg-error/10"><LogOut size={16} strokeWidth={1.8} />Sair</button>
          </div>}
        </div>
      </div>
      {painelConta && <PainelConta path={painelConta} aoFechar={() => setPainelConta(null)} />}
    </header>
  );
}

function MenuContaItem({ Icon, label, onClick }: { Icon: typeof User; label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"><Icon size={16} strokeWidth={1.8} />{label}</button>;
}

/** Painéis de conta não fazem parte do espaço de trabalho: são diálogos
 * modais, centralizados e previsíveis, sem alças de arraste/redimensionamento. */
function PainelConta({ path, aoFechar }: { path: string; aoFechar: () => void }) {
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/35 p-6 backdrop-blur-md ecos-fade-in" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) aoFechar(); }}>
    <section role="dialog" aria-modal="true" aria-label="Painel da conta" className="flex aspect-video w-[min(960px,calc(100vw-48px))] max-h-[calc(100vh-48px)] flex-col overflow-hidden rounded-2xl border border-border bg-base shadow-nav">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-surface-1 px-4"><span className="text-sm font-semibold text-text-primary">Conta</span><button type="button" onClick={aoFechar} aria-label="Fechar" className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-surface-2 hover:text-text-primary"><X size={17} /></button></header>
      <div className="min-h-0 flex-1 overflow-y-auto"><MemoryRouter initialEntries={[path]}><Routes>{screenRoutes}</Routes></MemoryRouter></div>
    </section>
  </div>;
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
      {(capturaAberta === "nota" || capturaAberta === "tarefa" || capturaAberta === "transacao") && <DocumentoJanela
        path={capturaAberta === "nota" ? "/notas" : capturaAberta === "tarefa" ? "/tarefas" : "/cofre"}
        titulo={tituloCaptura || (capturaAberta === "nota" ? "Nova nota" : capturaAberta === "tarefa" ? "Nova tarefa" : "Nova transação")}
        ordem={janelas.length}
        z={contador.current + 1}
        aoFechar={fecharCaptura}
        aoFocar={() => {}}
        aoFixar={() => {}}
        conteudo={<CreateFlow embedded onTitleChange={setTituloCaptura} pastaContexto={pastaContexto} />}
      />}
      <CommandPalette aberta={paletaAberta} aoFechar={() => setPaletaAberta(false)} aoAbrirDocumento={abrirDocumento} />
      {/* O fluxo de captura navega depois de salvar (`navigate("/feed")`) — num Router próprio isso não mexe nas abas. */}
      {capturaAberta !== "nota" && capturaAberta !== "tarefa" && capturaAberta !== "transacao" && <MemoryRouter><CreateFlow pastaContexto={pastaContexto} /></MemoryRouter>}
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
