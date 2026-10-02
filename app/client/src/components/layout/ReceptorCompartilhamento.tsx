import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ImagePlus } from "lucide-react";
import { ApiError, media } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useCompartilhados } from "@/lib/compartilhar";
import { enfileirarComprovantes } from "@/lib/fila-comprovantes";
import { useAppUI } from "@/lib/ui-context";

type Aviso = { tipo: "enviando" | "erro"; texto: string };

/**
 * Arquivos compartilhados com o Ecos pelo menu do Android. O menu tem dois destinos:
 * - "Ecos": abre uma nota nova (título em foco, pronto pra digitar), sobe cada imagem pra biblioteca e entrega a
 *   referência Markdown pra captura, que a coloca no corpo;
 * - "Ecos Cofre": o arquivo (imagem ou PDF) vai para a fila de comprovantes e o Cofre abre na aba Comprovantes. Se o
 *   Cofre estiver trancado, a pessoa vê a tela de senha primeiro e o arquivo espera em memória até o desbloqueio.
 * Só existe logado — sem sessão os arquivos ficam à espera no lado nativo até o login.
 */
export function ReceptorCompartilhamento() {
  const { capturaAberta, trocarTipoCaptura, empilharAnexosDeCaptura, espacoAtivo } = useAppUI();
  const { perfil } = useAuth();
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const capturaRef = useRef(capturaAberta);
  capturaRef.current = capturaAberta;
  const perfilRef = useRef(perfil);
  perfilRef.current = perfil;

  function receberNoCofre(arquivos: File[]) {
    if (perfilRef.current && !perfilRef.current.cofre_ativado) {
      setAviso({ tipo: "erro", texto: "O Cofre não está ativado nesta conta. Ative-o nas configurações do Ecos e compartilhe de novo." });
      return;
    }
    enfileirarComprovantes(arquivos);
    window.dispatchEvent(new CustomEvent("ecos:abrir-cofre", { detail: "/cofre/comprovantes" }));
  }

  async function receberEmNota(arquivos: File[]) {
    // Já digitando uma nota ou tarefa: a imagem entra nela. Senão, começa uma nota nova.
    if (capturaRef.current !== "nota" && capturaRef.current !== "tarefa") trocarTipoCaptura("nota");
    setAviso({ tipo: "enviando", texto: arquivos.length === 1 ? "Anexando a imagem…" : `Anexando ${arquivos.length} imagens…` });
    let falhas = 0;
    let ultimoErro = "";
    for (const arquivo of arquivos) {
      try {
        const item = await media.enviar(arquivo, espacoAtivo);
        empilharAnexosDeCaptura([media.referencia(item)]);
      } catch (e) {
        falhas += 1;
        ultimoErro = e instanceof ApiError ? e.message : "Não foi possível enviar a imagem. O ecos-app está acessível?";
      }
    }
    setAviso(falhas ? { tipo: "erro", texto: falhas === arquivos.length ? ultimoErro : `${falhas} de ${arquivos.length} imagens não foram enviadas.` } : null);
  }

  useCompartilhados(async (itens) => {
    const doCofre = itens.filter((i) => i.destino === "cofre").map((i) => i.arquivo);
    const deNota = itens.filter((i) => i.destino === "nota").map((i) => i.arquivo);
    if (doCofre.length) receberNoCofre(doCofre);
    if (deNota.length) await receberEmNota(deNota);
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
      className={`fixed inset-x-4 bottom-[calc(var(--ecos-safe-bottom)+5.5rem)] z-[120] mx-auto flex w-fit max-w-full items-center gap-2 rounded-xl border bg-surface-raised px-4 py-3 text-sm font-medium shadow-nav ${
        erro ? "border-error/40 text-error" : "border-steel-500/30 text-text-primary"
      }`}
    >
      {erro ? <AlertTriangle size={16} className="shrink-0" /> : <ImagePlus size={16} className="shrink-0 text-steel-300" />}
      {aviso.texto}
    </div>
  );
}
