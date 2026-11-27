import type { CSSProperties, ReactNode, Ref } from "react";
import { ChevronDown } from "lucide-react";
import { useIsMobile } from "@/lib/use-viewport";
import { ALTURA_CABECALHO, ALTURA_CURVA, COR_TRILHO, COR_TRILHO_SVG, RAMO, RECUO_LISTA, TRONCO } from "./geometria";

/** Segmento reto do tronco; tracejado no futuro. */
function Tronco({ futuro, style }: { futuro?: boolean; style: CSSProperties }) {
  return <span aria-hidden className={`absolute w-0 border-l ${COR_TRILHO} ${futuro ? "border-dashed" : ""}`} style={{ left: TRONCO - 0.5, ...style }} />;
}

/** Curva entre tronco e ramo: a de entrada desce do tronco para o ramo; a de saída volta ao tronco. */
function Curva({ entrada, futuro, destaque }: { entrada: boolean; futuro?: boolean; destaque?: boolean }) {
  const [x0, x1] = entrada ? [TRONCO, RAMO] : [RAMO, TRONCO];
  const meio = ALTURA_CURVA / 2;
  const largura = RAMO + 4;
  return <svg aria-hidden data-futuro={futuro || undefined} className={`ecos-timeline-curva absolute left-0 ${entrada ? "top-0" : "bottom-0"} ${destaque ? "text-error/50" : COR_TRILHO_SVG}`} width={largura} height={ALTURA_CURVA} viewBox={`0 0 ${largura} ${ALTURA_CURVA}`} fill="none">
    <path d={`M${x0} 0 C${x0} ${meio}, ${x1} ${meio}, ${x1} ${ALTURA_CURVA}`} stroke="currentColor" strokeWidth={1} strokeLinecap="round" />
  </svg>;
}

/** `inert` tira o ramo recolhido do foco e dos leitores de tela; os tipos do React 18 ainda não conhecem o atributo. */
const inerte = (sim: boolean) => (sim ? ({ inert: "" } as Record<string, string>) : {});

export interface GrupoDiaProps {
  id: string;
  rotulo: string;
  subtitulo?: string;
  contagem: number;
  /** Hoje: cabeçalho grande e o bloco levemente elevado. */
  atual?: boolean;
  futuro?: boolean;
  /** Grupo "Atrasadas". */
  destaque?: boolean;
  primeiro?: boolean;
  ultimo?: boolean;
  recolhido: boolean;
  onAlternar: (id: string) => void;
  refDia?: Ref<HTMLLIElement>;
  /** Os itens desenham o trilho do ramo linha a linha (dia com registro); o grupo só desenha as curvas. */
  trilhoPorLinha?: boolean;
  children: ReactNode;
}

/** Um dia da Timeline: ponto no tronco, cabeçalho que recolhe e o ramo com os itens. */
export function GrupoDia({ id, rotulo, subtitulo, contagem, atual, futuro, destaque, primeiro, ultimo, recolhido, onAlternar, refDia, trilhoPorLinha, children }: GrupoDiaProps) {
  const meioCabecalho = ALTURA_CABECALHO / 2;
  const corPonto = destaque ? "bg-error" : atual ? "bg-cyan ecos-timeline-agora" : futuro ? "border border-text-muted/60 bg-base" : "bg-text-muted/70";
  const corRamo = destaque ? "border-error/50" : COR_TRILHO;
  // No celular, hoje não ganha cartão (ocupava a largura e pesava): só o "Hoje" em ciano marca o dia.
  const movel = useIsMobile();
  const cartao = atual && !movel;
  return <li ref={refDia} data-dia={id} className={`relative scroll-mt-24 ${cartao ? "my-2 pb-2" : "pb-1"}`}>
    {cartao && <span aria-hidden className="ecos-timeline-hoje absolute -inset-x-3 inset-y-0 rounded-2xl border border-border/70 bg-surface-1" />}
    {/* tronco: chega ao ponto do dia, segue até o fim do cabeçalho e atravessa o respiro de baixo */}
    <Tronco futuro={futuro} style={{ top: primeiro ? meioCabecalho : cartao ? -8 : 0, height: primeiro ? meioCabecalho : ALTURA_CABECALHO + (cartao ? 8 : 0) }} />
    {!ultimo && <Tronco futuro={futuro} style={{ bottom: cartao ? -8 : 0, height: cartao ? 16 : 4 }} />}

    <h2 className="relative" style={{ height: ALTURA_CABECALHO }}>
      <button type="button" onClick={() => onAlternar(id)} aria-expanded={!recolhido} aria-controls={`ramo-${id}`} style={{ paddingLeft: TRONCO + 16 }}
        className="group flex h-full w-full items-center gap-2 rounded-xl pr-2 text-left transition-colors hover:bg-surface-2/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/70">
        <span aria-hidden className={`absolute h-[9px] w-[9px] -translate-x-1/2 rounded-full ring-4 transition-colors ${cartao ? "ring-surface-1" : "ring-base"} ${corPonto}`} style={{ left: TRONCO }} />
        {atual && movel
          ? <><span className="text-[15px] font-semibold text-cyan">Hoje</span><span className="min-w-0 truncate text-xs text-text-muted">{rotulo}</span></>
          : <span className={atual ? "font-display text-lg text-text-primary" : `text-[15px] font-semibold ${destaque ? "text-error" : "text-text-primary"}`}>{rotulo}</span>}
        {subtitulo && <span className="text-xs text-text-muted">{subtitulo}</span>}
        <span className={`ml-auto rounded-full px-1.5 text-[11px] tabular-nums transition-opacity duration-300 ${destaque ? "bg-error/15 text-error" : "text-text-muted"} ${recolhido || destaque ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>{contagem}</span>
        <ChevronDown size={15} aria-hidden className={`text-text-muted transition-transform duration-300 ${recolhido ? "-rotate-90" : ""}`} />
      </button>
    </h2>

    <div id={`ramo-${id}`} className="ecos-timeline-ramo" data-recolhido={recolhido || undefined} {...inerte(recolhido)}>
      <div>
        {/* A chave muda ao abrir: as curvas se redesenham e os itens entram de novo, em cascata. */}
        <div key={recolhido ? "recolhido" : "aberto"} className="relative" style={{ paddingTop: ALTURA_CURVA - 4, paddingBottom: ultimo ? 0 : ALTURA_CURVA - 4 }}>
          <Curva entrada futuro={futuro} destaque={destaque} />
          {!trilhoPorLinha && <span aria-hidden className={`absolute w-0 border-l ${corRamo} ${futuro ? "border-dashed" : ""}`} style={{ left: RAMO - 0.5, top: ALTURA_CURVA, bottom: ultimo ? 8 : ALTURA_CURVA }} />}
          {!ultimo && <Curva entrada={false} futuro={futuro} destaque={destaque} />}
          <ul className="flex flex-col" style={{ paddingLeft: RECUO_LISTA }}>{children}</ul>
        </div>
      </div>
    </div>
  </li>;
}

const fmtCurto = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "numeric", month: "short" });
const curto = (dia: string) => fmtCurto.format(new Date(`${dia}T12:00:00`)).replace(/\./g, "");

/** Dias futuros seguidos sem nada: uma linha discreta no tronco, em vez de um grupo por dia. */
export function FaixaVazia({ de, ate, ultimo }: { de: string; ate: string; ultimo?: boolean }) {
  const rotulo = de === ate ? curto(de) : `${curto(de)} – ${curto(ate)}`;
  return <li data-faixa-de={de} data-faixa-ate={ate} className="ecos-timeline-item relative scroll-mt-24 flex h-9 items-center" style={{ paddingLeft: TRONCO + 16 }}>
    <Tronco futuro style={{ top: 0, height: ultimo ? "50%" : "100%" }} />
    <span aria-hidden className="absolute h-[5px] w-[5px] -translate-x-1/2 rounded-full border border-text-muted/50 bg-base" style={{ left: TRONCO }} />
    <span className="text-xs text-text-muted"><span className="first-letter:uppercase inline-block">{rotulo}</span> · nada programado</span>
  </li>;
}
