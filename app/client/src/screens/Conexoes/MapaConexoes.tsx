import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, ExternalLink, FileText, Globe, Locate, Minus, Plus, Scan } from "lucide-react";

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
const ESCALA_MIN = 0.3;
const ESCALA_MAX = 2.5;
/** Escala ao centralizar um item clicado. */
const ESCALA_FOCO = 1.25;
/** Altura (fração do visor) em que o item clicado para: o meio. */
const LINHA_FOCO = 0.5;
/** Dois cliques no mesmo ponto dentro deste prazo (ms) abrem o item, mesmo com o mapa ainda deslizando. */
const PRAZO_DUPLO = 450;

interface Vista { x: number; y: number; s: number }

const limitar = (s: number) => Math.min(ESCALA_MAX, Math.max(ESCALA_MIN, s));
const semMovimento = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
export function MapaConexoes({ centro, nos, aoAbrir, aoVerOnde, aoAbrirCentro }: Props) {
  const comZoom = useTelaGrande();
  const visor = useRef<HTMLDivElement>(null);
  const raiz = useRef<HTMLDivElement>(null);
  const centroEl = useRef<HTMLButtonElement>(null);
  const cartoes = useRef(new Map<string, HTMLElement>());
  const vista = useRef<Vista>({ x: 0, y: 0, s: 1 });
  const mexeu = useRef(false);
  const fimTransicao = useRef(0);
  const [linhas, setLinhas] = useState<{ chave: string; lado: LadoMapa; d: string; fim: [number, number] }[]>([]);
  const [ativa, setAtiva] = useState<string | null>(null);
  const [foco, setFoco] = useState<string | null>(null);
  const ultimoClique = useRef<{ chave: string; t: number; x: number; y: number } | null>(null);
  const [percentual, setPercentual] = useState(100);

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
    setLinhas(saida);
  }, []);

  useLayoutEffect(() => {
    medir();
    const r = raiz.current;
    if (!r || typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver(medir);
    obs.observe(r);
    return () => obs.disconnect();
  }, [medir, nos, comZoom]);

  // A entrada do painel só desloca (sem escala), então a medida já vale desde o primeiro quadro: as linhas
  // começam logo, no primeiro frame depois da montagem, em vez de esperar o painel assentar.
  const [pronto, setPronto] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => { medir(); setPronto(true); });
    return () => cancelAnimationFrame(id);
  }, [medir]);

  /** Escreve a vista direto no DOM (sem re-render); `ms` > 0 anima com a curva suave do Ecos. */
  const aplicar = useCallback((v: Vista, ms: number) => {
    const el = raiz.current;
    if (!el) return;
    const dur = semMovimento() ? 0 : ms;
    vista.current = v;
    el.style.transition = dur ? `transform ${dur}ms cubic-bezier(.22,1,.36,1)` : "none";
    // Camada própria só durante o movimento; depois o navegador redesenha o texto nítido na escala final.
    // Com dur = 0 (arrasto) não mexe: o arrasto mantém a camada enquanto dura.
    if (dur) el.style.willChange = "transform";
    el.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.s})`;
    window.clearTimeout(fimTransicao.current);
    if (dur) fimTransicao.current = window.setTimeout(() => { el.style.willChange = ""; }, dur + 80);
    setPercentual(Math.round(v.s * 100));
  }, []);

  /** Enquadra tudo no visor (zoom para caber, centralizado). */
  const ajustar = useCallback((ms: number) => {
    const vp = visor.current, w = raiz.current;
    if (!vp || !w) return;
    const vw = vp.clientWidth, vh = vp.clientHeight, ww = w.offsetWidth, wh = w.offsetHeight;
    if (!vw || !vh || !ww || !wh) return;
    // Piso de 55% no enquadramento: com dezenas de itens é melhor caber no tamanho legível e arrastar do que virar um risco.
    const s = limitar(Math.max(0.55, Math.min(1, vw / ww, vh / wh)));
    aplicar({ s, x: (vw - ww * s) / 2, y: Math.max(0, (vh - wh * s) / 2) }, ms);
  }, [aplicar]);

  useLayoutEffect(() => {
    if (!comZoom) return;
    if (!mexeu.current) ajustar(0);
    const vp = visor.current;
    if (!vp || typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver(() => { if (!mexeu.current) ajustar(0); });
    obs.observe(vp);
    return () => obs.disconnect();
  }, [comZoom, nos, ajustar]);

  /** Aproxima/afasta mantendo o ponto (px, py) do visor parado. */
  const zoomEm = useCallback((px: number, py: number, fator: number, ms: number) => {
    const { x, y, s } = vista.current;
    const s2 = limitar(s * fator);
    if (s2 === s) return;
    mexeu.current = true;
    setFoco(null);
    aplicar({ s: s2, x: px - (px - x) * (s2 / s), y: py - (py - y) * (s2 / s) }, ms);
  }, [aplicar]);

  // A roda precisa de listener não passivo para impedir a rolagem da janela por baixo.
  useEffect(() => {
    const vp = visor.current;
    if (!comZoom || !vp) return;
    const roda = (e: WheelEvent) => {
      e.preventDefault();
      const r = vp.getBoundingClientRect();
      zoomEm(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0016), 120);
    };
    vp.addEventListener("wheel", roda, { passive: false });
    return () => vp.removeEventListener("wheel", roda);
  }, [comZoom, zoomEm]);

  /** Centraliza o item, no meio do visor, aproximando com zoom suave. */
  function focar(chave: string) {
    setFoco(chave);
    const vp = visor.current, r = raiz.current;
    const el = chave === CENTRO ? centroEl.current : cartoes.current.get(chave);
    if (!comZoom || !vp || !r || !el) return;
    const b = caixa(el, r);
    const vw = vp.clientWidth, vh = vp.clientHeight;
    const s = limitar(Math.max(vista.current.s, ESCALA_FOCO));
    mexeu.current = true;
    aplicar({ s, x: vw / 2 - (b.x + b.w / 2) * s, y: vh * LINHA_FOCO - (b.y + b.h / 2) * s }, 560);
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

  // Arrastar o fundo move o mapa; um toque no fundo (sem arrastar) tira o destaque.
  const arrasto = useRef<{ px: number; py: number; x: number; y: number; moveu: boolean } | null>(null);
  function aoPressionar(e: ReactPointerEvent<HTMLDivElement>) {
    if (!comZoom || e.button !== 0 || (e.target as HTMLElement).closest("[data-lado],[data-centro],[data-controles],button,a")) return;
    arrasto.current = { px: e.clientX, py: e.clientY, x: vista.current.x, y: vista.current.y, moveu: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function aoMover(e: ReactPointerEvent<HTMLDivElement>) {
    const a = arrasto.current;
    if (!a) return;
    const dx = e.clientX - a.px, dy = e.clientY - a.py;
    if (!a.moveu && Math.hypot(dx, dy) < 4) return;
    if (!a.moveu) {
      a.moveu = true; mexeu.current = true; limparFoco(); setAtiva(null);
      // Arrastando, o mapa é só uma camada que se desloca: sem hover reagindo por baixo e sem redesenhar o texto a cada passo.
      const r = raiz.current;
      if (r) { window.clearTimeout(fimTransicao.current); r.style.pointerEvents = "none"; r.style.willChange = "transform"; }
    }
    aplicar({ ...vista.current, x: a.x + dx, y: a.y + dy }, 0);
  }
  function aoSoltar() {
    const a = arrasto.current;
    arrasto.current = null;
    if (a?.moveu) { const r = raiz.current; if (r) { r.style.pointerEvents = ""; r.style.willChange = ""; } }
    else if (a) limparFoco();
  }

  const ordemDe = useMemo(() => new Map(nos.map((n, i) => [n.chave, Math.min(i, 12)])), [nos]);
  const por = (lado: LadoMapa) => nos.filter((n) => n.lado === lado);
  const entrada = por("entrada"), saida = por("saida"), externos = por("externo");
  const CentroIcone = ICONE[centro.tipo];
  const alvo = foco && foco !== CENTRO ? foco : ativa;
  const cartao = (n: NoMapa) => <Cartao key={n.chave} no={n} ordem={ordemDe.get(n.chave) ?? 0} pronto={pronto} ativo={alvo === n.chave} aoAtivar={setAtiva} registrar={registrar} aoSelecionar={selecionar} aoAbrir={aoAbrir} aoVerOnde={aoVerOnde} />;
  const titulo = (Icone: typeof ArrowUpRight, texto: string, n: number) => (
    <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted"><Icone size={13} aria-hidden />{texto}<span className="font-normal normal-case tracking-normal">· {n}</span></h3>
  );

  const mapa = (
    <div ref={raiz} className={comZoom ? "absolute left-0 top-0 flex w-[64rem] origin-top-left flex-col gap-12 px-10 pb-10 pt-24" : "relative flex flex-col gap-12"}>
      <svg className="pointer-events-none absolute inset-0 hidden h-full w-full md:block" style={{ willChange: "transform", contain: "strict" }} aria-hidden>
        {pronto && linhas.map((l) => {
          const forte = alvo === l.chave;
          const atraso = atrasoLinha(ordemDe.get(l.chave) ?? 0);
          return (
            <g key={l.chave} className={l.lado === "externo" ? "text-text-muted" : l.lado === "entrada" ? "text-steel-300" : "text-success"}>
              <path d={l.d} pathLength={1} strokeDasharray="1 1" className="ecos-linha-desenha" fill="none" stroke="currentColor" strokeWidth={forte ? 2.5 : 1.25} strokeLinecap="round" opacity={alvo ? (forte ? 0.95 : 0.15) : 0.45} style={{ transition: "opacity 160ms, stroke-width 160ms", animationDelay: `${atraso}ms` }} />
              <circle cx={l.fim[0]} cy={l.fim[1]} r={forte ? 4 : 3} className="ecos-linha-ponto" fill="currentColor" opacity={alvo ? (forte ? 0.95 : 0.15) : 0.6} style={{ transition: "opacity 160ms", animationDelay: `${atraso + 480}ms` }} />
            </g>
          );
        })}
      </svg>

      <div className="grid grid-cols-1 items-center gap-6 md:grid-cols-[18rem_15rem_18rem] md:justify-center md:gap-x-14">
        <div className="flex min-w-0 flex-col gap-2.5 md:order-1" role="group" aria-label="Mencionada em">
          {titulo(ArrowDownLeft, "Mencionada em", entrada.length)}
          {entrada.length ? entrada.map(cartao) : <Vazio>Nada aponta para cá ainda.</Vazio>}
        </div>

        <button ref={centroEl} data-centro type="button" onClick={selecionarCentro} title={`Abrir ${centro.tipo}: ${centro.titulo}`}
          className={`relative z-10 flex flex-col items-center gap-2 rounded-2xl border bg-surface-2 px-5 py-6 text-center shadow-lg transition-colors hover:bg-surface-3 md:order-2 ${foco === CENTRO ? "border-steel-300" : "border-steel-300/50"} ${botaoFoco}`}>
          <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${COR[centro.tipo]}`}><CentroIcone size={22} aria-hidden /></span>
          <span className="line-clamp-3 text-base font-semibold text-text-primary">{centro.titulo}</span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">{ROTULO[centro.tipo]}</span>
        </button>

        <div className="flex min-w-0 flex-col gap-2.5 md:order-3" role="group" aria-label="Menciona">
          {titulo(ArrowUpRight, "Menciona", saida.length)}
          {saida.length ? saida.map(cartao) : <Vazio>Não menciona nada ainda.</Vazio>}
        </div>
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
          <button type="button" className={botaoZoom} aria-label="Afastar" title="Afastar" onClick={() => { const v = visor.current!; zoomEm(v.clientWidth / 2, v.clientHeight / 2, 1 / 1.3, 380); }}><Minus size={14} aria-hidden /></button>
          <span className="w-10 text-center text-[11px] tabular-nums text-text-muted" aria-live="off">{percentual}%</span>
          <button type="button" className={botaoZoom} aria-label="Aproximar" title="Aproximar" onClick={() => { const v = visor.current!; zoomEm(v.clientWidth / 2, v.clientHeight / 2, 1.3, 380); }}><Plus size={14} aria-hidden /></button>
          <button type="button" className={botaoZoom} aria-label="Ajustar à tela" title="Ajustar à tela" onClick={() => { mexeu.current = false; limparFoco(); ajustar(560); }}><Scan size={14} aria-hidden /></button>
        </div>
      )}
    </div>
  );
}
