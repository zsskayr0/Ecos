import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ShieldHalf } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { enfileirarComprovantes } from "@/lib/fila-comprovantes";
import { ehArquivoDoCofre, TIPOS_DO_COFRE } from "@/lib/tipos-comprovante";

export { ehArquivoDoCofre };

/** Enquanto o arquivo está sendo arrastado por cima da janela, `dragover` dispara várias vezes por segundo; sem ele, a pessoa saiu. */
const SILENCIO_MS = 400;

const trazArquivos = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

/** Durante o arrasto só se conhece o tipo de cada item (não o nome). Sem informação, assume que pode ser aceito. */
function talvezAceito(e: DragEvent): boolean {
  const itens = Array.from(e.dataTransfer?.items ?? []).filter((i) => i.kind === "file");
  return itens.length === 0 || itens.some((i) => !i.type || TIPOS_DO_COFRE.includes(i.type));
}

type Aviso = { texto: string; erro: boolean };

/**
 * Soltar um arquivo em **qualquer ponto** da janela do Ecos guarda o comprovante no Cofre: os arquivos entram na fila
 * (memória) e o Cofre abre na aba Comprovantes, onde o primeiro vai para revisão. Soltar `.md` nas telas de Notas
 * continua importando nota (`SoltarMarkdown` responde primeiro e este componente respeita). Só existe no desktop.
 */
export function SoltarNoCofre() {
  const { perfil } = useAuth();
  const perfilRef = useRef(perfil);
  perfilRef.current = perfil;
  const [visivel, setVisivel] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const avisoTimer = useRef<number | undefined>(undefined);

  function mostrarAviso(a: Aviso) {
    setAviso(a);
    window.clearTimeout(avisoTimer.current);
    avisoTimer.current = window.setTimeout(() => setAviso(null), 6000);
  }

  useEffect(() => {
    const esconder = () => { window.clearTimeout(timer.current); setVisivel(false); };

    const aoArrastar = (e: DragEvent) => {
      // Quem já tratou (importação de .md, por exemplo) fica com o evento.
      if (!trazArquivos(e) || e.defaultPrevented) return;
      if (!talvezAceito(e)) return; // sem preventDefault: o cursor mostra "não pode soltar aqui" e nada acontece
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      setVisivel(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setVisivel(false), SILENCIO_MS);
    };

    const aoSoltar = (e: DragEvent) => {
      if (!trazArquivos(e)) return;
      esconder();
      if (e.defaultPrevented) return;
      // Sempre impede o comportamento padrão: sem isso o WebView abriria o arquivo no lugar do app.
      e.preventDefault();
      const arquivos = Array.from(e.dataTransfer?.files ?? []);
      if (perfilRef.current && !perfilRef.current.cofre_ativado) {
        mostrarAviso({ texto: "O Cofre não está ativado nesta conta. Ative-o nas configurações do Ecos para guardar comprovantes.", erro: true });
        return;
      }
      const aceitos = arquivos.filter(ehArquivoDoCofre);
      if (!aceitos.length) {
        mostrarAviso({ texto: "Só PDF e imagens (JPEG, PNG, WebP ou HEIC) vão para o Cofre.", erro: true });
        return;
      }
      enfileirarComprovantes(aceitos);
      const ignorados = arquivos.length - aceitos.length;
      if (ignorados) mostrarAviso({ texto: `${ignorados} ${ignorados === 1 ? "arquivo ignorado" : "arquivos ignorados"}: só PDF e imagens vão para o Cofre.`, erro: false });
    };

    window.addEventListener("dragenter", aoArrastar);
    window.addEventListener("dragover", aoArrastar);
    window.addEventListener("drop", aoSoltar);
    window.addEventListener("dragend", esconder);
    window.addEventListener("blur", esconder);
    return () => {
      window.removeEventListener("dragenter", aoArrastar);
      window.removeEventListener("dragover", aoArrastar);
      window.removeEventListener("drop", aoSoltar);
      window.removeEventListener("dragend", esconder);
      window.removeEventListener("blur", esconder);
      window.clearTimeout(timer.current);
      window.clearTimeout(avisoTimer.current);
    };
  }, []);

  return (
    <>
      {visivel && (
        <div role="status" className="pointer-events-none fixed inset-0 z-[200] flex items-center justify-center bg-surface-1/80 p-6 backdrop-blur-sm">
          <div className="flex max-w-sm flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-steel-400 bg-surface-raised px-10 py-8 text-center shadow-nav">
            <ShieldHalf size={30} className="text-steel-300" aria-hidden />
            <p className="text-base font-semibold text-text-primary">Solte para guardar no Cofre</p>
            <p className="text-xs text-text-secondary">PDF, JPEG, PNG, WebP ou HEIC · até 8 MB cada</p>
          </div>
        </div>
      )}
      {aviso && (
        <p
          role={aviso.erro ? "alert" : "status"}
          className={`fixed bottom-4 left-1/2 z-[210] flex max-w-[90vw] -translate-x-1/2 items-center gap-2 rounded-xl border bg-surface-raised px-4 py-2 text-sm shadow-nav ${aviso.erro ? "border-error/40 text-error" : "border-steel-500/30 text-text-primary"}`}
        >
          {aviso.erro && <AlertTriangle size={16} className="shrink-0" aria-hidden />}
          {aviso.texto}
        </p>
      )}
    </>
  );
}
