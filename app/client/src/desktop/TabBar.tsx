import { useEffect, useRef, useState, type DragEvent } from "react";
import { Plus, X } from "lucide-react";
import { RAIL_PRINCIPAL, RAIL_UTILITARIOS, moduloDaRota, moduloPorId, tituloDaRota } from "./modules";
import { useTabDrag } from "./tab-drag";
import { useWorkspace, type Pane } from "./workspace-store";

export function TabBar({ pane }: { pane: Pane }) {
  const { dispatch, fechando } = useWorkspace();
  const { arrastando, iniciar, encerrar } = useTabDrag();
  const [indiceAlvo, setIndiceAlvo] = useState<number | null>(null);
  const [menuAberto, setMenuAberto] = useState(false);

  function indiceSemArrastada(tabId: string): number {
    return pane.tabs.filter((t) => t.id !== arrastando?.tabId).findIndex((t) => t.id === tabId);
  }

  function aoSoltar(e: DragEvent, indice: number) {
    e.preventDefault();
    e.stopPropagation();
    if (arrastando) dispatch({ type: "move-tab", tabId: arrastando.tabId, toPaneId: pane.id, index: indice });
    setIndiceAlvo(null);
    encerrar();
  }

  return (
    <div
      data-pane-tabbar={pane.id}
      className="relative flex h-9 shrink-0 items-stretch border-b border-border bg-surface-1 transition-colors data-[drop-alvo=true]:bg-cyan/20"
      onDragOver={(e) => {
        if (!arrastando) return;
        e.preventDefault();
        setIndiceAlvo((atual) => atual ?? pane.tabs.length);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setIndiceAlvo(null);
      }}
      onDrop={(e) => aoSoltar(e, pane.tabs.filter((t) => t.id !== arrastando?.tabId).length)}
    >
      <div role="tablist" className="flex min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:none]">
        {pane.tabs.map((tab) => {
          const ativa = tab.id === pane.activeTabId;
          const Icone = moduloDaRota(tab.path).icone;
          const marcadorAntes = indiceAlvo !== null && arrastando?.tabId !== tab.id && indiceSemArrastada(tab.id) === indiceAlvo;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={ativa}
              ref={(el) => {
                // Congela a largura atual: a animação parte dela em vez de esperar o teto de 200px.
                if (el && fechando.includes(tab.id) && !el.style.getPropertyValue("--ecos-aba-w")) el.style.setProperty("--ecos-aba-w", `${el.offsetWidth}px`);
              }}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", tab.id);
                iniciar({ tabId: tab.id, paneId: pane.id });
              }}
              onDragEnd={() => {
                setIndiceAlvo(null);
                encerrar();
              }}
              onDragOver={(e) => {
                if (!arrastando || arrastando.tabId === tab.id) return;
                e.preventDefault();
                e.stopPropagation();
                const caixa = e.currentTarget.getBoundingClientRect();
                const depois = e.clientX > caixa.left + caixa.width / 2;
                const base = indiceSemArrastada(tab.id);
                setIndiceAlvo(depois ? base + 1 : base);
              }}
              onDrop={(e) => aoSoltar(e, indiceAlvo ?? pane.tabs.length)}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  dispatch({ type: "close-tab", paneId: pane.id, tabId: tab.id });
                }
              }}
              onClick={() => dispatch({ type: "activate-tab", paneId: pane.id, tabId: tab.id })}
              className={`group relative flex max-w-[200px] cursor-pointer select-none items-center gap-2 border-r border-border px-3 text-xs transition-colors ${fechando.includes(tab.id) ? "ecos-aba-saindo" : ""} ${
                ativa ? "bg-base text-text-primary" : "text-text-muted hover:bg-surface-2 hover:text-text-secondary"
              } ${arrastando?.tabId === tab.id ? "opacity-40" : ""}`}
            >
              {marcadorAntes && <span className="absolute inset-y-0 left-0 w-0.5 bg-cyan" />}
              <Icone size={13} strokeWidth={1.75} className="shrink-0" />
              <span className="truncate">{tab.title || tituloDaRota(tab.path)}</span>
              <button
                type="button"
                aria-label="Fechar aba"
                onClick={(e) => {
                  e.stopPropagation();
                  dispatch({ type: "close-tab", paneId: pane.id, tabId: tab.id });
                }}
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-text-muted hover:bg-surface-3 hover:text-text-primary ${
                  ativa ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                }`}
              >
                <X size={11} strokeWidth={2} />
              </button>
            </div>
          );
        })}
        {indiceAlvo === pane.tabs.filter((t) => t.id !== arrastando?.tabId).length && arrastando && (
          <span className="my-1 w-0.5 shrink-0 bg-cyan" />
        )}
      </div>

      <div className="relative shrink-0">
        <button
          type="button"
          aria-label="Abrir módulo neste painel"
          title="Abrir módulo neste painel"
          onClick={() => setMenuAberto((v) => !v)}
          className="flex h-full w-9 items-center justify-center text-text-muted hover:bg-surface-2 hover:text-text-primary"
        >
          <Plus size={15} strokeWidth={1.75} />
        </button>
        {menuAberto && (
          <MenuModulos
            aoEscolher={(path) => {
              dispatch({ type: "focus-pane", paneId: pane.id });
              dispatch({ type: "open", path, where: "focused", reuse: "modulo" });
              setMenuAberto(false);
            }}
            aoFechar={() => setMenuAberto(false)}
          />
        )}
      </div>
    </div>
  );
}

function MenuModulos({ aoEscolher, aoFechar }: { aoEscolher: (path: string) => void; aoFechar: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function fora(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) aoFechar();
    }
    function esc(e: KeyboardEvent) {
      if (e.key === "Escape") aoFechar();
    }
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aoFechar]);

  return (
    <div
      ref={ref}
      className="absolute right-0 top-10 z-40 w-48 rounded-xl border border-border bg-surface-2 p-1 shadow-nav ecos-fade-in"
    >
      {[...RAIL_PRINCIPAL, ...RAIL_UTILITARIOS].map((id) => {
        const modulo = moduloPorId(id);
        return (
          <button
            key={id}
            type="button"
            onClick={() => aoEscolher(modulo.raiz)}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-text-primary hover:bg-surface-3"
          >
            <modulo.icone size={14} strokeWidth={1.75} className="text-text-muted" />
            {modulo.titulo}
          </button>
        );
      })}
    </div>
  );
}
