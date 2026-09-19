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

/** Primeiro link http(s) que não seja imagem nem anexo, com o domínio já extraído. */
export function primeiroLink(corpo: string): { url: string; dominio: string; rotulo: string } | null {
  for (const m of corpo.matchAll(/(!?)(?:\[([^\]]*)\]\((<?https?:\/\/[^)\s>]+>?)[^)]*\)|(https?:\/\/[^\s)<>]+))/g)) {
    if (m[1]) continue;
    const url = (m[3] ?? m[4]).replace(/^<|>$/g, "");
    if (/\.(png|jpe?g|gif|webp|avif|svg)(\?|$)/i.test(url)) continue;
    try {
      const dominio = new URL(url).hostname.replace(/^www\./, "");
      return { url, dominio, rotulo: m[2]?.trim() || url.replace(/^https?:\/\/(www\.)?/, "") };
    } catch { /* URL inválida */ }
  }
  return null;
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
