import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema, type Options as OpcoesSanitize } from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { useState, type MouseEvent as EventoMouse, type ReactNode } from "react";
import "katex/dist/katex.min.css";
import "./markdown-leitura.css";
import type { Plugin } from "unified";
import type { Root, Text } from "mdast";
import { media, notas, tarefas } from "@/lib/api";
import { Wikilink } from "@/components/common/Wikilink";
import { lerAltImagem, remarkCallouts } from "@/lib/markdown-blocos";
import { DiagramaMermaid } from "@/lib/mermaid-sob-demanda";

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
  data: { hName: "ecos-wikilink"; hProperties: { dataInterno: string; dataApelido?: string } };
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
      data: { hName: "ecos-wikilink", hProperties: { dataInterno: titulo, ...(apelido ? { dataApelido: apelido } : {}) } },
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

// `==realce==`, `^sup^`, `~sub~` — fora do GFM; vira <mark>/<sup>/<sub>.
// `~~tachado~~` já foi consumido pelo remark-gfm antes deste plugin.
const MARCAS_RE = /==([^=\n]+?)==|\^([^^\s]+?)\^|~([^~\s]+?)~/g;

function percorrerMarcas(node: { type?: string; children?: unknown[] }): void {
  if (!Array.isArray(node.children)) return;
  const novos: unknown[] = [];
  for (const filho of node.children as { type: string; value?: string; children?: unknown[] }[]) {
    if (filho.type !== "text" || typeof filho.value !== "string") { percorrerMarcas(filho); novos.push(filho); continue; }
    const v = filho.value;
    let ultimo = 0;
    let m: RegExpExecArray | null;
    MARCAS_RE.lastIndex = 0;
    while ((m = MARCAS_RE.exec(v))) {
      if (m.index > ultimo) novos.push({ type: "text", value: v.slice(ultimo, m.index) });
      const tag = m[1] !== undefined ? "mark" : m[2] !== undefined ? "sup" : "sub";
      novos.push({ type: "marcaEcos", data: { hName: tag }, children: [{ type: "text", value: m[1] ?? m[2] ?? m[3] }] });
      ultimo = m.index + m[0].length;
    }
    if (ultimo === 0) { novos.push(filho); continue; }
    if (ultimo < v.length) novos.push({ type: "text", value: v.slice(ultimo) });
  }
  node.children = novos as never[];
}

const remarkMarcas: Plugin<[], Root> = () => (tree) => { percorrerMarcas(tree as unknown as { children?: unknown[] }); };

/** HTML inline só por lista branca: nada de script, style ou atributos de evento. */
const esquemaSanitize: OpcoesSanitize = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "mark", "u", "ecos-wikilink"],
  attributes: {
    ...defaultSchema.attributes,
    div: [...(defaultSchema.attributes?.div ?? []), ["className", /^ecos-callout/], "dataCallout", ["align", "center", "left", "right"]],
    details: [...(defaultSchema.attributes?.details ?? []), ["className", /^ecos-callout/], "dataCallout", "open"],
    summary: [["className", /^ecos-callout/]],
    span: [["className", /^ecos-callout/], "ariaHidden"],
    p: [["align", "center", "left", "right"]],
    img: [...(defaultSchema.attributes?.img ?? []), "title", "width"],
    "ecos-wikilink": ["dataInterno", "dataApelido"],
    code: [["className", /^language-./, "math-inline", "math-display"]],
  },
};

/** Texto puro de um nó hast (para o botão Copiar). */
function textoHast(no: { type: string; value?: string; children?: unknown[] } | undefined): string {
  if (!no) return "";
  if (no.type === "text") return no.value ?? "";
  return ((no.children ?? []) as { type: string }[]).map((c) => textoHast(c)).join("");
}

function BlocoCodigo({ linguagem, texto, children, linha }: { linguagem?: string; texto: string; children: ReactNode; linha?: number }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div data-linha={linha} data-bloco-codigo="" className="overflow-hidden rounded-xl border border-border bg-surface-2">
      <div className="flex items-center justify-between border-b border-border px-3 py-1 text-[12px] text-text-secondary">
        <span>{linguagem ?? "texto"}</span>
        <button
          type="button"
          className="rounded px-2 py-0.5 hover:bg-surface-3 hover:text-text-primary"
          onClick={(e) => {
            e.stopPropagation();
            void navigator.clipboard?.writeText(texto).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 1500); });
          }}
        >
          {copiado ? "Copiado" : "Copiar"}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-2 text-[13.5px] leading-relaxed">{children}</pre>
    </div>
  );
}

interface NoHast { type: string; position?: { start: { line: number } }; properties?: Record<string, unknown>; children?: NoHast[] }

/** Marca cada elemento com a linha do Markdown de onde veio (`data-linha`), para manter o ponto de leitura ao trocar entre ler e editar. */
const rehypeLinhas = () => (tree: NoHast) => {
  const percorrer = (no: NoHast) => {
    if (no.type === "element" && no.position) no.properties = { ...no.properties, dataLinha: no.position.start.line };
    no.children?.forEach(percorrer);
  };
  percorrer(tree);
};

type LinhaProp = { "data-linha"?: number };

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
  /** Com isto, os checkboxes de lista de tarefas ficam clicáveis; recebe a posição (0, 1, 2…) do item no corpo. */
  aoAlternarChecklist?: (indice: number) => void;
}

/** Resolve `_anexos/<id>/<arquivo>` (referência relativa gravada pelo
 * upload, ver `notas.rs::enviar_anexo`/`tarefas.rs::enviar_anexo`) pra URL
 * real; deixa qualquer coisa que já pareça absoluta (http(s)://) em paz. */
export function resolverSrcImagem(src: string | undefined, itemId: string | undefined, tipo: "nota" | "tarefa"): string | undefined {
  if (!src || /^https?:\/\//i.test(src)) return src;
  const prefixo = `_anexos/${itemId}/`;
  if (itemId && src.startsWith(prefixo)) {
    const urlDownload = tipo === "tarefa" ? tarefas.anexos.urlDownload : notas.anexos.urlDownload;
    return urlDownload(itemId, src.slice(prefixo.length));
  }
  if (src.startsWith("src/Media/")) return media.urlArquivo(src);
  return src;
}

function Figura({ src, alt, title, itemId, tipo, width }: { src?: string; alt?: string; title?: string; itemId?: string; tipo: "nota" | "tarefa"; width?: string | number }) {
  const { alt: texto, largura, alinhar } = lerAltImagem(alt);
  const w = largura ?? (width ? `${width}px` : undefined);
  return (
    <span className="ecos-figura" data-alinhar={alinhar} >
      {/* eslint-disable-next-line jsx-a11y/alt-text -- alt vem do próprio Markdown */}
      <img src={resolverSrcImagem(src, itemId, tipo)} alt={texto} className="max-w-full rounded-xl" style={w ? { width: w } : undefined} loading="lazy" />
      {title && <span className="ecos-legenda">{title}</span>}
    </span>
  );
}

export function MarkdownPreview({ corpo, itemId, tipo = "nota", aoAlternarChecklist }: Props) {
  let proximoCheckbox = 0;
  return (
    <div className="ecos-markdown flex min-w-0 flex-col gap-2 text-text-primary [overflow-wrap:anywhere]">
      <ReactMarkdown
        remarkPlugins={[[remarkGfm, { singleTilde: false }], remarkMath, remarkBreaks, remarkWikilink, remarkMarcas, remarkCallouts]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, esquemaSanitize], rehypeKatex, [rehypeHighlight, { detect: false }], rehypeLinhas]}
        remarkRehypeOptions={{
          footnoteLabel: "Notas",
          footnoteBackLabel: (i: number, r: number) => `Voltar à referência ${i + 1}${r > 1 ? `-${r}` : ""}`,
        }}
        components={{
          ...({ "ecos-wikilink": (p: { "data-interno"?: string; "data-apelido"?: string }) => <Wikilink interno={p["data-interno"] ?? ""} apelido={p["data-apelido"]} origem={itemId ? { tipo, id: itemId } : undefined} /> } as object),
          img: ({ src, alt, title, width }) => <Figura src={typeof src === "string" ? src : undefined} alt={alt} title={title} width={width} itemId={itemId} tipo={tipo} />,
          a: ({ href, children, node: _n, ...resto }) => {
            // Âncora interna (rodapé `[^1]` ↔ nota): mesma página, sem nova aba.
            const interno = href?.startsWith("#");
            const extra = resto as Record<string, unknown>;
            return (
              <a
                href={href?.startsWith("src/Media/") ? media.urlArquivo(href) : href}
                id={extra.id as string | undefined}
                aria-label={extra["aria-label"] as string | undefined}
                aria-describedby={extra["aria-describedby"] as string | undefined}
                data-footnote-ref={extra["data-footnote-ref"] as string | undefined}
                data-footnote-backref={extra["data-footnote-backref"] as string | undefined}
                className="text-steel-300 underline underline-offset-2"
                {...(interno ? { onClick: (e: EventoMouse) => e.stopPropagation() } : { target: "_blank", rel: "noreferrer" })}
              >
                {children}
              </a>
            );
          },
          input: ({ checked, type }) => {
            if (type !== "checkbox") return null;
            const indice = proximoCheckbox++;
            return <input type="checkbox" checked={!!checked} disabled={!aoAlternarChecklist} onChange={() => aoAlternarChecklist?.(indice)} onClick={(e) => e.stopPropagation()} className={aoAlternarChecklist ? "cursor-pointer" : ""} />;
          },
          code: ({ children, className }) => <code className={`${className ?? ""} whitespace-pre-wrap rounded bg-surface-3 px-1 py-0.5 font-['IBM_Plex_Mono',monospace] text-[13.5px] [overflow-wrap:anywhere]`}>{children}</code>,
          h1: ({ children, className, ...p }) => <h1 id={(p as { id?: string }).id} data-linha={(p as LinhaProp)["data-linha"]} className={`font-display text-xl text-text-primary ${className ?? ""}`}>{children}</h1>,
          h2: ({ children, className, ...p }) => <h2 id={(p as { id?: string }).id} data-linha={(p as LinhaProp)["data-linha"]} className={`font-display text-lg text-text-primary ${className ?? ""}`}>{children}</h2>,
          h3: ({ children, className, ...p }) => <h3 id={(p as { id?: string }).id} data-linha={(p as LinhaProp)["data-linha"]} className={`font-display text-base font-semibold text-text-primary ${className ?? ""}`}>{children}</h3>,
          h4: ({ children, className, ...p }) => <h4 data-linha={(p as LinhaProp)["data-linha"]} className={`text-[0.95rem] font-semibold text-text-primary ${className ?? ""}`}>{children}</h4>,
          h5: ({ children, className, ...p }) => <h5 data-linha={(p as LinhaProp)["data-linha"]} className={`text-sm font-semibold text-text-secondary ${className ?? ""}`}>{children}</h5>,
          h6: ({ children, className, ...p }) => <h6 data-linha={(p as LinhaProp)["data-linha"]} className={`text-xs font-semibold uppercase tracking-wide text-text-secondary ${className ?? ""}`}>{children}</h6>,
          pre: ({ node, children, ...p }) => {
            const codigo = node?.children.find((c) => c.type === "element" && c.tagName === "code") as { properties?: { className?: string[] }; type: string; children?: unknown[] } | undefined;
            const linguagem = codigo?.properties?.className?.find((c) => c.startsWith("language-"))?.slice("language-".length);
            if (linguagem === "mermaid") return <DiagramaMermaid texto={textoHast(codigo).replace(/\n$/, "")} linha={(p as LinhaProp)["data-linha"]} />;
            return <BlocoCodigo linguagem={linguagem} texto={textoHast(codigo).replace(/\n$/, "")} linha={(p as LinhaProp)["data-linha"]}>{children}</BlocoCodigo>;
          },
          ol: ({ children, ...p }) => <ol data-linha={(p as LinhaProp)["data-linha"]} start={(p as { start?: number }).start} className="ml-5 list-decimal">{children}</ol>,
          ul: ({ children, className, ...p }) => <ul data-linha={(p as LinhaProp)["data-linha"]} className={className?.includes("contains-task-list") ? "" : "ml-5 list-disc"}>{children}</ul>,
          blockquote: ({ children, ...p }) => <blockquote data-linha={(p as LinhaProp)["data-linha"]} className="border-l-2 border-border pl-3 text-text-secondary">{children}</blockquote>,
          table: ({ children, ...p }) => (
            <div data-linha={(p as LinhaProp)["data-linha"]} className="max-w-full overflow-x-auto">
              <table className="w-full border-collapse text-left text-[0.93em] leading-normal">{children}</table>
            </div>
          ),
          th: ({ children, style }) => <th style={style} className="whitespace-nowrap border-b border-steel-500/60 px-3.5 py-2.5 text-left font-bold text-text-primary">{children}</th>,
          td: ({ children, style }) => <td style={style} className="border-b border-border px-3.5 py-2.5 align-top text-text-secondary [tr:last-child>&]:border-b-0 [overflow-wrap:normal]">{children}</td>,
          li: ({ children, className, ...p }) => (
            // remark-gfm marca item de task-list com essa classe; o checkbox real já vem no `input` filho.
            <li data-linha={(p as LinhaProp)["data-linha"]} className={className?.includes("task-list-item") ? "flex items-start gap-2 [&>input]:mt-1" : "pl-0.5"}>{children}</li>
          ),
        }}
      >
        {corpo}
      </ReactMarkdown>
    </div>
  );
}
