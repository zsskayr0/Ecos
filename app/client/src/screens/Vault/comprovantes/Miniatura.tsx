import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { vault } from "@/lib/api";
import { exibivelComoImagem, useBlobUrl } from "./use-blob-url";

/** Carrega a imagem só quando o quadro aparece na tela; sem imagem possível (PDF, HEIC), mostra um ícone de documento. */
export function Miniatura({ mime, carregar, chave, habilitada, className = "cofre-comprovante-thumb" }: {
  mime: string;
  carregar: () => Promise<Blob | null>;
  chave: string;
  habilitada: boolean;
  className?: string;
}) {
  const [visivel, setVisivel] = useState(false);
  const [alvo, setAlvo] = useState<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!habilitada || !alvo) return;
    if (typeof IntersectionObserver === "undefined") { setVisivel(true); return; }
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisivel(true); obs.disconnect(); } }, { rootMargin: "120px" });
    obs.observe(alvo);
    return () => obs.disconnect();
  }, [habilitada, alvo]);
  const { url, estado } = useBlobUrl(habilitada && visivel ? chave : null, carregar);
  return (
    <span className={className} ref={setAlvo} data-mime={mime}>
      {estado === "pronto" && url ? <img src={url} alt="" /> : <FileText size={28} aria-hidden />}
    </span>
  );
}

/** Miniatura de um anexo: a do servidor; se ainda não existir (anexo antigo), a própria imagem. */
export function MiniaturaDoAnexo({ id, mime }: { id: string; mime: string }) {
  const imagem = exibivelComoImagem(mime);
  const carregar = async () => (await vault.anexos.miniatura(id)) ?? (imagem ? vault.anexos.conteudo(id) : null);
  return <Miniatura mime={mime} carregar={carregar} chave={`anexo-${id}`} habilitada={imagem} />;
}
