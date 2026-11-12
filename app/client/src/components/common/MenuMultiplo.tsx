import { ArvorePastas } from "./ArvorePastas";
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Check, Search, type LucideIcon } from "lucide-react";
import { ALTURA_ITEM, TOM, misturar } from "./MenuSuspenso";
import "./menu-suspenso.css";

export interface OpcaoMultipla {
  valor: string;
  pasta?: boolean;
  rotulo: string;
  icone?: LucideIcon;
  cor?: string;
}

interface Props {
  /** Valores marcados. Vazio = nenhum filtro (a opção "todas" fica marcada). */
  valores: string[];
  opcoes: readonly OpcaoMultipla[];
  onChange: (valores: string[]) => void;
  ariaLabel: string;
  /** Rótulo e ícone da opção que limpa a seleção ("Todas as pastas"). */
  todas: { rotulo: string; icone?: LucideIcon };
  gatilho: (estado: { aberto: boolean }) => ReactNode;
  classeGatilho?: string;
  corAtiva?: string | null;
  larguraMenu?: string;
  pesquisavel?: boolean;
  placeholderBusca?: string;
  arvore?: boolean;
  /** Posição fixa na tela: o menu escapa de contêineres com rolagem (ex.: faixa de filtros do celular). */
  fixo?: boolean;
}

const VALOR_TODAS = "\u0000todas";

/** Menu suspenso de escolha múltipla (mesmo visual do `MenuSuspenso`): clicar marca/desmarca e o menu continua aberto. */
export function MenuMultiplo({ valores, opcoes, onChange, ariaLabel, todas, gatilho, classeGatilho = "", corAtiva, larguraMenu = "min-w-[14rem]", pesquisavel = false, placeholderBusca = "Pesquisar…", arvore = false, fixo = false }: Props) {
  const id = useId();
  const raiz = useRef<HTMLDivElement>(null);
  const [aberto, setAberto] = useState(false);
  const [montado, setMontado] = useState(false);
  const [destaque, setDestaque] = useState(0);
  const [consulta, setConsulta] = useState("");
  const [posicao, setPosicao] = useState<CSSProperties>({});

  const todasOpcoes: OpcaoMultipla[] = [{ valor: VALOR_TODAS, rotulo: todas.rotulo, icone: todas.icone }, ...opcoes];
  const termo = consulta.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  const opcoesFiltradas = termo
    ? [todasOpcoes[0], ...opcoes.filter((o) => o.rotulo.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").includes(termo))]
    : todasOpcoes;
  const marcado = (v: string) => (v === VALOR_TODAS ? valores.length === 0 : valores.includes(v));

  const fechar = useCallback(() => {
    setAberto(false);
    setConsulta("");
    window.setTimeout(() => setMontado(false), 110);
  }, []);

  function abrir() {
    if (fixo) {
      const r = raiz.current!.getBoundingClientRect();
      const largura = Math.min(arvore ? 288 : 224, window.innerWidth - 16);
      const abaixo = window.innerHeight - r.bottom - 14;
      const subir = abaixo < 200 && r.top > abaixo;
      setPosicao({ position: "fixed", marginTop: 0, width: largura, minWidth: 0, left: Math.max(8, Math.min(r.left, window.innerWidth - largura - 8)), right: "auto",
        top: subir ? "auto" : r.bottom + 6, bottom: subir ? window.innerHeight - r.top + 6 : "auto", maxHeight: Math.max(160, Math.min(288, subir ? r.top - 14 : abaixo)) });
    }
    setMontado(true); setAberto(true);
  }

  useEffect(() => {
    if (!aberto || !fixo) return;
    const aoRolar = (e: Event) => { if (!(e.target instanceof Node) || !raiz.current?.contains(e.target)) fechar(); };
    window.addEventListener("resize", fechar);
    document.addEventListener("scroll", aoRolar, true);
    return () => { window.removeEventListener("resize", fechar); document.removeEventListener("scroll", aoRolar, true); };
  }, [aberto, fixo, fechar]);

  function alternar(valor: string) {
    if (valor === VALOR_TODAS) return onChange([]);
    onChange(valores.includes(valor) ? valores.filter((v) => v !== valor) : [...valores, valor]);
  }

  useEffect(() => {
    if (!aberto) return;
    const aoClicarFora = (e: PointerEvent) => { if (!raiz.current?.contains(e.target as Node)) fechar(); };
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); fechar(); raiz.current?.querySelector<HTMLElement>("[data-gatilho]")?.focus(); }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const itens = [...(raiz.current?.querySelectorAll<HTMLElement>("[role^=menuitem]") ?? [])];
        if (!itens.length) return;
        const i = itens.indexOf(document.activeElement as HTMLElement);
        const proximo = i < 0 ? (e.key === "ArrowDown" ? 0 : itens.length - 1) : (i + (e.key === "ArrowDown" ? 1 : -1) + itens.length) % itens.length;
        itens[proximo]?.focus();
      }
    };
    document.addEventListener("pointerdown", aoClicarFora);
    document.addEventListener("keydown", aoTeclar, true);
    return () => { document.removeEventListener("pointerdown", aoClicarFora); document.removeEventListener("keydown", aoTeclar, true); };
  }, [aberto, fechar]);

  useEffect(() => {
    if (!aberto) return;
    setDestaque(0);
    const t = window.setTimeout(() => raiz.current?.querySelector<HTMLElement>(pesquisavel ? "[data-busca]" : "[role^=menuitem]")?.focus({ preventScroll: true }), 30);
    return () => window.clearTimeout(t);
  }, [aberto, pesquisavel]);

  useEffect(() => { setDestaque(0); }, [consulta]);

  const corDestaque = opcoesFiltradas[destaque]?.cor ?? TOM.aco;
  return (
    <div ref={raiz} className="relative">
      <button type="button" data-gatilho aria-haspopup="menu" aria-expanded={aberto} aria-controls={id} aria-label={ariaLabel}
        onClick={() => (aberto ? fechar() : abrir())} className={classeGatilho}
        style={corAtiva ? ({ borderColor: misturar(corAtiva, 70), backgroundColor: misturar(corAtiva, 18) } as CSSProperties) : undefined}>
        {gatilho({ aberto })}
      </button>
      {montado && (
        <div id={id} role="menu" aria-label={ariaLabel} aria-multiselectable data-saindo={!aberto} style={fixo ? posicao : undefined}
          className={`ecos-menu ${fixo ? "z-50" : "absolute left-0 z-40"} mt-1.5 max-h-72 overflow-y-auto overflow-x-hidden rounded-xl border border-border bg-surface-1 p-1 shadow-nav ${arvore ? "w-72 max-w-[calc(100vw-2rem)]" : larguraMenu}`}>
          {pesquisavel && (
            <label className="sticky top-0 z-20 mb-1 flex h-10 items-center gap-2 rounded-lg border border-border bg-surface-1 px-2.5 focus-within:border-steel-400/70">
              <Search size={14} className="shrink-0 text-text-muted" aria-hidden />
              <input data-busca type="search" value={consulta} onChange={(e) => setConsulta(e.target.value)} placeholder={placeholderBusca}
                style={{ outline: "none", boxShadow: "none" }} className="min-w-0 flex-1 appearance-none bg-transparent text-sm text-text-primary outline-none ring-0 placeholder:text-text-muted [&::-webkit-search-cancel-button]:appearance-none" aria-label={placeholderBusca} />
              {consulta && <button type="button" onClick={() => setConsulta("")} className="text-xs text-text-muted hover:text-text-primary" aria-label="Limpar pesquisa">Limpar</button>}
            </label>
          )}
          {arvore ? <ArvorePastas opcoes={todasOpcoes} valores={valores.length ? valores : [VALOR_TODAS]} onSelect={alternar} multipla busca={consulta} /> : <>
          <span aria-hidden className={`pointer-events-none absolute left-1 right-1 rounded-lg border transition-[transform,background-color,border-color] duration-100 motion-reduce:transition-none ${pesquisavel ? "top-12" : "top-1"}`}
            style={{ height: ALTURA_ITEM, transform: `translateY(${destaque * ALTURA_ITEM}px)`, borderColor: misturar(corDestaque, 65), backgroundColor: misturar(corDestaque, 16) }} />
          {opcoesFiltradas.map((o, i) => {
            const ativo = marcado(o.valor);
            return (
              <button key={o.valor} type="button" role="menuitemcheckbox" aria-checked={ativo} style={{ height: ALTURA_ITEM }}
                onClick={() => alternar(o.valor)}
                onPointerEnter={() => setDestaque(i)} onFocus={() => setDestaque(i)}
                className={`ecos-menu-item relative flex w-full items-center gap-2 rounded-lg border border-transparent px-2.5 text-left text-sm focus-visible:outline-none ${ativo || destaque === i ? "text-text-primary" : "text-text-secondary"}`}>
                {o.icone && <o.icone size={15} className="shrink-0" style={{ color: o.cor ?? "currentColor" }} />}
                <span className="min-w-0 flex-1 truncate">{o.rotulo}</span>
                <span aria-hidden className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors duration-150 ${ativo ? "" : "border-border"}`}
                  style={ativo ? { backgroundColor: o.cor ?? TOM.aco, borderColor: o.cor ?? TOM.aco } : undefined}>
                  {ativo && <Check size={12} strokeWidth={3} className="text-white" />}
                </span>
              </button>
            );
          })}
          </>}
        </div>
      )}
    </div>
  );
}
