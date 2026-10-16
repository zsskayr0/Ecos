import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { tituloDaRota } from "./modules";
import { useWorkspace, type Pane } from "./workspace-store";

interface Props {
  tabId: string;
  x: number;
  y: number;
  panes: Pane[];
  aoAnunciar: (texto: string) => void;
  aoFechar: () => void;
}

/**
 * "Mover para...": caminho por teclado (Shift+F10 / tecla de menu) e por clique direito para tudo o que o arrasto de
 * abas faz: reordenar, trocar de painel e abrir painel novo ao lado.
 */
export function MoverAbaMenu({ tabId, x, y, panes, aoAnunciar, aoFechar }: Props) {
  const { dispatch } = useWorkspace();
  const ref = useRef<HTMLDivElement>(null);
  const origem = panes.find((p) => p.tabs.some((t) => t.id === tabId));
  const tab = origem?.tabs.find((t) => t.id === tabId);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const fora = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) aoFechar();
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aoFechar]);

  if (!origem || !tab) return null;
  const titulo = tab.title || tituloDaRota(tab.path);
  const indice = origem.tabs.findIndex((t) => t.id === tabId);
  const itens: { rotulo: string; acao: () => void; aviso: string }[] = [];
  if (indice > 0) itens.push({ rotulo: "Mover para o início", aviso: "movida para o início", acao: () => dispatch({ type: "move-tab", tabId, toPaneId: origem.id, index: 0 }) });
  if (indice < origem.tabs.length - 1) itens.push({ rotulo: "Mover para o fim", aviso: "movida para o fim", acao: () => dispatch({ type: "move-tab", tabId, toPaneId: origem.id }) });
  panes.forEach((p, n) => {
    if (p.id === origem.id) return;
    itens.push({ rotulo: `Mover para o painel ${n + 1}`, aviso: `movida para o painel ${n + 1}`, acao: () => dispatch({ type: "move-tab", tabId, toPaneId: p.id }) });
  });
  if (origem.tabs.length > 1) {
    itens.push({ rotulo: "Mover para novo painel à esquerda", aviso: "movida para um novo painel à esquerda", acao: () => dispatch({ type: "move-tab-to-new-pane", tabId, nextToPaneId: origem.id, side: "left" }) });
    itens.push({ rotulo: "Mover para novo painel à direita", aviso: "movida para um novo painel à direita", acao: () => dispatch({ type: "move-tab-to-new-pane", tabId, nextToPaneId: origem.id, side: "right" }) });
  }

  function teclado(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      aoFechar();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const botoes = [...(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const i = botoes.indexOf(document.activeElement as HTMLElement);
    botoes[(i + (e.key === "ArrowDown" ? 1 : -1) + botoes.length) % botoes.length]?.focus();
  }

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={`Mover a aba ${titulo}`}
      onKeyDown={teclado}
      style={{ left: Math.min(x, window.innerWidth - 240), top: Math.min(y, window.innerHeight - 200) }}
      className="fixed z-[1000] w-56 rounded-xl border border-border bg-surface-2 p-1 shadow-nav ecos-fade-in"
    >
      {itens.length === 0 && <p className="px-2.5 py-1.5 text-xs text-text-muted">Não há para onde mover esta aba.</p>}
      {itens.map((item) => (
        <button
          key={item.rotulo}
          type="button"
          role="menuitem"
          onClick={() => {
            item.acao();
            aoAnunciar(`${titulo} ${item.aviso}`);
            aoFechar();
          }}
          className="flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-xs text-text-primary hover:bg-surface-3 focus-visible:bg-surface-3 focus-visible:outline-none"
        >
          {item.rotulo}
        </button>
      ))}
    </div>,
    document.body,
  );
}
