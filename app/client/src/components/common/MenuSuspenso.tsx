import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Check } from "lucide-react";
import "./menu-suspenso.css";

/** Cores do app (seguem o tema claro/escuro). Qualquer valor CSS de cor também serve. */
export const TOM = {
  aco: "rgb(var(--ecos-steel-400-rgb))",
  ciano: "rgb(var(--ecos-cyan-rgb))",
  violeta: "rgb(var(--ecos-violet-rgb))",
  sucesso: "rgb(var(--ecos-success-rgb))",
  alerta: "rgb(var(--ecos-warning-rgb))",
  erro: "rgb(var(--ecos-error-rgb))",
} as const;

export interface OpcaoMenu<T extends string> {
  valor: T;
  rotulo: string;
  /** Cor da opção: bolinha, destaque deslizante e, quando é o filtro atual, o gatilho. */
  cor?: string;
}

const misturar = (cor: string, pct: number) => `color-mix(in srgb, ${cor} ${pct}%, transparent)`;
const ALTURA_ITEM = 36;

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
  /** Pinta o botão com esta cor (o filtro está ativo). `null`/ausente = visual neutro. */
  corAtiva?: string | null;
  larguraMenu?: string;
}

/** Menu suspenso do Ecos, no lugar do `<select>` nativo. Anima entrada e saída, fecha com Esc/clique fora e navega por setas. */
export function MenuSuspenso<T extends string>({ valor, opcoes, onChange, ariaLabel, gatilho, alinhar = "esq", classeGatilho = "", corAtiva, larguraMenu = "min-w-[11rem]" }: Props<T>) {
  const id = useId();
  const raiz = useRef<HTMLDivElement>(null);
  const [aberto, setAberto] = useState(false);
  const [montado, setMontado] = useState(false);
  const indiceAtual = Math.max(0, opcoes.findIndex((o) => o.valor === valor));
  // O destaque desliza entre as opções (como o seletor de prioridade) e muda de cor conforme a opção sob o cursor.
  const [destaque, setDestaque] = useState(indiceAtual);
  useEffect(() => { if (aberto) setDestaque(indiceAtual); }, [aberto, indiceAtual]);

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
        onClick={() => (aberto ? fechar() : abrir())} className={classeGatilho}
        style={corAtiva ? ({ borderColor: misturar(corAtiva, 70), backgroundColor: misturar(corAtiva, 18) } as CSSProperties) : undefined}>
        {gatilho({ aberto, atual })}
      </button>
      {montado && (
        <div id={id} role="menu" aria-label={ariaLabel} data-alinhar={alinhar} data-saindo={!aberto}
          className={`ecos-menu absolute z-40 mt-1.5 max-h-72 overflow-y-auto overflow-x-hidden rounded-xl border border-border bg-surface-1 p-1 shadow-nav ${larguraMenu} ${alinhar === "dir" ? "right-0" : "left-0"}`}>
          <span aria-hidden className="pointer-events-none absolute left-1 right-1 top-1 rounded-lg border transition-[transform,background-color,border-color] duration-200 motion-reduce:transition-none"
            style={{ height: ALTURA_ITEM, transform: `translateY(${destaque * ALTURA_ITEM}px)`, borderColor: misturar(opcoes[destaque]?.cor ?? TOM.aco, 65), backgroundColor: misturar(opcoes[destaque]?.cor ?? TOM.aco, 16) }} />
          {opcoes.map((o, i) => {
            const ativo = o.valor === valor;
            return (
              <button key={o.valor} type="button" role="menuitemradio" aria-checked={ativo} style={{ height: ALTURA_ITEM }}
                onClick={() => { onChange(o.valor); fechar(); }}
                onPointerEnter={() => setDestaque(i)} onFocus={() => setDestaque(i)} onPointerLeave={() => setDestaque(indiceAtual)}
                className={`ecos-menu-item relative flex w-full items-center gap-2 rounded-lg border border-transparent px-2.5 text-left text-sm focus-visible:outline-none ${ativo || destaque === i ? "text-text-primary" : "text-text-secondary"}`}>
                {o.cor && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: o.cor }} />}
                <span className="min-w-0 flex-1 truncate">{o.rotulo}</span>
                {ativo && <Check size={14} className="shrink-0" style={{ color: o.cor ?? TOM.aco }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
