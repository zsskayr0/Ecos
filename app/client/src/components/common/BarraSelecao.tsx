import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface Props {
  /** Só aparece com algo selecionado. */
  aberta: boolean;
  rotulo: string;
  children: ReactNode;
}

/**
 * Barra flutuante de ações para vários itens: fica centrada na horizontal, no pé da área de conteúdo onde a seleção
 * acontece (não da janela, que no desktop inclui o menu lateral), e só existe enquanto há itens selecionados.
 */
export function BarraSelecao({ aberta, rotulo, children }: Props) {
  const ancora = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; baixo: number } | null>(null);

  useLayoutEffect(() => {
    if (!aberta) { setPos(null); return; }
    const area = ancora.current?.closest<HTMLElement>("[data-pane-conteudo], main, [data-aba-tarefa]") ?? null;
    const medir = () => {
      const r = area?.getBoundingClientRect();
      setPos(r ? { x: r.left + r.width / 2, baixo: Math.max(16, window.innerHeight - r.bottom + 20) } : { x: window.innerWidth / 2, baixo: 24 });
    };
    medir();
    window.addEventListener("resize", medir);
    const ro = area && typeof ResizeObserver !== "undefined" ? new ResizeObserver(medir) : null;
    if (area) ro?.observe(area);
    return () => { window.removeEventListener("resize", medir); ro?.disconnect(); };
  }, [aberta]);

  // Janela de documento, diálogo ou menu aberto por cima: a barra se esconde (e não recebe cliques) até eles fecharem.
  const [coberta, setCoberta] = useState(false);
  useEffect(() => {
    if (!aberta) { setCoberta(false); return; }
    let quadro = 0;
    const checar = () => { quadro = 0; setCoberta(!!document.querySelector(".ecos-documento-camada > *, [role=dialog], [role=menu]")); };
    const agendar = () => { if (!quadro) quadro = requestAnimationFrame(checar); };
    checar();
    const mo = new MutationObserver(agendar);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => { mo.disconnect(); if (quadro) cancelAnimationFrame(quadro); };
  }, [aberta]);

  return (
    <>
      <span ref={ancora} aria-hidden className="hidden" />
      {aberta && pos && createPortal(
        <div style={{ left: pos.x, bottom: pos.baixo }} className={`pointer-events-none fixed z-40 -translate-x-1/2 transition-opacity duration-150 ${coberta ? "invisible opacity-0" : "opacity-100"}`} aria-hidden={coberta || undefined}>
          <div role="toolbar" aria-label={rotulo} className="ecos-fade-in pointer-events-auto flex max-w-[calc(100vw-32px)] flex-wrap items-center gap-1.5 rounded-xl border border-border bg-surface-2 p-1.5 shadow-nav">
            {children}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
