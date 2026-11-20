/**
 * Paleta flutuante do Modo de escrita: livre (arrasta para qualquer lugar), encaixada no topo
 * (acompanha a rolagem, como a barra de antes), ou presa na lateral esquerda/direita (estilo Samsung Notes).
 * Recolhe numa bolinha. Ao arrastar perto de uma borda aparece a zona de encaixe; ao soltar, a paleta
 * assenta com uma mola. Teclado: no puxador, setas movem e Enter alterna o encaixe.
 * A posição vale em coordenadas da janela do Ecos (ancestral com `transform`) ou da tela, e é lembrada.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { GripHorizontal, GripVertical, Minimize2, PenTool, Keyboard, RotateCw, type LucideIcon } from "lucide-react";
import { Colapso } from "./Colapso";
import { useIsMobile } from "@/lib/use-viewport";
import "./paleta-flutuante.css";

type Modo = "livre" | "topo" | "baixo" | "esq" | "dir";
interface Salvo { modo: Modo; x: number; y: number; recolhida: boolean; girada: boolean }
/** `dx`/`dy`: onde o quadro fica em relação ao bloco que contém os elementos `fixed` (a janela com `transform`, ou a tela se o `transform` já acabou). */
interface Quadro { l: number; t: number; w: number; h: number; ancoraTopo: number; topoFixo: number; /** distância das zonas e da paleta à borda de cima (sob o cabeçalho) e à de baixo: a mesma nas duas */ folga: number; dx: number; dy: number }

const CHAVE = "ecos.paleta-escrita";
const MARGEM = 8;
/** Faixa que a paleta de formatação reserva acima do texto (a leitura da nota usa a mesma altura para a linha de datas). */
export const RESERVA_TOPO_PX = 68;
const ZONA = 40;
/** Só a paleta minimizada (bolinha) resiste a sair de uma zona de encaixe: exige ir mais longe do que foi preciso para entrar. Aberta, ela troca de encaixe sem resistência. */
const ZONA_SAIDA = 88;
/** Tela pequena, paleta aberta: arrastar tanto assim (px) na vertical já troca de cima para baixo (e vice-versa). */
const LIMIAR_TROCA = 36;
/** Arrastar além disto (px do ponto de partida) ou mais rápido que isto (px/ms) encolhe a paleta até soltar. */
const ENCOLHE_DIST = 140;
const ENCOLHE_VEL = 1.4;
const MOLA = "cubic-bezier(0.2, 0.9, 0.25, 1.12)";
const ORDEM: Modo[] = ["topo", "baixo", "esq", "dir", "livre"];
const limitar = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));

function lerSalvo(): Salvo {
  try {
    const bruto = JSON.parse(localStorage.getItem(CHAVE) ?? "null") as Partial<Salvo> | null;
    if (bruto && ORDEM.includes(bruto.modo as Modo)) return { modo: bruto.modo as Modo, x: Number(bruto.x) || MARGEM, y: Number(bruto.y) || 80, recolhida: !!bruto.recolhida, girada: !!bruto.girada };
  } catch { /* sem armazenamento: usa o padrão */ }
  return { modo: "topo", x: MARGEM, y: 80, recolhida: false, girada: false };
}

function medirQuadro(ancora: HTMLElement, sonda: HTMLElement | null): Quadro {
  const altura = Math.min(window.innerHeight, document.documentElement.clientHeight || window.innerHeight, window.visualViewport?.height ?? Infinity);
  const pagina = ancora.closest<HTMLElement>(".ecos-detail-page");
  const topoFixo = pagina ? parseFloat(pagina.style.getPropertyValue("--ecos-editor-sticky-top")) || 0 : 0;
  // O quadro é a nota em si (sem o título), recortada pela área visível: nunca a tela inteira nem a barra de título.
  const nota = ancora.parentElement;
  let rolagem: HTMLElement | null = nota;
  while (rolagem && !/(auto|scroll)/.test(getComputedStyle(rolagem).overflowY)) rolagem = rolagem.parentElement;
  const rn = nota?.getBoundingClientRect();
  const rr = rolagem?.getBoundingClientRect();
  const esq = Math.max(rn?.left ?? 0, rr?.left ?? 0), dir = Math.min(rn?.right ?? window.innerWidth, rr?.right ?? window.innerWidth);
  const topo = Math.max(rn?.top ?? 0, rr?.top ?? 0, 0);
  // O fim do quadro é o fim da área visível, não o da nota: numa nota curta a zona de baixo e a paleta não podem parar logo abaixo do texto.
  const base = Math.min(rr?.bottom ?? altura, altura);
  const q = { l: esq, t: topo, w: Math.max(0, dir - esq), h: Math.max(0, base - topo) };
  // `fixed` parte da janela enquanto ela tem `transform`, e da tela depois; a sonda diz de onde.
  const origem = sonda?.getBoundingClientRect();
  // `--ecos-editor-sticky-top` conta a partir do topo da área que rola; o quadro começa onde a nota começa (pode estar abaixo desse topo, ex.: logo após o cabeçalho com a página no início).
  const topoRolagem = rr?.top ?? 0;
  return { ...q, ancoraTopo: ancora.getBoundingClientRect().top - q.t, topoFixo: Math.max(0, topoRolagem + topoFixo - q.t), folga: topoFixo > 0 ? 16 : 4, dx: origem ? q.l - origem.left : q.l, dy: origem ? q.t - origem.top : q.t };
}

/** Barra lateral começa onde a nota começa (abaixo do título e das tags) e sobe junto com a rolagem até o topo da folha. */
function topoLateral(f: Quadro, tam: { h: number }): number {
  return limitar(Math.max(f.ancoraTopo, f.topoFixo), f.topoFixo, f.h - Math.min(tam.h, 120));
}

function posicaoDe(s: Salvo, tam: { w: number; h: number }, f: Quadro, flutuante: boolean): { x: number; y: number } {
  const minY = f.topoFixo + 4;
  const maxX = f.w - tam.w - MARGEM;
  const maxY = f.h - tam.h - MARGEM;
  // Encaixada (e aberta) vira barra de verdade, colada nas bordas; recolhida é só a bolinha.
  const barra = !s.recolhida && !flutuante;
  switch (s.modo) {
    case "topo": return barra ? { x: 0, y: Math.max(f.ancoraTopo, f.topoFixo) } : { x: flutuante && !s.recolhida ? Math.max(MARGEM, maxX / 2) : Math.max(MARGEM, maxX), y: limitar(Math.max(f.ancoraTopo, minY), minY, maxY) };
    case "baixo": return barra ? { x: 0, y: Math.max(f.topoFixo, f.h - tam.h) } : { x: flutuante && !s.recolhida ? Math.max(MARGEM, maxX / 2) : Math.max(MARGEM, maxX), y: Math.max(minY, f.h - tam.h - f.folga) };
    case "esq": return barra ? { x: 0, y: topoLateral(f, tam) } : { x: MARGEM, y: limitar(s.y, minY, maxY) };
    case "dir": return barra ? { x: Math.max(0, f.w - tam.w), y: topoLateral(f, tam) } : { x: Math.max(MARGEM, maxX), y: limitar(s.y, minY, maxY) };
    default: return { x: limitar(s.x, MARGEM, maxX), y: limitar(s.y, minY, maxY) };
  }
}

interface Props {
  /** Volta ao modo texto (botão no fim da paleta). */
  aoSair?: () => void;
  /** Saindo do Modo de escrita: a paleta se desfaz com uma animação antes de sumir. */
  saindo?: boolean;
  /** Entrada e saída só com fade (sem escala nem deslocamento). */
  desvanecer?: boolean;
  /** Nome da paleta para leitores de tela (padrão: ferramentas de escrita). */
  rotulo?: string;
  /** Ícone da bolinha (paleta recolhida) e do botão que troca de modo. */
  iconeBolinha?: LucideIcon;
  iconeSair?: LucideIcon;
  rotuloSair?: string;
  /** No topo, abre a faixa `RESERVA_TOPO_PX` acima do texto para a paleta não cobrir as primeiras linhas. */
  reservarTopo?: boolean;
  children: (estado: { vertical: boolean; alinhar: "esq" | "dir"; embaixo: boolean }) => ReactNode;
}

export function PaletaFlutuante({ aoSair, saindo = false, desvanecer = false, rotulo = "Ferramentas de escrita", iconeBolinha: IconeBolinha = PenTool, iconeSair: IconeSair = Keyboard, rotuloSair = "Voltar ao modo texto", reservarTopo = false, children }: Props) {
  const ancora = useRef<HTMLDivElement>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const [salvo, setSalvo] = useState<Salvo>(lerSalvo);
  const [tam, setTam] = useState({ w: 0, h: 0 });
  const sonda = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState<Quadro>({ l: 0, t: 0, w: 0, h: 0, ancoraTopo: 0, topoFixo: 0, folga: 4, dx: 0, dy: 0 });
  const [arrasto, setArrasto] = useState<{ x: number; y: number; alvo: Modo | null } | null>(null);
  const [animando, setAnimando] = useState(false);
  /** Encolhida só enquanto arrasta (longe ou rápido); volta ao soltar. */
  const [encolhida, setEncolhida] = useState(false);
  /** Girar = recolher, virar e abrir de novo (a mesma animação do minimizar). */
  const [girando, setGirando] = useState(false);
  const girar = () => {
    if (girando) return;
    setGirando(true);
    window.setTimeout(() => setSalvo((s) => ({ ...s, girada: !s.girada })), 340);
    window.setTimeout(() => setGirando(false), 420);
  };
  const amostra = useRef<{ x: number; y: number; t: number; v: number } | null>(null);
  const arrastoRef = useRef(arrasto);
  const inicio = useRef<{ px: number; py: number; x: number; y: number; moveu: boolean; encolheu: boolean } | null>(null);

  const medir = useCallback(() => { if (ancora.current) setQ(medirQuadro(ancora.current, sonda.current)); }, []);
  useLayoutEffect(medir, [medir]);
  useEffect(() => {
    window.addEventListener("resize", medir);
    let quadro = 0;
    const aoRolar = () => { if (!quadro) quadro = requestAnimationFrame(() => { quadro = 0; medir(); }); };
    document.addEventListener("scroll", aoRolar, { capture: true, passive: true });
    // A janela anima com `transform`; quando a animação acaba o bloco dos elementos `fixed` muda, então mede de novo.
    document.addEventListener("animationend", aoRolar, true);
    document.addEventListener("transitionend", aoRolar, true);
    const tardio = window.setTimeout(medir, 700);
    const obs = new ResizeObserver(() => { if (caixa.current) setTam({ w: caixa.current.offsetWidth, h: caixa.current.offsetHeight }); medir(); });
    if (caixa.current) obs.observe(caixa.current);
    return () => { window.removeEventListener("resize", medir); document.removeEventListener("scroll", aoRolar, true); document.removeEventListener("animationend", aoRolar, true); document.removeEventListener("transitionend", aoRolar, true); window.clearTimeout(tardio); cancelAnimationFrame(quadro); obs.disconnect(); };
  }, [medir]);
  useEffect(() => { try { localStorage.setItem(CHAVE, JSON.stringify(salvo)); } catch { /* ignora */ } }, [salvo]);
  useEffect(() => {
    setAnimando(true);
    const t = window.setTimeout(() => setAnimando(false), 520);
    return () => window.clearTimeout(t);
  }, [salvo.modo, salvo.recolhida, encolhida, girando]);

  const mobile = useIsMobile();
  // Sempre uma pílula flutuante, também no celular (lá só acima ou abaixo da nota).
  const flutuante = true;
  // Tela pequena (celular): só cabe acima ou abaixo da nota; laterais e posição livre ficam de fora, e a paleta não gira.
  const restrito = mobile;
  // Só a bolinha (recolhida) vai para onde se quiser, sem encaixe; aberta, assenta acima ou abaixo (o lado do meio da nota onde ela está).
  const bolinhaLivre = restrito && salvo.recolhida;
  const sv: Salvo = restrito && !bolinhaLivre ? { ...salvo, modo: salvo.modo === "livre" ? (salvo.y + tam.h / 2 < q.h / 2 ? "topo" : "baixo") : salvo.modo === "baixo" ? "baixo" : "topo", girada: false } : bolinhaLivre ? { ...salvo, girada: false } : salvo;
  const pos = arrasto ?? posicaoDe(sv, tam, q, flutuante);
  // Horizontal só encaixada no topo; solta, fica vertical e as abas abrem para o lado com mais espaço (meio da tela).
  const verticalBase = sv.modo !== "topo" && sv.modo !== "baixo";
  const vertical = verticalBase !== sv.girada;
  const alinhar: "esq" | "dir" = sv.modo === "esq" ? "esq" : sv.modo === "dir" ? "dir" : pos.x + tam.w / 2 > q.w / 2 ? "dir" : "esq";
  // No desktop a paleta é sempre uma pílula flutuante (encaixar só a gruda na borda); a barra de ponta a ponta é do celular.
  const recolhidaVista = sv.recolhida || encolhida || girando;
  const acoplada = !flutuante && sv.modo !== "livre" && !sv.recolhida && !arrasto;
  // Celular, no topo: abre espaço acima do texto para a pílula não cobrir as primeiras linhas.
  const reserva = reservarTopo && sv.modo === "topo" && !sv.recolhida ? RESERVA_TOPO_PX : 0;
  const embaixo = sv.modo === "baixo";
  const lateral = sv.modo === "esq" || sv.modo === "dir";
  // Barra lateral acoplada: abre espaço no conteúdo da nota, em vez de ficar por cima.
  useLayoutEffect(() => {
    const pai = ancora.current?.parentElement;
    if (!pai) return;
    if (flutuante) return;
    if (embaixo && !sv.recolhida) {
      pai.style.paddingBottom = `${tam.h + 8}px`;
      return () => { pai.style.paddingBottom = ""; };
    }
    if (!lateral || sv.recolhida) return;
    const r = pai.getBoundingClientRect();
    const dentro = sv.modo === "esq" ? r.left - q.l : q.l + q.w - r.right;
    const lado = sv.modo === "esq" ? "paddingLeft" : "paddingRight";
    pai.style[lado] = `${Math.max(0, tam.w - dentro + 8)}px`;
    return () => { pai.style[lado] = ""; };
  }, [flutuante, lateral, embaixo, sv.modo, sv.recolhida, tam.w, tam.h, q.l, q.w]);

  // Os eventos do arrasto ouvem a janela: a paleta pode encolher no meio do gesto e o puxador deixa de ser alvo.
  const mover = useRef<(e: globalThis.PointerEvent) => void>(() => {});
  const soltar = useRef<() => void>(() => {});
  function aoPressionar(e: PointerEvent<HTMLElement>) {
    if (e.button !== 0) return;
    medir();
    inicio.current = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y, moveu: false, encolheu: false };
    amostra.current = { x: e.clientX, y: e.clientY, t: performance.now(), v: 0 };
    const mv = (ev: globalThis.PointerEvent) => mover.current(ev);
    const fim = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", fim); window.removeEventListener("pointercancel", fim); soltar.current(); };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", fim);
    window.addEventListener("pointercancel", fim);
  }
  mover.current = (e) => {
    const i = inicio.current;
    if (!i) return;
    const dx = e.clientX - i.px, dy = e.clientY - i.py;
    if (!i.moveu && Math.hypot(dx, dy) < 5) return;
    i.moveu = true;
    // Velocidade suavizada (px/ms) entre os últimos pontos.
    const a = amostra.current;
    const agora = performance.now();
    if (a) {
      const dt = Math.max(1, agora - a.t);
      a.v = a.v * 0.6 + (Math.hypot(e.clientX - a.x, e.clientY - a.y) / dt) * 0.4;
      a.x = e.clientX; a.y = e.clientY; a.t = agora;
    }
    if (!i.encolheu && (Math.hypot(dx, dy) > ENCOLHE_DIST || (a && a.v > ENCOLHE_VEL && Math.hypot(dx, dy) > 40))) { i.encolheu = true; setEncolhida(true); }
    const px = e.clientX - q.l, py = e.clientY - q.t;
    const atual = arrastoRef.current?.alvo ?? null;
    const z = (m: Modo) => (sv.recolhida && atual === m ? ZONA_SAIDA : ZONA);
    const alvoBorda: Modo | null = bolinhaLivre ? null : !restrito && px < z("esq") ? "esq" : !restrito && px > q.w - z("dir") ? "dir" : py < q.topoFixo + z("topo") ? "topo" : py > q.h - z("baixo") ? "baixo" : null;
    // Tela pequena: sem laterais, um toque curto na vertical basta para trocar de lado; soltar perto de onde estava mantém o lado.
    const alvo: Modo | null = restrito && !bolinhaLivre && !alvoBorda ? (sv.modo === "topo" ? (dy > LIMIAR_TROCA ? "baixo" : "topo") : (dy < -LIMIAR_TROCA ? "topo" : "baixo")) : alvoBorda;
    // Encolhida, a bolinha acompanha o ponteiro pelo meio.
    const novo = i.encolheu ? { x: limitar(px - 22, 0, q.w - 44), y: limitar(py - 22, 0, q.h - 44), alvo } : { x: limitar(i.x + dx, 0, q.w - tam.w), y: limitar(i.y + dy, 0, q.h - tam.h), alvo };
    arrastoRef.current = novo;
    setArrasto(novo);
  };
  soltar.current = () => {
    const i = inicio.current;
    inicio.current = null;
    amostra.current = null;
    setEncolhida(false);
    if (!i) return;
    const fim = arrastoRef.current;
    arrastoRef.current = null;
    setArrasto(null);
    if (!i.moveu || !fim) { if (!i.moveu && sv.recolhida) setSalvo((s) => ({ ...s, recolhida: false })); return; }
    // Solta no ponto onde a bolinha estava: a paleta volta inteira, com o canto superior esquerdo no mesmo lugar do centro dela.
    const x = i.encolheu ? limitar(fim.x + 22 - tam.w / 2, 0, q.w - tam.w) : fim.x;
    const y = i.encolheu ? limitar(fim.y + 22 - tam.h / 2, 0, q.h - tam.h) : fim.y;
    // Tela pequena: sem alvo, assenta no lado (acima ou abaixo) mais perto de onde soltou.
    if (restrito && !bolinhaLivre && !fim.alvo) fim.alvo = y + tam.h / 2 < q.h / 2 ? "topo" : "baixo";
    setSalvo((s) => (fim.alvo ? { ...s, modo: fim.alvo, girada: fim.alvo === s.modo ? s.girada : false, recolhida: false, y: fim.alvo === "topo" || fim.alvo === "baixo" ? s.y : y } : { ...s, modo: "livre", x, y }));
  };
  function aoTeclar(e: KeyboardEvent<HTMLElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const ordem = restrito ? ORDEM.slice(0, 2) : ORDEM;
      setSalvo((s) => ({ ...s, girada: false, modo: ordem[(ordem.indexOf(s.modo) + 1) % ordem.length]! }));
      return;
    }
    const passo: Record<string, [number, number]> = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] };
    const d = passo[e.key];
    if (!d) return;
    e.preventDefault();
    if (restrito) { if (e.key === "ArrowUp" || e.key === "ArrowDown") setSalvo((s) => ({ ...s, girada: false, modo: e.key === "ArrowUp" ? "topo" : "baixo" })); return; }
    setSalvo((s) => ({ ...s, modo: "livre", x: pos.x + d[0], y: pos.y + d[1] }));
  }

  const dedo = "touch-none select-none";
  const botao = "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-3 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400 max-md:h-10 max-md:w-10";
  const zona = (alvo: Modo, estilo: CSSProperties) => <div key={alvo} aria-hidden className="ecos-paleta-zona" data-visivel={!!arrasto && !bolinhaLivre} data-ativa={arrasto?.alvo === alvo} style={estilo} />;
  const larguraTopo = Math.min(q.w - 2 * MARGEM, 420);
  const altZona = Math.max(0, q.h - q.topoFixo - 2 * MARGEM - 8);

  const estiloCaixa: CSSProperties = {
    transform: `translate3d(${pos.x + q.dx}px, ${pos.y + q.dy}px, 0)${arrasto ? " scale(1.03)" : ""}`,
    transition: arrasto ? "border-radius 320ms ease" : animando ? `transform 420ms ${MOLA}, border-radius 320ms ease` : "border-radius 320ms ease",
    maxWidth: acoplada ? q.w : Math.max(0, q.w - 2 * MARGEM),
    ...(acoplada && (sv.modo === "topo" || embaixo) ? { width: q.w } : {}),
    ...(acoplada && lateral ? { height: Math.max(0, q.h - topoLateral(q, tam)) } : {}),
    borderRadius: acoplada ? 0 : recolhidaVista ? 22 : 16,
    ...(acoplada ? { background: "rgb(var(--ecos-surface-1-rgb, 18 24 36))", backdropFilter: "none", borderWidth: 0, [sv.modo === "topo" ? "borderBottomWidth" : embaixo ? "borderTopWidth" : sv.modo === "esq" ? "borderRightWidth" : "borderLeftWidth"]: 1 } : {}),
    opacity: tam.w ? 1 : 0,
    boxShadow: acoplada ? "none" : arrasto ? "inset 0 1px 0 rgb(255 255 255 / 0.07), 0 18px 44px rgb(0 0 0 / 0.45)" : "inset 0 1px 0 rgb(255 255 255 / 0.07), 0 8px 28px rgb(0 0 0 / 0.28)",
  };

  return (
    <div ref={ancora} data-paleta-flutuante className="relative z-30" style={{ height: reserva, transition: "height 320ms ease" }}>
      <div ref={sonda} aria-hidden className="pointer-events-none fixed left-0 top-0 h-0 w-0" />
      <>
        {!restrito && zona("esq", { transform: `translate3d(${MARGEM / 2 + q.dx}px, ${q.topoFixo + 8 + q.dy}px, 0)`, width: ZONA - 8, height: altZona })}
        {!restrito && zona("dir", { transform: `translate3d(${q.w - ZONA + MARGEM / 2 + q.dx}px, ${q.topoFixo + 8 + q.dy}px, 0)`, width: ZONA - 8, height: altZona })}
        {zona("baixo", { transform: `translate3d(${(q.w - larguraTopo) / 2 + q.dx}px, ${q.h - 52 - q.folga + q.dy}px, 0)`, width: larguraTopo, height: 52 })}
        {zona("topo", { transform: `translate3d(${(q.w - larguraTopo) / 2 + q.dx}px, ${q.topoFixo + 4 + q.dy}px, 0)`, width: larguraTopo, height: 52 })}
      </>
      <div ref={caixa} data-modo={sv.modo} role="toolbar" aria-label={rotulo} style={estiloCaixa}
        className="fixed left-0 top-0 z-30 border border-border bg-surface-2 backdrop-blur-xl" >
        <div className={`flex items-center ${saindo ? (desvanecer ? "ecos-paleta-fade-sai" : "ecos-paleta-sai pointer-events-none") : tam.w ? (desvanecer ? "ecos-paleta-fade-entra" : "ecos-paleta-entra") : ""} ${vertical ? "flex-col" : acoplada ? "justify-center" : ""}`} style={{ borderRadius: acoplada ? 0 : recolhidaVista ? 22 : 16 }}>
          <Colapso aberto={recolhidaVista} vertical={vertical}>
            <button type="button" aria-label={`Abrir ${rotulo.toLowerCase()} (arraste para mover)`} title="Abrir ferramentas (arraste para mover)" onPointerDown={aoPressionar}
              className={`flex h-11 w-11 items-center justify-center rounded-full text-steel-300 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400 ${dedo} ${arrasto ? "cursor-grabbing" : "cursor-pointer"}`}>
              <IconeBolinha size={19} strokeWidth={1.75} />
            </button>
          </Colapso>
          <Colapso aberto={!recolhidaVista} vertical={vertical} zerarCruzado>
            <div className={`flex items-center gap-0.5 ${vertical ? "flex-col p-1" : "p-1.5 pl-1"}`}>
              <button type="button" aria-label="Mover ferramentas (arraste; Enter alterna o encaixe)" title="Arraste para mover livremente ou encaixar no topo, embaixo e nas laterais" onPointerDown={aoPressionar} onKeyDown={aoTeclar}
                className={`${botao} ${dedo} ${arrasto ? "cursor-grabbing" : "cursor-grab"} text-text-muted`}>
                {vertical ? <GripHorizontal size={17} strokeWidth={1.75} /> : <GripVertical size={17} strokeWidth={1.75} />}
              </button>
              {aoSair && <button type="button" aria-label={rotuloSair} title={rotuloSair} onClick={aoSair} className={`${botao} group`}><IconeSair size={16} strokeWidth={1.75} className="transition-transform duration-200 ease-out motion-reduce:transition-none [@media(hover:hover)]:group-hover:rotate-90 group-active:scale-125" /></button>}
              {children({ vertical, alinhar, embaixo })}
              {!acoplada && !restrito && <button type="button" aria-label="Girar ferramentas" title="Girar (horizontal ↔ vertical)" onClick={girar} className={botao}><RotateCw size={16} strokeWidth={1.75} /></button>}
              <button type="button" aria-label="Recolher ferramentas" title="Recolher" onClick={() => setSalvo((s) => ({ ...s, recolhida: true }))} className={botao}><Minimize2 size={16} strokeWidth={1.75} /></button>
            </div>
          </Colapso>
        </div>
      </div>
    </div>
  );
}
