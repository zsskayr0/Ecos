import type { Completion, CompletionContext, CompletionResult, CompletionSource } from "@codemirror/autocomplete";
import { normalizarTexto } from "@/lib/texto-busca";

/**
 * Menu "/" do editor: digitar `/` no começo da linha (ou depois de um espaço) abre a lista de blocos.
 * `§` marca onde o cursor fica; `«…»` marca o trecho que já sai selecionado.
 */
interface Bloco { rotulo: string; dica: string; chaves: string; texto: string; bloco?: boolean }

const BLOCOS: Bloco[] = [
  { rotulo: "Título 1", dica: "# ", chaves: "titulo h1 cabecalho", texto: "# §", bloco: true },
  { rotulo: "Título 2", dica: "## ", chaves: "titulo h2 subtitulo", texto: "## §", bloco: true },
  { rotulo: "Título 3", dica: "### ", chaves: "titulo h3", texto: "### §", bloco: true },
  { rotulo: "Lista", dica: "- ", chaves: "lista marcadores bullet", texto: "- §", bloco: true },
  { rotulo: "Lista numerada", dica: "1. ", chaves: "lista numerada ordenada", texto: "1. §", bloco: true },
  { rotulo: "Lista de tarefas", dica: "- [ ] ", chaves: "tarefa checklist caixa todo", texto: "- [ ] §", bloco: true },
  { rotulo: "Citação", dica: "> ", chaves: "citacao quote", texto: "> §", bloco: true },
  { rotulo: "Seção dobrável", dica: "<details>", chaves: "details dobravel recolher expandir toggle", texto: "<details>\n<summary>«Título»</summary>\n\n§\n\n</details>", bloco: true },
  { rotulo: "Bloco de código", dica: "```", chaves: "codigo code programacao", texto: "```«linguagem»\n\n```", bloco: true },
  { rotulo: "Tabela", dica: "| |", chaves: "tabela table", texto: "| «Coluna» | Coluna |\n| --- | --- |\n|  |  |", bloco: true },
  { rotulo: "Imagem com legenda", dica: "![alt|largura|centro]", chaves: "imagem foto figura legenda", texto: "![«descrição»|400|centro](url \"Legenda\")", bloco: true },
  { rotulo: "Divisor", dica: "---", chaves: "divisor linha separador hr", texto: "---\n§", bloco: true },
  { rotulo: "Centralizar parágrafo", dica: "<p align=center>", chaves: "centralizar centro alinhar", texto: "<p align=\"center\">«texto»</p>", bloco: true },
  { rotulo: "Sublinhado", dica: "<u>", chaves: "sublinhado underline", texto: "<u>«texto»</u>" },
  { rotulo: "Sobrescrito", dica: "<sup>", chaves: "sobrescrito expoente superscript", texto: "<sup>«texto»</sup>" },
  { rotulo: "Subscrito", dica: "<sub>", chaves: "subscrito indice subscript", texto: "<sub>«texto»</sub>" },
  { rotulo: "Realce", dica: "==", chaves: "realce destaque marca", texto: "==«texto»==" },
  { rotulo: "Bloco de escrita", dica: "à mão", chaves: "escrita mao caneta desenho quadriculado exercicio rascunho", texto: "```escrita 240\n```\n§", bloco: true },
  { rotulo: "Fórmula", dica: "$$", chaves: "formula matematica latex equacao", texto: "$$\n«x^2»\n$$", bloco: true },
];

function preparar(texto: string): { insert: string; anchor: number; head: number } {
  const ini = texto.indexOf("«");
  if (ini >= 0) {
    const fim = texto.indexOf("»", ini);
    const insert = texto.replace("«", "").replace("»", "");
    return { insert, anchor: ini, head: fim - 1 };
  }
  const cursor = texto.indexOf("§");
  const insert = texto.replace("§", "");
  const pos = cursor >= 0 ? cursor : insert.length;
  return { insert, anchor: pos, head: pos };
}

export const fonteBlocos: CompletionSource = (ctx: CompletionContext): CompletionResult | null => {
  const m = ctx.matchBefore(/(?:^|\s)\/[\p{L}\d ]{0,20}$/u);
  if (!m) return null;
  const barra = m.from + m.text.indexOf("/");
  const termo = normalizarTexto(ctx.state.sliceDoc(barra + 1, m.to)).trim();
  // "/ " sozinho ou com muitas palavras não é comando.
  if (/\s/.test(ctx.state.sliceDoc(barra + 1, barra + 2))) return null;
  const linha = ctx.state.doc.lineAt(barra);
  const noComeco = !ctx.state.sliceDoc(linha.from, barra).trim();
  const casa = (texto: string) => termo.split(/\s+/).every((p) => normalizarTexto(texto).includes(p));
  const achados = !termo ? BLOCOS : [...BLOCOS.filter((b) => casa(b.rotulo)), ...BLOCOS.filter((b) => !casa(b.rotulo) && casa(`${b.rotulo} ${b.chaves}`))];
  if (!achados.length) return null;
  return {
    from: barra,
    filter: false,
    options: achados.map((b, i): Completion => ({
      label: b.rotulo,
      detail: b.dica,
      type: "bloco",
      boost: -i,
      apply: (view, _c, from, to) => {
        const prefixo = b.bloco && !noComeco ? "\n" : "";
        const { insert, anchor, head } = preparar(b.texto);
        const base = from + prefixo.length;
        view.dispatch({ changes: { from, to, insert: prefixo + insert }, selection: { anchor: base + anchor, head: base + head }, userEvent: "input.complete" });
      },
    })),
  };
};

/** Linha do menu "/" (o CSS do menu esconde os campos de série do CodeMirror). */
export function linhaBloco(c: Completion): HTMLElement {
  const linha = document.createElement("div");
  linha.className = "ecos-wl-linha ecos-bloco-linha";
  const rotulo = document.createElement("span");
  rotulo.textContent = c.label;
  rotulo.style.cssText = "font-family:inherit;font-size:14px;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
  const dica = document.createElement("code");
  dica.textContent = c.detail ?? "";
  dica.style.cssText = "flex:none;opacity:.6;font-size:12px;font-family:'IBM Plex Mono',monospace";
  linha.append(rotulo, dica);
  return linha;
}
