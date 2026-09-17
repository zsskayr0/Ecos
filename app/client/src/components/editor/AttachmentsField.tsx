import { useRef, useState } from "react";
import { FileText, Paperclip, X } from "lucide-react";
import { ApiError, media, notas, tarefas } from "@/lib/api";

interface Props {
  corpo: string;
  onCorpoChange: (corpo: string) => void;
  itemId?: string;
  tipo: "nota" | "tarefa";
  onBusyChange?: (ocupado: boolean) => void;
  compact?: boolean;
  disabled?: boolean;
}

/** Um único controle de anexos para criação e edição. O Markdown mantém a
 * associação; a biblioteca global guarda o arquivo antes do primeiro save. */
export function AttachmentsField(props: Props) {
  const atual = useRef(props);
  atual.current = props;
  const input = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [arquivoFalhou, setArquivoFalhou] = useState<File | null>(null);
  const anexos = [...props.corpo.matchAll(/(!?)\[([^\]]*)\]\(((?:src\/Media\/|_anexos\/)[^)]+)\)/g)];

  async function enviar(arquivo: File) {
    if (enviando || props.disabled) return;
    if (arquivo.size > 120 * 1024 * 1024) {
      setErro("O arquivo excede o limite de 120 MB. Escolha um arquivo menor.");
      setArquivoFalhou(null);
      return;
    }
    setEnviando(true);
    setErro(null);
    atual.current.onBusyChange?.(true);
    try {
      const item = await media.enviar(arquivo);
      const { corpo, onCorpoChange } = atual.current;
      const linha = media.referencia(item);
      onCorpoChange(corpo.trim() ? `${corpo.trimEnd()}\n\n${linha}` : linha);
      setArquivoFalhou(null);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível enviar o arquivo. Tente novamente.");
      setArquivoFalhou(arquivo);
    } finally {
      setEnviando(false);
      atual.current.onBusyChange?.(false);
    }
  }

  function url(caminho: string) {
    if (caminho.startsWith("src/Media/")) return media.urlArquivo(caminho);
    return props.itemId ? (props.tipo === "nota" ? notas : tarefas).anexos.urlDownload(props.itemId, caminho.split("/").slice(2).join("/")) : undefined;
  }

  return <section className={`flex min-w-0 flex-col gap-2 ${props.compact ? "rounded-xl border border-border bg-surface-1 p-4" : ""}`} aria-label="Anexos" aria-busy={enviando}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="flex items-center gap-2 text-sm font-medium text-text-secondary"><Paperclip size={17} />Anexos</p>
      <button type="button" disabled={enviando || props.disabled} onClick={() => input.current?.click()} className="flex min-h-11 items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm font-medium text-text-secondary disabled:opacity-40"><Paperclip size={16} />{enviando ? "Enviando arquivo..." : "Adicionar arquivo"}</button>
    </div>
    {anexos.map((a, i) => <div key={`${a[3]}-${i}`} className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2">
      <FileText size={16} className="shrink-0 text-text-muted" />
      <a href={url(a[3])} target="_blank" rel="noreferrer" className="flex-1 truncate text-sm text-steel-300">{a[2]}</a>
      <button type="button" disabled={props.disabled || enviando} className="flex min-h-11 min-w-11 items-center justify-center" aria-label={`Remover referência de ${a[2]}`} onClick={() => props.onCorpoChange(props.corpo.replace(a[0], "").replace(/\n{3,}/g, "\n\n").trim())}><X size={15} className="text-text-secondary" /></button>
    </div>)}
    <input ref={input} type="file" className="hidden" onChange={(e) => { const arquivo = e.target.files?.[0]; e.target.value = ""; if (arquivo) void enviar(arquivo); }} />
    {!props.compact && <p className="text-xs text-text-secondary">Até 120 MB por arquivo. Salve a nota ou tarefa para manter o vínculo.</p>}
    {erro && <div role="alert" className="min-w-0 text-sm text-error"><p>{arquivoFalhou && <span className="break-all font-medium">{arquivoFalhou.name}: </span>}{erro}</p>{arquivoFalhou && <button type="button" disabled={enviando || props.disabled} onClick={() => void enviar(arquivoFalhou)} className="mt-2 min-h-11 rounded-lg border border-error/40 px-3 text-sm disabled:opacity-40">Tentar novamente</button>}</div>}
  </section>;
}
