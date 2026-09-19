import { useEffect, useRef, useState } from "react";
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

const EXTENSAO_POR_TIPO: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
};

const dois = (n: number) => String(n).padStart(2, "0");

/** Capturas de tela chegam da área de transferência todas como `image.png` — cada uma ganha um nome próprio, com data e hora. */
function nomearColado(arquivo: File, indice: number, total: number): File {
  if (arquivo.name && !/^image\.\w+$/i.test(arquivo.name)) return arquivo;
  const agora = new Date();
  const carimbo = `${agora.getFullYear()}-${dois(agora.getMonth() + 1)}-${dois(agora.getDate())}-${dois(agora.getHours())}${dois(agora.getMinutes())}${dois(agora.getSeconds())}`;
  const extensao = EXTENSAO_POR_TIPO[arquivo.type] ?? arquivo.name.split(".").pop() ?? "bin";
  const sufixo = total > 1 ? `-${indice + 1}` : "";
  return new File([arquivo], `captura-${carimbo}${sufixo}.${extensao}`, { type: arquivo.type });
}

/** Coloca a referência do anexo no texto: no cursor (colagem) ou no fim (botão), sempre em bloco próprio. */
export function inserirReferencia(corpo: string, linha: string, posicao?: number): string {
  if (posicao === undefined) return corpo.trim() ? `${corpo.trimEnd()}\n\n${linha}` : linha;
  const p = Math.min(Math.max(posicao, 0), corpo.length);
  const antes = corpo.slice(0, p);
  const depois = corpo.slice(p);
  return `${antes}${antes && !antes.endsWith("\n\n") ? (antes.endsWith("\n") ? "\n" : "\n\n") : ""}${linha}${depois && !depois.startsWith("\n") ? "\n\n" : ""}${depois}`;
}

/** Um único controle de anexos para criação e edição. O Markdown mantém a
 * associação; a biblioteca global guarda o arquivo antes do primeiro save.
 * Colar (Ctrl+V) uma captura de tela ou um arquivo em qualquer campo do
 * formulário também anexa. */
export function AttachmentsField(props: Props) {
  const atual = useRef(props);
  atual.current = props;
  const raiz = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const ocupado = useRef(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [arquivoFalhou, setArquivoFalhou] = useState<File | null>(null);
  const anexos = [...props.corpo.matchAll(/(!?)\[([^\]]*)\]\(((?:src\/Media\/|_anexos\/)[^)]+)\)/g)];

  async function enviar(arquivo: File, posicao?: number) {
    if (ocupado.current || atual.current.disabled) return;
    if (arquivo.size > 120 * 1024 * 1024) {
      setErro("O arquivo excede o limite de 120 MB. Escolha um arquivo menor.");
      setArquivoFalhou(null);
      return;
    }
    if (!arquivo.size) {
      setErro("O arquivo está vazio.");
      setArquivoFalhou(null);
      return;
    }
    ocupado.current = true;
    setEnviando(true);
    setErro(null);
    atual.current.onBusyChange?.(true);
    try {
      const item = await media.enviar(arquivo);
      const { corpo, onCorpoChange } = atual.current;
      onCorpoChange(inserirReferencia(corpo, media.referencia(item), posicao));
      setArquivoFalhou(null);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível enviar o arquivo. Tente novamente.");
      setArquivoFalhou(arquivo);
    } finally {
      ocupado.current = false;
      setEnviando(false);
      atual.current.onBusyChange?.(false);
    }
  }

  // O ouvinte usa sempre a versão mais recente de `enviar` (que lê `atual`).
  const enviarRef = useRef(enviar);
  enviarRef.current = enviar;

  useEffect(() => {
    const escopo = raiz.current?.parentElement;
    if (!escopo) return;

    function aoColar(e: ClipboardEvent) {
      const dados = e.clipboardData;
      if (!dados || atual.current.disabled) return;
      const arquivos = Array.from(dados.files);
      if (!arquivos.length) return;
      // Texto junto com imagem (células do Word/Excel, páginas copiadas) é uma colagem de texto: deixa o navegador colar.
      if (dados.getData("text/plain").trim()) return;

      e.preventDefault();
      const alvo = e.target;
      const cursor = alvo instanceof HTMLTextAreaElement ? alvo.selectionStart : undefined;
      void (async () => {
        let posicao = cursor;
        for (const [i, arquivo] of arquivos.entries()) {
          await enviarRef.current(nomearColado(arquivo, i, arquivos.length), posicao);
          posicao = undefined; // os seguintes vão para o fim, depois do primeiro
        }
      })();
    }

    escopo.addEventListener("paste", aoColar);
    return () => escopo.removeEventListener("paste", aoColar);
  }, []);

  function url(caminho: string) {
    if (caminho.startsWith("src/Media/")) return media.urlArquivo(caminho);
    return props.itemId ? (props.tipo === "nota" ? notas : tarefas).anexos.urlDownload(props.itemId, caminho.split("/").slice(2).join("/")) : undefined;
  }

  return <section ref={raiz} className={`flex min-w-0 flex-col gap-2 ${props.compact ? "rounded-xl border border-border bg-surface-1 p-4" : ""}`} aria-label="Anexos" aria-busy={enviando}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="flex items-center gap-2 text-sm font-medium text-text-secondary"><Paperclip size={17} />Anexos<span className="hidden text-xs font-normal text-text-muted md:inline">· cole uma captura com Ctrl+V</span></p>
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
