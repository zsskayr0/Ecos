import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Download, ExternalLink, FileText, Minus, Plus, Maximize, X } from "lucide-react";

export interface ItemVisualizador {
  nome: string;
  url: string;
  /** Imagem (a referência no texto começa com `!`). */
  imagem: boolean;
}

const eImagem = (i: ItemVisualizador) => i.imagem || /\.(png|jpe?g|gif|webp|bmp|svg|avif)(\?|$)/i.test(i.nome);
const ePdf = (i: ItemVisualizador) => /\.pdf(\?|$)/i.test(i.nome);
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 6;

const BTN = "flex h-8 w-8 items-center justify-center rounded-lg text-white/75 transition-colors hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/60";

/**
 * Visualizador compacto dos anexos de uma nota ou tarefa: imagem com zoom e arraste, PDF embutido, setas (e ←/→) para
 * passar de um anexo ao outro, abrir em outra aba e baixar. Esc fecha só o visualizador, não a janela por baixo.
 */
export function VisualizadorDeAnexos({ itens, inicial = 0, onFechar }: { itens: ItemVisualizador[]; inicial?: number; onFechar: () => void }) {
  const [indice, setIndice] = useState(Math.max(0, Math.min(inicial, itens.length - 1)));
  const [zoom, setZoom] = useState(1);
  const [deslocamento, setDeslocamento] = useState({ x: 0, y: 0 });
  const [falhou, setFalhou] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const arraste = useRef<{ x: number; y: number; origem: { x: number; y: number } } | null>(null);
  const item = itens[indice];

  const ajustar = useCallback(() => { setZoom(1); setDeslocamento({ x: 0, y: 0 }); }, []);
  const ir = useCallback((delta: number) => {
    setIndice((i) => Math.max(0, Math.min(itens.length - 1, i + delta)));
    ajustar();
    setFalhou(false);
  }, [itens.length, ajustar]);
  const dar = useCallback((fator: number) => setZoom((z) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, +(z * fator).toFixed(3)))), []);

  useEffect(() => { raiz.current?.focus(); }, []);
  if (!item) return null;
  const imagem = eImagem(item);
  const pdf = ePdf(item);

  function aoTeclar(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onFechar(); return; }
    if (e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); ir(-1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); ir(1); }
    else if (imagem && (e.key === "+" || e.key === "=")) { e.preventDefault(); dar(1.25); }
    else if (imagem && e.key === "-") { e.preventDefault(); dar(0.8); }
    else if (imagem && e.key === "0") { e.preventDefault(); ajustar(); }
  }

  return createPortal(
    <div ref={raiz} role="dialog" aria-modal="true" aria-label={`Anexo ${item.nome}`} tabIndex={-1} onKeyDown={aoTeclar}
      className="ecos-backdrop-in fixed inset-0 z-[300] flex flex-col bg-black/80 backdrop-blur-md outline-none">
      <header className="flex shrink-0 items-center gap-1 px-3 py-2 text-white">
        <FileText size={15} className="shrink-0 text-white/60" aria-hidden />
        <p className="min-w-0 flex-1 truncate px-1 text-sm font-medium" title={item.nome}>{item.nome}</p>
        {itens.length > 1 && <span className="px-2 text-xs tabular-nums text-white/60" aria-live="polite">{indice + 1} de {itens.length}</span>}
        {imagem && <>
          <button type="button" className={BTN} aria-label="Diminuir zoom" title="Diminuir (-)" onClick={() => dar(0.8)} disabled={zoom <= ZOOM_MIN}><Minus size={16} /></button>
          <button type="button" className="min-w-12 rounded-lg px-1 text-xs tabular-nums text-white/75 hover:bg-white/10 hover:text-white" aria-label="Ajustar à tela" title="Ajustar (0)" onClick={ajustar}>{Math.round(zoom * 100)}%</button>
          <button type="button" className={BTN} aria-label="Aumentar zoom" title="Aumentar (+)" onClick={() => dar(1.25)} disabled={zoom >= ZOOM_MAX}><Plus size={16} /></button>
          <button type="button" className={BTN} aria-label="Tamanho da tela" title="Ajustar à tela" onClick={ajustar}><Maximize size={15} /></button>
          <span aria-hidden className="mx-1 h-4 w-px bg-white/20" />
        </>}
        <a className={BTN} href={item.url} target="_blank" rel="noreferrer" aria-label="Abrir em outra aba" title="Abrir em outra aba"><ExternalLink size={15} /></a>
        <a className={BTN} href={item.url} download={item.nome} aria-label="Baixar" title="Baixar"><Download size={15} /></a>
        <button type="button" className={BTN} aria-label="Fechar visualizador" title="Fechar (Esc)" onClick={onFechar}><X size={17} /></button>
      </header>

      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-14 pb-6"
        onClick={(e) => { if (e.target === e.currentTarget) onFechar(); }}
        onWheel={imagem ? (e) => { dar(e.deltaY < 0 ? 1.12 : 1 / 1.12); } : undefined}>
        {imagem && !falhou ? (
          <img key={item.url} src={item.url} alt={item.nome} draggable={false} onError={() => setFalhou(true)} onDoubleClick={() => (zoom === 1 ? dar(2.5) : ajustar())}
            onPointerDown={(e) => { if (zoom <= 1) return; e.currentTarget.setPointerCapture(e.pointerId); arraste.current = { x: e.clientX, y: e.clientY, origem: deslocamento }; }}
            onPointerMove={(e) => { const a = arraste.current; if (a) setDeslocamento({ x: a.origem.x + e.clientX - a.x, y: a.origem.y + e.clientY - a.y }); }}
            onPointerUp={() => { arraste.current = null; }}
            className={`max-h-full max-w-full select-none rounded-lg object-contain shadow-2xl ${zoom > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"}`}
            style={{ transform: `translate(${deslocamento.x}px, ${deslocamento.y}px) scale(${zoom})`, transition: arraste.current ? "none" : "transform 140ms ease-out", touchAction: "none" }} />
        ) : pdf ? (
          <iframe key={item.url} title={item.nome} src={item.url} className="h-full w-full max-w-5xl rounded-lg bg-white" />
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/15 bg-white/5 px-10 py-8 text-center text-white">
            <FileText size={44} className="text-white/60" aria-hidden />
            <p className="max-w-xs break-all text-sm font-medium">{item.nome}</p>
            <p className="text-xs text-white/60">{falhou ? "Não foi possível mostrar a imagem." : "Sem pré-visualização para este tipo de arquivo."}</p>
            <a href={item.url} download={item.nome} className="mt-1 flex min-h-10 items-center gap-2 rounded-lg bg-white/15 px-4 text-sm font-medium hover:bg-white/25"><Download size={15} />Baixar</a>
          </div>
        )}

        {itens.length > 1 && <>
          <button type="button" className={`${BTN} absolute left-3 top-1/2 h-11 w-11 -translate-y-1/2 bg-black/40`} aria-label="Anexo anterior" onClick={() => ir(-1)} disabled={indice === 0}><ChevronLeft size={22} /></button>
          <button type="button" className={`${BTN} absolute right-3 top-1/2 h-11 w-11 -translate-y-1/2 bg-black/40`} aria-label="Próximo anexo" onClick={() => ir(1)} disabled={indice === itens.length - 1}><ChevronRight size={22} /></button>
        </>}
      </div>
    </div>,
    document.body,
  );
}
