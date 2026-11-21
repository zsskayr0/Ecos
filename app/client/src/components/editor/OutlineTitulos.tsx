import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { EditorView } from "@codemirror/view";
import { areaDeRolagem, rolarAteLinha } from "./sumario-editor";
import { extrairTitulos, numerarTitulos, type TituloNota } from "@/lib/sumario";
import { usePreferenciaNumerar } from "./usePreferenciaNumerar";

interface Props {
  corpo: string;
  /** Editor vivo, quando a nota está em edição; null na leitura (usa os títulos renderizados). */
  view: EditorView | null;
  /** Raiz do editor: a coluna fica colada à borda direita dela. */
  raiz: RefObject<HTMLElement | null>;
}

/** Ancestral com transform/filter: vira o bloco de referência do `position: fixed` (janelas animadas). */
function contexto(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement; p && p !== document.body; p = p.parentElement) {
    const c = getComputedStyle(p);
    if (c.transform !== "none" || c.filter !== "none" || c.perspective !== "none" || c.contain.includes("paint")) return p;
  }
  return null;
}

/** Linha de referência (px abaixo do topo da área que rola) para decidir qual título está "visível". */
const REFERENCIA = 160;

/**
 * Sumário lateral: uma coluna fina de tracinhos (um por título) na borda direita da nota.
 * Ao passar o mouse abre um cartão com a lista; clique salta para o título.
 */
export function OutlineTitulos({ corpo, view, raiz }: Props) {
  const titulos = useMemo(() => extrairTitulos(corpo), [corpo]);
  const numerar = usePreferenciaNumerar();
  const numeros = useMemo(() => (titulos.length ? numerarTitulos(titulos) : []), [titulos]);
  const [ativo, setAtivo] = useState(0);
  const [caixa, setCaixa] = useState<{ alvo: HTMLElement; dx: number; dy: number; esquerda: number; topo: number; altura: number } | null>(null);
  const [aberto, setAberto] = useState(false);
  const fechar = useRef<number>();

  const elementoLeitura = useCallback((t: TituloNota) => raiz.current?.querySelector<HTMLElement>(`h1[data-linha="${t.linha}"],h2[data-linha="${t.linha}"],h3[data-linha="${t.linha}"],h4[data-linha="${t.linha}"],h5[data-linha="${t.linha}"],h6[data-linha="${t.linha}"]`) ?? null, [raiz]);

  const topo = useCallback((t: TituloNota): number | null => {
    if (view) {
      if (t.linha > view.state.doc.lines) return null;
      return view.lineBlockAt(view.state.doc.line(t.linha).from).top + view.documentTop;
    }
    return elementoLeitura(t)?.getBoundingClientRect().top ?? null;
  }, [view, elementoLeitura]);

  useEffect(() => {
    if (titulos.length < 2) return;
    let quadro = 0;
    const medir = () => {
      quadro = 0;
      // Celular: sem coluna lateral (cobriria o texto); o [TOC] cobre a navegação.
      if (window.innerWidth < 640) { setCaixa(null); return; }
      const r = areaDeRolagem(raiz.current)?.getBoundingClientRect();
      const ctx = contexto(raiz.current);
      const o = ctx?.getBoundingClientRect() ?? { left: 0, top: 0 };
      if (r) setCaixa({ alvo: ctx ?? document.body, dx: o.left, dy: o.top, esquerda: Math.min(r.right, window.innerWidth) - 30, topo: Math.max(r.top, 0) + Math.min(r.height, window.innerHeight) * 0.28, altura: Math.min(r.height, window.innerHeight) * 0.5 });
      let atual = 0;
      const ref = Math.max(r?.top ?? 0, 0) + REFERENCIA;
      titulos.forEach((t, i) => { const y = topo(t); if (y !== null && y <= ref) atual = i; });
      setAtivo(atual);
    };
    const agendar = () => { if (!quadro) quadro = requestAnimationFrame(medir); };
    medir();
    window.addEventListener("scroll", agendar, true);
    window.addEventListener("resize", agendar);
    const obs = raiz.current ? new ResizeObserver(agendar) : null;
    if (raiz.current) obs?.observe(raiz.current);
    return () => { window.removeEventListener("scroll", agendar, true); window.removeEventListener("resize", agendar); obs?.disconnect(); if (quadro) cancelAnimationFrame(quadro); };
  }, [titulos, topo, raiz]);

  if (titulos.length < 2 || !caixa) return null;

  const base = Math.min(...titulos.map((t) => t.nivel));
  const saltar = (t: TituloNota) => {
    if (view) {
      rolarAteLinha(view, t.linha);
    } else elementoLeitura(t)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setAberto(false);
  };
  const abrir = () => { window.clearTimeout(fechar.current); setAberto(true); };
  const sair = () => { fechar.current = window.setTimeout(() => setAberto(false), 180); };

  return createPortal(
    <nav aria-label="Sumário da nota" className="fixed z-30" style={{ left: caixa.esquerda - caixa.dx, top: caixa.topo - caixa.dy }} onMouseEnter={abrir} onMouseLeave={sair} onFocus={abrir} onBlur={sair}>
      <div className="flex w-5 flex-col items-end gap-[7px] overflow-hidden py-1" style={{ maxHeight: caixa.altura }}>
        {titulos.map((t, i) => {
          const recuo = Math.min(t.nivel - base, 3);
          return <button key={`${t.linha}-${i}`} type="button" tabIndex={-1} aria-hidden onClick={() => saltar(t)}
            className={`h-[2px] shrink-0 rounded-full transition-all ${i === ativo ? "bg-text-primary" : "bg-text-muted/50"}`}
            style={{ width: i === ativo ? 18 : 14 - recuo * 3 }} />;
        })}
      </div>
      {aberto && (
        <div className="absolute right-full top-[-12px] mr-2 max-h-[60vh] w-72 overflow-y-auto rounded-xl border border-white/10 bg-[#1e1f22] p-2 shadow-2xl ecos-fade-in">
          <ul>
            {titulos.map((t, i) => (
              <li key={`${t.linha}-${i}`}>
                <button type="button" onClick={() => saltar(t)} aria-current={i === ativo ? "location" : undefined}
                  className={`block w-full truncate rounded-lg py-1.5 pr-2 text-left text-[13px] leading-snug hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400 ${i === ativo ? "font-semibold text-white" : "text-white/70"}`}
                  style={{ paddingLeft: 8 + Math.min(t.nivel - base, 4) * 12 }}>
                  {numerar && <span className="mr-1.5 text-white/45">{numeros[i]}</span>}{t.texto || "Sem título"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </nav>,
    caixa.alvo,
  );
}
