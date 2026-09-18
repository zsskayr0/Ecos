import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink, Minus, Plus } from "lucide-react";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

// Build "legacy" (WebView do Android mais antigo) e worker do próprio bundle — o CSP do app só admite `script-src 'self'`.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const ZOOM_PASSO = 0.25;
// `contentRect` do ResizeObserver já exclui o padding da área de rolagem; sobra só uma folga contra rolagem horizontal por arredondamento.
export const RECUO_LATERAL = 2;

interface Tamanho {
  w: number;
  h: number;
}

/** Renderiza a página só quando ela se aproxima da área visível, e libera o bitmap quando se afasta. */
function PaginaPdf({ pdf, numero, escala, base, raiz }: { pdf: PDFDocumentProxy; numero: number; escala: number; base: Tamanho; raiz: HTMLElement | null }) {
  const caixa = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visivel, setVisivel] = useState(false);
  const [real, setReal] = useState<{ escala: number } & Tamanho | null>(null);

  useEffect(() => {
    const el = caixa.current;
    if (!el || !raiz) return;
    const obs = new IntersectionObserver(([entrada]) => setVisivel(entrada.isIntersecting), { root: raiz, rootMargin: "900px 0px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [raiz]);

  useEffect(() => {
    const c = canvas.current;
    if (!visivel) {
      if (c) { c.width = 0; c.height = 0; }
      return;
    }
    let cancelado = false;
    let tarefa: RenderTask | null = null;
    (async () => {
      const pagina = await pdf.getPage(numero);
      const viewport = pagina.getViewport({ scale: escala });
      if (cancelado || !c) return;
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.floor(viewport.width * dpr);
      c.height = Math.floor(viewport.height * dpr);
      c.style.width = `${viewport.width}px`;
      c.style.height = `${viewport.height}px`;
      setReal({ escala, w: viewport.width, h: viewport.height });
      const ctx = c.getContext("2d");
      if (!ctx) return;
      tarefa = pagina.render({ canvasContext: ctx, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      await tarefa.promise.catch(() => undefined);
    })();
    return () => {
      cancelado = true;
      tarefa?.cancel();
    };
  }, [visivel, pdf, numero, escala]);

  const tamanho = real && real.escala === escala ? real : { w: base.w * escala, h: base.h * escala };
  return (
    <div ref={caixa} data-pagina={numero} className="mx-auto mb-3 bg-white shadow-lg" style={{ width: tamanho.w, height: tamanho.h }}>
      <canvas ref={canvas} aria-label={`Página ${numero}`} className="block" />
    </div>
  );
}

const BOTAO = "flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-3 hover:text-text-primary disabled:opacity-30";

export function PdfReader({ dados, nome, urlExterna, aoMedirPagina }: { dados: ArrayBuffer; nome: string; urlExterna: string; aoMedirPagina?: (primeiraPagina: Tamanho) => void }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [base, setBase] = useState<Tamanho | null>(null);
  const [erro, setErro] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pagina, setPagina] = useState(1);
  const [campoPagina, setCampoPagina] = useState("1");
  const [largura, setLargura] = useState(0);
  const [rolagem, setRolagem] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    let vivo = true;
    setPdf(null);
    setErro(false);
    // `data` é transferido para o worker (o buffer original fica inutilizável) — por isso a cópia.
    const tarefa = pdfjs.getDocument({ data: new Uint8Array(dados.slice(0)), isEvalSupported: false });
    tarefa.promise
      .then(async (doc) => {
        const primeira = await doc.getPage(1);
        const v = primeira.getViewport({ scale: 1 });
        if (!vivo) return;
        setBase({ w: v.width, h: v.height });
        setPdf(doc);
        aoMedirPagina?.({ w: v.width, h: v.height });
      })
      .catch(() => vivo && setErro(true));
    return () => {
      vivo = false;
      void tarefa.destroy();
    };
  }, [dados]);

  useEffect(() => {
    if (!rolagem) return;
    const obs = new ResizeObserver(([e]) => setLargura(e.contentRect.width));
    obs.observe(rolagem);
    return () => obs.disconnect();
  }, [rolagem]);

  useEffect(() => setCampoPagina(String(pagina)), [pagina]);

  function aoRolar() {
    if (!rolagem) return;
    const referencia = rolagem.scrollTop + rolagem.clientHeight / 3;
    let atual = 1;
    for (const el of Array.from(rolagem.querySelectorAll<HTMLElement>("[data-pagina]"))) {
      if (el.offsetTop - rolagem.offsetTop <= referencia) atual = Number(el.dataset.pagina);
      else break;
    }
    setPagina(atual);
  }

  function irParaPagina(n: number) {
    if (!rolagem || !pdf) return;
    const alvo = Math.min(Math.max(1, n), pdf.numPages);
    const el = rolagem.querySelector<HTMLElement>(`[data-pagina="${alvo}"]`);
    if (el) rolagem.scrollTo({ top: el.offsetTop - rolagem.offsetTop - 12 });
  }

  const ajustar = (delta: number) => setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((z + delta) * 100) / 100)));
  const escala = base && largura ? Math.max(0.1, ((largura - RECUO_LATERAL) / base.w) * zoom) : 1;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border bg-surface-1 px-3 py-1.5">
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary" title={nome}>{nome}</p>
        {pdf && (
          <>
            <button type="button" className={BOTAO} aria-label="Página anterior" disabled={pagina <= 1} onClick={() => irParaPagina(pagina - 1)}><ChevronUp size={16} /></button>
            <form className="flex items-center gap-1 text-xs text-text-muted" onSubmit={(e) => { e.preventDefault(); irParaPagina(Number(campoPagina) || 1); }}>
              <input
                value={campoPagina}
                onChange={(e) => setCampoPagina(e.target.value.replace(/\D/g, ""))}
                onBlur={() => setCampoPagina(String(pagina))}
                inputMode="numeric"
                aria-label="Página atual"
                className="h-7 w-10 rounded-md border border-border bg-surface-2 text-center font-mono text-xs text-text-primary outline-none focus:border-steel-400"
              />
              <span className="font-mono">/ {pdf.numPages}</span>
            </form>
            <button type="button" className={BOTAO} aria-label="Próxima página" disabled={pagina >= pdf.numPages} onClick={() => irParaPagina(pagina + 1)}><ChevronDown size={16} /></button>
            <span className="mx-1 h-5 w-px bg-border" />
            <button type="button" className={BOTAO} aria-label="Diminuir zoom" disabled={zoom <= ZOOM_MIN} onClick={() => ajustar(-ZOOM_PASSO)}><Minus size={15} /></button>
            <button type="button" onClick={() => setZoom(1)} title="Ajustar à largura" className="h-8 w-12 rounded-lg font-mono text-xs text-text-secondary hover:bg-surface-3">{Math.round(zoom * 100)}%</button>
            <button type="button" className={BOTAO} aria-label="Aumentar zoom" disabled={zoom >= ZOOM_MAX} onClick={() => ajustar(ZOOM_PASSO)}><Plus size={15} /></button>
          </>
        )}
        <a href={urlExterna} target="_blank" rel="noreferrer" title="Abrir fora do app" aria-label="Abrir fora do app" className={BOTAO}><ExternalLink size={15} /></a>
      </div>

      <div ref={setRolagem} onScroll={aoRolar} className="min-h-0 flex-1 overflow-auto bg-surface-2 px-4 py-4">
        {erro ? (
          <p role="alert" className="py-16 text-center text-sm text-error">Não foi possível ler este PDF. Ele pode estar corrompido ou protegido por senha.</p>
        ) : !pdf || !base ? (
          <p className="py-16 text-center text-sm text-text-muted">Carregando PDF…</p>
        ) : (
          Array.from({ length: pdf.numPages }, (_, i) => <PaginaPdf key={i + 1} pdf={pdf} numero={i + 1} escala={escala} base={base} raiz={rolagem} />)
        )}
      </div>
    </div>
  );
}
