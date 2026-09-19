import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import "./menu-suspenso.css";

export interface OpcaoMenu<T extends string> {
  valor: T;
  rotulo: string;
  /** Bolinha de cor à esquerda (ex.: prioridade). */
  cor?: string;
}

interface Props<T extends string> {
  valor: T;
  opcoes: readonly OpcaoMenu<T>[];
  onChange: (valor: T) => void;
  ariaLabel: string;
  /** Desenha o conteúdo do botão que abre o menu. */
  gatilho: (estado: { aberto: boolean; atual: OpcaoMenu<T> | undefined }) => ReactNode;
  alinhar?: "esq" | "dir";
  /** Classes do botão. */
  classeGatilho?: string;
  larguraMenu?: string;
}

/** Menu suspenso do Ecos, no lugar do `<select>` nativo. Anima entrada e saída, fecha com Esc/clique fora e navega por setas. */
export function MenuSuspenso<T extends string>({ valor, opcoes, onChange, ariaLabel, gatilho, alinhar = "esq", classeGatilho = "", larguraMenu = "min-w-[11rem]" }: Props<T>) {
  const id = useId();
  const raiz = useRef<HTMLDivElement>(null);
  const [aberto, setAberto] = useState(false);
  const [montado, setMontado] = useState(false);

  const fechar = useCallback(() => {
    setAberto(false);
    window.setTimeout(() => setMontado(false), 110);
  }, []);
  const abrir = () => { setMontado(true); setAberto(true); };

  useEffect(() => {
    if (!aberto) return;
    const aoClicarFora = (e: PointerEvent) => { if (!raiz.current?.contains(e.target as Node)) fechar(); };
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); fechar(); raiz.current?.querySelector<HTMLElement>("[data-gatilho]")?.focus(); }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const itens = [...(raiz.current?.querySelectorAll<HTMLElement>("[role^=menuitem]") ?? [])];
        const i = itens.indexOf(document.activeElement as HTMLElement);
        itens[(i + (e.key === "ArrowDown" ? 1 : -1) + itens.length) % itens.length]?.focus();
      }
    };
    document.addEventListener("pointerdown", aoClicarFora);
    document.addEventListener("keydown", aoTeclar, true);
    return () => { document.removeEventListener("pointerdown", aoClicarFora); document.removeEventListener("keydown", aoTeclar, true); };
  }, [aberto, fechar]);

  // Ao abrir, o foco vai para o item selecionado (ou o primeiro), para o teclado.
  useEffect(() => {
    if (!aberto) return;
    const t = window.setTimeout(() => {
      const itens = [...(raiz.current?.querySelectorAll<HTMLElement>("[role^=menuitem]") ?? [])];
      (itens.find((el) => el.getAttribute("aria-checked") === "true") ?? itens[0])?.focus({ preventScroll: true });
    }, 30);
    return () => window.clearTimeout(t);
  }, [aberto]);

  const atual = opcoes.find((o) => o.valor === valor);
  return (
    <div ref={raiz} className="relative">
      <button type="button" data-gatilho aria-haspopup="menu" aria-expanded={aberto} aria-controls={id} aria-label={ariaLabel}
        onClick={() => (aberto ? fechar() : abrir())} className={classeGatilho}>
        {gatilho({ aberto, atual })}
      </button>
      {montado && (
        <div id={id} role="menu" aria-label={ariaLabel} data-alinhar={alinhar} data-saindo={!aberto}
          className={`ecos-menu absolute z-40 mt-1.5 max-h-72 overflow-y-auto rounded-xl border border-border bg-surface-1 p-1 shadow-nav ${larguraMenu} ${alinhar === "dir" ? "right-0" : "left-0"}`}>
          {opcoes.map((o) => {
            const ativo = o.valor === valor;
            return (
              <button key={o.valor} type="button" role="menuitemradio" aria-checked={ativo}
                onClick={() => { onChange(o.valor); fechar(); }}
                className={`ecos-menu-item flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm focus-visible:outline-none ${ativo ? "bg-steel-700/30 text-text-primary" : "text-text-secondary hover:bg-surface-2 hover:text-text-primary focus-visible:bg-surface-2"}`}>
                {o.cor && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: o.cor }} />}
                <span className="min-w-0 flex-1 truncate">{o.rotulo}</span>
                {ativo && <Check size={14} className="shrink-0 text-steel-300" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
