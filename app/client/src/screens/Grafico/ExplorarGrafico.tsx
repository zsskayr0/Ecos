import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { ArrowUpRight, Locate, Minus, Plus, Scan, Search } from "lucide-react";

import type { GraficoDados, NoGrafico } from "@/lib/api";
import { corDoTipo, ROTULO_TIPO_SINGULAR, type PreferenciasGrafico } from "@/lib/preferencias-grafico";
import { useVisorZoom } from "@/lib/use-visor-zoom";
import { MenuSuspenso } from "@/components/common/MenuSuspenso";
import { MarcaTipo } from "./controles";
import { ALTURA_CARTAO, escalaParaAnel, LARGURA_CARTAO, layoutAneis } from "./explorar-layout";

const PRAZO_DUPLO = 450;
const DIST_DUPLO = 16;
/** Tempo do deslize até o cartão clicado antes de ele virar o centro. */
const TEMPO_RECENTRAR = 480;
const ATRASO_ANEL = 480;

type NoRotulado = NoGrafico & { nomeEspaco?: string };

interface Props {
  dados: GraficoDados;
  prefs: PreferenciasGrafico;
  /** Id inicial; sem ele, o item mais conectado. */
  raizInicial?: string;
  onAbrir: (no: NoGrafico) => void;
  /** Se o nó pode ser aberto (tag não pode). */
  podeAbrir: (no: NoGrafico) => boolean;
}

/** Aba "Explorar": um item no centro, o que se liga a ele em anéis; clicar num vizinho o traz para o centro, duplo clique abre. */
export function ExplorarGrafico({ dados, prefs, raizInicial, onAbrir, podeAbrir }: Props) {
  const [profundidade, setProfundidade] = useState(2);
  const [tags, setTags] = useState(false);
  const maisConectado = useMemo(() => {
    const grau = new Map<string, number>();
    for (const a of dados.arestas) { grau.set(a.origem, (grau.get(a.origem) ?? 0) + 1); grau.set(a.destino, (grau.get(a.destino) ?? 0) + 1); }
    const candidatos = dados.nos.filter((n) => n.tipo !== "tag");
    return candidatos.sort((a, b) => (grau.get(b.id) ?? 0) - (grau.get(a.id) ?? 0))[0]?.id ?? dados.nos[0]?.id ?? "";
  }, [dados]);
  const [raiz, setRaiz] = useState(raizInicial && dados.nos.some((n) => n.id === raizInicial) ? raizInicial : maisConectado);
  const raizValida = dados.nos.some((n) => n.id === raiz) ? raiz : maisConectado;

  const layout = useMemo(() => layoutAneis(dados.nos, dados.arestas, raizValida, profundidade, tags), [dados, raizValida, profundidade, tags]);
  const opcoes = useMemo(() => [...dados.nos].filter((n) => n.tipo !== "tag").sort((a, b) => a.titulo.localeCompare(b.titulo, "pt-BR")).map((n) => ({ valor: n.id, rotulo: n.titulo || "(sem título)" })), [dados]);

  const temporizador = useRef(0);
  const ultimoClique = useRef<{ t: number; x: number; y: number; id: string } | null>(null);
  const v = useVisorZoom({ escalaMin: 0.15, escalaMax: 2, ignorar: "button,a,[data-no-id],[data-controles]" });
  const { visor, mundo, vista, centralizar, zoomNoCentro } = v;

  /** Centro do mundo no meio do visor, na escala dada (ou na atual). */
  const irParaCentro = useCallback((escala: number | undefined, ms: number) => {
    if (!layout) return;
    centralizar({ x: layout.centro.x - 1, y: layout.centro.y - 1, w: 2, h: 2 }, { escala, ms });
  }, [layout, centralizar]);

  // Troca de raiz/profundidade/tags: o mundo foi redesenhado, então reposiciona (sem animar) mantendo a escala se a pessoa já mexeu.
  const primeira = useRef(true);
  useLayoutEffect(() => {
    const vp = visor.current;
    if (!layout || !vp) return;
    const escala = primeira.current || !v.mexeu.current ? escalaParaAnel(layout, Math.min(1, layout.raios.length - 1), vp.clientWidth, vp.clientHeight) : vista.current.s;
    primeira.current = false;
    irParaCentro(escala, 0);
  }, [layout, irParaCentro, visor, vista, v.mexeu]);

  useEffect(() => () => window.clearTimeout(temporizador.current), []);

  const abrir = useCallback((id: string) => {
    const no = dados.nos.find((n) => n.id === id);
    if (no && podeAbrir(no)) onAbrir(no);
  }, [dados, onAbrir, podeAbrir]);

  /** Desliza até o cartão e, quando ele chega ao meio, ele passa a ser o centro do desenho. */
  const trazerParaCentro = useCallback((id: string) => {
    const p = layout?.nos.find((n) => n.no.id === id);
    if (!layout || !p || p.anel === 0) return;
    centralizar({ x: p.x - LARGURA_CARTAO / 2, y: p.y - ALTURA_CARTAO / 2, w: LARGURA_CARTAO, h: ALTURA_CARTAO }, { ms: TEMPO_RECENTRAR });
    window.clearTimeout(temporizador.current);
    temporizador.current = window.setTimeout(() => setRaiz(id), TEMPO_RECENTRAR - 40);
  }, [layout, centralizar]);

  // Duplo clique no nível do visor: vale mesmo com o cartão ainda deslizando (compara tempo e posição, não o elemento).
  const aoClicarCapturando = (e: ReactMouseEvent<HTMLDivElement>) => {
    const alvo = (e.target as HTMLElement).closest<HTMLElement>("[data-no-id]");
    if (!alvo || (e.target as HTMLElement).closest("[data-abrir]")) return;
    const agora = performance.now(), id = alvo.dataset.noId!;
    const u = ultimoClique.current;
    if (u && agora - u.t < PRAZO_DUPLO && Math.hypot(e.clientX - u.x, e.clientY - u.y) < DIST_DUPLO) {
      ultimoClique.current = null;
      window.clearTimeout(temporizador.current);
      e.stopPropagation();
      abrir(u.id);
      return;
    }
    ultimoClique.current = { t: agora, x: e.clientX, y: e.clientY, id };
  };

  if (!layout) return <p className="p-6 text-sm text-slate-400">Escolha um item para explorar.</p>;

  const atraso = (anel: number) => Math.min(anel - 1, 4) * ATRASO_ANEL;

  return (
    <div className="relative min-h-[420px] flex-1 overflow-hidden rounded-t-2xl bg-[#050713] text-slate-200">
      <div ref={visor} onClickCapture={aoClicarCapturando} onPointerDown={v.aoPressionar} onPointerMove={v.aoMover} onPointerUp={v.aoSoltar} onPointerCancel={v.aoSoltar}
        data-testid="explorar-visor" className="absolute inset-0 cursor-grab touch-none select-none overflow-hidden active:cursor-grabbing">
        <div ref={mundo} className="absolute left-0 top-0 origin-top-left" style={{ width: layout.tamanho, height: layout.tamanho }}>
          <div key={`${raizValida}|${profundidade}|${tags}`} className="absolute inset-0">
            <svg width={layout.tamanho} height={layout.tamanho} className="pointer-events-none absolute inset-0 text-slate-400" aria-hidden>
              {layout.raios.slice(1).map((r, i) => <circle key={i} cx={layout.centro.x} cy={layout.centro.y} r={r} fill="none" stroke="currentColor" strokeOpacity={0.07} strokeDasharray="3 8" />)}
              {layout.linhas.map((l) => (
                <path key={l.chave} d={l.d} pathLength={1} strokeDasharray="1 1" className="ecos-linha-desenha" fill="none" stroke="currentColor" strokeWidth={1.25} strokeLinecap="round" opacity={0.4}
                  style={{ animationDelay: `${atraso(l.anel)}ms` }} />
              ))}
            </svg>
            {layout.nos.map((p) => {
              const n = p.no as NoRotulado;
              const centro = p.anel === 0;
              const abrivel = podeAbrir(n);
              return (
                <div key={n.id} data-no-id={n.id} style={{ left: p.x - LARGURA_CARTAO / 2, top: p.y - ALTURA_CARTAO / 2, width: LARGURA_CARTAO, minHeight: ALTURA_CARTAO, animationDelay: `${centro ? 0 : atraso(p.anel) + 440}ms` }}
                  className={`ecos-no-nasce absolute flex items-stretch rounded-xl border bg-surface-2 text-text-primary transition-colors ${centro ? "z-10 border-steel-300/80 bg-surface-3 shadow-lg ring-2 ring-steel-300/30" : "border-border hover:border-steel-300/60 hover:bg-surface-3"}`}>
                  <button type="button" onClick={() => { if (!centro) trazerParaCentro(n.id); }} title={n.titulo}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2.5 py-2 text-left">
                    <MarcaTipo tipo={n.tipo} cor={corDoTipo(prefs, n.tipo)} tamanho={9} />
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-[13px] leading-tight ${centro ? "font-semibold" : "font-medium"}`}>{n.titulo || "(sem título)"}</span>
                      <span className="block truncate text-[10px] text-text-muted">{ROTULO_TIPO_SINGULAR[n.tipo]}{n.nomeEspaco ? ` · ${n.nomeEspaco}` : ""} · {p.grau}</span>
                    </span>
                  </button>
                  {abrivel && (
                    <button type="button" data-abrir aria-label={`Abrir ${n.titulo}`} title="Abrir" onClick={() => abrir(n.id)}
                      className="flex w-8 shrink-0 cursor-pointer items-center justify-center rounded-r-xl border-l border-border text-text-muted hover:bg-surface-1 hover:text-text-primary">
                      <ArrowUpRight size={14} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div data-controles className="absolute left-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-[#0c1222]/85 p-1.5 text-xs text-slate-200 shadow-lg backdrop-blur-md">
        <span className="flex items-center gap-1.5 pl-1.5 text-slate-400"><Search size={13} />Explorar</span>
        <MenuSuspenso valor={raizValida} opcoes={opcoes} buscar ariaLabel="Item no centro" larguraMenu="w-64 max-w-[calc(100vw-2rem)]" onChange={(id) => { if (id) { window.clearTimeout(temporizador.current); setRaiz(id); } }}
          classeGatilho="flex h-8 w-52 items-center rounded-lg border border-white/10 bg-white/5 px-2 text-left text-xs text-slate-200 hover:bg-white/10"
          gatilho={({ atual }) => <span className="min-w-0 flex-1 truncate">{atual?.rotulo ?? "Escolher item"}</span>} />
        <div role="group" aria-label="Profundidade" className="flex items-center gap-0.5">
          {[1, 2, 3].map((d) => <button key={d} type="button" aria-pressed={profundidade === d} onClick={() => setProfundidade(d)} className={`h-8 w-8 rounded-lg ${profundidade === d ? "bg-white/15 text-white" : "hover:bg-white/10"}`}>{d}</button>)}
        </div>
        <button type="button" aria-pressed={tags} onClick={() => setTags((t) => !t)} className={`h-8 rounded-lg px-2 ${tags ? "bg-white/15 text-white" : "hover:bg-white/10"}`}>Tags</button>
        {layout.ocultos > 0 && <span className="pr-1.5 text-[11px] text-slate-400">+{layout.ocultos} fora do desenho</span>}
      </div>
      <p className="pointer-events-none absolute bottom-3 left-3 z-10 hidden text-[11px] text-slate-500 sm:block">Clique num item para trazê-lo ao centro; clique duas vezes (ou use a seta) para abrir. Role para aproximar ou afastar.</p>

      <div data-controles className="absolute bottom-3 right-3 z-10 flex items-center gap-1 rounded-xl border border-white/10 bg-[#0c1222]/85 p-1 text-slate-200 shadow-lg backdrop-blur-md">
        <button type="button" aria-label="Afastar" onClick={() => zoomNoCentro(0.8)} className="rounded-lg p-1.5 hover:bg-white/10"><Minus size={14} /></button>
        <span className="w-10 text-center text-[11px] tabular-nums text-slate-400">{v.percentual}%</span>
        <button type="button" aria-label="Aproximar" onClick={() => zoomNoCentro(1.25)} className="rounded-lg p-1.5 hover:bg-white/10"><Plus size={14} /></button>
        <button type="button" aria-label="Centralizar no item" onClick={() => irParaCentro(undefined, 520)} className="rounded-lg p-1.5 hover:bg-white/10"><Locate size={14} /></button>
        <button type="button" aria-label="Enquadrar tudo" onClick={() => v.ajustar(520, 0.15)} className="rounded-lg p-1.5 hover:bg-white/10"><Scan size={14} /></button>
      </div>
    </div>
  );
}
