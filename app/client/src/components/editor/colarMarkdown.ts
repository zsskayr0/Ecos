import { EditorView, type Command } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

/** Converte HTML colado (páginas, editores de texto, planilhas) em Markdown. */
export function htmlParaMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,meta,link,title,head").forEach((n) => n.remove());
  const saida = blocos(doc.body, 0);
  return saida.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n").trim();
}

function estilo(el: Element, prop: string): string {
  return (el as HTMLElement).style?.getPropertyValue(prop) ?? "";
}

function inline(no: Node): string {
  if (no.nodeType === Node.TEXT_NODE) return (no.textContent ?? "").replace(/\s+/g, " ");
  if (no.nodeType !== Node.ELEMENT_NODE) return "";
  const el = no as Element;
  const tag = el.tagName.toLowerCase();
  const filhos = () => Array.from(el.childNodes).map(inline).join("");
  const envolver = (marca: string, txt: string) => {
    const t = txt.trim();
    if (!t) return txt;
    const ini = txt.match(/^\s*/)![0], fim = txt.match(/\s*$/)![0];
    return `${ini}${marca}${t}${marca}${fim}`;
  };
  switch (tag) {
    case "br": return "\n";
    case "strong": case "b": return envolver("**", filhos());
    case "em": case "i": return envolver("*", filhos());
    case "s": case "del": case "strike": return envolver("~~", filhos());
    case "code": return envolver("`", el.textContent ?? "");
    case "img": { const src = el.getAttribute("src") ?? ""; return /^https?:/i.test(src) ? `![${el.getAttribute("alt") ?? ""}](${src})` : ""; }
    case "a": {
      const href = el.getAttribute("href") ?? "";
      const txt = filhos().trim();
      if (!/^(https?:|mailto:)/i.test(href)) return txt;
      return txt && txt !== href ? `[${txt}](${href})` : href;
    }
    case "span": {
      // Google Docs marca negrito/itálico via estilo inline.
      let t = filhos();
      const peso = estilo(el, "font-weight");
      if (peso === "bold" || Number(peso) >= 600) t = envolver("**", t);
      if (estilo(el, "font-style") === "italic") t = envolver("*", t);
      return t;
    }
    default:
      if (BLOCOS.has(tag)) return blocos(el, 0);
      return filhos();
  }
}

const BLOCOS = new Set(["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "table", "blockquote", "pre", "hr", "section", "article", "body", "header", "footer", "main"]);

function blocos(el: Element, nivel: number): string {
  let out = "";
  let linha = "";
  const fecharLinha = () => { if (linha.trim()) out += linha.trim() + "\n\n"; linha = ""; };
  for (const no of Array.from(el.childNodes)) {
    if (no.nodeType !== Node.ELEMENT_NODE || !BLOCOS.has((no as Element).tagName.toLowerCase())) { linha += inline(no); continue; }
    fecharLinha();
    const f = no as Element;
    const tag = f.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) out += `${"#".repeat(Number(tag[1]))} ${inline(f).trim()}\n\n`;
    else if (tag === "ul" || tag === "ol") out += lista(f, nivel) + "\n";
    else if (tag === "table") out += tabela(f) + "\n\n";
    else if (tag === "blockquote") out += blocos(f, nivel).trim().split("\n").map((l) => `> ${l}`.trimEnd()).join("\n") + "\n\n";
    else if (tag === "pre") out += "```\n" + (f.textContent ?? "").replace(/\n$/, "") + "\n```\n\n";
    else if (tag === "hr") out += "---\n\n";
    else out += blocos(f, nivel);
  }
  fecharLinha();
  return out;
}

function lista(el: Element, nivel: number): string {
  const ordenada = el.tagName.toLowerCase() === "ol";
  let n = Number(el.getAttribute("start") ?? 1) || 1;
  const recuo = "  ".repeat(nivel);
  let out = "";
  for (const li of Array.from(el.children)) {
    if (li.tagName.toLowerCase() !== "li") continue;
    let texto = "";
    let sub = "";
    let marcador = "";
    for (const c of Array.from(li.childNodes)) {
      const t = c.nodeType === Node.ELEMENT_NODE ? (c as Element).tagName.toLowerCase() : "";
      if (t === "ul" || t === "ol") sub += lista(c as Element, nivel + 1);
      else if (t === "input" && (c as HTMLInputElement).type === "checkbox") marcador = (c as HTMLInputElement).checked ? "[x] " : "[ ] ";
      else if (t === "p" || t === "div") texto += " " + inline(c);
      else texto += inline(c);
    }
    out += `${recuo}${ordenada ? `${n++}.` : "-"} ${marcador}${texto.replace(/\s+/g, " ").trim()}\n${sub}`;
  }
  return out;
}

function celula(t: string): string {
  return t.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
}

function tabelaMarkdown(linhas: string[][]): string {
  const cols = Math.max(...linhas.map((l) => l.length));
  const norm = linhas.map((l) => Array.from({ length: cols }, (_, i) => celula(l[i] ?? "")));
  const [cab, ...corpo] = norm;
  return [cab, cab.map(() => "---"), ...corpo].map((l) => `| ${l.join(" | ")} |`).join("\n");
}

function tabela(el: Element): string {
  const linhas = Array.from(el.querySelectorAll("tr")).map((tr) => Array.from(tr.children).filter((c) => /^t[hd]$/i.test(c.tagName)).map((c) => inline(c)));
  const validas = linhas.filter((l) => l.length);
  return validas.length ? tabelaMarkdown(validas) : "";
}

/** Texto separado por tabulação (cópia de planilha) com 2+ linhas e 2+ colunas vira tabela Markdown. */
export function tsvParaMarkdown(texto: string): string | null {
  const linhas = texto.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  if (linhas.length < 2 || !linhas.every((l) => l.includes("\t"))) return null;
  const celulas = linhas.map((l) => l.split("\t"));
  const n = celulas[0].length;
  if (n < 2 || !celulas.every((l) => l.length === n)) return null;
  return tabelaMarkdown(celulas);
}

const URL_SOLTA = /^(https?:\/\/|mailto:)\S+$/i;

function inserir(view: EditorView, texto: string) {
  view.dispatch(view.state.replaceSelection(texto), { userEvent: "input.paste", scrollIntoView: true });
}

/** Colagem inteligente: HTML → Markdown, planilha → tabela, URL sobre seleção → link. Arquivos ficam com o AttachmentsField. */
export function colarMarkdown(): Extension {
  return EditorView.domEventHandlers({
    paste(e, view) {
      const dados = e.clipboardData;
      if (!dados || view.state.readOnly) return false;
      if (dados.files.length > 0 || Array.from(dados.items).some((i) => i.kind === "file")) return false;
      const texto = dados.getData("text/plain");
      const sel = view.state.selection.main;
      if (!sel.empty && URL_SOLTA.test(texto.trim())) {
        const rotulo = view.state.sliceDoc(sel.from, sel.to);
        if (!rotulo.includes("\n")) { e.preventDefault(); inserir(view, `[${rotulo}](${texto.trim()})`); return true; }
      }
      const tsv = tsvParaMarkdown(texto);
      if (tsv) { e.preventDefault(); inserir(view, tsv); return true; }
      const html = dados.getData("text/html");
      if (html && /<(b|strong|i|em|a|h[1-6]|ul|ol|li|table|blockquote|pre|span)[\s>]/i.test(html)) {
        const md = htmlParaMarkdown(html);
        if (md) { e.preventDefault(); inserir(view, md); return true; }
      }
      return false;
    },
  });
}

/** Ctrl+Shift+V: cola só o texto puro, sem conversão. Lê a área de transferência pela API assíncrona. */
export const colarComoTextoSimples: Command = (view) => {
  if (view.state.readOnly || !navigator.clipboard?.readText) return false;
  navigator.clipboard.readText().then((t) => { if (t) inserir(view, t); }).catch(() => {});
  return true;
};

export const atalhoColarTextoSimples = { key: "Mod-Shift-v", run: colarComoTextoSimples, preventDefault: true };
