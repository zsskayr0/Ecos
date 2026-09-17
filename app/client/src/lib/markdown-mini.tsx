import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import type { Plugin } from "unified";
import type { Root, Text } from "mdast";
import { media, notas, tarefas } from "@/lib/api";

/**
 * Real Markdown rendering (section 3.6 preview + Nota read mode) — used to
 * be a hand-rolled per-line parser covering only checkbox/bold/code/
 * wikilink; the richer editor toolbar (headings, lists, quotes, images)
 * needed real coverage, so this now runs on `react-markdown` + `remark-gfm`
 * (tables, task lists, strikethrough) + `remark-breaks` (single `\n` breaks
 * a line, matching the old per-line renderer's behavior — CommonMark alone
 * would need a blank line between paragraphs, which isn't how anyone here
 * has been writing Notas).
 *
 * `[[Título]]`/`[[Título|Apelido]]` (Obsidian-style wikilink, `wikilink.rs`)
 * is Ecos's own syntax, not standard Markdown — `remarkWikilink` below
 * turns it into a custom mdast node rendered as a styled `<span>`, same
 * visual treatment the old renderer gave it.
 */

const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/;
const WIKILINK_RE_GLOBAL = new RegExp(WIKILINK_RE.source, "g");

interface WikilinkMdastNode {
  type: "wikilinkEcos";
  data: { hName: "span"; hProperties: { className: string } };
  children: [{ type: "text"; value: string }];
}

function dividirTextoComWikilinks(node: Text): (Text | WikilinkMdastNode)[] {
  const partes: (Text | WikilinkMdastNode)[] = [];
  let ultimo = 0;
  let match: RegExpExecArray | null;
  WIKILINK_RE_GLOBAL.lastIndex = 0;
  while ((match = WIKILINK_RE_GLOBAL.exec(node.value))) {
    if (match.index > ultimo) partes.push({ type: "text", value: node.value.slice(ultimo, match.index) });
    const titulo = match[1].trim();
    const apelido = match[2]?.trim();
    partes.push({
      type: "wikilinkEcos",
      data: { hName: "span", hProperties: { className: "font-medium text-steel-300" } },
      children: [{ type: "text", value: apelido || titulo }],
    });
    ultimo = match.index + match[0].length;
  }
  if (ultimo < node.value.length) partes.push({ type: "text", value: node.value.slice(ultimo) });
  return partes;
}

// mdast não exporta um tipo genérico "nó com filhos" fácil de tipar aqui —
// a árvore é heterogênea de propósito (parágrafo, ênfase, wikilink...).
function percorrerENormalizarWikilinks(node: { children?: unknown[] }): void {
  if (!Array.isArray(node.children)) return;
  const novosFilhos: unknown[] = [];
  for (const filho of node.children as { type: string; value?: string; children?: unknown[] }[]) {
    if (filho.type === "text" && typeof filho.value === "string" && WIKILINK_RE.test(filho.value)) {
      novosFilhos.push(...dividirTextoComWikilinks(filho as Text));
    } else {
      percorrerENormalizarWikilinks(filho);
      novosFilhos.push(filho);
    }
  }
  node.children = novosFilhos as never[];
}

const remarkWikilink: Plugin<[], Root> = () => (tree) => {
  percorrerENormalizarWikilinks(tree as unknown as { children?: unknown[] });
};

interface Props {
  corpo: string;
  /** Nota/Tarefa já existente — necessário pra resolver `_anexos/<id>/<arquivo>`
   * pra uma URL real de download. `undefined` (item ainda não salvo, ver
   * `CorpoEditor`) faz imagens locais aparecerem quebradas até o primeiro
   * save — aceitável, mesma limitação que o upload já tem. */
  itemId?: string;
  /** Nota e Tarefa têm rotas de anexo espelhadas mas distintas
   * (`notas.anexos` / `tarefas.anexos`, mesmo padrão de backend) — decide
   * qual usar pra resolver a URL de download. Default "nota" preserva o
   * comportamento de quem já chamava sem essa prop. */
  tipo?: "nota" | "tarefa";
}

/** Resolve `_anexos/<id>/<arquivo>` (referência relativa gravada pelo
 * upload, ver `notas.rs::enviar_anexo`/`tarefas.rs::enviar_anexo`) pra URL
 * real; deixa qualquer coisa que já pareça absoluta (http(s)://) em paz. */
function resolverSrcImagem(src: string | undefined, itemId: string | undefined, tipo: "nota" | "tarefa"): string | undefined {
  if (!src || /^https?:\/\//i.test(src)) return src;
  const prefixo = `_anexos/${itemId}/`;
  if (itemId && src.startsWith(prefixo)) {
    const urlDownload = tipo === "tarefa" ? tarefas.anexos.urlDownload : notas.anexos.urlDownload;
    return urlDownload(itemId, src.slice(prefixo.length));
  }
  if (src.startsWith("src/Media/")) return media.urlArquivo(src);
  return src;
}

export function MarkdownPreview({ corpo, itemId, tipo = "nota" }: Props) {
  return (
    <div className="ecos-markdown flex flex-col gap-2 text-text-primary">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks, remarkWikilink]}
        components={{
          img: ({ src, alt }) => (
            // eslint-disable-next-line jsx-a11y/alt-text -- alt vem do próprio Markdown (![alt](src))
            <img src={resolverSrcImagem(typeof src === "string" ? src : undefined, itemId, tipo)} alt={alt ?? ""} className="max-w-full rounded-xl" loading="lazy" />
          ),
          a: ({ href, children }) => (
            <a href={href?.startsWith("src/Media/") ? media.urlArquivo(href) : href} className="text-steel-300 underline underline-offset-2" target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          code: ({ children }) => <code className="rounded bg-surface-3 px-1 py-0.5 font-mono-value text-[13px]">{children}</code>,
          h1: ({ children }) => <h1 className="font-display text-xl text-text-primary">{children}</h1>,
          h2: ({ children }) => <h2 className="font-display text-lg text-text-primary">{children}</h2>,
          h3: ({ children }) => <h3 className="font-display text-base font-semibold text-text-primary">{children}</h3>,
          blockquote: ({ children }) => <blockquote className="border-l-2 border-border pl-3 text-text-secondary">{children}</blockquote>,
          li: ({ children, className }) => (
            // remark-gfm marca item de task-list com essa classe; o checkbox real já vem no `input` filho.
            <li className={className?.includes("task-list-item") ? "flex items-start gap-2 [&>input]:mt-1" : "ml-4 list-disc"}>{children}</li>
          ),
        }}
      >
        {corpo}
      </ReactMarkdown>
    </div>
  );
}
