import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { notas } from "@/lib/api";
import { baixarArquivo } from "@/lib/baixar-arquivo";
import { resolverSrcImagem } from "@/lib/markdown-mini";
import { obterAccessToken } from "@/lib/server-config";
import { gerarZip, type EntradaZip } from "@/lib/zip-mini";

export type FormatoExportacao = "md" | "html" | "docx" | "tex";

export const FORMATOS_EXPORTACAO: { formato: FormatoExportacao; rotulo: string }[] = [
  { formato: "md", rotulo: "Markdown (.md)" },
  { formato: "html", rotulo: "Página web (.html)" },
  { formato: "docx", rotulo: "Word (.docx)" },
  { formato: "tex", rotulo: "LaTeX (.tex)" },
];

interface Nota { id: string; titulo: string; corpo: string; tags: string[] }

const semWikilink = (texto: string) => texto.replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_, alvo: string, apelido?: string) => apelido || alvo);
const nomeArquivo = (titulo: string) => titulo.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "Nota";
const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** HTML do corpo, como o app desenha (GFM, quebras simples e fórmulas marcadas). */
export function corpoEmDom(corpo: string): HTMLElement {
  const html = renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm, remarkMath, remarkBreaks] }, semWikilink(corpo)));
  return new DOMParser().parseFromString(`<body>${html}</body>`, "text/html").body;
}

const ehMath = (el: Element) => /\bmath-(inline|display)\b/.test(el.className) || /\blanguage-math\b/.test(el.className);
const ehMathDisplay = (el: Element) => /\bmath-display\b/.test(el.className) || (el.tagName === "PRE" && !!el.querySelector("code.math-display, code.language-math"));

// ---------------------------------------------------------------- imagens

interface Imagem { bytes: Uint8Array; tipo: "png" | "jpeg" | "gif"; largura: number; altura: number }

async function baixarImagem(url: string): Promise<Imagem | null> {
  try {
    const doEcos = url.startsWith("/") || new URL(url, window.location.href).origin === window.location.origin;
    const token = doEcos ? obterAccessToken() : null;
    const resp = doEcos
      ? await fetch(url, { credentials: "include", headers: token ? { Authorization: `Bearer ${token}` } : {} })
      : await fetch(url, { credentials: "omit", mode: "cors" });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    const bitmap = await createImageBitmap(blob);
    const { width: largura, height: altura } = bitmap;
    const tipo = blob.type === "image/png" ? "png" : blob.type === "image/jpeg" ? "jpeg" : blob.type === "image/gif" ? "gif" : null;
    if (tipo) return { bytes: new Uint8Array(await blob.arrayBuffer()), tipo, largura, altura };
    // webp, svg…: o Word não lê todos; vira PNG
    const canvas = document.createElement("canvas");
    canvas.width = largura; canvas.height = altura;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
    const png = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/png"));
    return png ? { bytes: new Uint8Array(await png.arrayBuffer()), tipo: "png", largura, altura } : null;
  } catch { return null; }
}

async function imagensDo(raiz: Element, nota: Nota): Promise<Map<string, Imagem>> {
  const mapa = new Map<string, Imagem>();
  await Promise.all(Array.from(raiz.querySelectorAll("img")).map(async (img) => {
    const src = img.getAttribute("src") ?? "";
    if (mapa.has(src)) return;
    const url = resolverSrcImagem(src, nota.id, "nota");
    const r = url ? await baixarImagem(url) : null;
    if (r) mapa.set(src, r);
  }));
  return mapa;
}

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// ---------------------------------------------------------------- .html

const CSS_HTML = `body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;max-width:760px;margin:40px auto;padding:0 20px;line-height:1.6;color:#0f1729}
img{max-width:100%}pre{background:#f1f5f9;padding:12px;border-radius:8px;overflow:auto}code{font-family:ui-monospace,Consolas,monospace;background:#f1f5f9;padding:0 3px;border-radius:4px}
pre code{background:none;padding:0}blockquote{border-left:3px solid #cbd5e1;margin:0;padding-left:14px;color:#475569}
table{border-collapse:collapse}td,th{border:1px solid #cbd5e1;padding:4px 8px}.tags{color:#2563eb}`;

async function gerarHtml(nota: Nota): Promise<Blob> {
  const raiz = corpoEmDom(nota.corpo);
  const imagens = await imagensDo(raiz, nota);
  raiz.querySelectorAll("img").forEach((img) => {
    const im = imagens.get(img.getAttribute("src") ?? "");
    if (im) img.setAttribute("src", `data:image/${im.tipo};base64,${base64(im.bytes)}`);
  });
  raiz.querySelectorAll("code").forEach((c) => { if (ehMath(c)) c.textContent = ehMathDisplay(c) ? `$$${c.textContent}$$` : `$${c.textContent}$`; });
  const tags = nota.tags.length ? `<p class="tags">${nota.tags.map((t) => `#${escHtml(t)}`).join(" ")}</p>` : "";
  const html = `<!doctype html>\n<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escHtml(nota.titulo)}</title><style>${CSS_HTML}</style></head>\n<body><h1>${escHtml(nota.titulo)}</h1>${tags}\n${raiz.innerHTML}\n</body></html>\n`;
  return new Blob([html], { type: "text/html;charset=utf-8" });
}

// ---------------------------------------------------------------- .docx

const escXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
interface Estilo { b?: boolean; i?: boolean; code?: boolean; link?: boolean; strike?: boolean }
const REL_LINK = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";

class Docx {
  corpo: string[] = [];
  midias: EntradaZip[] = [];
  rels: string[] = [];
  /** numIds das listas numeradas (cada uma recomeça em 1); 1 = marcadores. */
  numeradas: number[] = [];
  private nImg = 0;
  private nLink = 0;
  constructor(readonly imagens: Map<string, Imagem>) {}

  run(texto: string, e: Estilo): string {
    if (!texto) return "";
    const pr = [e.b && "<w:b/>", e.i && "<w:i/>", e.strike && "<w:strike/>", e.code && '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:shd w:val="clear" w:color="auto" w:fill="F1F5F9"/>', e.link && '<w:color w:val="2563EB"/><w:u w:val="single"/>'].filter(Boolean).join("");
    return texto.split("\n").map((linha, i) => `${i ? "<w:r><w:br/></w:r>" : ""}<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ""}<w:t xml:space="preserve">${escXml(linha)}</w:t></w:r>`).join("");
  }

  imagem(src: string, alt: string): string {
    const im = this.imagens.get(src);
    if (!im) return this.run(`[imagem${alt ? `: ${alt}` : ""}]`, { i: true });
    const n = ++this.nImg;
    const arquivo = `imagem${n}.${im.tipo === "jpeg" ? "jpg" : im.tipo}`;
    this.midias.push({ nome: `word/media/${arquivo}`, dados: im.bytes });
    this.rels.push(`<Relationship Id="rImg${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${arquivo}"/>`);
    const maxPx = 600; // ~16 cm
    const escala = Math.min(1, maxPx / im.largura);
    const cx = Math.round(im.largura * escala * 9525), cy = Math.round(im.altura * escala * 9525);
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Imagem ${n}" descr="${escXml(alt)}"/>`
      + `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">`
      + `<pic:nvPicPr><pic:cNvPr id="${n}" name="${arquivo}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rImg${n}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
      + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  }

  /** Runs do conteúdo inline do elemento (listas aninhadas ficam de fora). */
  inline(no: Node, e: Estilo = {}): string {
    let s = "";
    no.childNodes.forEach((f) => {
      if (f.nodeType === 3) { s += this.run((f.textContent ?? "").replace(/[ \t\r\n]+/g, " "), e); return; }
      if (f.nodeType !== 1) return;
      const el = f as Element;
      const tag = el.tagName;
      if (tag === "UL" || tag === "OL") return;
      if (tag === "INPUT") s += this.run((el as HTMLInputElement).hasAttribute("checked") ? "☑ " : "☐ ", e);
      else if (tag === "BR") s += "<w:r><w:br/></w:r>";
      else if (tag === "IMG") s += this.imagem(el.getAttribute("src") ?? "", el.getAttribute("alt") ?? "");
      else if (tag === "STRONG" || tag === "B") s += this.inline(el, { ...e, b: true });
      else if (tag === "EM" || tag === "I") s += this.inline(el, { ...e, i: true });
      else if (tag === "DEL" || tag === "S") s += this.inline(el, { ...e, strike: true });
      else if (tag === "CODE") s += this.run(ehMath(el) ? `$${el.textContent}$` : el.textContent ?? "", ehMath(el) ? e : { ...e, code: true });
      else if (tag === "A") {
        const href = el.getAttribute("href") ?? "";
        const runs = this.inline(el, { ...e, link: true });
        if (/^(https?:|mailto:)/i.test(href)) {
          const id = `rLink${++this.nLink}`;
          this.rels.push(`<Relationship Id="${id}" Type="${REL_LINK}" Target="${escXml(href)}" TargetMode="External"/>`);
          s += `<w:hyperlink r:id="${id}">${runs}</w:hyperlink>`;
        } else s += runs;
      }
      else s += this.inline(el, e);
    });
    return s;
  }

  paragrafo(runs: string, pPr = "") {
    this.corpo.push(`<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${runs}</w:p>`);
  }

  lista(lista: Element, nivel: number) {
    let numId = 1;
    if (lista.tagName === "OL") { numId = 2 + this.numeradas.length; this.numeradas.push(numId); }
    for (const li of Array.from(lista.children)) {
      if (li.tagName !== "LI") continue;
      const tarefa = !!li.querySelector(":scope > input[type=checkbox], :scope > p > input[type=checkbox]");
      const pPr = tarefa ? `<w:ind w:left="${360 * (nivel + 1)}"/><w:spacing w:after="40"/>` : `<w:numPr><w:ilvl w:val="${Math.min(nivel, 8)}"/><w:numId w:val="${numId}"/></w:numPr><w:spacing w:after="40"/>`;
      this.paragrafo(this.inline(li), pPr);
      for (const sub of Array.from(li.children)) if (sub.tagName === "UL" || sub.tagName === "OL") this.lista(sub, nivel + 1);
    }
  }

  numeracao(): string {
    const niveis = (fmt: "bullet" | "decimal") => Array.from({ length: 9 }, (_, i) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${fmt === "bullet" ? ["•", "◦", "▪"][i % 3] : `%${i + 1}.`}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${360 * (i + 1)}" w:hanging="360"/></w:pPr></w:lvl>`).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0">${niveis("bullet")}</w:abstractNum><w:abstractNum w:abstractNumId="1">${niveis("decimal")}</w:abstractNum>`
      + `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>${this.numeradas.map((n) => `<w:num w:numId="${n}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`).join("")}</w:numbering>`;
  }

  blocos(raiz: Element) {
    for (const no of Array.from(raiz.children)) {
      const tag = no.tagName;
      if (/^H[1-6]$/.test(tag)) this.paragrafo(this.inline(no), `<w:pStyle w:val="Heading${tag[1]}"/>`);
      else if (tag === "UL" || tag === "OL") this.lista(no, 0);
      else if (tag === "BLOCKQUOTE") {
        for (const p of Array.from(no.children)) this.paragrafo(this.inline(p), '<w:pStyle w:val="Quote"/>');
      } else if (tag === "PRE") {
        if (ehMathDisplay(no)) this.paragrafo(this.run(`$$${no.textContent?.trim()}$$`, {}), '<w:jc w:val="center"/>');
        else this.paragrafo(this.run((no.textContent ?? "").replace(/\n$/, ""), { code: true }), '<w:spacing w:after="120"/>');
      } else if (tag === "HR") this.paragrafo("", '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="CBD5E1"/></w:pBdr>');
      else if (tag === "TABLE") {
        const linhas = Array.from(no.querySelectorAll("tr")).map((tr) => `<w:tr>${Array.from(tr.children).map((td) =>
          `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr><w:p>${this.inline(td, td.tagName === "TH" ? { b: true } : {})}</w:p></w:tc>`).join("")}</w:tr>`).join("");
        const bordas = ["top", "left", "bottom", "right", "insideH", "insideV"].map((b) => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>`).join("");
        this.corpo.push(`<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${bordas}</w:tblBorders></w:tblPr>${linhas}</w:tbl><w:p/>`);
      } else if (tag === "DIV" || tag === "SECTION") this.blocos(no);
      else if (tag === "IMG") this.paragrafo(this.imagem(no.getAttribute("src") ?? "", no.getAttribute("alt") ?? ""));
      else this.paragrafo(this.inline(no));
    }
  }
}

const ESTILOS_DOCX = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="pt-BR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:rPr><w:b/><w:sz w:val="44"/></w:rPr></w:style>
${[40, 32, 28, 24, 22, 22].map((sz, i) => `<w:style w:type="paragraph" w:styleId="Heading${i + 1}"><w:name w:val="heading ${i + 1}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="${i}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${sz}"/></w:rPr></w:style>`).join("\n")}
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="360"/><w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="CBD5E1"/></w:pBdr></w:pPr><w:rPr><w:i/><w:color w:val="475569"/></w:rPr></w:style>
</w:styles>`;

async function gerarDocx(nota: Nota): Promise<Blob> {
  const raiz = corpoEmDom(nota.corpo);
  const d = new Docx(await imagensDo(raiz, nota));
  d.paragrafo(d.run(nota.titulo, {}), '<w:pStyle w:val="Title"/>');
  if (nota.tags.length) d.paragrafo(d.run(nota.tags.map((t) => `#${t}`).join("  "), { link: true }));
  d.blocos(raiz);
  const documento = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${d.corpo.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const zip = gerarZip([
    { nome: "[Content_Types].xml", dados: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
    { nome: "_rels/.rels", dados: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
    { nome: "docProps/core.xml", dados: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${escXml(nota.titulo)}</dc:title><dc:creator>Ecos</dc:creator></cp:coreProperties>` },
    { nome: "word/_rels/document.xml.rels", dados: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>${d.rels.join("")}</Relationships>` },
    { nome: "word/styles.xml", dados: ESTILOS_DOCX },
    { nome: "word/numbering.xml", dados: d.numeracao() },
    { nome: "word/document.xml", dados: documento },
    ...d.midias,
  ]);
  return new Blob([zip as Uint8Array<ArrayBuffer>], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

// ---------------------------------------------------------------- .tex

const escTex = (s: string) => s.replace(/[\\{}$&%#_^~]/g, (c) => ({ "\\": "\\textbackslash{}", "^": "\\textasciicircum{}", "~": "\\textasciitilde{}" } as Record<string, string>)[c] ?? `\\${c}`);

function texInline(no: Node): string {
  let s = "";
  no.childNodes.forEach((f) => {
    if (f.nodeType === 3) { s += escTex((f.textContent ?? "").replace(/[ \t\r\n]+/g, " ")); return; }
    if (f.nodeType !== 1) return;
    const el = f as Element;
    const tag = el.tagName;
    if (tag === "UL" || tag === "OL") return;
    if (tag === "INPUT") s += (el as HTMLInputElement).hasAttribute("checked") ? "$\\boxtimes$ " : "$\\square$ ";
    else if (tag === "BR") s += "\\\\\n";
    else if (tag === "STRONG" || tag === "B") s += `\\textbf{${texInline(el)}}`;
    else if (tag === "EM" || tag === "I") s += `\\emph{${texInline(el)}}`;
    else if (tag === "DEL" || tag === "S") s += `\\sout{${texInline(el)}}`;
    else if (tag === "CODE") s += ehMath(el) ? `$${el.textContent}$` : `\\texttt{${escTex(el.textContent ?? "")}}`;
    else if (tag === "A") { const href = el.getAttribute("href") ?? ""; s += /^https?:/.test(href) ? `\\href{${href.replace(/[%#\\]/g, (c) => `\\${c}`)}}{${texInline(el)}}` : texInline(el); }
    else if (tag === "IMG") s += `[imagem${el.getAttribute("alt") ? `: ${escTex(el.getAttribute("alt")!)}` : ""}]`;
    else s += texInline(el);
  });
  return s;
}

function texBlocos(raiz: Element): string {
  const out: string[] = [];
  const lista = (l: Element): string => {
    const amb = l.tagName === "OL" ? "enumerate" : "itemize";
    const itens = Array.from(l.children).filter((li) => li.tagName === "LI").map((li) =>
      `  \\item ${texInline(li).trim()}${Array.from(li.children).filter((x) => x.tagName === "UL" || x.tagName === "OL").map((x) => `\n${lista(x)}`).join("")}`);
    return `\\begin{${amb}}\n${itens.join("\n")}\n\\end{${amb}}`;
  };
  for (const no of Array.from(raiz.children)) {
    const tag = no.tagName;
    if (/^H[1-6]$/.test(tag)) out.push(`${["\\section*", "\\subsection*", "\\subsubsection*", "\\paragraph*", "\\subparagraph*", "\\subparagraph*"][Number(tag[1]) - 1]}{${texInline(no).trim()}}`);
    else if (tag === "UL" || tag === "OL") out.push(lista(no));
    else if (tag === "BLOCKQUOTE") out.push(`\\begin{quote}\n${texBlocos(no)}\n\\end{quote}`);
    else if (tag === "PRE") out.push(ehMathDisplay(no) ? `\\[\n${no.textContent?.trim()}\n\\]` : `\\begin{verbatim}\n${(no.textContent ?? "").replace(/\n$/, "")}\n\\end{verbatim}`);
    else if (tag === "HR") out.push("\\noindent\\rule{\\linewidth}{0.4pt}");
    else if (tag === "TABLE") {
      const linhas = Array.from(no.querySelectorAll("tr"));
      const cols = Math.max(1, ...linhas.map((tr) => tr.children.length));
      const corpo = linhas.map((tr, i) => `${Array.from(tr.children).map((td) => texInline(td).trim()).join(" & ")} \\\\${i === 0 && tr.querySelector("th") ? " \\hline" : ""}`).join("\n");
      out.push(`\\begin{tabular}{${"l".repeat(cols)}}\n\\hline\n${corpo}\n\\hline\n\\end{tabular}`);
    } else if (tag === "DIV" || tag === "SECTION") out.push(texBlocos(no));
    else out.push(texInline(no).trim());
  }
  return out.filter(Boolean).join("\n\n");
}

function gerarTex(nota: Nota): Blob {
  const raiz = corpoEmDom(nota.corpo);
  const tex = `\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage[brazil]{babel}
\\usepackage{amsmath,amssymb}
\\usepackage[normalem]{ulem}
\\usepackage{hyperref}

\\title{${escTex(nota.titulo)}}
\\date{}

\\begin{document}
\\maketitle

${texBlocos(raiz)}

\\end{document}
`;
  return new Blob([tex], { type: "application/x-tex;charset=utf-8" });
}

// ---------------------------------------------------------------- entrada

export async function exportarNota(id: string, formato: FormatoExportacao): Promise<void> {
  const n = await notas.obter(id);
  const nota: Nota = { id, titulo: n.titulo, corpo: n.corpo, tags: n.tags };
  const blob = formato === "md" ? new Blob([n.corpo], { type: "text/markdown;charset=utf-8" })
    : formato === "html" ? await gerarHtml(nota)
    : formato === "docx" ? await gerarDocx(nota)
    : gerarTex(nota);
  baixarArquivo(blob, `${nomeArquivo(n.titulo)}.${formato}`);
}
