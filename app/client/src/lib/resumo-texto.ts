export interface BlocoResumo { tipo: "titulo" | "paragrafo" | "item"; texto: string }

/** Tira a marcação do Markdown de uma linha, deixando só o texto que se lê. */
export function textoSimples(linha: string): string {
  return linha
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(\*|_)(.+?)\1/g, "$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/==(.+?)==/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Versão enxuta do corpo para a miniatura: parágrafos corridos, títulos e itens, sem código, tabelas, imagens nem HTML.
 * Não precisa ser fiel à nota, só dar a ideia do começo; texto corrido quebra bem em coluna estreita, o que a marcação não deixa.
 */
export function blocosDoResumo(corpo: string, maxCaracteres = 1100): BlocoResumo[] {
  const saida: BlocoResumo[] = [];
  let total = 0;
  let paragrafo: string[] = [];
  let cerca = false;
  const fechar = () => {
    const texto = textoSimples(paragrafo.join(" "));
    paragrafo = [];
    if (texto) { saida.push({ tipo: "paragrafo", texto }); total += texto.length; }
  };
  for (const bruta of corpo.replace(/^---\n[\s\S]*?\n---\n/, "").split("\n")) {
    if (total >= maxCaracteres) break;
    const linha = bruta.trim();
    if (/^(```|~~~)/.test(linha)) { fechar(); cerca = !cerca; continue; }
    if (cerca) continue;
    if (!linha) { fechar(); continue; }
    if (/^(-{3,}|\*{3,}|_{3,}|---pagebreak)$/i.test(linha) || /^\|.*\|$/.test(linha) || /^!\[/.test(linha) || /^<\/?[a-z]/i.test(linha) || /^\$\$/.test(linha)) { fechar(); continue; }
    const titulo = linha.match(/^#{1,6}\s+(.*)$/);
    if (titulo) { fechar(); const t = textoSimples(titulo[1]!); if (t) { saida.push({ tipo: "titulo", texto: t }); total += t.length; } continue; }
    const item = linha.match(/^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/);
    if (item) { fechar(); const t = textoSimples(item[1]!); if (t) { saida.push({ tipo: "item", texto: t }); total += t.length; } continue; }
    paragrafo.push(linha.replace(/^>\s?/, ""));
  }
  fechar();
  return saida;
}
