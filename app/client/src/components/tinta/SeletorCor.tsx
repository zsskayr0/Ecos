/**
 * Conteúdo da aba de cor da paleta de escrita, em dois modos:
 * - Amostras: as cores do grupo atual; só o nome do grupo aparece, com bolinhas para os demais (toque ou deslize).
 * - Espectro: saturação/brilho, matiz, HEX e conta-gotas; "Guardar" leva a cor para um grupo próprio.
 */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight, Grid3x3, Pencil, Pipette, Plus, Star, SwatchBook, Trash2, X } from "lucide-react";
import { hexParaHsv, hsvParaHex, ID_FAVORITOS, MAX_CORES_GRUPO, normalizarHex, usePaletasTinta, type Hsv } from "@/lib/tinta/paletas";
import type { Ferramenta } from "@/lib/tinta/tipos";

const COR_AUTO = "rgb(var(--ecos-text-primary-rgb))";
const css = (cor: string) => (cor === "auto" ? COR_AUTO : cor);

interface Props { ferramenta: Ferramenta; valor: string; onChange: (cor: string) => void }

type Modo = "amostras" | "espectro";
/** O modo escolhido vale para as próximas aberturas da aba. */
let modoLembrado: Modo = "amostras";

const ICONE_ESPECTRO: [string, number, number][] = [["#f87171", 3, 4], ["#fbbf24", 8, 4], ["#4ade80", 13, 4], ["#38bdf8", 3, 11], ["#818cf8", 8, 11], ["#e879f9", 13, 11]];
const IconeEspectro = () => (
  <svg aria-hidden width="16" height="16" viewBox="0 0 16 16">{ICONE_ESPECTRO.map(([c, x, y]) => <circle key={c} cx={x} cy={y} r="2.2" fill={c} />)}</svg>
);

function EscolhaSV({ hsv, onChange }: { hsv: Hsv; onChange: (h: Hsv) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ativo, setAtivo] = useState(false);
  const mover = (e: PointerEvent<HTMLDivElement>) => {
    const r = ref.current!.getBoundingClientRect();
    onChange({ h: hsv.h, s: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), v: Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height)) });
  };
  const teclar = (e: KeyboardEvent<HTMLDivElement>) => {
    const passo = e.shiftKey ? 0.1 : 0.02;
    const d: Record<string, [number, number]> = { ArrowLeft: [-passo, 0], ArrowRight: [passo, 0], ArrowUp: [0, passo], ArrowDown: [0, -passo] };
    const m = d[e.key];
    if (!m) return;
    e.preventDefault();
    onChange({ h: hsv.h, s: Math.min(1, Math.max(0, hsv.s + m[0])), v: Math.min(1, Math.max(0, hsv.v + m[1])) });
  };
  return (
    <div ref={ref} role="slider" tabIndex={0} aria-label="Saturação e brilho" aria-valuetext={`saturação ${Math.round(hsv.s * 100)}%, brilho ${Math.round(hsv.v * 100)}%`} aria-valuenow={Math.round(hsv.s * 100)}
      onKeyDown={teclar} onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setAtivo(true); mover(e); }} onPointerMove={(e) => { if (ativo) mover(e); }}
      onPointerUp={() => setAtivo(false)} onPointerCancel={() => setAtivo(false)}
      className="relative h-28 w-full cursor-crosshair touch-none select-none rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400"
      style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)`, backgroundImage: "linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)" }}>
      <span aria-hidden className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
        style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, backgroundColor: hsvParaHex(hsv) }} />
    </div>
  );
}

function EscolhaMatiz({ hsv, onChange }: { hsv: Hsv; onChange: (h: Hsv) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ativo, setAtivo] = useState(false);
  const mover = (e: PointerEvent<HTMLDivElement>) => {
    const r = ref.current!.getBoundingClientRect();
    onChange({ ...hsv, h: Math.min(359.9, Math.max(0, ((e.clientX - r.left) / r.width) * 360)) });
  };
  const teclar = (e: KeyboardEvent<HTMLDivElement>) => {
    const passo = e.shiftKey ? 20 : 4;
    const d = e.key === "ArrowRight" || e.key === "ArrowUp" ? passo : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -passo : 0;
    if (!d) return;
    e.preventDefault();
    onChange({ ...hsv, h: (hsv.h + d + 360) % 360 });
  };
  return (
    <div ref={ref} role="slider" tabIndex={0} aria-label="Matiz" aria-valuemin={0} aria-valuemax={360} aria-valuenow={Math.round(hsv.h)} onKeyDown={teclar}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setAtivo(true); mover(e); }} onPointerMove={(e) => { if (ativo) mover(e); }}
      onPointerUp={() => setAtivo(false)} onPointerCancel={() => setAtivo(false)}
      className="relative h-3 w-full cursor-pointer touch-none select-none rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400"
      style={{ backgroundImage: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)" }}>
      <span aria-hidden className="pointer-events-none absolute top-1/2 h-4 w-2 -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
        style={{ left: `${(hsv.h / 360) * 100}%`, backgroundColor: `hsl(${hsv.h} 100% 50%)` }} />
    </div>
  );
}

/** Anima a altura do conteúdo ao trocar de modo (a aba estica ou encolhe, em vez de pular). */
function AlturaAnimada({ children }: { children: ReactNode }) {
  const dentro = useRef<HTMLDivElement>(null);
  const [h, setH] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = dentro.current;
    if (!el) return;
    const medir = () => setH(el.offsetHeight);
    medir();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="-m-1 overflow-hidden p-1 motion-reduce:!transition-none" style={h === null ? undefined : { height: h + 8, transition: "height 260ms cubic-bezier(0.2, 0.9, 0.25, 1)" }}>
      <div ref={dentro}>{children}</div>
    </div>
  );
}

type ConstrutorConta = { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } };

export function SeletorCor({ ferramenta, valor, onChange }: Props) {
  const { grupos, grupo, escolher, criar, renomear, excluir, adicionar, remover, trocar, favoritos, alternarFavorito } = usePaletasTinta(ferramenta);
  const ehFavoritos = grupo.id === ID_FAVORITOS;
  /** Grupos em que dá para reordenar e remover cores: os do usuário e o de favoritos. */
  const editavel = grupo.proprio || ehFavoritos;
  const favorita = valor !== "auto" && favoritos.includes(valor);
  const grade = useRef<HTMLDivElement>(null);
  /** Arrasto de uma amostra (modo de edição): `de` é o índice atual dela; o fantasma segue o ponteiro. */
  const [movendo, setMovendo] = useState<{ cor: string; x: number; y: number } | null>(null);
  const movido = useRef<{ de: number; andou: boolean } | null>(null);
  const [modo, setModoEstado] = useState<Modo>(modoLembrado);
  const [trocou, setTrocou] = useState(false);
  const setModo = (m: Modo) => { if (m === modo) return; modoLembrado = m; setTrocou(true); setModoEstado(m); };
  const arrasto = useRef<{ x: number; y: number; moveu: boolean } | null>(null);
  const [editando, setEditando] = useState(false);
  const [confirmaExcluir, setConfirmaExcluir] = useState(false);
  const [hsv, setHsv] = useState<Hsv>(() => hexParaHsv(valor === "auto" ? "#2563eb" : valor));
  const [hexRascunho, setHexRascunho] = useState<string | null>(null);
  const nomeRef = useRef<HTMLInputElement>(null);
  const hexAtual = hsvParaHex(hsv);
  const conta = typeof window !== "undefined" ? (window as unknown as ConstrutorConta).EyeDropper : undefined;

  // Escolha por fora (amostra, outro seletor): o espectro acompanha.
  useEffect(() => {
    if (valor !== "auto" && normalizarHex(valor) && normalizarHex(valor) !== hexAtual) setHsv(hexParaHsv(valor));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor]);
  useEffect(() => { setEditando(false); setConfirmaExcluir(false); }, [grupo.id]);
  useEffect(() => { if (!confirmaExcluir) return; const t = window.setTimeout(() => setConfirmaExcluir(false), 3000); return () => window.clearTimeout(t); }, [confirmaExcluir]);
  useEffect(() => { if (editando) nomeRef.current?.select(); }, [editando]);

  const aplicar = (h: Hsv) => { setHsv(h); setHexRascunho(null); onChange(hsvParaHex(h)); };
  const confirmarHex = () => {
    const n = hexRascunho !== null ? normalizarHex(hexRascunho) : null;
    if (n) aplicar(hexParaHsv(n));
    else setHexRascunho(null);
  };
  async function pingar() {
    if (!conta) return;
    try { const r = await new conta().open(); const n = normalizarHex(r.sRGBHex); if (n) aplicar(hexParaHsv(n)); } catch { /* cancelado */ }
  }
  /** Guarda a cor atual no grupo próprio aberto; num grupo pronto, cria um grupo novo com ela. */
  const guardar = () => {
    if (grupo.proprio) adicionar(grupo.id, hexAtual);
    else criar(undefined, [hexAtual]);
  };
  const jaGuardada = grupo.proprio && grupo.cores.includes(hexAtual);
  const cheio = grupo.proprio && grupo.cores.length >= MAX_CORES_GRUPO;
  const tituloGuardar = grupo.proprio ? (jaGuardada ? `Já está em ${grupo.nome}` : cheio ? "Grupo cheio" : `Guardar em ${grupo.nome}`) : "Guardar num grupo novo";
  const favoritaEspectro = favoritos.includes(hexAtual);
  const novoGrupo = () => { if (criar()) setEditando(true); };

  const indiceGrupo = grupos.findIndex((g) => g.id === grupo.id);
  const irGrupo = (d: number) => escolher(grupos[(indiceGrupo + d + grupos.length) % grupos.length]!.id);
  const aoPressionar = (e: PointerEvent<HTMLDivElement>) => { if (editando) return; arrasto.current = { x: e.clientX, y: e.clientY, moveu: false }; };
  const aoSoltar = (e: PointerEvent<HTMLDivElement>) => {
    const a = arrasto.current;
    if (!a) return;
    const dx = e.clientX - a.x, dy = e.clientY - a.y;
    if (Math.abs(dx) > 36 && Math.abs(dx) > 2 * Math.abs(dy)) { a.moveu = true; irGrupo(dx < 0 ? 1 : -1); window.setTimeout(() => { arrasto.current = null; }, 0); }
    else arrasto.current = null;
  };
  const fantasma = (e: PointerEvent<HTMLElement>) => {
    const r = grade.current!.getBoundingClientRect();
    return { x: e.clientX - r.left + grade.current!.scrollLeft, y: e.clientY - r.top + grade.current!.scrollTop };
  };
  const comecarMover = (e: PointerEvent<HTMLButtonElement>, cor: string, i: number) => {
    if (!editando || !editavel || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    movido.current = { de: i, andou: false };
    setMovendo({ cor, ...fantasma(e) });
  };
  const mover = (e: PointerEvent<HTMLButtonElement>) => {
    const m = movido.current;
    if (!m) return;
    m.andou = true;
    const alvo = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-cor-indice]");
    const j = alvo ? Number(alvo.dataset.corIndice) : -1;
    if (j >= 0 && j !== m.de && grade.current?.contains(alvo ?? null)) { trocar(grupo.id, m.de, j); m.de = j; }
    setMovendo((v) => (v ? { ...v, ...fantasma(e) } : v));
  };
  const soltarMover = () => { setMovendo(null); window.setTimeout(() => { movido.current = null; }, 0); };
  const pequeno = "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-secondary transition-colors enabled:hover:bg-surface-3 enabled:hover:text-text-primary disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400";

  /** Largura extra do painel para os botões de editar/excluir do grupo (só no modo Amostras). */
  const extra = modo === "amostras" ? (editavel ? 32 : 0) + (grupo.proprio ? 32 : 0) : 0;
  const abas: [Modo, string, ReactNode][] = [["amostras", "Amostras", <Grid3x3 key="a" size={14} strokeWidth={1.75} />], ["espectro", "Espectro", <IconeEspectro key="e" />]];

  return (
    <div className="flex flex-col gap-2 overflow-hidden p-2.5 motion-reduce:!transition-none" style={{ width: 240 + extra, transition: "width 260ms cubic-bezier(0.2, 0.9, 0.25, 1)" }}>
      <div className="flex items-center gap-1">
        <div role="group" aria-label="Modo do seletor de cor" className="relative grid w-[220px] shrink-0 grid-cols-2 rounded-lg bg-surface-3 p-0.5">
          <span aria-hidden className="absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-md bg-surface-1 shadow-sm motion-reduce:!transition-none"
            style={{ transform: `translateX(${modo === "espectro" ? "100%" : "0"})`, transition: "transform 280ms cubic-bezier(0.2, 0.9, 0.25, 1.12)" }} />
          {abas.map(([m, rotulo, icone]) => (
            <button key={m} type="button" aria-pressed={modo === m} onClick={() => setModo(m)}
              className={`relative z-10 flex h-7 items-center justify-center gap-1.5 rounded-md text-xs transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400 ${modo === m ? "text-text-primary" : "text-text-secondary hover:text-text-primary"}`}>{icone}{rotulo}</button>
          ))}
        </div>
        {modo === "amostras" && editavel && (
          <div className="ecos-botao-entra flex shrink-0 items-center gap-1">
            <button type="button" aria-label={editando ? "Concluir edição" : "Editar grupo (renomear e remover cores)"} title={editando ? "Concluir" : "Editar grupo (arrastar para reordenar, × para remover)"} aria-pressed={editando} onClick={() => setEditando((v) => !v)} className={pequeno}>
              {editando ? <Check size={14} strokeWidth={2} /> : <Pencil size={14} strokeWidth={1.75} />}
            </button>
            {grupo.proprio && <button type="button" aria-label={confirmaExcluir ? "Confirmar: excluir o grupo" : "Excluir grupo"} title={confirmaExcluir ? "Clique de novo para excluir" : "Excluir grupo"}
              onClick={() => { if (confirmaExcluir) excluir(grupo.id); else setConfirmaExcluir(true); }} className={`${pequeno} ${confirmaExcluir ? "!bg-error/15 !text-error" : ""}`}><Trash2 size={14} strokeWidth={1.75} /></button>}
          </div>
        )}
      </div>

      <AlturaAnimada>
      <div key={modo} className={`flex flex-col gap-2 ${trocou ? "ecos-modo-entra" : ""}`} data-de={modo === "espectro" ? "dir" : "esq"}>
      {modo === "amostras" ? (
        <>
          <div ref={grade} role="radiogroup" aria-label={`Cores do grupo ${grupo.nome}`} className="relative grid h-[76px] touch-pan-y auto-rows-[28px] grid-cols-6 content-start gap-2 overflow-y-auto p-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            onPointerDown={aoPressionar} onPointerUp={aoSoltar} onPointerCancel={() => { arrasto.current = null; }} onClickCapture={(e) => { if (arrasto.current?.moveu) { e.stopPropagation(); e.preventDefault(); } }}>
            {grupo.cores.map((c, i) => {
              const ativa = c === valor;
              const levando = movendo?.cor === c;
              return (
                <div key={c} className="relative" data-cor-indice={i}>
                  <button type="button" role="radio" aria-checked={ativa} aria-label={c === "auto" ? "Cor do texto" : c} title={c === "auto" ? "Cor do texto (muda com o tema)" : c} onClick={() => { if (!movido.current?.andou) onChange(c); }}
                    onPointerDown={(e) => comecarMover(e, c, i)} onPointerMove={mover} onPointerUp={soltarMover} onPointerCancel={soltarMover}
                    style={{ backgroundColor: css(c), ...(editando && editavel ? { touchAction: "none", cursor: "grab" } : {}), ...(levando ? { opacity: 0.35 } : {}) }}
                    className={`flex h-full w-full items-center justify-center rounded-lg border border-border transition-transform focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400 ${ativa ? "ring-2 ring-steel-400 ring-offset-1 ring-offset-surface-1" : "hover:scale-105"}`}>
                    {ativa && <Check size={14} strokeWidth={2.5} className="text-white mix-blend-difference" aria-hidden />}
                  </button>
                  {editando && editavel && (
                    <button type="button" aria-label={`Remover ${c}`} title="Remover do grupo" onClick={() => remover(grupo.id, c)}
                      className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-error text-on-accent shadow"><X size={10} strokeWidth={3} /></button>
                  )}
                </div>
              );
            })}
            {movendo && <span aria-hidden className="pointer-events-none absolute z-10 h-7 w-7 -translate-x-1/2 -translate-y-1/2 scale-110 rounded-lg border border-border shadow-lg ring-2 ring-steel-400" style={{ left: movendo.x, top: movendo.y, backgroundColor: css(movendo.cor) }} />}
            {grupo.proprio && grupo.cores.length < MAX_CORES_GRUPO && valor !== "auto" && !grupo.cores.includes(valor) && (
              <button type="button" aria-label="Guardar a cor atual neste grupo" title="Guardar a cor atual neste grupo" onClick={() => adicionar(grupo.id, valor)}
                className="flex h-full w-full items-center justify-center rounded-lg border border-dashed border-border text-text-muted transition-colors hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400"><Plus size={14} strokeWidth={2} /></button>
            )}
          </div>
          {/* Uma linha só: setas nas pontas, o nome do grupo atual com as bolinhas logo abaixo (toque, setas ou deslize as cores para trocar). */}
          <div className="flex h-8 items-center gap-0.5">
            <button type="button" aria-label="Grupo anterior" title="Grupo anterior" onClick={() => irGrupo(-1)} className={pequeno}><ChevronLeft size={16} strokeWidth={2} /></button>
            <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5">
              {grupo.proprio && editando
                ? <input ref={nomeRef} aria-label="Nome do grupo" defaultValue={grupo.nome} maxLength={24} onBlur={(e) => { renomear(grupo.id, e.target.value); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); setEditando(false); } }}
                    className="h-5 w-full rounded border border-border bg-surface-2 px-1.5 text-center text-xs text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400" />
                : <span aria-live="polite" className="w-full truncate text-center text-xs leading-4 text-text-secondary">{grupo.nome}</span>}
              <div role="tablist" aria-label="Grupos de cores" className="flex max-w-full items-center justify-center gap-1 overflow-hidden">
                {grupos.map((g) => (
                  <button key={g.id} type="button" role="tab" aria-selected={g.id === grupo.id} aria-label={g.nome} title={g.nome} onClick={() => escolher(g.id)}
                    className={g.id === ID_FAVORITOS ? `flex h-2.5 w-2.5 shrink-0 items-center justify-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400 ${g.id === grupo.id ? "text-amber-400" : "text-text-muted/60 hover:text-text-muted"}` : `h-1.5 shrink-0 rounded-full transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400 ${g.id === grupo.id ? "w-4 bg-text-primary" : "w-1.5 bg-text-muted/50 hover:bg-text-muted"}`}>
                    {g.id === ID_FAVORITOS && <Star size={10} strokeWidth={1.75} fill={g.id === grupo.id ? "currentColor" : "none"} aria-hidden />}
                  </button>
                ))}
                <button type="button" aria-label="Novo grupo de cores" title="Novo grupo de cores" onClick={novoGrupo}
                  className="flex h-2.5 w-2.5 shrink-0 items-center justify-center text-text-muted transition-colors hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400"><Plus size={10} strokeWidth={2.5} /></button>
              </div>
            </div>
            <button type="button" aria-label={favorita ? "Tirar a cor atual dos favoritos" : "Favoritar a cor atual"} title={favorita ? "Tirar dos favoritos" : "Favoritar a cor atual"} aria-pressed={favorita} disabled={valor === "auto"} onClick={() => alternarFavorito(valor)} className={`${pequeno} ${favorita ? "!text-amber-400" : ""}`}><Star size={14} strokeWidth={1.75} fill={favorita ? "currentColor" : "none"} /></button>
            <button type="button" aria-label="Próximo grupo" title="Próximo grupo" onClick={() => irGrupo(1)} className={pequeno}><ChevronRight size={16} strokeWidth={2} /></button>
          </div>
        </>
      ) : (
        <>
          <EscolhaSV hsv={hsv} onChange={aplicar} />
          <EscolhaMatiz hsv={hsv} onChange={aplicar} />
          <div className="flex items-center gap-1.5">
            <span aria-hidden className="h-7 w-7 shrink-0 rounded-md border border-border" style={{ backgroundColor: hexAtual }} />
            <input aria-label="Cor em HEX" value={hexRascunho ?? hexAtual} spellCheck={false} maxLength={7} onChange={(e) => setHexRascunho(e.target.value)} onBlur={confirmarHex}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirmarHex(); } }}
              className={`h-7 min-w-0 flex-1 rounded-md border bg-surface-2 px-2 font-mono text-xs uppercase text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400 ${hexRascunho !== null && !normalizarHex(hexRascunho) ? "border-error" : "border-border"}`} />
            {conta && <button type="button" aria-label="Conta-gotas (pegar cor da tela)" title="Conta-gotas" onClick={pingar} className={pequeno}><Pipette size={14} strokeWidth={1.75} /></button>}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <button type="button" onClick={guardar} disabled={jaGuardada || cheio} aria-label={tituloGuardar} title={tituloGuardar}
              className="flex h-7 items-center justify-center rounded-md bg-steel-500/25 text-text-primary transition-colors enabled:hover:bg-steel-500/40 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400"><SwatchBook size={15} strokeWidth={1.75} /></button>
            <button type="button" onClick={() => alternarFavorito(hexAtual)} aria-pressed={favoritaEspectro} aria-label={favoritaEspectro ? "Tirar esta cor dos favoritos" : "Favoritar esta cor"} title={favoritaEspectro ? "Tirar dos favoritos" : "Favoritar esta cor"}
              className={`flex h-7 items-center justify-center rounded-md bg-steel-500/25 transition-colors hover:bg-steel-500/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400 ${favoritaEspectro ? "text-amber-400" : "text-text-primary"}`}><Star size={15} strokeWidth={1.75} fill={favoritaEspectro ? "currentColor" : "none"} /></button>
          </div>
        </>
      )}
      </div>
      </AlturaAnimada>
    </div>
  );
}
