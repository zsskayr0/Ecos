import { useCallback, useContext, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { EditorView } from "@codemirror/view";
import { areaDeRolagem, rolarAteElemento, rolarAteLinha } from "./sumario-editor";
import { ChevronRight, X } from "lucide-react";
import { ModoFocusDocumentoContext, PainelFocusEsquerdoContext } from "@/lib/documento-popup";
import { extrairEstrutura, numerarTitulos, type TituloNota } from "@/lib/sumario";
import { usePreferenciaNumerar } from "./usePreferenciaNumerar";

interface Props {
  corpo: string;
  /** Editor vivo, quando a nota está em edição; null na leitura (usa os títulos renderizados). */
  view: EditorView | null;
  /** Raiz do editor: a coluna fica colada à borda direita dela. */
  raiz: RefObject<HTMLElement | null>;
}

/** Linha de referência (px abaixo do topo da área que rola) para decidir qual título está "visível". */
const REFERENCIA = 160;

/**
 * Sumário lateral: uma coluna fina de tracinhos (um por título) na borda direita da nota.
 * Ao passar o mouse abre um cartão com a lista; clique salta para o título.
 */
/** Títulos da nota, qual está visível agora e como saltar até um deles. Base do trilho e da barra lateral. */
function useTitulosNota(corpo: string, view: EditorView | null, raiz: RefObject<HTMLElement | null>) {
  const titulos = useMemo(() => extrairEstrutura(corpo), [corpo]);
  const numerar = usePreferenciaNumerar();
  // Número só para títulos de verdade (#); linhas em negrito ficam sem número.
  const numeros = useMemo(() => {
    const h = titulos.filter((t) => t.nivel <= 6);
    const n = h.length ? numerarTitulos(h) : [];
    let k = 0;
    return titulos.map((t) => (t.nivel <= 6 ? n[k++] : ""));
  }, [titulos]);
  const [ativo, setAtivo] = useState(0);

  const elementoLeitura = useCallback((t: TituloNota) => raiz.current?.querySelector<HTMLElement>(`[data-linha="${t.linha}"]`) ?? null, [raiz]);

  const topo = useCallback((t: TituloNota): number | null => {
    if (view) {
      if (t.linha > view.state.doc.lines) return null;
      return view.lineBlockAt(view.state.doc.line(t.linha).from).top + view.documentTop;
    }
    return elementoLeitura(t)?.getBoundingClientRect().top ?? null;
  }, [view, elementoLeitura]);

  useEffect(() => {
    if (!titulos.length) return;
    let quadro = 0;
    const medir = () => {
      quadro = 0;
      const ref = Math.max(areaDeRolagem(raiz.current)?.getBoundingClientRect().top ?? 0, 0) + REFERENCIA;
      let atual = 0;
      for (let i = 0; i < titulos.length; i++) { const y = topo(titulos[i]); if (y === null) continue; if (y <= ref) atual = i; else break; }
      setAtivo(atual);
    };
    const agendar = () => { if (!quadro) quadro = requestAnimationFrame(medir); };
    medir();
    window.addEventListener("scroll", agendar, { capture: true, passive: true });
    window.addEventListener("resize", agendar);
    return () => { window.removeEventListener("scroll", agendar, true); window.removeEventListener("resize", agendar); if (quadro) cancelAnimationFrame(quadro); };
  }, [titulos, topo, raiz]);

  const saltar = useCallback((t: TituloNota, instantaneo = false) => {
    const duracao = instantaneo ? 0 : 500;
    if (view) rolarAteLinha(view, t.linha, 90, duracao);
    else { const el = elementoLeitura(t); if (el) rolarAteElemento(el, 90, duracao); }
  }, [view, elementoLeitura]);

  const base = titulos.length ? Math.min(...titulos.map((t) => t.nivel)) : 1;
  return { titulos, numerar, numeros, ativo, saltar, base };
}

/**
 * Trilho de tracinhos à esquerda do texto, como no Codex: um tracinho por título, subtítulo ou
 * linha só em negrito. Passar o mouse faz uma onda (o tracinho sob o mouse cresce mais, os
 * vizinhos menos) e mostra um cartão com o nome do item, que segue o mouse. Clique salta.
 */
export function OutlineTitulos({ corpo, view, raiz }: Props) {
  const { titulos, ativo, saltar } = useTitulosNota(corpo, view, raiz);
  const [sobre, setSobre] = useState<number | null>(null);
  const trilho = useRef<HTMLDivElement>(null);
  const cartao = useRef<HTMLDivElement>(null);
  const tracos = useRef<(HTMLSpanElement | null)[]>([]);
  const ultimo = useRef(0);
  const arrastando = useRef(false);
  const destino = useRef(-1);
  const inicioArraste = useRef(0);
  const alcance = useRef<number>();
  if (sobre !== null) ultimo.current = sobre;

  // Desenha a onda direto no DOM a cada movimento (sem re-render nem transição: segue o mouse
  // sem atraso). `pos` é contínuo, então a onda desliza entre os tracinhos em vez de pular.
  const pintar = useCallback((pos: number | null) => {
    tracos.current.forEach((el, i) => {
      if (!el) return;
      const onda = pos === null ? 0 : Math.exp(-((pos - i) ** 2) / 4.5);
      el.style.width = `${Math.max(i === ativo ? 12 : 8, 8 + 14 * onda)}px`;
      el.style.opacity = String(Math.max(i === ativo ? 0.85 : 0.28, 0.28 + 0.72 * onda));
    });
  }, [ativo]);
  useEffect(() => { if (sobre === null) pintar(null); }, [pintar, sobre, titulos.length]);

  if (titulos.length < 2) return null;

  // Qual tracinho está sob o ponteiro (e pinta a onda). Segurando o clique, cada troca de item
  // dispara a rolagem de 0,5 s até ele: primeiro vai ao item do clique, depois segue o ponteiro.
  const mover = (e: React.PointerEvent) => {
    const r = trilho.current?.getBoundingClientRect();
    if (!r) return;
    const dentro = Math.min(Math.max(e.clientY - r.top, 0), r.height);
    const pos = (dentro - 4) / PASSO - 0.5;
    pintar(pos);
    if (cartao.current) cartao.current.style.top = `${dentro}px`;
    const i = Math.min(titulos.length - 1, Math.max(0, Math.round(pos)));
    if (i !== sobre) setSobre(i);
    if (!arrastando.current || i === destino.current) return;
    if (destino.current === -1) { destino.current = i; inicioArraste.current = performance.now(); saltar(titulos[i]); return; }
    destino.current = i;
    // Arraste: depois da primeira viagem (0,5 s), a nota segue o ponteiro na hora, como uma barra de rolagem.
    if (performance.now() - inicioArraste.current >= 500) saltar(titulos[i], true);
  };
  const apertar = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    arrastando.current = true;
    destino.current = -1;
    mover(e);
    // Se o ponteiro mudou de item durante a primeira viagem, alcança-o assim que ela termina.
    window.clearTimeout(alcance.current);
    const primeiro = destino.current;
    alcance.current = window.setTimeout(() => { if (arrastando.current && destino.current !== primeiro && destino.current >= 0) saltar(titulos[destino.current], true); }, 500);
  };
  const soltar = (e: React.PointerEvent) => {
    arrastando.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const r = e.currentTarget.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) sair();
  };
  const sair = () => { if (arrastando.current) return; setSobre(null); pintar(null); };

  const item = titulos[sobre ?? ultimo.current];
  return (
    <div className="pointer-events-none sticky top-1/2 z-30 hidden h-0 sm:block">
      <nav aria-label="Navegar pela nota" className="pointer-events-auto absolute left-[-38px] top-0 -translate-y-1/2"
        onPointerMove={mover} onPointerDown={apertar} onPointerUp={soltar} onPointerCancel={soltar} onPointerLeave={sair} style={{ touchAction: "none" }}>
        <div ref={trilho} className="flex max-h-[60vh] w-7 cursor-pointer flex-col items-start overflow-hidden py-1">
          {titulos.map((t, i) => (
            <span key={`${t.linha}-${i}`} aria-hidden className="flex shrink-0 items-center" style={{ height: PASSO }}>
              <span ref={(el) => { tracos.current[i] = el; }} className="block h-px rounded-full bg-text-secondary"
                style={{ width: i === ativo ? 12 : 8, opacity: i === ativo ? 0.85 : 0.28 }} />
            </span>
          ))}
        </div>
        <div ref={cartao} aria-hidden className={`pointer-events-none absolute left-full ml-1 max-w-72 truncate rounded-lg border border-white/10 bg-[#2a2a2c] px-2.5 py-1.5 text-[13px] font-semibold leading-snug text-white shadow-xl transition-opacity duration-100 ${sobre !== null ? "opacity-100" : "opacity-0"}`}
          style={{ translate: "0 -50%" }}>
          {item?.texto || "Sem título"}
        </div>
        {/* Teclado: lista acessível dos itens. */}
        <ul className="sr-only">{titulos.map((t, i) => <li key={`${t.linha}-${i}`}><button type="button" onClick={() => saltar(t)}>{t.texto || "Sem título"}</button></li>)}</ul>
      </nav>
    </div>
  );
}

/** Altura de cada tracinho no trilho (px). */
const PASSO = 7;

/**
 * Sumário em painel lateral esquerdo. No Focus, monta dentro do painel esquerdo da camada
 * (espelho do painel direito de opções); fora dele, um painel flutuante no mesmo estilo.
 */
export function SumarioLateral({ corpo, view, raiz, aoFechar, aberto }: Props & { aoFechar: () => void; aberto: boolean }) {
  const { titulos, numerar, numeros, ativo, saltar, base } = useTitulosNota(corpo, view, raiz);
  const montagemFocus = useContext(PainelFocusEsquerdoContext);
  const emFocus = useContext(ModoFocusDocumentoContext);
  // Recolhido por seção: as seções (menor nível) aparecem sempre; os itens de dentro só da seção
  // onde você está, ou das que você abrir/fechar na setinha (escolha manual vence a automática).
  const secoes = useMemo(() => { let atual = -1; return titulos.map((t, i) => (t.nivel === base ? (atual = i) : atual)); }, [titulos, base]);
  // Grupos: cada seção com seus itens; itens antes da primeira seção viram grupos soltos.
  const grupos = useMemo(() => {
    const g: { cab: number; filhos: number[] }[] = [];
    titulos.forEach((_, i) => { if (secoes[i] === i || secoes[i] < 0) g.push({ cab: i, filhos: [] }); else g[g.length - 1].filhos.push(i); });
    return g;
  }, [titulos, secoes]);
  const [manual, setManual] = useState<Map<number, boolean>>(() => new Map());
  useEffect(() => setManual(new Map()), [titulos.length]);
  const secaoAtiva = secoes[ativo] ?? -1;
  const aberta = (sec: number) => manual.get(sec) ?? sec === secaoAtiva;
  const alternar = (sec: number) => setManual((m) => new Map(m).set(sec, !aberta(sec)));
  // No Focus o conteúdo fica sempre montado no painel (que aparece e some com fade); fora dele, só aberto.
  if (emFocus ? !montagemFocus : !aberto) return null;
  const conteudo = (
    <aside aria-label="Sumário" className="flex min-w-0 flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold text-text-primary">Sumário</h2>
        <button type="button" onClick={aoFechar} aria-label="Fechar sumário" title="Fechar sumário" className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-3 hover:text-text-primary"><X size={15} /></button>
      </div>
      {titulos.length ? (
        <ul className="flex flex-col gap-0.5">
          {grupos.map(({ cab, filhos }) => {
            const t = titulos[cab];
            const secao = t.nivel === base;
            const item = (k: number, recuo: number) => {
              const x = titulos[k];
              return <button type="button" onClick={() => saltar(x)} aria-current={k === ativo ? "location" : undefined}
                className={`block min-w-0 flex-1 truncate rounded-lg py-1.5 pr-2 text-left text-sm leading-snug transition-colors hover:bg-surface-2 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400 ${k === ativo ? "bg-surface-2 font-semibold text-text-primary" : recuo === 0 && secao ? "text-text-primary" : "text-text-secondary"}`}
                style={{ paddingLeft: 6 + recuo * 12 }} data-negrito={x.nivel > 6 || undefined}>
                {numerar && numeros[k] && <span className="mr-1.5 text-text-muted">{numeros[k]}</span>}{x.texto || "Sem título"}
              </button>;
            };
            const abre = secao && aberta(cab);
            return (
              <li key={`${t.linha}-${cab}`}>
                <div className="flex items-center">
                  {secao && filhos.length
                    ? <button type="button" onClick={() => alternar(cab)} aria-expanded={abre} aria-label={abre ? `Recolher ${t.texto}` : `Abrir ${t.texto}`}
                        className="flex h-7 w-5 shrink-0 items-center justify-center rounded text-text-muted hover:text-text-primary"><ChevronRight size={13} className={`transition-transform duration-200 ease-out ${abre ? "rotate-90" : ""}`} /></button>
                    : <span aria-hidden className="w-5 shrink-0" />}
                  {item(cab, secao ? 0 : Math.min(t.nivel - base, 4))}
                </div>
                {filhos.length > 0 && (
                  // Recolher/expandir fluido: a altura anima de 0 até o conteúdo (grid 0fr → 1fr).
                  <div className="grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(.22,1,.36,1)]" style={{ gridTemplateRows: abre ? "1fr" : "0fr", opacity: abre ? 1 : 0 }} {...(abre ? {} : ({ inert: "" } as object))}>
                    <ul className="flex min-h-0 flex-col gap-0.5 overflow-hidden">
                      {filhos.map((k) => <li key={`${titulos[k].linha}-${k}`} className="flex items-center"><span aria-hidden className="w-5 shrink-0" />{item(k, Math.min(titulos[k].nivel - base, 4))}</li>)}
                    </ul>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : <p className="text-sm text-text-muted">Esta nota ainda não tem títulos. Comece uma linha com # para criar um.</p>}
    </aside>
  );
  if (emFocus) return createPortal(conteudo, montagemFocus!);
  return createPortal(
    <div className="fixed bottom-4 left-4 top-12 z-40 w-[min(20rem,calc(100%-2rem))] overflow-y-auto rounded-2xl border border-border bg-base p-5 shadow-nav ecos-fade-in">{conteudo}</div>,
    document.body,
  );
}
