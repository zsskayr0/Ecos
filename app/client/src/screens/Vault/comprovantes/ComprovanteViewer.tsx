import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, FileText, Minus, Plus, RefreshCw, StretchHorizontal, StretchVertical, X } from "lucide-react";
import { vault } from "@/lib/api";
import { baixarArquivo } from "@/lib/baixar-arquivo";
import { EditorDeLancamento } from "../EditorDeLancamento";
import { exibivelComoImagem, formatarTamanho, useBlobUrl, usePdfDados } from "./use-blob-url";

// O leitor de PDF (pdf.js) é pesado e só é preciso quando se abre um PDF.
const PdfReader = lazy(() => import("@/components/common/PdfReader").then((m) => ({ default: m.PdfReader })));

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const ZOOM_PASSO = 0.25;
const CHAVE_MODO = "ecos.cofre.visualizador.modo";
const BOTAO = "flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-3 hover:text-text-primary disabled:opacity-30";
type ModoImagem = "fixo" | "dinamico";
function lerModo(): ModoImagem {
  try { return localStorage.getItem(CHAVE_MODO) === "dinamico" ? "dinamico" : "fixo"; } catch { return "fixo"; }
}

export interface ArquivoVisto {
  id: string;
  nome_arquivo: string;
  mime_type: string;
  tamanho_bytes: number;
}

/**
 * Visualizador de um comprovante ou nota fiscal. A janela começa do tamanho do próprio arquivo. Imagens e PDF aparecem
 * aqui (o PDF num leitor simples, com páginas, zoom e rolagem); HEIC só é baixado. Com `lancamentoId`, o rodapé ganha um botão que abre o
 * lançamento num painel à direita, na mesma janela, com animação (e fecha de novo no mesmo botão).
 */
export function ComprovanteViewer({ arquivo, onFechar, acoes, lancamentoId, aoMudar, navegacao }: {
  arquivo: ArquivoVisto;
  onFechar: () => void;
  acoes?: React.ReactNode;
  /** Lançamento a que o comprovante pertence; habilita o painel lateral. */
  lancamentoId?: string;
  /** O lançamento foi editado ou apagado pelo painel (a lista por trás precisa recarregar). */
  aoMudar?: () => void;
  /** Vários anexos do mesmo lançamento: setas (e ← →) para passar de um para o outro. */
  navegacao?: { posicao: string; temAnterior: boolean; temProximo: boolean; anterior: () => void; proximo: () => void };
}) {
  const imagem = exibivelComoImagem(arquivo.mime_type);
  const pdf = arquivo.mime_type === "application/pdf";
  const { url, estado, tentarDeNovo } = useBlobUrl(imagem ? arquivo.id : null, () => vault.anexos.conteudo(arquivo.id));
  const doc = usePdfDados(pdf ? arquivo.id : null, () => vault.anexos.conteudo(arquivo.id));
  const [erroDownload, setErroDownload] = useState(false);
  const [painelAberto, setPainelAberto] = useState(false);
  /** O editor só é montado na primeira abertura, mas depois fica montado: fechar o painel anima sem esvaziá-lo. */
  const [jaAbriu, setJaAbriu] = useState(false);
  const fechar = useRef<HTMLButtonElement>(null);
  /** "fixo": a imagem inteira cabe na altura da janela; "dinamico": preenche a largura, com zoom e rolagem (como o PDF). */
  const [modo, setModo] = useState<ModoImagem>(lerModo);
  const [zoom, setZoom] = useState(1);
  const ajustar = (delta: number) => setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((z + delta) * 100) / 100)));
  const janela = useRef<HTMLDivElement>(null);
  const imagemRef = useRef<HTMLImageElement>(null);
  const antes = useRef<{ j: DOMRect; i: DOMRect } | null>(null);
  function alternarModo() {
    const novo: ModoImagem = modo === "fixo" ? "dinamico" : "fixo";
    if (janela.current && imagemRef.current) antes.current = { j: janela.current.getBoundingClientRect(), i: imagemRef.current.getBoundingClientRect() };
    setModo(novo);
    setZoom(1);
    try { localStorage.setItem(CHAVE_MODO, novo); } catch { /* vale só nesta visita */ }
  }

  useEffect(() => {
    fechar.current?.focus();
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Esc fecha primeiro o painel do lançamento; só depois o visualizador.
        if (painelAberto) setPainelAberto(false);
        else onFechar();
        return;
      }
      // Setas passam de um anexo para o outro, mas nunca roubam a seta de quem está digitando.
      if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && navegacao && !painelAberto) {
        const alvo = e.target as HTMLElement | null;
        if (alvo && (alvo.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(alvo.tagName))) return;
        if (e.key === "ArrowLeft" && navegacao.temAnterior) navegacao.anterior();
        if (e.key === "ArrowRight" && navegacao.temProximo) navegacao.proximo();
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [onFechar, painelAberto, navegacao]);

  // Trocar de modo muda o tamanho da janela e da imagem: ambas deslizam do tamanho antigo para o novo.
  useLayoutEffect(() => {
    const a = antes.current;
    antes.current = null;
    const j = janela.current, img = imagemRef.current;
    if (!a || !j || !img || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const opcoes = { duration: 380, easing: "cubic-bezier(.2,.8,.2,1)" };
    const nj = j.getBoundingClientRect(), ni = img.getBoundingClientRect();
    if (Math.abs(a.j.width - nj.width) > 1 || Math.abs(a.j.height - nj.height) > 1) {
      j.animate([{ width: `${a.j.width}px`, height: `${a.j.height}px` }, { width: `${nj.width}px`, height: `${nj.height}px` }], opcoes);
    }
    if (ni.width && ni.height) {
      img.animate([
        { transformOrigin: "0 0", transform: `translate(${a.i.left - ni.left}px, ${a.i.top - ni.top}px) scale(${a.i.width / ni.width}, ${a.i.height / ni.height})` },
        { transformOrigin: "0 0", transform: "none" },
      ], opcoes);
    }
  }, [modo]);

  function alternarPainel() {
    setJaAbriu(true);
    setPainelAberto((v) => !v);
  }

  async function baixar() {
    setErroDownload(false);
    try {
      const blob = await vault.anexos.conteudo(arquivo.id);
      if (!blob) { setErroDownload(true); return; }
      baixarArquivo(blob, arquivo.nome_arquivo);
    } catch {
      setErroDownload(true);
    }
  }

  return (
    <div className="cofre-viewer-backdrop" onClick={onFechar}>
      <div
        ref={janela}
        className="cofre-viewer"
        data-lancamento={lancamentoId ? (painelAberto ? "aberto" : "fechado") : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={`Comprovante ${arquivo.nome_arquivo}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <div>
            <b>{arquivo.nome_arquivo}</b>
            <small>{formatarTamanho(arquivo.tamanho_bytes)}</small>
          </div>
          {navegacao && (
            <span className="cofre-viewer-nav">
              <button className="cofre-icon-button" aria-label="Anexo anterior" disabled={!navegacao.temAnterior} onClick={navegacao.anterior}><ChevronLeft size={18} /></button>
              <small aria-live="polite">{navegacao.posicao}</small>
              <button className="cofre-icon-button" aria-label="Próximo anexo" disabled={!navegacao.temProximo} onClick={navegacao.proximo}><ChevronRight size={18} /></button>
            </span>
          )}
          <button ref={fechar} className="cofre-icon-button" aria-label="Fechar" onClick={onFechar}><X size={18} /></button>
        </header>
        <div className="cofre-viewer-corpo">
          <div className="cofre-viewer-body" data-pdf={pdf || undefined} data-imagem={imagem && estado === "pronto" ? modo : undefined}>
            {imagem && estado === "pronto" && url && (
              <>
                <div className="cofre-viewer-barra">
                  {modo === "dinamico" && (
                    <>
                      <button type="button" className={BOTAO} aria-label="Diminuir zoom" disabled={zoom <= ZOOM_MIN} onClick={() => ajustar(-ZOOM_PASSO)}><Minus size={15} /></button>
                      <button type="button" onClick={() => setZoom(1)} title="Ajustar à largura" className="h-8 w-12 rounded-lg font-mono text-xs text-text-secondary hover:bg-surface-3">{Math.round(zoom * 100)}%</button>
                      <button type="button" className={BOTAO} aria-label="Aumentar zoom" disabled={zoom >= ZOOM_MAX} onClick={() => ajustar(ZOOM_PASSO)}><Plus size={15} /></button>
                      <span className="mx-1 h-5 w-px bg-border" />
                    </>
                  )}
                  <button type="button" className={BOTAO} aria-pressed={modo === "dinamico"} aria-label={modo === "fixo" ? "Preencher a largura, com zoom" : "Ajustar à altura da janela"} title={modo === "fixo" ? "Preencher a largura, com zoom" : "Ajustar à altura da janela"} onClick={alternarModo}>
                    {modo === "fixo" ? <StretchVertical size={16} /> : <StretchHorizontal size={16} />}
                  </button>
                </div>
                <div className="cofre-viewer-imagem" style={{ "--zoom": zoom } as React.CSSProperties}>
                  <img ref={imagemRef} src={url} alt={`Comprovante ${arquivo.nome_arquivo}`} />
                </div>
              </>
            )}
            {imagem && estado === "carregando" && <p role="status">Abrindo comprovante…</p>}
            {imagem && estado === "ausente" && <p role="alert">Este comprovante não existe mais.</p>}
            {imagem && estado === "erro" && (
              <div role="alert" className="cofre-viewer-erro">
                <p>Não foi possível abrir o comprovante.</p>
                <button className="cofre-secondary" onClick={tentarDeNovo}><RefreshCw size={14} />Tentar novamente</button>
              </div>
            )}
            {pdf && doc.estado === "pronto" && doc.dados && (
              <Suspense fallback={<p role="status">Abrindo PDF…</p>}>
                <PdfReader dados={doc.dados} nome={arquivo.nome_arquivo} />
              </Suspense>
            )}
            {pdf && doc.estado === "carregando" && <p role="status">Abrindo comprovante…</p>}
            {pdf && doc.estado === "ausente" && <p role="alert">Este arquivo não existe mais.</p>}
            {pdf && doc.estado === "erro" && (
              <div role="alert" className="cofre-viewer-erro">
                <p>Não foi possível abrir o arquivo.</p>
                <button className="cofre-secondary" onClick={doc.tentarDeNovo}><RefreshCw size={14} />Tentar novamente</button>
              </div>
            )}
            {!imagem && !pdf && (
              <div className="cofre-viewer-erro">
                <FileText size={36} aria-hidden />
                <p>Este formato não pode ser exibido aqui. Use Baixar.</p>
              </div>
            )}
            {erroDownload && <p role="alert">Não foi possível baixar o arquivo. Tente novamente.</p>}
          </div>
          {lancamentoId && (
            <aside
              id="painel-lancamento"
              className="cofre-viewer-lancamento"
              aria-label="Lançamento deste comprovante"
              aria-hidden={!painelAberto}
              {...(painelAberto ? {} : ({ inert: "" } as object))}
            >
              <div className="cofre-viewer-lancamento-miolo">
                {jaAbriu && (
                  <EditorDeLancamento
                    id={lancamentoId}
                    aninhado
                    comComprovantes={false}
                    aoSalvar={() => { aoMudar?.(); setPainelAberto(false); }}
                    aoExcluir={() => { aoMudar?.(); onFechar(); }}
                    aoFechar={() => setPainelAberto(false)}
                  />
                )}
              </div>
            </aside>
          )}
        </div>
        <footer>
          {acoes}
          {lancamentoId && (
            <button className="cofre-secondary cofre-viewer-alternar" aria-expanded={painelAberto} aria-controls="painel-lancamento" onClick={alternarPainel}>
              {painelAberto ? "Ocultar lançamento" : "Abrir lançamento"}<ChevronRight size={15} aria-hidden />
            </button>
          )}
          <button className="cofre-solid" onClick={() => void baixar()}><Download size={15} />Baixar</button>
        </footer>
      </div>
    </div>
  );
}
