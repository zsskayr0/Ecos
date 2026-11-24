/**
 * Texto colado numa tabela. No GFM, uma linha logo abaixo de uma tabela vira mais uma linha dela (mesmo sem nenhuma
 * barra `|`), e a tabela "se desfaz" em células estranhas. Aqui a tabela termina na primeira linha sem `|`:
 * o resto é texto comum, como a pessoa espera.
 */
const DELIMITADOR = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

/** Quantas linhas, a partir do começo de `linhas` (cabeçalho, delimitador e corpo), pertencem à tabela. */
export function linhasDaTabela(linhas: readonly string[], inicio = 0): number {
  let n = Math.min(2, linhas.length - inicio);
  while (inicio + n < linhas.length && linhas[inicio + n]!.includes("|") && linhas[inicio + n]!.trim() !== "") n++;
  return n;
}

/** Põe uma linha em branco entre o fim da tabela e o texto colado nela (fora de blocos de código). */
export function separarTextoColadoNaTabela(md: string): string {
  if (!md.includes("|")) return md;
  const linhas = md.split("\n");
  const saida: string[] = [];
  let cerca: string | null = null;
  let naTabela = false;
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i]!;
    const m = l.match(/^[ \t]*(`{3,}|~{3,})/);
    if (cerca) { saida.push(l); if (m && m[1]![0] === cerca[0] && m[1]!.length >= cerca.length) cerca = null; continue; }
    if (m) { cerca = m[1]!; naTabela = false; saida.push(l); continue; }
    if (naTabela) {
      if (l.trim() === "") naTabela = false;
      else if (!l.includes("|")) { naTabela = false; saida.push(""); }
    } else if (i > 0 && l.includes("-") && l.includes("|") && DELIMITADOR.test(l) && linhas[i - 1]!.includes("|") && linhas[i - 1]!.trim() !== "") {
      naTabela = true;
    }
    saida.push(l);
  }
  return saida.join("\n");
}

/**
 * Acha as tabelas pelo texto (cabeçalho com `|`, linha de delimitadores e as linhas seguintes com `|`), fora de blocos de
 * código. Serve para o editor desenhar a tabela mesmo quando o analisador do Markdown desiste dela por causa do texto colado embaixo.
 * Devolve intervalos de índices de linha: `de` (cabeçalho) até `ate` (última linha da tabela), inclusive.
 */
export function acharTabelas(linhas: readonly string[]): { de: number; ate: number }[] {
  const achadas: { de: number; ate: number }[] = [];
  let cerca: string | null = null;
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i]!;
    const m = l.match(/^[ \t]*(`{3,}|~{3,})/);
    if (cerca) { if (m && m[1]![0] === cerca[0] && m[1]!.length >= cerca.length) cerca = null; continue; }
    if (m) { cerca = m[1]!; continue; }
    const d = linhas[i + 1];
    if (d === undefined || !l.includes("|") || !d.includes("|") || !d.includes("-") || !DELIMITADOR.test(d)) continue;
    const n = linhasDaTabela(linhas, i);
    achadas.push({ de: i, ate: i + n - 1 });
    i += n - 1;
  }
  return achadas;
}
