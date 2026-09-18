import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FileText } from "lucide-react";
import { DetailHeader } from "@/components/layout/DetailHeader";
import { PdfReader, RECUO_LATERAL } from "@/components/common/PdfReader";
import { ApiError, media } from "@/lib/api";
import { nomeDoArquivo } from "@/lib/format";
import { useAjustarJanela } from "@/lib/documento-popup";
import { useIsDesktop } from "@/lib/use-viewport";

const IMAGENS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"];

/**
 * Visualizador de arquivos da biblioteca (`/media/ver?c=<caminho>`). Por ser
 * uma rota comum, abre igual a Tarefa/Nota: janela flutuante que arrasta,
 * redimensiona e vira aba no desktop; tela cheia no mobile.
 */
export function FileViewerScreen() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const desktop = useIsDesktop();
  const ajustarJanela = useAjustarJanela();
  const caminho = params.get("c") ?? "";
  const nome = nomeDoArquivo(caminho) || "Arquivo";
  const extensao = nome.includes(".") ? nome.split(".").pop()!.toLowerCase() : "";
  const tipo = extensao === "pdf" ? "pdf" : IMAGENS.includes(extensao) ? "imagem" : "outro";
  const url = caminho ? media.urlArquivo(caminho) : "";

  const [dados, setDados] = useState<ArrayBuffer | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setDados(null);
    setErro(null);
    if (tipo !== "pdf" || !caminho) return;
    let vivo = true;
    media
      .baixar(caminho)
      .then((d) => vivo && setDados(d))
      .catch((e) => vivo && setErro(e instanceof ApiError ? e.message : "Não foi possível abrir o PDF."));
    return () => {
      vivo = false;
    };
  }, [caminho, tipo]);

  const link = <a href={url} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm text-steel-300 underline">Abrir ou baixar arquivo</a>;

  return (
    <div className={`flex h-full flex-col bg-base ${desktop ? "" : "min-h-[70vh]"}`}>
      {!desktop && <DetailHeader onBack={() => navigate(-1)} />}
      <div className="min-h-0 flex-1">
        {!caminho ? (
          <p className="p-10 text-center text-sm text-text-secondary">Nenhum arquivo selecionado.</p>
        ) : tipo === "pdf" ? (
          erro ? (
            <div className="p-10 text-center"><p role="alert" className="text-sm text-error">{erro}</p>{link}</div>
          ) : dados ? (
            <PdfReader
              dados={dados}
              nome={nome}
              urlExterna={url}
              // Barra de ferramentas (46) + padding vertical (32) + margem sob a página (12); padding horizontal (32) + folga do leitor.
              aoMedirPagina={(p) => ajustarJanela?.({ larguraNatural: p.w, alturaNatural: p.h, extraLargura: 32 + RECUO_LATERAL, extraAltura: 46 + 32 + 12, ampliar: 1.3 })}
            />
          ) : (
            <p className="p-10 text-center text-sm text-text-muted">Carregando PDF…</p>
          )
        ) : tipo === "imagem" ? (
          <div className="flex h-full items-center justify-center overflow-auto bg-surface-2 p-3">
            <img
              src={url}
              alt={nome}
              onLoad={(e) => ajustarJanela?.({ larguraNatural: e.currentTarget.naturalWidth || 1, alturaNatural: e.currentTarget.naturalHeight || 1, extraLargura: 24, extraAltura: 24 })}
              className="max-h-full max-w-full rounded-xl object-contain"
            />
          </div>
        ) : (
          <div className="p-12 text-center">
            <FileText size={44} className="mx-auto mb-3 text-steel-300" />
            <p className="text-sm text-text-secondary">Este formato não tem prévia interna.</p>
            {link}
          </div>
        )}
      </div>
    </div>
  );
}
