/**
 * Paleta flutuante do Modo de escrita: livre (arrasta para qualquer lugar), encaixada no topo
 * (acompanha a rolagem, como a barra de antes), ou presa na lateral esquerda/direita (estilo Samsung Notes).
 * Recolhe numa bolinha. Ao arrastar perto de uma borda aparece a zona de encaixe; ao soltar, a paleta
 * assenta com uma mola. Teclado: no puxador, setas movem e Enter alterna o encaixe.
 * A posição vale em coordenadas da janela do Ecos (ancestral com `transform`) ou da tela, e é lembrada.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { GripHorizontal, GripVertical, Minimize2, PenTool, Keyboard } from "lucide-react";
import { Colapso } from "./Colapso";
import "./paleta-flutuante.css";

type Modo = "livre" | "topo" | "baixo" | "esq" | "dir";
interface Salvo { modo: Modo; x: number; y: number; recolhida: boolean }
interface Quadro { l: number; t: number; w: number; h: number; ancoraTopo: number; topoFixo: number }

const CHAVE = "ecos.paleta-escrita";
const MARGEM = 8;
const ZONA = 56;
const MOLA = "cubic-bezier(0.2, 0.9, 0.25, 1.12)";
const ORDEM: Modo[] = ["topo", "baixo", "esq", "dir", "livre"];
const limitar = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));

function lerSalvo(): Salvo {
  try {
    const bruto = JSON.parse(localStorage.getItem(CHAVE) ?? "null") as Partial<Salvo> | null;
    if (bruto && ORDEM.includes(bruto.modo as Modo)) return { modo: bruto.modo as Modo, x: Number(bruto.x) || MARGEM, y: Number(bruto.y) || 80, recolhida: !!bruto.recolhida };
  } catch { /* sem armazenamento: usa o padrão */ }
  return { modo: "topo", x: MARGEM, y: 80, recolhida: false };
}

function medirQuadro(ancora: HTMLElement): Quadro {
  let ref: HTMLElement | null = ancora.parentElement;
  while (ref && getComputedStyle(ref).transform === "none") ref = ref.parentElement;
  const altura = Math.min(window.innerHeight, document.documentElement.clientHeight || window.innerHeight, window.visualViewport?.height ?? Infinity);
  const r = ref?.getBoundingClientRect();
  const q = r ? { l: r.left, t: r.top, w: r.width, h: Math.min(r.height, altura - r.top) } : { l: 0, t: 0, w: window.innerWidth, h: altura };
  const pagina = ancora.closest<HTMLElement>(".ecos-detail-page");
  const topoFixo = pagina ? parseFloat(pagina.style.getPropertyValue("--ecos-editor-sticky-top")) || 0 : 0;
  return { ...q, ancoraTopo: ancora.getBoundingClientRect().top - q.t, topoFixo };
}

function posicaoDe(s: Salvo, tam: { w: number; h: number }, f: Quadro): { x: number; y: number } {
  const minY = f.topoFixo + 4;
  const maxX = f.w - tam.w - MARGEM;
  const maxY = f.h - tam.h - MARGEM;
  // Encaixada (e aberta) vira barra de verdade, colada nas bordas; recolhida é só a bolinha.
  const barra = !s.recolhida;
  switch (s.modo) {
    case "topo": return barra ? { x: 0, y: Math.max(f.ancoraTopo, f.topoFixo) } : { x: Math.max(MARGEM, maxX), y: limitar(Math.max(f.ancoraTopo, minY), minY, maxY) };
    case "baixo": return barra ? { x: 0, y: Math.max(f.topoFixo, f.h - tam.h) } : { x: Math.max(MARGEM, maxX), y: Math.max(minY, maxY) };
    case "esq": return barra ? { x: 0, y: f.topoFixo } : { x: MARGEM, y: limitar(s.y, minY, maxY) };
    case "dir": return barra ? { x: Math.max(0, f.w - tam.w), y: f.topoFixo } : { x: Math.max(MARGEM, maxX), y: limitar(s.y, minY, maxY) };
    default: return { x: limitar(s.x, MARGEM, maxX), y: limitar(s.y, minY, maxY) };
  }
}

interface Props {
  /** Volta ao modo texto (botão no fim da paleta). */
  aoSair?: () => void;
  children: (estado: { vertical: boolean; alinhar: "esq" | "dir"; embaixo: boolean }) => ReactNode;
}

export function PaletaFlutuante({ aoSair, children }: Props) {
  const ancora = useRef<HTMLDivElement>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const [salvo, setSalvo] = useState<Salvo>(lerSalvo);
  const [tam, setTam] = useState({ w: 0, h: 0 });
  const [q, setQ] = useState<Quadro>({ l: 0, t: 0, w: 0, h: 0, ancoraTopo: 0, topoFixo: 0 });
  const [arrasto, setArrasto] = useState<{ x: number; y: number; alvo: Modo | null } | null>(null);
  const [animando, setAnimando] = useState(false);
  const arrastoRef = useRef(arrasto);
  const inicio = useRef<{ px: number; py: number; x: number; y: number; moveu: boolean } | null>(null);

  const medir = useCallback(() => { if (ancora.current) setQ(medirQuadro(ancora.current)); }, []);
  useLayoutEffect(medir, [medir]);
  useEffect(() => {
    window.addEventListener("resize", medir);
    let quadro = 0;
    const aoRolar = () => { if (!quadro) quadro = requestAnimationFrame(() => { quadro = 0; medir(); }); };
    document.addEventListener("scroll", aoRolar, { capture: true, passive: true });
    const obs = new ResizeObserver(() => { if (caixa.current) setTam({ w: caixa.current.offsetWidth, h: caixa.current.offsetHeight }); medir(); });
    if (caixa.current) obs.observe(caixa.current);
    return () => { window.removeEventListener("resize", medir); document.removeEventListener("scroll", aoRolar, true); cancelAnimationFrame(quadro); obs.disconnect(); };
  }, [medir]);
  useEffect(() => { try { localStorage.setItem(CHAVE, JSON.stringify(salvo)); } catch { /* ignora */ } }, [salvo]);
  useEffect(() => {
    setAnimando(true);
    const t = window.setTimeout(() => setAnimando(false), 520);
    return () => window.clearTimeout(t);
  }, [salvo.modo, salvo.recolhida]);

  const pos = arrasto ?? posicaoDe(salvo, tam, q);
  // Horizontal só encaixada no topo; solta, fica vertical e as abas abrem para o lado com mais espaço (meio da tela).
  const vertical = salvo.modo !== "topo" && salvo.modo !== "baixo";
  const alinhar: "esq" | "dir" = salvo.modo === "esq" ? "esq" : salvo.modo === "dir" ? "dir" : pos.x + tam.w / 2 > q.w / 2 ? "dir" : "esq";
  const acoplada = salvo.modo !== "livre" && !salvo.recolhida && !arrasto;
  const reserva = salvo.modo === "topo" && !salvo.recolhida ? tam.h : 0;
  const embaixo = salvo.modo === "baixo";
  const lateral = salvo.modo === "esq" || salvo.modo === "dir";
  // Barra lateral acoplada: abre espaço no conteúdo da nota, em vez de ficar por cima.
  useLayoutEffect(() => {
    const pai = ancora.current?.parentElement;
    if (!pai) return;
    if (embaixo && !salvo.recolhida) {
      pai.style.paddingBottom = `${tam.h + 8}px`;
      return () => { pai.style.paddingBottom = ""; };
    }
    if (!lateral || salvo.recolhida) return;
    const r = pai.getBoundingClientRect();
    const dentro = salvo.modo === "esq" ? r.left - q.l : q.l + q.w - r.right;
    const lado = salvo.modo === "esq" ? "paddingLeft" : "paddingRight";
    pai.style[lado] = `${Math.max(0, tam.w - dentro + 8)}px`;
    return () => { pai.style[lado] = ""; };
  }, [lateral, embaixo, salvo.modo, salvo.recolhida, tam.w, tam.h, q.l, q.w]);

  function aoPressionar(e: PointerEvent<HTMLElement>) {
    if (e.button !== 0) return;
    medir();
    inicio.current = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y, moveu: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function aoMover(e: PointerEvent<HTMLElement>) {
    const i = inicio.current;
    if (!i) return;
    const dx = e.clientX - i.px, dy = e.clientY - i.py;
    if (!i.moveu && Math.hypot(dx, dy) < 5) return;
    i.moveu = true;
    const px = e.clientX - q.l, py = e.clientY - q.t;
    const alvo: Modo | null = px < ZONA ? "esq" : px > q.w - ZONA ? "dir" : py < q.topoFixo + ZONA ? "topo" : py > q.h - ZONA ? "baixo" : null;
    const novo = { x: limitar(i.x + dx, 0, q.w - tam.w), y: limitar(i.y + dy, 0, q.h - tam.h), alvo };
    arrastoRef.current = novo;
    setArrasto(novo);
  }
  function aoSoltar(e: PointerEvent<HTMLElement>) {
    const i = inicio.current;
    inicio.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!i) return;
    const fim = arrastoRef.current;
    arrastoRef.current = null;
    setArrasto(null);
    if (!i.moveu || !fim) { if (!i.moveu && salvo.recolhida) setSalvo((s) => ({ ...s, recolhida: false })); return; }
    setSalvo((s) => (fim.alvo ? { ...s, modo: fim.alvo, recolhida: false, y: fim.alvo === "topo" || fim.alvo === "baixo" ? s.y : fim.y } : { ...s, modo: "livre", x: fim.x, y: fim.y }));
  }
  function aoTeclar(e: KeyboardEvent<HTMLElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setSalvo((s) => ({ ...s, modo: ORDEM[(ORDEM.indexOf(s.modo) + 1) % ORDEM.length]! }));
      return;
    }
    const passo: Record<string, [number, number]> = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] };
    const d = passo[e.key];
    if (!d) return;
    e.preventDefault();
    setSalvo((s) => ({ ...s, modo: "livre", x: pos.x + d[0], y: pos.y + d[1] }));
  }

  const dedo = "touch-none select-none";
  const botao = "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-3 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400 max-md:h-10 max-md:w-10";
  const zona = (alvo: Modo, estilo: CSSProperties) => <div key={alvo} aria-hidden className="ecos-paleta-zona" data-visivel={!!arrasto} data-ativa={arrasto?.alvo === alvo} style={estilo} />;
  const larguraTopo = Math.min(q.w - 2 * MARGEM, 420);
  const altZona = Math.max(0, q.h - q.topoFixo - 2 * MARGEM - 8);

  const estiloCaixa: CSSProperties = {
    transform: `translate3d(${pos.x}px, ${pos.y}px, 0)${arrasto ? " scale(1.03)" : ""}`,
    transition: arrasto ? "none" : animando ? `transform 420ms ${MOLA}, border-radius 320ms ease` : "border-radius 320ms ease",
    maxWidth: acoplada ? q.w : Math.max(0, q.w - 2 * MARGEM),
    ...(acoplada && (salvo.modo === "topo" || embaixo) ? { width: q.w } : {}),
    ...(acoplada && lateral ? { height: Math.max(0, q.h - q.topoFixo) } : {}),
    borderRadius: acoplada ? 0 : salvo.recolhida ? 22 : 16,
    ...(acoplada ? { background: "rgb(var(--ecos-surface-1-rgb, 18 24 36))", backdropFilter: "none", borderWidth: 0, [salvo.modo === "topo" ? "borderBottomWidth" : embaixo ? "borderTopWidth" : salvo.modo === "esq" ? "borderRightWidth" : "borderLeftWidth"]: 1 } : {}),
    opacity: tam.w ? 1 : 0,
    boxShadow: acoplada ? "none" : arrasto ? "inset 0 1px 0 rgb(255 255 255 / 0.07), 0 18px 44px rgb(0 0 0 / 0.45)" : "inset 0 1px 0 rgb(255 255 255 / 0.07), 0 8px 28px rgb(0 0 0 / 0.28)",
  };

  return (
    <div ref={ancora} data-paleta-flutuante className="relative z-30" style={{ height: reserva, transition: "height 320ms ease" }}>
      <>
        {zona("esq", { transform: `translate3d(${MARGEM / 2}px, ${q.topoFixo + 8}px, 0)`, width: ZONA - 8, height: altZona })}
        {zona("dir", { transform: `translate3d(${q.w - ZONA + MARGEM / 2}px, ${q.topoFixo + 8}px, 0)`, width: ZONA - 8, height: altZona })}
        {zona("baixo", { transform: `translate3d(${(q.w - larguraTopo) / 2}px, ${q.h - 56}px, 0)`, width: larguraTopo, height: 52 })}
        {zona("topo", { transform: `translate3d(${(q.w - larguraTopo) / 2}px, ${q.topoFixo + 4}px, 0)`, width: larguraTopo, height: 52 })}
      </>
      <div ref={caixa} data-modo={salvo.modo} role="toolbar" aria-label="Ferramentas de escrita" style={estiloCaixa}
        className="fixed left-0 top-0 z-30 border border-border bg-surface-2 backdrop-blur-xl" >
        <div className={`flex items-center ${vertical ? "flex-col" : acoplada ? "justify-center" : ""}`} style={{ borderRadius: acoplada ? 0 : salvo.recolhida ? 22 : 16 }}>
          <Colapso aberto={salvo.recolhida} vertical={vertical}>
            <button type="button" aria-label="Abrir ferramentas de escrita (arraste para mover)" title="Abrir ferramentas (arraste para mover)" onPointerDown={aoPressionar} onPointerMove={aoMover} onPointerUp={aoSoltar} onPointerCancel={aoSoltar}
              className={`flex h-11 w-11 items-center justify-center rounded-full text-steel-300 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400 ${dedo} ${arrasto ? "cursor-grabbing" : "cursor-pointer"}`}>
              <PenTool size={19} strokeWidth={1.75} />
            </button>
          </Colapso>
          <Colapso aberto={!salvo.recolhida} vertical={vertical}>
            <div className={`flex items-center gap-0.5 ${vertical ? "flex-col p-1" : "p-1.5 pl-1"}`}>
              <button type="button" aria-label="Mover ferramentas (arraste; Enter alterna o encaixe)" title="Arraste para mover livremente ou encaixar no topo, embaixo e nas laterais" onPointerDown={aoPressionar} onPointerMove={aoMover} onPointerUp={aoSoltar} onPointerCancel={aoSoltar} onKeyDown={aoTeclar}
                className={`${botao} ${dedo} ${arrasto ? "cursor-grabbing" : "cursor-grab"} text-text-muted`}>
                {vertical ? <GripHorizontal size={17} strokeWidth={1.75} /> : <GripVertical size={17} strokeWidth={1.75} />}
              </button>
              {aoSair && <button type="button" aria-label="Voltar ao modo texto" title="Voltar ao modo texto" onClick={aoSair} className={botao}><Keyboard size={16} strokeWidth={1.75} /></button>}
              {children({ vertical, alinhar, embaixo })}
              <button type="button" aria-label="Recolher ferramentas" title="Recolher" onClick={() => setSalvo((s) => ({ ...s, recolhida: true }))} className={botao}><Minimize2 size={16} strokeWidth={1.75} /></button>
            </div>
          </Colapso>
        </div>
      </div>
    </div>
  );
}
