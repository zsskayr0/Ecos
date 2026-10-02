import { useCallback, useEffect, useRef, useState } from "react";
import { MemoryRouter, Routes } from "react-router-dom";
import { ArrowLeft, Bell, ChevronDown, FolderTree, Lock, LogOut, Search, User, Users, Settings, X } from "lucide-react";
import { Avatar } from "@/components/common/Avatar";
import logoIcone from "@/assets/brand/ecos-icone.svg";
import { CreateFlow } from "@/screens/Create/CreateFlow";
import { nomeExibicao, useAuth } from "@/lib/auth-context";
import { useAppUI } from "@/lib/ui-context";
import { useMinhasEquipes } from "@/lib/use-minhas-equipes";
import { DocumentoPopupContext } from "@/lib/documento-popup";
import { useComprovantesEsperando } from "@/lib/fila-comprovantes";
import { pastaDoCaminho } from "@/lib/pasta-contexto";
import { useFotoPerfil } from "@/lib/profile-avatar";
import { CommandPalette } from "./CommandPalette";
import { DocumentoJanela } from "./DocumentoJanela";
import { MenuCriar } from "./MenuCriar";
import { Rail } from "./Rail";
import { SoltarNoCofre } from "./SoltarNoCofre";
import { TabDragProvider } from "./tab-drag";
import { Workspace } from "./Workspace";
import { WorkspaceProvider, useWorkspace } from "./workspace-store";
import { screenRoutes } from "@/routes/screen-routes";
import { VaultScreen } from "@/screens/Vault/VaultScreen";

const ehMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

function useAtalhosGlobais(alternarPaleta: (global?: boolean) => void) {
  const { state, dispatch } = useWorkspace();

  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const tecla = e.key.toLowerCase();

      if (tecla === "k") {
        e.preventDefault();
        alternarPaleta(e.shiftKey);
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

function Barra({ abrirPaleta, abrirOrganizacao, cofre, voltarAoEcos, buscaGlobal = false, setBuscaGlobal }: { abrirPaleta: () => void; abrirOrganizacao: () => void; cofre?: boolean; voltarAoEcos?: () => void; buscaGlobal?: boolean; setBuscaGlobal?: (valor:boolean)=>void }) {
  const { perfil, logout } = useAuth();
  const { espacoAtivo, setEspacoAtivo } = useAppUI();
  const { equipes } = useMinhasEquipes();
  const nome = perfil ? nomeExibicao(perfil) : "?";
  const { url: urlFotoPerfil } = useFotoPerfil(perfil?.id, perfil?.avatar_atualizado_em);
  const [menuPerfilAberto, setMenuPerfilAberto] = useState(false);
  const [seletorEquipesAberto, setSeletorEquipesAberto] = useState(false);
  const [painelConta, setPainelConta] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const equipeAtual = equipes.find((equipe) => `equipe:${equipe.id}` === espacoAtivo);
  useEffect(() => {
    function fecharAoClicarFora(evento: MouseEvent) {
      if (!menuRef.current?.contains(evento.target as Node)) { setMenuPerfilAberto(false); setSeletorEquipesAberto(false); }
    }
    if (menuPerfilAberto || seletorEquipesAberto) document.addEventListener("pointerdown", fecharAoClicarFora);
    return () => document.removeEventListener("pointerdown", fecharAoClicarFora);
  }, [menuPerfilAberto, seletorEquipesAberto]);
  const abrir = (path: string) => {
    setPainelConta(path);
    setMenuPerfilAberto(false);
  };
  const abrirOrganizacaoNoMenu = () => { abrirOrganizacao(); setMenuPerfilAberto(false); setSeletorEquipesAberto(false); };

  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b border-border bg-surface-1 px-4">
      <span className="flex items-center gap-2 font-display text-base font-bold text-text-primary">
        <img src={logoIcone} alt="" className="h-6 w-6" />
        {cofre ? "Cofre" : "Ecos"}
      </span>

      <div className="mx-auto flex w-full max-w-xl items-center rounded-lg border border-border bg-surface-2 transition-colors hover:border-cyan/40">
      <button
        type="button"
        onClick={abrirPaleta}
        className="flex h-8 min-w-0 flex-1 items-center gap-2 px-3 text-left text-sm text-text-muted"
      >
        <Search size={14} strokeWidth={1.75} />
        <span className="flex-1">{cofre&&!buscaGlobal?"Buscar no Cofre":"Buscar ou executar um comando"}</span>
        <kbd className="rounded border border-border bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">
          {ehMac ? "⌘" : "Ctrl"} K
        </kbd>
      </button>
      {cofre&&<button type="button" role="checkbox" aria-checked={buscaGlobal} title="Incluir dados de todo o Ecos (Ctrl+Shift+K)" onClick={()=>setBuscaGlobal?.(!buscaGlobal)} className={`mr-1.5 flex h-5 w-5 items-center justify-center rounded border text-[11px] ${buscaGlobal?"border-cyan bg-cyan/15 text-cyan":"border-border text-transparent"}`}>✓</button>}
      </div>

      {cofre && <button type="button" onClick={voltarAoEcos} className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-text-secondary hover:bg-surface-2 hover:text-text-primary"><ArrowLeft size={15} />Voltar ao Ecos</button>}
      {cofre && <button type="button" onClick={() => window.dispatchEvent(new Event("ecos:solicitar-bloqueio"))} className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-text-secondary hover:bg-surface-2 hover:text-text-primary"><Lock size={14} />Bloquear</button>}
      <MenuCriar />

      <div className="flex items-center gap-1">
        <button type="button" onClick={() => abrir("/notificacoes")} aria-label="Notificações" title="Notificações" className="flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"><Bell size={17} /></button>
        <div ref={menuRef} className="relative">
          <button type="button" aria-label="Abrir menu da conta" aria-expanded={menuPerfilAberto} onClick={() => setMenuPerfilAberto((aberto) => !aberto)} className="flex h-9 items-center gap-1 rounded-lg px-1 transition-colors hover:bg-surface-2">
            <Avatar nome={nome} tamanho={30} url={urlFotoPerfil} />
            <ChevronDown size={13} className={`text-text-muted transition-transform duration-200 ${menuPerfilAberto ? "rotate-180" : ""}`} />
          </button>
          {menuPerfilAberto && <div className="ecos-fade-in absolute right-0 top-11 z-50 w-64 overflow-visible rounded-xl border border-border bg-surface-1 p-1.5 shadow-nav">
          <button type="button" onClick={() => abrir("/perfil")} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-surface-2"><Avatar nome={nome} tamanho={32} url={urlFotoPerfil} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-text-primary">{nome}</span><span className="block text-xs text-text-muted">Ver perfil</span></span></button>
          <div className="my-1 border-t border-border" />
          <button type="button" onClick={() => setSeletorEquipesAberto((aberto) => !aberto)} className="flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"><Users size={16} strokeWidth={1.8} /><span className="min-w-0 flex-1"><span className="block text-xs text-text-muted">Equipe atual</span><span className="block truncate text-sm text-text-primary">{equipeAtual?.nome ?? "Pessoal"}</span></span><ChevronDown size={14} className={seletorEquipesAberto ? "rotate-180 transition-transform" : "transition-transform"} /></button>
          {seletorEquipesAberto && <div className="ecos-fade-in absolute right-[calc(100%+8px)] top-20 z-[60] w-60 rounded-xl border border-border bg-surface-1 p-1.5 shadow-nav"><p className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">Trocar equipe</p><button type="button" onClick={() => { setEspacoAtivo("pessoal"); setSeletorEquipesAberto(false); setMenuPerfilAberto(false); }} className={`flex min-h-10 w-full items-center rounded-lg px-3 text-left text-sm ${espacoAtivo === "pessoal" ? "bg-surface-2 text-text-primary" : "text-text-secondary hover:bg-surface-2"}`}>Pessoal</button>{equipes.map((equipe) => <button key={equipe.id} type="button" onClick={() => { setEspacoAtivo(`equipe:${equipe.id}`); setSeletorEquipesAberto(false); setMenuPerfilAberto(false); }} className={`flex min-h-10 w-full items-center justify-between rounded-lg px-3 text-left text-sm ${espacoAtivo === `equipe:${equipe.id}` ? "bg-surface-2 text-text-primary" : "text-text-secondary hover:bg-surface-2"}`}><span className="truncate">{equipe.nome}</span><span className="text-xs text-text-muted">{equipe.cargo}</span></button>)}<div className="my-1 border-t border-border" /><button type="button" onClick={() => { abrir("/equipes"); setSeletorEquipesAberto(false); }} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-medium text-steel-300 hover:bg-surface-2"><Settings size={15} />Gerenciar equipes</button></div>}
          <MenuContaItem Icon={FolderTree} label="Organização" onClick={abrirOrganizacaoNoMenu} />
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
    <section role="dialog" aria-modal="true" aria-label="Painel da conta" className="flex h-[min(780px,calc(100vh-48px))] w-[min(1200px,calc(100vw-48px))] flex-col overflow-hidden rounded-2xl border border-border bg-base shadow-nav">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-surface-1 px-4"><span className="text-sm font-semibold text-text-primary">Conta</span><button type="button" onClick={aoFechar} aria-label="Fechar" className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-surface-2 hover:text-text-primary"><X size={17} /></button></header>
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]"><MemoryRouter initialEntries={[path]}><Routes>{screenRoutes}</Routes></MemoryRouter></div>
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
  const [buscaGlobal, setBuscaGlobal] = useState(false);
  const [cofreAberto, setCofreAberto] = useState(false);
  const [tituloCaptura, setTituloCaptura] = useState("");
  const [janelas, setJanelas] = useState<JanelaAberta[]>([]);
  const contador = useRef(0);
  const alternarPaleta = (global = false) => { if (global) setBuscaGlobal(true); setPaletaAberta((v) => !v); };
  useAtalhosGlobais(alternarPaleta);
  // Comprovante solto na janela: abre o Cofre (a aba Comprovantes recolhe a fila sozinha).
  const comprovantesEsperando = useComprovantesEsperando();
  useEffect(() => { if (comprovantesEsperando > 0) setCofreAberto(true); }, [comprovantesEsperando]);
  useEffect(() => {
    const voltar = () => setCofreAberto(false);
    window.addEventListener("ecos:voltar-do-cofre", voltar);
    return () => window.removeEventListener("ecos:voltar-do-cofre", voltar);
  }, []);

  const trazerParaFrente = useCallback(
    (id: number) => setJanelas((js) => js.map((j) => (j.id === id ? { ...j, z: ++contador.current } : j))),
    [],
  );
  const fecharJanela = useCallback((id: number) => setJanelas((js) => js.filter((j) => j.id !== id)), []);

  // Clique simples: janela flutuante (a mesma tarefa/nota não abre duas vezes — só vem para a frente). Ctrl/Cmd+clique: só uma aba.
  const abrirDocumento = useCallback(
    (path: string, emAba: boolean) => {
      if (cofreAberto && path.startsWith("/cofre")) {
        setJanelas((js) => {
          const existente = js.find((j) => j.path === path);
          if (existente) return js.map((j) => j === existente ? { ...j, z: ++contador.current } : j);
          return [...js, { id: ++contador.current, path, ordem: js.length, z: ++contador.current }];
        });
        return;
      }
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
    [dispatch, cofreAberto],
  );

  function fixarComoAba(janela: JanelaAberta, paneId?: string) {
    if (paneId) dispatch({ type: "focus-pane", paneId });
    dispatch({ type: "open", path: janela.path, where: "focused", reuse: "path" });
    fecharJanela(janela.id);
  }

  return (
    <DocumentoPopupContext.Provider value={abrirDocumento}>
    <SoltarNoCofre />
    {cofreAberto ? (
      <div className="flex h-screen flex-col overflow-hidden bg-base">
        <div className="min-h-0 flex-1 overflow-hidden"><MemoryRouter initialEntries={["/cofre"]}><VaultScreen embedded voltar={() => setCofreAberto(false)} /></MemoryRouter></div>
        {janelas.map((j) => <DocumentoJanela key={j.id} path={j.path} ordem={j.ordem} z={j.z} aoFechar={() => fecharJanela(j.id)} aoFocar={() => trazerParaFrente(j.id)} />)}
        {capturaAberta === "transacao" && <DocumentoJanela path="/cofre/transacao/novo" titulo={tituloCaptura || "Novo lançamento"} ordem={janelas.length} z={contador.current + 1} aoFechar={fecharCaptura} aoFocar={() => {}} cabecalhoNoConteudo conteudo={<div className="cofre-app cofre-capture-scope"><CreateFlow embedded contextoDesktop="cofre" onTitleChange={setTituloCaptura} pastaContexto={pastaContexto} /></div>} />}
      </div>
    ) : (
    <div className="flex h-screen flex-col bg-base">
      <Barra abrirPaleta={() => setPaletaAberta(true)} abrirOrganizacao={() => abrirDocumento("/configuracoes/organizacao", false)} />
      <div className="flex min-h-0 flex-1">
        <Rail abrirCofre={() => setCofreAberto(true)} />
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
        path={capturaAberta === "nota" ? "/notas" : capturaAberta === "tarefa" ? "/tarefas" : "/cofre/transacao/novo"}
        titulo={tituloCaptura || (capturaAberta === "nota" ? "Nova nota" : capturaAberta === "tarefa" ? "Nova tarefa" : "Nova transação")}
        ordem={janelas.length}
        z={contador.current + 1}
        aoFechar={fecharCaptura}
        aoFocar={() => {}}
        cabecalhoNoConteudo={capturaAberta==="transacao"}
        aoFixar={() => {}}
        conteudo={capturaAberta==="transacao"?<div className="cofre-app cofre-capture-scope"><CreateFlow embedded contextoDesktop="ecos" onTitleChange={setTituloCaptura} pastaContexto={pastaContexto}/></div>:<CreateFlow embedded contextoDesktop="ecos" onTitleChange={setTituloCaptura} pastaContexto={pastaContexto}/>} 
      />}
      <CommandPalette aberta={paletaAberta} aoFechar={() => setPaletaAberta(false)} aoAbrirDocumento={abrirDocumento} aoAbrirCofre={() => setCofreAberto(true)} />
      {/* O fluxo de captura navega depois de salvar (`navigate("/feed")`) — num Router próprio isso não mexe nas abas. */}
      {capturaAberta !== "nota" && capturaAberta !== "tarefa" && capturaAberta !== "transacao" && <MemoryRouter><CreateFlow pastaContexto={pastaContexto} /></MemoryRouter>}
    </div>
    )}
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
