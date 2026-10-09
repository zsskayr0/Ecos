import { ArvorePastas } from "./ArvorePastas";
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Check, Search, type LucideIcon } from "lucide-react";
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
  pasta?: boolean;
  rotulo: string;
  /** Cor da opção: bolinha, destaque deslizante e, quando é o filtro atual, o gatilho. */
  cor?: string;
  /** Ícone à esquerda; herda a cor da opção. Sem ícone, a opção com cor mostra uma bolinha. */
  icone?: LucideIcon;
  /** Elemento próprio à esquerda (ex.: o selo de uma conta); tem prioridade sobre `icone` e a bolinha. */
  visual?: ReactNode;
}

export const misturar = (cor: string, pct: number) => `color-mix(in srgb, ${cor} ${pct}%, transparent)`;
export const ALTURA_ITEM = 36;

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
  arvore?: boolean;
  /** Mantém o menu dentro da janela, sem recorte por painéis com rolagem. */
  fixo?: boolean;
  /** Campo de pesquisa no topo da lista (só com muitas opções, ex.: categorias e pagadores). */
  buscar?: boolean;
  /** Lista mais larga e mais alta que o gatilho (com `fixo`). */
  largo?: boolean;
  /** Classe extra da lista (ex.: o desenho do Cofre). */
  classeMenu?: string;
  /** Avisa quando o menu abre ou fecha (ex.: trocar o painel ao lado enquanto se escolhe). */
  onAbrirChange?: (aberto: boolean) => void;
}

/** Menu suspenso do Ecos, no lugar do `<select>` nativo. Anima entrada e saída, fecha com Esc/clique fora e navega por setas. */
export function MenuSuspenso<T extends string>({ valor, opcoes, onChange, ariaLabel, gatilho, alinhar = "esq", classeGatilho = "", corAtiva, larguraMenu = "min-w-[11rem]", arvore = false, fixo = false, buscar = false, largo = false, classeMenu = "", onAbrirChange }: Props<T>) {
  const id = useId();
  const raiz = useRef<HTMLDivElement>(null);
  const [aberto, setAberto] = useState(false);
  const [montado, setMontado] = useState(false);
  const [posicao, setPosicao] = useState<CSSProperties>();
  const [busca, setBusca] = useState("");
  const semAcento = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const lista = buscar && busca.trim() ? opcoes.filter((o) => semAcento(o.rotulo).includes(semAcento(busca.trim()))) : opcoes;
  const alturaMax = largo ? 400 : 288;
  const indiceAtual = Math.max(0, opcoes.findIndex((o) => o.valor === valor));
  // O destaque desliza entre as opções (como o seletor de prioridade) e muda de cor conforme a opção sob o cursor.
  const [destaque, setDestaque] = useState(indiceAtual);
  useEffect(() => { if (aberto) setDestaque(indiceAtual); }, [aberto, indiceAtual]);
  useEffect(() => { onAbrirChange?.(aberto); }, [aberto]); // eslint-disable-line react-hooks/exhaustive-deps
  // Com a lista filtrada o destaque segue a primeira opção que sobrou.
  useEffect(() => { if (buscar && busca.trim()) setDestaque(0); }, [buscar, busca]);

  const fechar = useCallback(() => {
    setAberto(false);
    window.setTimeout(() => { setMontado(false); setBusca(""); }, 110);
  }, []);
  const abrir = () => {
    if (fixo) {
      const r = raiz.current!.getBoundingClientRect();
      // Altura realmente visível (a janela pode estar menor que `innerHeight`, ex.: painéis do app).
      const altura = Math.min(window.innerHeight, document.documentElement.clientHeight || window.innerHeight, window.visualViewport?.height ?? Infinity);
      const abaixo = altura - r.bottom - 14;
      const acima = r.top - 14;
      const preciso = Math.min(alturaMax, opcoes.length * ALTURA_ITEM + 10 + (buscar ? 44 : 0));
      // Abre para o lado que comporta a lista; se nenhum comporta, para o que tem mais espaço (nunca só a barra de pesquisa).
      const subir = abaixo < preciso && acima > abaixo;
      const largura = Math.min(Math.max(r.width, largo ? 320 : 176), window.innerWidth - 16);
      setPosicao({
        position: "fixed", marginTop: 0, width: largura, minWidth: 0,
        left: Math.max(8, Math.min(alinhar === "dir" ? r.right - largura : r.left, window.innerWidth - largura - 8)),
        right: "auto", top: subir ? "auto" : r.bottom + 6,
        bottom: subir ? altura - r.top + 6 : "auto",
        maxHeight: Math.max(Math.min(preciso, 160), Math.min(alturaMax, subir ? acima : abaixo)),
      });
    }
    setMontado(true); setAberto(true);
  };

  useEffect(() => {
    if (!aberto || !fixo) return;
    const aoRolar = (e: Event) => {
      if (!(e.target instanceof Node) || !raiz.current?.contains(e.target)) fechar();
    };
    window.addEventListener("resize", fechar);
    document.addEventListener("scroll", aoRolar, true);
    return () => {
      window.removeEventListener("resize", fechar);
      document.removeEventListener("scroll", aoRolar, true);
    };
  }, [aberto, fixo, fechar]);

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
      if (buscar) { raiz.current?.querySelector<HTMLElement>("[data-busca]")?.focus({ preventScroll: true }); return; }
      const itens = [...(raiz.current?.querySelectorAll<HTMLElement>("[role^=menuitem]") ?? [])];
      (itens.find((el) => el.getAttribute("aria-checked") === "true") ?? itens[0])?.focus({ preventScroll: true });
    }, 30);
    return () => window.clearTimeout(t);
  }, [aberto, buscar]);

  const atual = opcoes.find((o) => o.valor === valor);
  return (
    <div ref={raiz} className="relative">
      <button type="button" data-gatilho aria-haspopup="menu" aria-expanded={aberto} aria-controls={id} aria-label={ariaLabel}
        onClick={() => (aberto ? fechar() : abrir())} className={classeGatilho}
        style={corAtiva ? ({ borderColor: misturar(corAtiva, 70), backgroundColor: misturar(corAtiva, 18) } as CSSProperties) : undefined}>
        {gatilho({ aberto, atual })}
      </button>
      {montado && (
        <div id={id} role="menu" aria-label={ariaLabel} data-alinhar={alinhar} data-saindo={!aberto} style={fixo ? posicao : undefined}
          className={`ecos-menu ${classeMenu} absolute z-40 mt-1.5 ${largo ? "max-h-[25rem]" : "max-h-72"} overflow-y-auto overflow-x-hidden rounded-xl border border-border bg-surface-1 p-1 shadow-nav ${arvore ? "w-72 max-w-[calc(100vw-2rem)]" : larguraMenu} ${alinhar === "dir" ? "right-0" : "left-0"}`}>
          {arvore ? <ArvorePastas opcoes={opcoes} valores={[valor]} onSelect={(v) => { onChange(v as T); fechar(); }} /> : <>
          {buscar && (
            <label className="sticky -top-1 z-10 -mx-1 -mt-1 mb-1 flex h-11 items-center gap-2 bg-surface-1 px-3.5 text-text-muted focus-within:text-text-primary">
              <Search size={14} className="shrink-0" aria-hidden />
              <input data-busca value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Pesquisar…" aria-label={`Pesquisar: ${ariaLabel}`} autoComplete="off"
                className="min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted" />
            </label>
          )}
          <div className="relative">
          <span aria-hidden className="pointer-events-none absolute left-0 right-0 top-0 rounded-lg border transition-[transform,background-color,border-color] duration-100 motion-reduce:transition-none"
            style={{ height: ALTURA_ITEM, transform: `translateY(${destaque * ALTURA_ITEM}px)`, borderColor: misturar(lista[destaque]?.cor ?? TOM.aco, 65), backgroundColor: misturar(lista[destaque]?.cor ?? TOM.aco, 16) }} />
          {buscar && lista.length === 0 && <p className="px-3 py-3 text-sm text-text-muted">Nada encontrado</p>}
          {lista.map((o, i) => {
            const ativo = o.valor === valor;
            return (
              <button key={o.valor} type="button" role="menuitemradio" aria-checked={ativo} style={{ height: ALTURA_ITEM }}
                onClick={() => { onChange(o.valor); fechar(); }}
                onPointerEnter={() => setDestaque(i)} onFocus={() => setDestaque(i)} onPointerLeave={() => setDestaque(Math.max(0, lista.findIndex((x) => x.valor === valor)))}
                className={`ecos-menu-item relative flex w-full items-center gap-2 rounded-lg border border-transparent px-2.5 text-left text-sm focus-visible:outline-none ${ativo || destaque === i ? "text-text-primary" : "text-text-secondary"}`}>
                {o.visual ? <span className="shrink-0">{o.visual}</span> : o.icone ? <o.icone size={15} className="ecos-menu-icone shrink-0" style={{ color: o.cor ?? "currentColor" }} />
                  : o.cor && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: o.cor }} />}
                <span className="min-w-0 flex-1 truncate">{o.rotulo}</span>
                {ativo && <Check size={14} className="shrink-0" style={{ color: o.cor ?? TOM.aco }} />}
              </button>
            );
          })}
          </div>
          </>}
        </div>
      )}
    </div>
  );
}
