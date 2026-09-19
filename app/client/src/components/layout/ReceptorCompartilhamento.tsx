import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ImagePlus } from "lucide-react";
import { ApiError, media } from "@/lib/api";
import { useImagensCompartilhadas } from "@/lib/compartilhar";
import { useAppUI } from "@/lib/ui-context";

type Aviso = { tipo: "enviando" | "erro"; texto: string };

/**
 * Imagens compartilhadas com o Ecos pelo menu do Android: abre uma nota nova (título em foco, pronto pra digitar),
 * sobe cada imagem pra biblioteca e entrega a referência Markdown pra captura, que a coloca no corpo. Só existe
 * logado — sem sessão as imagens ficam à espera no lado nativo até o login.
 */
export function ReceptorCompartilhamento() {
  const { capturaAberta, trocarTipoCaptura, empilharAnexosDeCaptura } = useAppUI();
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const capturaRef = useRef(capturaAberta);
  capturaRef.current = capturaAberta;

  useImagensCompartilhadas(async (arquivos) => {
    // Já digitando uma nota ou tarefa: a imagem entra nela. Senão, começa uma nota nova.
    if (capturaRef.current !== "nota" && capturaRef.current !== "tarefa") trocarTipoCaptura("nota");
    setAviso({ tipo: "enviando", texto: arquivos.length === 1 ? "Anexando a imagem…" : `Anexando ${arquivos.length} imagens…` });
    let falhas = 0;
    let ultimoErro = "";
    for (const arquivo of arquivos) {
      try {
        const item = await media.enviar(arquivo);
        empilharAnexosDeCaptura([media.referencia(item)]);
      } catch (e) {
        falhas += 1;
        ultimoErro = e instanceof ApiError ? e.message : "Não foi possível enviar a imagem. O ecos-app está acessível?";
      }
    }
    setAviso(falhas ? { tipo: "erro", texto: falhas === arquivos.length ? ultimoErro : `${falhas} de ${arquivos.length} imagens não foram enviadas.` } : null);
  });

  useEffect(() => {
    if (aviso?.tipo !== "erro") return;
    const t = window.setTimeout(() => setAviso(null), 6000);
    return () => window.clearTimeout(t);
  }, [aviso]);

  if (!aviso) return null;
  const erro = aviso.tipo === "erro";
  return (
    <div
      role={erro ? "alert" : "status"}
      className={`fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-[120] mx-auto flex w-fit max-w-full items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium shadow-nav ${
        erro ? "border-error/40 bg-error/10 text-error" : "border-steel-500/30 bg-surface-raised text-text-primary"
      }`}
    >
      {erro ? <AlertTriangle size={16} className="shrink-0" /> : <ImagePlus size={16} className="shrink-0 text-steel-300" />}
      {aviso.texto}
    </div>
  );
}
