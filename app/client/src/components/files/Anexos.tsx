import { Paperclip } from "lucide-react";
import type { AnexoExplorador, ArquivoExplorador } from "@/lib/api";

/** Peças dos anexos (mídias que uma nota ou tarefa referencia) no explorador: o clipe com a contagem e o arquivo como item. */

/** O nome na biblioteca leva um ULID antes da extensão (`foto-01ABC….png`): para exibir, sai. */
export function nomeDeMidia(nome: string): string {
  return nome.replace(/-[0-9A-HJKMNP-TV-Z]{26}(?=\.[^.]+$|$)/i, "");
}

export function extensaoDoNome(nome: string): string {
  const i = nome.lastIndexOf(".");
  return i > 0 ? nome.slice(i + 1).toLowerCase() : "";
}

function categoriaDoNome(nome: string): ArquivoExplorador["categoria"] {
  switch (extensaoDoNome(nome)) {
    case "md": return "markdown";
    case "pdf": return "pdf";
    case "png": case "jpg": case "jpeg": case "gif": case "webp": case "svg": case "avif": case "bmp": return "imagem";
    case "mp3": case "wav": case "ogg": case "m4a": case "flac": case "opus": return "audio";
    case "mp4": case "webm": case "mov": case "mkv": case "m4v": return "video";
    case "txt": case "csv": case "json": case "log": return "texto";
    default: return "outro";
  }
}

/** O anexo no formato de arquivo do explorador, para reaproveitar o ícone por tipo/extensão. */
export function anexoComoArquivo(a: AnexoExplorador): ArquivoExplorador {
  return { nome: nomeDeMidia(a.nome), caminho: a.caminho, categoria: categoriaDoNome(a.nome), tamanho_bytes: a.tamanho_bytes, modificado_em: null };
}

export const rotaDoAnexo = (a: AnexoExplorador) => `/media/ver?c=${encodeURIComponent(a.caminho)}`;

/** Clipe com a quantidade de anexos; clicar mostra ou esconde a lista. Não inicia arraste nem seleciona a linha. */
export function BadgeAnexos({ quantidade, aberto, aoAlternar, className = "" }: { quantidade: number; aberto: boolean; aoAlternar: () => void; className?: string }) {
  return (
    <button
      type="button"
      data-sem-arraste=""
      aria-expanded={aberto}
      aria-label={`${aberto ? "Esconder" : "Mostrar"} ${quantidade === 1 ? "1 anexo" : `${quantidade} anexos`}`}
      title={quantidade === 1 ? "1 anexo" : `${quantidade} anexos`}
      onClick={(e) => { e.stopPropagation(); aoAlternar(); }}
      onDoubleClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className={`flex shrink-0 items-center gap-0.5 rounded-md px-1 py-0.5 text-[11px] leading-none ${aberto ? "bg-surface-3 text-text-primary" : "text-text-muted hover:bg-surface-3 hover:text-text-primary"} ${className}`}
    >
      <Paperclip size={12} />{quantidade}
    </button>
  );
}
