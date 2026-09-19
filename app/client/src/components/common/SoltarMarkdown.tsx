import { useRef, useState, type ReactNode } from "react";
import { FileUp } from "lucide-react";
import { ApiError, notas } from "@/lib/api";
import { useRefreshBus } from "@/lib/refresh-bus";

const EXTENSAO_MD = /\.(md|markdown)$/i;
const LIMITE_BYTES = 2 * 1024 * 1024;

const trazArquivos = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

/** Arrastar arquivos `.md` de fora para dentro da tela de Notas importa como nota (na pasta aberta, se houver).
 * O servidor completa o front-matter que faltar e nunca altera o corpo. */
export function SoltarMarkdown({ pasta, children, className }: { pasta?: string; children: ReactNode; className?: string }) {
  const { notificar } = useRefreshBus();
  const [sobre, setSobre] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; erro: boolean } | null>(null);
  const profundidade = useRef(0);

  async function importar(arquivos: File[]) {
    const md = arquivos.filter((a) => EXTENSAO_MD.test(a.name));
    if (!md.length) return setAviso({ texto: "Só arquivos .md podem ser importados aqui.", erro: true });
    let ok = 0;
    const falhas: string[] = [];
    for (const arquivo of md) {
      if (arquivo.size > LIMITE_BYTES) { falhas.push(`${arquivo.name}: maior que 2 MB`); continue; }
      try {
        await notas.importar({ nome: arquivo.name, conteudo: await arquivo.text(), pasta });
        ok++;
      } catch (e) {
        falhas.push(`${arquivo.name}: ${e instanceof ApiError ? e.message : "não foi possível importar"}`);
      }
    }
    if (ok) notificar();
    const outros = arquivos.length - md.length;
    const partes = [ok ? `${ok} ${ok === 1 ? "nota importada" : "notas importadas"}` : "", ...falhas, outros ? `${outros} ignorado(s) (não é .md)` : ""].filter(Boolean);
    setAviso({ texto: partes.join(" · "), erro: falhas.length > 0 && ok === 0 });
    window.setTimeout(() => setAviso(null), 6000);
  }

  return <div className={`relative ${className ?? ""}`}
    onDragEnter={(e) => { if (!trazArquivos(e)) return; e.preventDefault(); profundidade.current++; setSobre(true); }}
    onDragOver={(e) => { if (trazArquivos(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }}
    onDragLeave={(e) => { if (!trazArquivos(e)) return; profundidade.current = Math.max(0, profundidade.current - 1); if (!profundidade.current) setSobre(false); }}
    onDrop={(e) => { if (!trazArquivos(e)) return; e.preventDefault(); profundidade.current = 0; setSobre(false); void importar(Array.from(e.dataTransfer.files)); }}>
    {children}
    {sobre && <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-2xl border-2 border-dashed border-steel-400 bg-surface-1/85 backdrop-blur-sm">
      <p className="flex items-center gap-2 text-sm font-medium text-text-primary"><FileUp size={18} />Solte os arquivos .md para importar{pasta ? " nesta pasta" : ""}</p>
    </div>}
    {aviso && <p role={aviso.erro ? "alert" : "status"} className={`fixed bottom-4 left-1/2 z-40 max-w-[90vw] -translate-x-1/2 rounded-xl border px-4 py-2 text-sm shadow-nav ${aviso.erro ? "border-error/40 bg-surface-1 text-error" : "border-border bg-surface-1 text-text-primary"}`}>{aviso.texto}</p>}
  </div>;
}
