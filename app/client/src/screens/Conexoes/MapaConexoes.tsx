import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { useVisorZoom } from "@/lib/use-visor-zoom";
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, ExternalLink, FileText, Globe, Hash, Locate, Minus, Plus, Scan } from "lucide-react";

export type LadoMapa = "entrada" | "saida" | "externo";

export interface NoMapa {
  chave: string;
  lado: LadoMapa;
  /** Nota, tarefa ou link externo. */
  tipo: "nota" | "tarefa" | "externo";
  titulo: string;
  /** Segunda linha do cartão (domínio, para links externos). */
  detalhe?: string;
  /** Só links externos: para onde o cartão leva. */
  href?: string;
}

interface Props {
  centro: { tipo: "nota" | "tarefa"; titulo: string };
  /** Tags do item: ficam num recipiente acima dele, ligado por uma linha só. */
  tags?: string[];
  nos: NoMapa[];
  aoAbrir: (no: NoMapa, e: MouseEvent) => void;
  /** "Ver onde está": abre o documento onde a conexão aparece e rola até o trecho. */
  aoVerOnde: (no: NoMapa, e: MouseEvent) => void;
  aoAbrirCentro: (e: MouseEvent) => void;
}

const ICONE = { nota: FileText, tarefa: CheckCircle2, externo: Globe } as const;
const COR = {
  nota: "bg-steel-300/15 text-steel-300",
  tarefa: "bg-success/15 text-success",
  externo: "bg-surface-3 text-text-secondary",
} as const;
const ROTULO = { nota: "Nota", tarefa: "Tarefa", externo: "Link" } as const;

const botaoFoco = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400";

/** A linha começa em `atrasoLinha(ordem)` e leva 560 ms; o cartão aparece quando ela chega nele. */
const atrasoLinha = (ordem: number) => ordem * 65;

const CENTRO = "__centro";
const TAGS = "__tags";
/** Quantas tags aparecem no recipiente; o resto vira "+N". */
const MAX_TAGS = 10;
/** Acima disto, o lado vira um bloco em grade em vez de uma coluna comprida. */
const LIMITE_GRUPO = 8;
const ESCALA_MIN = 0.3;
const ESCALA_MAX = 2.5;
/** Escala ao centralizar um item clicado. */
const ESCALA_FOCO = 1.25;
/** Altura (fração do visor) em que o item clicado para: o meio. */
const LINHA_FOCO = 0.5;
/** Dois cliques no mesmo ponto dentro deste prazo (ms) abrem o item, mesmo com o mapa ainda deslizando. */
const PRAZO_DUPLO = 450;


/** Posição e tamanho no layout do mapa, sem influência do zoom (offset*, não getBoundingClientRect). */
function caixa(el: HTMLElement, raiz: HTMLElement) {
  let x = 0, y = 0;
  let n: HTMLElement | null = el;
  while (n && n !== raiz) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent as HTMLElement | null; }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

const botaoAbrir = `flex w-9 shrink-0 items-center justify-center rounded-r-xl border-l border-border text-text-muted transition-colors hover:bg-surface-3 hover:text-steel-300 ${botaoFoco}`;

function Cartao({ no, ordem, pronto, ativo, aoAtivar, registrar, aoSelecionar, aoAbrir, aoVerOnde }: {
  no: NoMapa; ordem: number; pronto: boolean; ativo: boolean; aoAtivar: (c: string | null) => void;
  registrar: (chave: string, el: HTMLElement | null) => void;
  aoSelecionar: (no: NoMapa, e: MouseEvent) => void; aoAbrir: (no: NoMapa, e: MouseEvent) => void; aoVerOnde: Props["aoVerOnde"];
}) {
  const Icone = ICONE[no.tipo];
  const corpo = (
    <>
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${COR[no.tipo]}`}><Icone size={15} aria-hidden /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-text-primary">{no.titulo}</span>
        <span className="block truncate text-[10px] font-semibold uppercase tracking-wider text-text-muted">{no.detalhe ?? ROTULO[no.tipo]}</span>
      </span>
    </>
  );
  const principal = "flex min-w-0 flex-1 items-center gap-2.5 rounded-l-xl px-2.5 py-2 text-left " + botaoFoco;
  return (
    <div ref={(el) => registrar(no.chave, el)} data-lado={no.lado}
      onMouseEnter={() => aoAtivar(no.chave)} onMouseLeave={() => aoAtivar(null)} onFocus={() => aoAtivar(no.chave)} onBlur={() => aoAtivar(null)}
      style={pronto ? { animationDelay: `${atrasoLinha(ordem) + 440}ms` } : { opacity: 0 }}
      className={`ecos-no-nasce relative z-10 flex min-w-0 items-stretch rounded-xl border bg-surface-2 transition-colors ${ativo ? "border-steel-300/70 bg-surface-3" : "border-border"}`}>
      {no.href
        ? <a href={no.href} target="_blank" rel="noopener noreferrer" title={no.href} className={principal}
            onClick={(e) => { if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); aoSelecionar(no, e); } }}>{corpo}</a>
        : <button type="button" onClick={(e) => aoSelecionar(no, e)} title={`Abrir ${no.tipo}: ${no.titulo}`} className={principal}>{corpo}</button>}
      <button type="button" onClick={(e) => aoVerOnde(no, e)} title="Ver onde está no texto" aria-label={`Ver onde ${no.titulo} aparece no texto`}
        className={`flex w-9 shrink-0 items-center justify-center border-l border-border text-text-muted transition-colors hover:bg-surface-3 hover:text-steel-300 ${botaoFoco}`}>
        <Locate size={15} aria-hidden />
      </button>
      {no.href
        ? <a href={no.href} target="_blank" rel="noopener noreferrer" title="Abrir o link" aria-label={`Abrir o link ${no.titulo}`} className={botaoAbrir}><ExternalLink size={15} aria-hidden /></a>
        : <button type="button" onClick={(e) => aoAbrir(no, e)} title="Abrir" aria-label={`Abrir ${no.titulo}`} className={botaoAbrir}><ArrowUpRight size={15} aria-hidden /></button>}
    </div>
  );
}

function Vazio({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-xs text-text-muted">{children}</p>;
}

function useTelaGrande() {
  const consulta = "(min-width: 768px)";
  const [grande, setGrande] = useState(() => typeof window.matchMedia === "function" && window.matchMedia(consulta).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const m = window.matchMedia(consulta);
    const mudou = () => setGrande(m.matches);
    m.addEventListener("change", mudou);
    return () => m.removeEventListener("change", mudou);
  }, []);
  return grande;
}

/**
 * Mapa das conexões de um item: ele no meio, quem o menciona à esquerda, o que ele menciona à direita e os links
 * externos embaixo. Em telas grandes é um visor com zoom suave (roda do mouse, botões) e arrasto; clicar num item
 * centraliza e aproxima até ele, e o clique duplo (ou o botão de abrir do cartão) abre. As linhas são medidas pelo layout
 * (independente do zoom). No celular as colunas empilham e as linhas somem.
 */
export function MapaConexoes({ centro, tags = [], nos, aoAbrir, aoVerOnde, aoAbrirCentro }: Props) {
  const comZoom = useTelaGrande();
  const [ativa, setAtiva] = useState<string | null>(null);
  const [foco, setFoco] = useState<string | null>(null);
  // Zoom, arrasto, pinça (toque), caneta e roda vêm do hook; o mapa só diz o que não deve iniciar arrasto.
  const { visor, mundo: raiz, mexeu, percentual, ajustar, centralizar, zoomNoCentro, aoPressionar, aoMover, aoSoltar } = useVisorZoom({
    ativo: comZoom, escalaMin: ESCALA_MIN, escalaMax: ESCALA_MAX,
    ignorar: "[data-lado],[data-centro],[data-tags],button,a",
    aoMexer: () => { setFoco(null); setAtiva(null); },
    aoToqueFundo: () => setFoco(null),
  });
  const centroEl = useRef<HTMLButtonElement>(null);
  const tagsEl = useRef<HTMLDivElement>(null);
  const cartoes = useRef(new Map<string, HTMLElement>());
  const [linhas, setLinhas] = useState<{ chave: string; lado: LadoMapa | "tags"; d: string; fim: [number, number] }[]>([]);
  const ultimoClique = useRef<{ chave: string; t: number; x: number; y: number } | null>(null);

  const registrar = useCallback((chave: string, el: HTMLElement | null) => { if (el) cartoes.current.set(chave, el); else cartoes.current.delete(chave); }, []);

  const medir = useCallback(() => {
    const r = raiz.current, c = centroEl.current;
    if (!r || !c) return;
    const C = caixa(c, r);
    const cx = C.x + C.w / 2;
    const saida: typeof linhas = [];
    for (const [chave, el] of cartoes.current) {
      const b = caixa(el, r);
      const lado = el.dataset.lado as LadoMapa;
      let x1: number, y1: number, x2: number, y2: number, d: string;
      if (lado === "externo") {
        x1 = cx; y1 = C.y + C.h; x2 = b.x + b.w / 2; y2 = b.y;
        const dy = (y2 - y1) / 2;
        d = `M${x1},${y1} C${x1},${y1 + dy} ${x2},${y2 - dy} ${x2},${y2}`;
      } else {
        const entra = lado === "entrada";
        // Toda linha nasce no centro e cresce até o cartão: é ela que "forma" a conexão.
        x1 = entra ? C.x : C.x + C.w; y1 = C.y + C.h / 2;
        x2 = entra ? b.x + b.w : b.x; y2 = b.y + b.h / 2;
        const dx = (x2 - x1) / 2;
        d = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
      }
      saida.push({ chave, lado, d, fim: [x2, y2] });
    }
    // Tags: uma linha só, do recipiente (em cima) até o item.
    const t = tagsEl.current;
    if (t) {
      const B = caixa(t, r), x = B.x + B.w / 2, y1 = B.y + B.h, y2 = C.y;
      saida.push({ chave: TAGS, lado: "tags", d: `M${x},${y1} L${cx},${y2}`, fim: [cx, y2] });
    }
    setLinhas(saida);
  }, []);

  useLayoutEffect(() => {
    medir();
    const r = raiz.current;
    if (!r || typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver(medir);
    obs.observe(r);
    return () => obs.disconnect();
  }, [medir, nos, tags, comZoom]);

  // A entrada do painel só desloca (sem escala), então a medida já vale desde o primeiro quadro: as linhas
  // começam logo, no primeiro frame depois da montagem, em vez de esperar o painel assentar.
  const [pronto, setPronto] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => { medir(); setPronto(true); });
    return () => cancelAnimationFrame(id);
  }, [medir]);

  useLayoutEffect(() => {
    if (!comZoom) return;
    if (!mexeu.current) ajustar(0, 0.55);
    const vp = visor.current;
    if (!vp || typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver(() => { if (!mexeu.current) ajustar(0, 0.55); });
    obs.observe(vp);
    return () => obs.disconnect();
  }, [comZoom, nos, ajustar]);

  /** Centraliza o item, no meio do visor, aproximando com zoom suave. */
  function focar(chave: string) {
    setFoco(chave);
    const r = raiz.current;
    const el = chave === CENTRO ? centroEl.current : chave === TAGS ? tagsEl.current : cartoes.current.get(chave);
    if (!comZoom || !r || !el) return;
    centralizar(caixa(el, r), { escala: Math.max(1, ESCALA_FOCO), linha: LINHA_FOCO, ms: 560 });
  }

  const limparFoco = () => setFoco(null);

  function abrirDireto(no: NoMapa, e: MouseEvent) {
    if (no.href) window.open(no.href, "_blank", "noopener,noreferrer");
    else aoAbrir(no, e);
  }
  const selecionar = (no: NoMapa, e: MouseEvent) => {
    if (e.ctrlKey || e.metaKey) { abrirDireto(no, e); return; }
    ultimoClique.current = { chave: no.chave, t: e.timeStamp, x: e.clientX, y: e.clientY };
    focar(no.chave);
  };
  const selecionarCentro = (e: MouseEvent) => {
    if (e.ctrlKey || e.metaKey) { aoAbrirCentro(e); return; }
    ultimoClique.current = { chave: CENTRO, t: e.timeStamp, x: e.clientX, y: e.clientY };
    focar(CENTRO);
  };
  /**
   * Clique duplo "no ponto": o segundo clique vale mesmo que o mapa já tenha deslizado (o item não está mais sob o
   * mouse), então a detecção é por tempo e posição, no visor, e não pelo `dblclick` do elemento.
   */
  function aoClicarCapturando(e: MouseEvent) {
    const u = ultimoClique.current;
    if (!u || (e.target as HTMLElement).closest("[data-controles]")) return;
    if (e.timeStamp - u.t > PRAZO_DUPLO || Math.hypot(e.clientX - u.x, e.clientY - u.y) > 16) return;
    e.stopPropagation(); e.preventDefault();
    ultimoClique.current = null;
    if (u.chave === CENTRO) { aoAbrirCentro(e); return; }
    const no = nos.find((n) => n.chave === u.chave);
    if (no) abrirDireto(no, e);
  }

  const ordemDe = useMemo(() => new Map(nos.map((n, i) => [n.chave, Math.min(i, 12)])), [nos]);
  const por = (lado: LadoMapa) => nos.filter((n) => n.lado === lado);
  const entrada = por("entrada"), saida = por("saida"), externos = por("externo");
  // Muitos itens num lado: em vez de uma coluna enorme, um bloco em grade (até 3 colunas) com uma linha só até ele.
  const agrupa = { entrada: comZoom && entrada.length > LIMITE_GRUPO, saida: comZoom && saida.length > LIMITE_GRUPO };
  const colunasDe = (n: number) => Math.min(3, Math.ceil(n / 10));
  const larguraDe = (agrupado: boolean, n: number) => (agrupado ? `${colunasDe(n) * 16 + (colunasDe(n) - 1) * 0.625}rem` : "18rem");
  const colunasGrade = `${larguraDe(agrupa.entrada, entrada.length)} 15rem ${larguraDe(agrupa.saida, saida.length)}`;
  const lista = (lado: "entrada" | "saida", itens: NoMapa[], vazio: string, Icone: typeof ArrowUpRight, texto: string, ordem: string, rotulo: string) => {
    const agrupado = agrupa[lado];
    return (
      <div role="group" aria-label={rotulo}
        className={`flex min-w-0 flex-col gap-2.5 ${ordem}`}>
        {titulo(Icone, texto, itens.length)}
        {itens.length ? (agrupado
          ? <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${colunasDe(itens.length)}, minmax(0, 1fr))` }}>{itens.map(cartao)}</div>
          : itens.map(cartao)) : <Vazio>{vazio}</Vazio>}
      </div>
    );
  };
  const CentroIcone = ICONE[centro.tipo];
  const alvo = foco && foco !== CENTRO ? foco : ativa;
  const cartao = (n: NoMapa) => <Cartao key={n.chave} no={n} ordem={ordemDe.get(n.chave) ?? 0} pronto={pronto} ativo={alvo === n.chave} aoAtivar={setAtiva} registrar={registrar} aoSelecionar={selecionar} aoAbrir={aoAbrir} aoVerOnde={aoVerOnde} />;
  const titulo = (Icone: typeof ArrowUpRight, texto: string, n: number) => (
    <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted"><Icone size={13} aria-hidden />{texto}<span className="font-normal normal-case tracking-normal">· {n}</span></h3>
  );

  const mapa = (
    <div ref={raiz} className={comZoom ? "absolute left-0 top-0 flex w-max min-w-[64rem] origin-top-left flex-col gap-12 px-10 pb-10 pt-24" : "relative flex flex-col gap-12"}>
      <svg className="pointer-events-none absolute inset-0 hidden h-full w-full md:block" style={{ willChange: "transform", contain: "strict" }} aria-hidden>
        {pronto && linhas.map((l) => {
          const forte = alvo === l.chave;
          const atraso = atrasoLinha(ordemDe.get(l.chave) ?? 0);
          return (
            <g key={l.chave} className={l.lado === "externo" ? "text-text-muted" : l.lado === "entrada" || l.lado === "tags" ? "text-steel-300" : "text-success"}>
              <path d={l.d} pathLength={1} strokeDasharray="1 1" className="ecos-linha-desenha" fill="none" stroke="currentColor" strokeWidth={forte ? 2.5 : 1.25} strokeLinecap="round" opacity={alvo ? (forte ? 0.95 : 0.15) : 0.45} style={{ transition: "opacity 160ms, stroke-width 160ms", animationDelay: `${atraso}ms` }} />
              <circle cx={l.fim[0]} cy={l.fim[1]} r={forte ? 4 : 3} className="ecos-linha-ponto" fill="currentColor" opacity={alvo ? (forte ? 0.95 : 0.15) : 0.6} style={{ transition: "opacity 160ms", animationDelay: `${atraso + 480}ms` }} />
            </g>
          );
        })}
      </svg>

      {tags.length > 0 && (
        <div ref={tagsEl} data-tags role="group" aria-label="Tags" onClick={() => focar(TAGS)} style={pronto ? { animationDelay: "0ms" } : { opacity: 0 }}
          className={`ecos-no-nasce relative z-10 mx-auto flex w-fit max-w-[34rem] flex-col gap-2 rounded-2xl border border-dashed bg-surface-1 px-4 py-3 transition-colors ${foco === TAGS ? "border-steel-300/70" : "border-border"}`}>
          {titulo(Hash, "Tags", tags.length)}
          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-2">
            {tags.slice(0, MAX_TAGS).map((t, i) => (
              <span key={t} style={{ animationDelay: `${-i * 0.7}s` }} className="ecos-tag-flutua rounded-full border border-border bg-surface-3 px-2.5 py-1 text-xs text-text-primary">#{t}</span>
            ))}
            {tags.length > MAX_TAGS && <span className="px-1 text-xs text-text-muted">+{tags.length - MAX_TAGS}</span>}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 items-center gap-6 md:justify-center md:gap-x-14 md:[grid-template-columns:var(--colunas)]" style={{ "--colunas": colunasGrade } as CSSProperties}>
        {lista("entrada", entrada, "Nada aponta para cá ainda.", ArrowDownLeft, "Mencionada em", "md:order-1", "Mencionada em")}

        <button ref={centroEl} data-centro type="button" onClick={selecionarCentro} title={`Abrir ${centro.tipo}: ${centro.titulo}`}
          className={`relative z-10 flex flex-col items-center gap-2 rounded-2xl border bg-surface-2 px-5 py-6 text-center shadow-lg transition-colors hover:bg-surface-3 md:order-2 ${foco === CENTRO ? "border-steel-300" : "border-steel-300/50"} ${botaoFoco}`}>
          <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${COR[centro.tipo]}`}><CentroIcone size={22} aria-hidden /></span>
          <span className="line-clamp-3 text-base font-semibold text-text-primary">{centro.titulo}</span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">{ROTULO[centro.tipo]}</span>
        </button>

        {lista("saida", saida, "Não menciona nada ainda.", ArrowUpRight, "Menciona", "md:order-3", "Menciona")}
      </div>

      {externos.length > 0 && (
        <div className="flex min-w-0 flex-col gap-3" role="group" aria-label="Links externos">
          <div className="w-fit bg-base pr-2">{titulo(Globe, "Links externos", externos.length)}</div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-2.5">{externos.map(cartao)}</div>
        </div>
      )}
    </div>
  );

  const botaoZoom = "flex h-7 w-7 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-3 hover:text-text-primary " + botaoFoco;

  return (
    <div ref={visor} onClickCapture={aoClicarCapturando} onPointerDown={aoPressionar} onPointerMove={aoMover} onPointerUp={aoSoltar} onPointerCancel={aoSoltar}
      className={comZoom ? "relative h-full cursor-grab touch-none select-none overflow-hidden bg-base active:cursor-grabbing" : "relative h-full overflow-y-auto px-4 pb-6 pt-24"}>
      {mapa}

      {comZoom && (
        <div data-controles className="absolute bottom-3 right-3 z-20 flex items-center gap-0.5 rounded-xl border border-border bg-surface-2/90 p-1 shadow-lg">
          <button type="button" className={botaoZoom} aria-label="Afastar" title="Afastar" onClick={() => zoomNoCentro(1 / 1.3)}><Minus size={14} aria-hidden /></button>
          <span className="w-10 text-center text-[11px] tabular-nums text-text-muted" aria-live="off">{percentual}%</span>
          <button type="button" className={botaoZoom} aria-label="Aproximar" title="Aproximar" onClick={() => zoomNoCentro(1.3)}><Plus size={14} aria-hidden /></button>
          <button type="button" className={botaoZoom} aria-label="Ajustar à tela" title="Ajustar à tela" onClick={() => { mexeu.current = false; limparFoco(); ajustar(560, 0.55); }}><Scan size={14} aria-hidden /></button>
        </div>
      )}
    </div>
  );
}
