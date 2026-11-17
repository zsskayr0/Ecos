import { moduloDaRota } from "./modules";
import type { WorkspaceAction, WorkspaceState } from "./workspace-store";

/** Registro do "voltar/avançar" de cada aba (e do Cofre): cada MemoryRouter se registra aqui para que o botão do mouse, Alt+setas e a barra de abas comandem o histórico certo. */
export interface NavegacaoAba {
  ir: (delta: -1 | 1) => void;
  podeVoltar: () => boolean;
  podeAvancar: () => boolean;
  /** Leva a aba a outra rota (o MemoryRouter dela): é como a sidebar abre uma pasta numa aba de Arquivos que já existe. */
  navegar?: (path: string) => void;
}

const registro = new Map<string, NavegacaoAba>();
const ouvintes = new Set<() => void>();

export function registrarNavegacao(chave: string, nav: NavegacaoAba): () => void {
  registro.set(chave, nav);
  ouvintes.forEach((fn) => fn());
  return () => { if (registro.get(chave) === nav) registro.delete(chave); };
}

export function navegacaoDaAba(chave: string): NavegacaoAba | undefined {
  return registro.get(chave);
}

/** Mostra a pasta na aba de Arquivos existente, de preferência no painel em foco. */
export function abrirPastaNosArquivos(
  { state, dispatch }: { state: WorkspaceState; dispatch: (acao: WorkspaceAction) => void },
  caminho: string,
  emAba: boolean | "segundo-plano" = false,
) {
  const path = `/arquivos${caminho ? `?pasta=${encodeURIComponent(caminho)}` : ""}`;
  if (!emAba) {
    const paineis = [...state.panes].sort((a, b) => Number(b.id === state.focusedPaneId) - Number(a.id === state.focusedPaneId));
    for (const painel of paineis) {
      const aba = painel.tabs.find((t) => moduloDaRota(t.path).id === "arquivos");
      if (!aba) continue;
      const navegar = navegacaoDaAba(`aba:${aba.id}`)?.navegar;
      if (aba.path !== path && !navegar) continue;
      dispatch({ type: "activate-tab", paneId: painel.id, tabId: aba.id });
      if (aba.path !== path) navegar?.(path);
      return;
    }
  }
  dispatch({ type: "open", path, where: "focused", reuse: "path", background: emAba === "segundo-plano" });
}

export function aoMudarNavegacao(fn: () => void): () => void {
  ouvintes.add(fn);
  return () => { ouvintes.delete(fn); };
}

/** Quem estiver "no topo" (ex.: o Cofre, quando aberto) assume voltar/avançar; senão, a aba ativa do painel em foco. */
let chaveTopo: string | null = null;
export function definirTopoNavegacao(chave: string | null) { chaveTopo = chave; }
export function topoNavegacao() { return chaveTopo; }

export const LIMITE_HISTORICO = 50;

