/**
 * Seletor de cor/espessura da barra de escrita, como uma aba secundária da paleta flutuante: ela desliza
 * para fora da borda da paleta (para baixo no topo; para o lado oposto à borda quando encaixada na lateral),
 * alinhada ao gatilho, e a sombra da paleta maior cai sobre ela para marcar a hierarquia.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export type LadoPaleta = "baixo" | "cima" | "direita" | "esquerda";
export interface OpcaoPaleta { valor: string; rotulo: string; conteudo: ReactNode }

const ITEM = 26;
const PAD = 3;
const LADO_ABA = ITEM + 2 * PAD;

interface Props {
  ariaLabel: string;
  valor: string;
  opcoes?: readonly OpcaoPaleta[];
  onChange?: (valor: string) => void;
  /** Conteúdo livre da aba (ex.: um slide), no lugar da lista de opções. */
  conteudoAba?: ReactNode;
  lado: LadoPaleta;
  /** Conteúdo do gatilho (a cor ou a espessura atual); a seta é desenhada aqui. */
  gatilho: ReactNode;
  classeGatilho: string;
}

export function SeletorPaleta({ ariaLabel, valor, opcoes = [], onChange, conteudoAba, lado, gatilho, classeGatilho }: Props) {
  const raiz = useRef<HTMLDivElement>(null);
  const aba = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const [aberto, setAberto] = useState(false);
  const [pos, setPos] = useState<CSSProperties>({});
  const [ajuste, setAjuste] = useState(0);
  const [saindo, setSaindo] = useState(false);
  const temporizador = useRef(0);
  // Ao fechar, a aba faz o caminho de volta para a paleta antes de sair do DOM.
  const fechar = useCallback(() => {
    setSaindo(true);
    window.clearTimeout(temporizador.current);
    temporizador.current = window.setTimeout(() => { setAberto(false); setSaindo(false); }, 200);
  }, []);
  useEffect(() => () => window.clearTimeout(temporizador.current), []);
  const abrir = () => { window.clearTimeout(temporizador.current); setSaindo(false); setAberto(true); };

  // A aba nasce colada na borda da paleta, alinhada ao centro do gatilho.
  useLayoutEffect(() => {
    if (!aberto || !raiz.current || !botao.current) return;
    const barra = botao.current.closest<HTMLElement>("[role=toolbar]");
    if (!barra) return;
    const r = raiz.current.getBoundingClientRect();
    const b = barra.getBoundingClientRect();
    const g = botao.current.getBoundingClientRect();
    const tamAba = { w: aba.current?.offsetWidth ?? LADO_ABA, h: aba.current?.offsetHeight ?? LADO_ABA };
    const cx = g.left - r.left + g.width / 2;
    const cy = g.top - r.top + g.height / 2;
    // A aba é `fixed` dentro da paleta (que tem transform): coordenadas relativas à borda da paleta, e o recorte de rolagem da barra não a corta.
    const ref = { x: g.left + g.width / 2 - b.left, y: g.top + g.height / 2 - b.top };
    if (lado === "direita") setPos({ left: b.width - 1, top: ref.y - tamAba.h / 2 });
    else if (lado === "esquerda") setPos({ right: b.width - 1, top: ref.y - tamAba.h / 2 });
    else if (lado === "cima") setPos({ left: ref.x - tamAba.w / 2, bottom: b.height - 1 });
    else setPos({ left: ref.x - tamAba.w / 2, top: b.height - 1 });
    setAjuste(0);
  }, [aberto, lado]);
  // Mantém a aba dentro da janela deslizando-a ao longo da borda (nunca descolando da paleta).
  useLayoutEffect(() => {
    if (!aberto || !aba.current) return;
    const rect = aba.current.getBoundingClientRect();
    const horizontal = lado === "baixo" || lado === "cima";
    const ini = horizontal ? rect.left : rect.top;
    const fim = horizontal ? rect.right : rect.bottom;
    const lim = horizontal ? window.innerWidth : window.innerHeight;
    const d = ini < 8 ? 8 - ini : fim > lim - 8 ? lim - 8 - fim : 0;
    if (d) setAjuste((a) => a + d);
  }, [aberto, pos, lado]);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => { if (!raiz.current?.contains(e.target as Node)) fechar(); };
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); fechar(); botao.current?.focus(); } };
    // Se a barra rolar, o gatilho sai do lugar: a aba volta para ele.
    const barra = botao.current?.closest<HTMLElement>("[role=toolbar]");
    const rolou = (e: Event) => { if (e.target instanceof Node && barra?.contains(e.target) && !aba.current?.contains(e.target)) fechar(); };
    barra?.addEventListener("scroll", rolou, true);
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", tecla, true);
    return () => { barra?.removeEventListener("scroll", rolou, true); document.removeEventListener("pointerdown", fora); document.removeEventListener("keydown", tecla, true); };
  }, [aberto, fechar]);

  const girado = aberto && !saindo;
  const giro = lado === "cima" ? (girado ? "" : "rotate-180") : lado === "baixo" ? (girado ? "rotate-180" : "") : lado === "direita" ? (girado ? "rotate-90" : "-rotate-90") : (girado ? "-rotate-90" : "rotate-90");
  const deslocamento = lado === "baixo" || lado === "cima" ? `translateX(${ajuste}px)` : `translateY(${ajuste}px)`;
  // O recorte só vale do lado da paleta: a aba aparece "saindo" de trás dela, e a própria sombra não é cortada.
  const recorte = lado === "direita" ? "inset(-24px -24px -24px 0)" : lado === "esquerda" ? "inset(-24px 0 -24px -24px)" : lado === "cima" ? "inset(-24px -24px 0 -24px)" : "inset(0 -24px -24px -24px)";
  const arredondar = lado === "cima" ? "rounded-t-2xl" : lado === "baixo" ? "rounded-b-2xl" : conteudoAba ? (lado === "direita" ? "rounded-r-2xl" : "rounded-l-2xl") : lado === "direita" ? "rounded-r-full" : "rounded-l-full";
  const sombra = lado === "cima" ? "bg-gradient-to-t" : lado === "direita" ? "bg-gradient-to-r" : lado === "esquerda" ? "bg-gradient-to-l" : "bg-gradient-to-b";
  const posSombra = lado === "cima" ? "inset-x-0 bottom-0 h-3" : lado === "baixo" ? "inset-x-0 top-0 h-3" : lado === "direita" ? "inset-y-0 left-0 w-3" : "inset-y-0 right-0 w-3";

  return (
    <div ref={raiz} className="relative">
      <button ref={botao} type="button" aria-haspopup="menu" aria-expanded={girado} aria-label={ariaLabel} title={ariaLabel} onClick={() => (aberto && !saindo ? fechar() : abrir())} className={classeGatilho}>
        {gatilho}
        <ChevronDown size={14} aria-hidden className={`text-text-muted transition-transform duration-150 ${giro}`} />
      </button>
      {aberto && (
        <div ref={aba} role="menu" aria-label={ariaLabel} style={{ ...pos, clipPath: recorte, transform: deslocamento }} className="fixed z-40">
          <div data-lado={lado} data-saindo={saindo} className={`ecos-paleta-aba relative flex flex-row border border-border bg-surface-1 shadow-nav ${arredondar}`} style={{ padding: conteudoAba ? 0 : PAD, gap: 2 }}>
            {conteudoAba ?? opcoes.map((o) => {
              const ativo = o.valor === valor;
              return (
                <button key={o.valor} type="button" role="menuitemradio" aria-checked={ativo} aria-label={o.rotulo} title={o.rotulo} style={{ width: ITEM, height: ITEM }}
                  onClick={() => { onChange?.(o.valor); fechar(); botao.current?.focus(); }}
                  className={`flex shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400 ${ativo ? "ring-2 ring-steel-400/80" : "hover:bg-surface-3"}`}>
                  {o.conteudo}
                </button>
              );
            })}
            <span aria-hidden className={`pointer-events-none absolute ${posSombra} ${sombra} from-black/40 to-transparent ${arredondar}`} />
          </div>
        </div>
      )}
    </div>
  );
}
