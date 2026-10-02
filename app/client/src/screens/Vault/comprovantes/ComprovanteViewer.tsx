import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, FileText, RefreshCw, X } from "lucide-react";
import { vault } from "@/lib/api";
import { baixarArquivo } from "@/lib/baixar-arquivo";
import { EditorDeLancamento } from "../EditorDeLancamento";
import { exibivelComoImagem, formatarTamanho, useBlobUrl } from "./use-blob-url";

export interface ArquivoVisto {
  id: string;
  nome_arquivo: string;
  mime_type: string;
  tamanho_bytes: number;
}

/**
 * Visualizador de um comprovante. A janela começa do tamanho do próprio comprovante. Imagens aparecem aqui; PDF e HEIC
 * só são baixados (o app não abre documentos embutidos). Com `lancamentoId`, o rodapé ganha um botão que abre o
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
  const { url, estado, tentarDeNovo } = useBlobUrl(imagem ? arquivo.id : null, () => vault.anexos.conteudo(arquivo.id));
  const [erroDownload, setErroDownload] = useState(false);
  const [painelAberto, setPainelAberto] = useState(false);
  /** O editor só é montado na primeira abertura, mas depois fica montado: fechar o painel anima sem esvaziá-lo. */
  const [jaAbriu, setJaAbriu] = useState(false);
  const fechar = useRef<HTMLButtonElement>(null);

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
          <div className="cofre-viewer-body">
            {imagem && estado === "pronto" && url && <img src={url} alt={`Comprovante ${arquivo.nome_arquivo}`} />}
            {imagem && estado === "carregando" && <p role="status">Abrindo comprovante…</p>}
            {imagem && estado === "ausente" && <p role="alert">Este comprovante não existe mais.</p>}
            {imagem && estado === "erro" && (
              <div role="alert" className="cofre-viewer-erro">
                <p>Não foi possível abrir o comprovante.</p>
                <button className="cofre-secondary" onClick={tentarDeNovo}><RefreshCw size={14} />Tentar novamente</button>
              </div>
            )}
            {!imagem && (
              <div className="cofre-viewer-erro">
                <FileText size={36} aria-hidden />
                <p>{arquivo.mime_type === "application/pdf" ? "Documentos PDF são abertos fora do Ecos. Use Baixar." : "Este formato não pode ser exibido aqui. Use Baixar."}</p>
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
