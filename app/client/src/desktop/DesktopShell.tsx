import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/common/Dialog";
import { MemoryRouter, Routes } from "react-router-dom";
import { ArrowLeft, Bell, ChevronDown, FolderTree, Lock, LogOut, Search, User, Users, Settings, X } from "lucide-react";
import { Avatar } from "@/components/common/Avatar";
import logoIcone from "@/assets/brand/ecos-icone.svg";
import { CreateFlow } from "@/screens/Create/CreateFlow";
import { nomeExibicao, useAuth } from "@/lib/auth-context";
import { useAppUI } from "@/lib/ui-context";
import { useMinhasEquipes } from "@/lib/use-minhas-equipes";
import { DocumentoPopupContext, type ModoAbrirDocumento } from "@/lib/documento-popup";
import { useComprovantesEsperando } from "@/lib/fila-comprovantes";
import { pastaDoCaminho } from "@/lib/pasta-contexto";
import { useFotoPerfil } from "@/lib/profile-avatar";
import { CommandPalette } from "./CommandPalette";
import { DocumentoJanela } from "./DocumentoJanela";
import { MenuCriar } from "./MenuCriar";
import { Rail } from "./Rail";
import { SoltarNoCofre } from "./SoltarNoCofre";
import { TabDragProvider } from "./tab-drag";
import { LARGURA_MENU_RECOLHIDO, useLarguraMenu } from "./arvore-lateral";
import { GuiasSlotContext } from "./TabBar";
import { Workspace } from "./Workspace";
import { WorkspaceProvider, useWorkspace } from "./workspace-store";
import { PathReporter } from "./TabContent";
import { useCliqueDoMeio } from "./clique-do-meio";
import { definirTopoNavegacao, navegacaoDaAba, topoNavegacao } from "./navegacao-abas";
import { screenRoutes } from "@/routes/screen-routes";
import { prefetchRotasProvaveis } from "@/lib/prefetch-rotas";
import { EstadoCarregando } from "@/components/common/EstadoCarregando";

// O Cofre é pesado e só abre sob demanda: fica fora do pacote inicial.
const VaultScreen = lazy(() => import("@/screens/Vault/VaultScreen").then((m) => ({ default: m.VaultScreen })));

const COFRE_ABERTO_KEY = "ecos.desktop.cofre-aberto.v1";
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

/** Botões voltar/avançar do mouse e Alt+←/→ navegam no histórico da aba em foco (ou do Cofre) — nunca saem do app. */
function useNavegacaoGlobal() {
  const { state } = useWorkspace();
  const estado = useRef(state);
  estado.current = state;
  useEffect(() => {
    const ir = (d: -1 | 1) => {
      const topo = topoNavegacao();
      let chave = topo;
      if (!chave) {
        const pane = estado.current.panes.find((p) => p.id === estado.current.focusedPaneId);
        if (pane) chave = `aba:${pane.activeTabId}`;
      }
      if (chave) navegacaoDaAba(chave)?.ir(d);
    };
    const botao = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.type === "mouseup") ir(e.button === 3 ? -1 : 1);
    };
    const tecla = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
      const alvo = e.target as HTMLElement | null;
      if (alvo && (alvo.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName))) return;
      e.preventDefault();
      ir(e.key === "ArrowLeft" ? -1 : 1);
    };
    // Rede de segurança: qualquer "voltar" do navegador que escape fica preso aqui em vez de sair do app.
    const preso = () => window.history.pushState(null, "", window.location.href);
    preso();
    window.addEventListener("popstate", preso);
    for (const t of ["mousedown", "mouseup", "auxclick"]) window.addEventListener(t, botao as EventListener, true);
    window.addEventListener("keydown", tecla);
    return () => {
      window.removeEventListener("popstate", preso);
      for (const t of ["mousedown", "mouseup", "auxclick"]) window.removeEventListener(t, botao as EventListener, true);
      window.removeEventListener("keydown", tecla);
    };
  }, []);
}

function Barra({ refGuias, abrirPaleta, abrirOrganizacao, cofre, voltarAoEcos, buscaGlobal = false, setBuscaGlobal }: { refGuias: (el: HTMLDivElement | null) => void; abrirPaleta: () => void; abrirOrganizacao: () => void; cofre?: boolean; voltarAoEcos?: () => void; buscaGlobal?: boolean; setBuscaGlobal?: (valor:boolean)=>void }) {
  const { perfil, logout } = useAuth();
  const { espacoAtivo, setEspacoAtivo } = useAppUI();
  const { equipes } = useMinhasEquipes();
  const larguraMenu = useLarguraMenu();
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
    <header className="flex h-14 shrink-0 items-center gap-2 bg-base pr-3">
      {/* O logo ocupa a coluna do menu lateral (mesma largura, mesmo eixo dos ícones); as guias começam onde o conteúdo começa. */}
      <span style={{ width: larguraMenu }} className="flex h-full shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap border-r border-border bg-surface-1 pl-4 font-display text-base font-bold text-text-primary">
        <img src={logoIcone} alt="" width={24} height={24} className="h-6 w-6 shrink-0" />
        {(cofre || larguraMenu > LARGURA_MENU_RECOLHIDO + 40) && (cofre ? "Cofre" : "Ecos")}
      </span>

      {/* Guias (um painel só) ocupam o espaço do meio; com painéis divididos, cada painel mantém a sua faixa. */}
      <div ref={refGuias} className="flex h-full min-w-0 flex-1 items-center pl-1" />

      <div className="flex w-48 shrink-0 items-center rounded-lg border border-border bg-surface-2 transition-colors hover:border-cyan/40 xl:w-60">
      <button
        type="button"
        onClick={abrirPaleta}
        title="Buscar ou executar um comando"
        className="flex h-8 min-w-0 flex-1 items-center gap-2 px-3 text-left text-[13px] text-text-muted"
      >
        <Search size={14} strokeWidth={1.75} />
        <span className="flex-1 truncate">{cofre&&!buscaGlobal?"Buscar no Cofre":"Buscar…"}</span>
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
  return <Dialog rotulo="Painel da conta" onFechar={aoFechar} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/35 p-6 backdrop-blur-md ecos-fade-in">
    <section className="flex h-[min(780px,calc(100dvh-48px))] w-[min(1200px,calc(100vw-48px))] flex-col overflow-hidden rounded-2xl border border-border bg-base shadow-nav">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-surface-1 px-4"><span className="text-sm font-semibold text-text-primary">Conta</span><button type="button" onClick={aoFechar} aria-label="Fechar" className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-surface-2 hover:text-text-primary"><X size={17} /></button></header>
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]"><MemoryRouter initialEntries={[path]}><Routes>{screenRoutes}</Routes></MemoryRouter></div>
    </section>
  </Dialog>;
}

interface JanelaAberta {
  id: number;
  path: string;
  ordem: number;
  z: number;
}

const MAX_JANELAS = 3;

function normalizarCaminhoJanela(path: string) {
  const semQuery = path.split(/[?#]/)[0];
  return semQuery.length > 1 ? semQuery.replace(/\/+$/, "") : semQuery;
}

export function documentoDoLinkDireto(pathname: string): string | null {
  const nota = /^\/(?:notas\/)?nota\/([^/]+)\/?$/.exec(pathname);
  if (nota) return `/notas/nota/${nota[1]}`;
  const tarefa = /^\/tarefa\/([^/]+)\/?$/.exec(pathname);
  if (tarefa) return `/tarefa/${tarefa[1]}`;
  return null;
}

function cofreCaminhoInicial() { try { return sessionStorage.getItem("ecos.desktop.cofre-rota.v1") || "/cofre"; } catch { return "/cofre"; } }

function Conteudo() {
  const { state, dispatch } = useWorkspace();
  const { capturaAberta, fecharCaptura } = useAppUI();
  // A pasta aberta na aba em foco vira a pasta padrão de quem for criada agora.
  const paneFocada = state.panes.find((p) => p.id === state.focusedPaneId);
  const abaFocada = paneFocada?.tabs.find((t) => t.id === paneFocada.activeTabId);
  const pastaContexto = abaFocada ? pastaDoCaminho(abaFocada.path) : null;
  const [slotGuias, setSlotGuias] = useState<HTMLDivElement | null>(null);
  const [paletaAberta, setPaletaAberta] = useState(false);
  const [buscaGlobal, setBuscaGlobal] = useState(false);
  const [cofreAberto, setCofreAbertoState] = useState(() => { try { return localStorage.getItem(COFRE_ABERTO_KEY) === "1"; } catch { return false; } });
  const setCofreAberto = useCallback((aberto: boolean) => { setCofreAbertoState(aberto); try { localStorage.setItem(COFRE_ABERTO_KEY, aberto ? "1" : "0"); } catch { /* só conveniência */ } }, []);
  useEffect(() => { definirTopoNavegacao(cofreAberto ? "cofre" : null); return () => definirTopoNavegacao(null); }, [cofreAberto]);
  const [tituloCaptura, setTituloCaptura] = useState("");
  const [janelas, setJanelas] = useState<JanelaAberta[]>([]);
  const contador = useRef(0);
  const alternarPaleta = (global = false) => { if (global) setBuscaGlobal(true); setPaletaAberta((v) => !v); };
  useAtalhosGlobais(alternarPaleta);
  useEffect(() => { prefetchRotasProvaveis(); }, []);
  useNavegacaoGlobal();
  useCliqueDoMeio();
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
    (path: string, emAba: ModoAbrirDocumento) => {
      if (cofreAberto && path.startsWith("/cofre")) {
        setJanelas((js) => {
          const existente = js.find((j) => j.path === path);
          if (existente) return js.map((j) => j === existente ? { ...j, z: ++contador.current } : j);
          return [...js, { id: ++contador.current, path, ordem: js.length, z: ++contador.current }];
        });
        return;
      }
      if (emAba) {
        dispatch({ type: "open", path, where: "focused", reuse: "path", background: emAba === "segundo-plano" });
        return;
      }
      const alvo = normalizarCaminhoJanela(path);
      setJanelas((js) => {
        const existente = js.find((j) => normalizarCaminhoJanela(j.path) === alvo);
        if (existente) return js.map((j) => (j === existente ? { ...j, z: ++contador.current } : j));
        let restantes = js;
        // Acima do limite, a janela mais ao fundo vira aba (em segundo plano) na barra do topo, em vez de empilhar.
        while (restantes.length >= MAX_JANELAS) {
          const fundo = restantes.reduce((a, b) => (b.z < a.z ? b : a));
          queueMicrotask(() => dispatch({ type: "open", path: fundo.path, where: "focused", reuse: "path", background: true }));
          restantes = restantes.filter((j) => j !== fundo);
        }
        return [...restantes, { id: ++contador.current, path, ordem: restantes.length, z: ++contador.current }];
      });
    },
    [dispatch, cofreAberto],
  );

  // Link direto (/notas/nota/<id>, /nota/<id>, /tarefa/<id>): abre o documento numa janela e limpa a URL.
  const linkInicial = useRef(false);
  useEffect(() => {
    if (linkInicial.current) return;
    linkInicial.current = true;
    const doc = documentoDoLinkDireto(window.location.pathname);
    if (!doc) return;
    abrirDocumento(doc, false);
    window.history.replaceState(null, "", "/");
  }, [abrirDocumento]);

  function fixarComoAba(janela: JanelaAberta, paneId?: string) {
    if (paneId) dispatch({ type: "focus-pane", paneId });
    dispatch({ type: "open", path: janela.path, where: "focused", reuse: "path" });
    fecharJanela(janela.id);
  }

  return (
    <DocumentoPopupContext.Provider value={abrirDocumento}>
    <SoltarNoCofre />
    {cofreAberto ? (
      <div className="flex h-dvh flex-col overflow-hidden bg-base">
        <div className="min-h-0 flex-1 overflow-hidden"><MemoryRouter initialEntries={[cofreCaminhoInicial()]}><PathReporter chave="cofre" hist={[cofreCaminhoInicial()]} idx={0} /><Suspense fallback={<EstadoCarregando />}><VaultScreen embedded voltar={() => setCofreAberto(false)} /></Suspense></MemoryRouter></div>
        {janelas.map((j) => <DocumentoJanela key={j.id} path={j.path} ordem={j.ordem} z={j.z} aoFechar={() => fecharJanela(j.id)} aoFocar={() => trazerParaFrente(j.id)} />)}
        {capturaAberta === "transacao" && <DocumentoJanela path="/cofre/transacao/novo" titulo={tituloCaptura || "Novo lançamento"} ordem={janelas.length} z={contador.current + 1} aoFechar={fecharCaptura} aoFocar={() => {}} cabecalhoNoConteudo conteudo={<div className="cofre-app cofre-capture-scope"><CreateFlow embedded contextoDesktop="cofre" onTitleChange={setTituloCaptura} pastaContexto={pastaContexto} /></div>} />}
      </div>
    ) : (
    <div className="flex h-dvh flex-col bg-base">
      <Barra refGuias={setSlotGuias} abrirPaleta={() => setPaletaAberta(true)} abrirOrganizacao={() => abrirDocumento("/configuracoes/organizacao", false)} />
      <div className="flex min-h-0 flex-1">
        <Rail abrirCofre={() => setCofreAberto(true)} />
        <GuiasSlotContext.Provider value={slotGuias}><Workspace /></GuiasSlotContext.Provider>
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
