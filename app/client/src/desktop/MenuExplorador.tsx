import { useEffect, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import { createPortal } from "react-dom";

export interface ItemMenuExplorador {
  rotulo: string;
  icone: LucideIcon;
  acao: () => void;
  /** Ação destrutiva: vermelha e separada das demais. */
  perigo?: boolean;
}

interface Props {
  x: number;
  y: number;
  rotulo: string;
  itens: ItemMenuExplorador[];
  aoFechar: () => void;
}

const LARGURA = 208;
const ALTURA_ITEM = 32;

/** Menu das linhas da árvore lateral (botão direito e "⋯"). Setas navegam, Esc e clique fora fecham. */
export function MenuExplorador({ x, y, rotulo, itens, aoFechar }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const fora = (e: MouseEvent) => {
      const alvo = e.target as Element;
      // O próprio "⋯" decide (alterna): se o mousedown fechasse aqui, o clique logo em seguida reabriria o menu.
      if (alvo.closest?.("[data-gatilho-menu-explorador]")) return;
      if (ref.current && !ref.current.contains(alvo)) aoFechar();
    };
    const rolou = () => aoFechar();
    document.addEventListener("mousedown", fora);
    window.addEventListener("blur", rolou);
    window.addEventListener("resize", rolou);
    return () => {
      document.removeEventListener("mousedown", fora);
      window.removeEventListener("blur", rolou);
      window.removeEventListener("resize", rolou);
    };
  }, [aoFechar]);

  function teclado(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      aoFechar();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const botoes = [...(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const i = botoes.indexOf(document.activeElement as HTMLElement);
    botoes[(i + (e.key === "ArrowDown" ? 1 : -1) + botoes.length) % botoes.length]?.focus();
  }

  const altura = itens.length * ALTURA_ITEM + 12;
  const primeiroPerigo = itens.findIndex((i) => i.perigo);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={`Ações de ${rotulo}`}
      onKeyDown={teclado}
      onContextMenu={(e) => e.preventDefault()}
      style={{ left: Math.max(8, Math.min(x, window.innerWidth - LARGURA - 8)), top: Math.max(8, Math.min(y, window.innerHeight - altura - 8)), width: LARGURA }}
      className="fixed z-[1000] rounded-xl border border-border bg-surface-2 p-1 shadow-nav ecos-fade-in"
    >
      {itens.map((item, i) => {
        const Icone = item.icone;
        return (
          <div key={item.rotulo}>
            {i === primeiroPerigo && i > 0 && <div role="separator" className="my-1 border-t border-border" />}
            <button
              type="button"
              role="menuitem"
              onClick={() => { aoFechar(); item.acao(); }}
              className={`flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] focus-visible:outline-none ${item.perigo ? "text-error hover:bg-error/10 focus-visible:bg-error/10" : "text-text-primary hover:bg-surface-3 focus-visible:bg-surface-3"}`}
            >
              <Icone size={14} className="shrink-0" />
              <span className="truncate">{item.rotulo}</span>
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
