/**
 * Remove espaços em branco de uma nota: sobras no fim de cada linha e TODAS as linhas em branco. Blocos de código (``` ou ~~~) não são tocados.
 */
export function removerEspacosEmBranco(corpo: string): string {
  const linhas = corpo.replace(/\r\n/g, "\n").split("\n");
  const saida: string[] = [];
  let cerca: string | null = null;
  for (const l of linhas) {
    const m = l.match(/^[ \t]*(`{3,}|~{3,})/);
    if (cerca) { saida.push(l); if (m && m[1]![0] === cerca[0] && m[1]!.length >= cerca.length) cerca = null; continue; }
    if (m) { cerca = m[1]!; saida.push(l.replace(/[ \t]+$/, "")); continue; }
    const limpa = l.replace(/[ \t]+$/, "");
    if (limpa === "") continue;
    saida.push(limpa);
  }
  return saida.length ? saida.join("\n") + "\n" : "";
}
