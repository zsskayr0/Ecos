import { useEffect, useRef, useState, type ReactNode } from "react";
import { FileUp } from "lucide-react";
import { EXTENSAO_IMPORTAVEL, importarArquivoComoNota } from "@/lib/importar-nota";
import { useRefreshBus } from "@/lib/refresh-bus";

import { mensagemDeErro } from "@/lib/erros";
const EXTENSAO_MD = EXTENSAO_IMPORTAVEL;
const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
/** Botão "Importar" do cabeçalho: escolhe arquivos e entrega à `SoltarMarkdown` da tela por este evento. */
export const EVENTO_IMPORTAR_NOTAS = "ecos:importar-notas";

const trazArquivos = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
/** Durante o arrasto só o tipo de cada item é conhecido. PDF e imagem não são notas: ficam para o Cofre (`SoltarNoCofre`). */
const podeSerMarkdown = (e: React.DragEvent) => {
  const itens = Array.from(e.dataTransfer.items ?? []).filter((i) => i.kind === "file");
  return itens.length === 0 || itens.some((i) => !i.type || i.type.startsWith("text/") || i.type === MIME_DOCX);
};

/** Arrastar arquivos `.md` de fora para dentro da tela de Notas importa como nota (na pasta aberta, se houver).
 * O servidor completa o front-matter que faltar e nunca altera o corpo. */
export function SoltarMarkdown({ pasta, children, className }: { pasta?: string; children: ReactNode; className?: string }) {
  const { notificar } = useRefreshBus();
  const [sobre, setSobre] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; erro: boolean } | null>(null);
  const profundidade = useRef(0);

  async function importar(arquivos: File[]) {
    const md = arquivos.filter((a) => EXTENSAO_MD.test(a.name));
    if (!md.length) { setAviso({ texto: "Só arquivos .md e .docx podem ser importados aqui.", erro: true }); window.setTimeout(() => setAviso(null), 6000); return; }
    let ok = 0;
    const falhas: string[] = [];
    for (const arquivo of md) {
      try {
        await importarArquivoComoNota(arquivo, pasta);
        ok++;
      } catch (e) {
        falhas.push(`${arquivo.name}: ${mensagemDeErro(e, "não foi possível importar")}`);
      }
    }
    if (ok) notificar();
    const outros = arquivos.length - md.length;
    const partes = [ok ? `${ok} ${ok === 1 ? "nota importada" : "notas importadas"}` : "", ...falhas, outros ? `${outros} ignorado(s) (não é .md nem .docx)` : ""].filter(Boolean);
    setAviso({ texto: partes.join(" · "), erro: falhas.length > 0 && ok === 0 });
    window.setTimeout(() => setAviso(null), 6000);
  }

  const importarRef = useRef(importar);
  importarRef.current = importar;
  useEffect(() => {
    const ouvir = (e: Event) => { const arquivos = (e as CustomEvent<File[]>).detail; if (arquivos?.length) void importarRef.current(arquivos); };
    window.addEventListener(EVENTO_IMPORTAR_NOTAS, ouvir);
    return () => window.removeEventListener(EVENTO_IMPORTAR_NOTAS, ouvir);
  }, []);

  return <div className={`relative ${className ?? ""}`}
    onDragEnter={(e) => { if (!trazArquivos(e) || !podeSerMarkdown(e)) return; e.preventDefault(); profundidade.current++; setSobre(true); }}
    onDragOver={(e) => { if (trazArquivos(e) && podeSerMarkdown(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }}
    onDragLeave={(e) => { if (!trazArquivos(e)) return; profundidade.current = Math.max(0, profundidade.current - 1); if (!profundidade.current) setSobre(false); }}
    onDrop={(e) => {
      if (!trazArquivos(e)) return;
      profundidade.current = 0;
      setSobre(false);
      const arquivos = Array.from(e.dataTransfer.files);
      // Nenhum .md: não é conosco. Sem preventDefault, o evento segue e o Cofre pode ficar com o arquivo.
      if (!arquivos.some((a) => EXTENSAO_MD.test(a.name))) return;
      e.preventDefault();
      void importar(arquivos);
    }}>
    {children}
    {sobre && <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-2xl border-2 border-dashed border-steel-400 bg-surface-1/85 backdrop-blur-sm">
      <p className="flex items-center gap-2 text-sm font-medium text-text-primary"><FileUp size={18} />Solte os arquivos .md ou .docx para importar{pasta ? " nesta pasta" : ""}</p>
    </div>}
    {aviso && <p role={aviso.erro ? "alert" : "status"} className={`fixed bottom-4 left-1/2 z-40 max-w-[90vw] -translate-x-1/2 rounded-xl border px-4 py-2 text-sm shadow-nav ${aviso.erro ? "border-error/40 bg-surface-1 text-error" : "border-border bg-surface-1 text-text-primary"}`}>{aviso.texto}</p>}
  </div>;
}

/** Abre o seletor de arquivos (.md, .docx) e importa cada um como nota na tela aberta. */
export function BotaoImportarNotas() {
  const entrada = useRef<HTMLInputElement>(null);
  return <>
    <button type="button" onClick={() => entrada.current?.click()} title="Importar arquivos .md ou .docx como notas" className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-text-muted hover:bg-surface-2 hover:text-text-primary"><FileUp size={14} />Importar</button>
    <input ref={entrada} type="file" multiple accept=".md,.markdown,.docx,text/markdown" className="hidden" aria-hidden tabIndex={-1}
      onChange={(e) => { const arquivos = Array.from(e.target.files ?? []); e.target.value = ""; if (arquivos.length) window.dispatchEvent(new CustomEvent(EVENTO_IMPORTAR_NOTAS, { detail: arquivos })); }} />
  </>;
}
