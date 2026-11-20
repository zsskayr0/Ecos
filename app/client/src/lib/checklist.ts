import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { toString } from "mdast-util-to-string";
import type { Nodes, Root } from "mdast";

const ITEM_CHECKLIST = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/;

/** Marca/desmarca o `indice`-ésimo item `- [ ]` do Markdown, ignorando blocos de código. */
export function alternarChecklist(corpo: string, indice: number): string {
  let atual = 0;
  let cerca = false;
  return corpo.split("\n").map((linha) => {
    if (/^\s*(```|~~~)/.test(linha)) { cerca = !cerca; return linha; }
    if (cerca) return linha;
    const m = ITEM_CHECKLIST.exec(linha);
    if (!m) return linha;
    if (atual++ !== indice) return linha;
    return `${m[1]}${m[2] === " " ? "x" : " "}${m[3]}${linha.slice(m[0].length)}`;
  }).join("\n");
}

const PARSER_LINKS = unified().use(remarkParse).use(remarkGfm);

/** Primeiro link http(s) do corpo, fora de tabelas e código, que não seja imagem nem anexo, com o domínio já extraído. */
export function primeiroLink(corpo: string): { url: string; dominio: string; rotulo: string } | null {
  let achado: { url: string; dominio: string; rotulo: string } | null = null;
  const visitar = (no: Nodes): void => {
    if (achado || no.type === "table" || no.type === "code" || no.type === "inlineCode" || no.type === "html") return;
    if (no.type === "link") {
      const url = no.url;
      if (!/^https?:\/\//i.test(url) || /\.(png|jpe?g|gif|webp|avif|svg)(\?|$)/i.test(url)) return;
      try {
        const dominio = new URL(url).hostname.replace(/^www\./, "");
        const texto = toString(no).trim();
        achado = { url, dominio, rotulo: texto && texto !== url ? texto : url.replace(/^https?:\/\/(www\.)?/, "") };
      } catch { /* URL inválida */ }
      return;
    }
    if ("children" in no) for (const filho of no.children) visitar(filho as Nodes);
  };
  visitar(PARSER_LINKS.parse(corpo) as Root);
  return achado;
}

export const LIMITE_EXPANDIDO_CARACTERES = 2500;
export const LIMITE_EXPANDIDO_LINHAS = 45;

/** Corta o Markdown numa quebra de linha; fecha um bloco de código deixado aberto. O prefixo é preservado, então os índices do checklist continuam válidos. */
export function cortarCorpo(corpo: string): { texto: string; cortado: boolean } {
  const linhas = corpo.split("\n");
  if (corpo.length <= LIMITE_EXPANDIDO_CARACTERES && linhas.length <= LIMITE_EXPANDIDO_LINHAS) return { texto: corpo, cortado: false };
  const mantidas: string[] = [];
  let total = 0;
  for (const linha of linhas) {
    if (mantidas.length >= LIMITE_EXPANDIDO_LINHAS || total + linha.length > LIMITE_EXPANDIDO_CARACTERES) break;
    mantidas.push(linha);
    total += linha.length + 1;
  }
  const aberto = mantidas.filter((l) => /^\s*(```|~~~)/.test(l)).length % 2 === 1;
  return { texto: mantidas.join("\n") + (aberto ? "\n```" : ""), cortado: true };
}
