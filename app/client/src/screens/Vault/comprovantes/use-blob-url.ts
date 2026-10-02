import { useEffect, useState } from "react";

export type EstadoBlob = "carregando" | "pronto" | "ausente" | "erro";

/** Baixa um arquivo autenticado e o expõe como `blob:` URL; revoga ao trocar de arquivo ou desmontar. */
export function useBlobUrl(chave: string | null, carregar: () => Promise<Blob | null>) {
  const [estado, setEstado] = useState<EstadoBlob>("carregando");
  const [url, setUrl] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    if (!chave) return;
    let vivo = true;
    let criada: string | null = null;
    setEstado("carregando");
    setUrl(null);
    carregar()
      .then((blob) => {
        if (!vivo) return;
        if (!blob) { setEstado("ausente"); return; }
        criada = URL.createObjectURL(blob);
        setUrl(criada);
        setEstado("pronto");
      })
      .catch(() => { if (vivo) setEstado("erro"); });
    return () => {
      vivo = false;
      if (criada) URL.revokeObjectURL(criada);
    };
    // `carregar` muda a cada render do chamador; a identidade do arquivo é `chave`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, tentativa]);

  return { url, estado, tentarDeNovo: () => setTentativa((n) => n + 1) };
}

/** O que o WebView do Cofre consegue desenhar numa `<img>`; o resto (PDF, HEIC) é só baixar. */
export const exibivelComoImagem = (mime: string) => ["image/jpeg", "image/png", "image/webp"].includes(mime);

export function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}
