/**
 * Regras puras do salvamento de notas: conflito de versão, proteção contra apagar o texto sem querer e o limite do
 * envio ao fechar a página. Ficam aqui (sem React) para os editores do desktop e do celular usarem e os testes cobrirem.
 */

export type LinhaDiff = { tipo: "igual" | "removida" | "adicionada"; texto: string };

/** Diferença por linhas (LCS). `antes` = versão do servidor, `depois` = a minha. Textos enormes caem num diff grosseiro. */
export function diffLinhas(antes: string, depois: string): LinhaDiff[] {
  const a = antes.split("\n");
  const b = depois.split("\n");
  // Prefixo e sufixo comuns saem antes da tabela: o caso típico (poucas linhas mudadas) fica barato.
  let ini = 0;
  while (ini < a.length && ini < b.length && a[ini] === b[ini]) ini++;
  let fimA = a.length, fimB = b.length;
  while (fimA > ini && fimB > ini && a[fimA - 1] === b[fimB - 1]) { fimA--; fimB--; }
  const meioA = a.slice(ini, fimA), meioB = b.slice(ini, fimB);
  const prefixo: LinhaDiff[] = a.slice(0, ini).map((texto) => ({ tipo: "igual", texto }));
  const sufixo: LinhaDiff[] = a.slice(fimA).map((texto) => ({ tipo: "igual", texto }));
  let meio: LinhaDiff[];
  if (meioA.length * meioB.length > 4_000_000) {
    meio = [...meioA.map((texto) => ({ tipo: "removida" as const, texto })), ...meioB.map((texto) => ({ tipo: "adicionada" as const, texto }))];
  } else {
    const n = meioA.length, m = meioB.length;
    const t: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i][j] = meioA[i] === meioB[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
    meio = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (meioA[i] === meioB[j]) { meio.push({ tipo: "igual", texto: meioA[i] }); i++; j++; }
      else if (t[i + 1][j] >= t[i][j + 1]) meio.push({ tipo: "removida", texto: meioA[i++] });
      else meio.push({ tipo: "adicionada", texto: meioB[j++] });
    }
    while (i < n) meio.push({ tipo: "removida", texto: meioA[i++] });
    while (j < m) meio.push({ tipo: "adicionada", texto: meioB[j++] });
  }
  return [...prefixo, ...meio, ...sufixo];
}

/** O corpo ia de conteúdo para vazio, ou encolheu mais de 80%: pede confirmação antes de salvar sozinho. */
export function quedaSuspeita(antes: string, depois: string): boolean {
  const a = antes.trim().length;
  if (a === 0) return false;
  const d = depois.trim().length;
  return d === 0 || d < a * 0.2;
}

/** Acima disso o navegador pode recusar um `fetch` com `keepalive` (o limite total é 64 KiB). */
export const LIMITE_KEEPALIVE_BYTES = 60 * 1024;

export function tamanhoEmBytes(texto: string): number {
  return new TextEncoder().encode(texto).length;
}

export function cabeNoKeepalive(corpoJson: string): boolean {
  return tamanhoEmBytes(corpoJson) < LIMITE_KEEPALIVE_BYTES;
}

/** Conteúdo do servidor no 409 de `PATCH /notas/:id`. */
export interface NotaNoServidor { titulo: string; corpo: string; versao: number; atualizado_em?: string }

export function lerConflito(dados: Record<string, unknown> | undefined): NotaNoServidor | null {
  const atual = (dados?.atual ?? dados) as Partial<NotaNoServidor> | undefined;
  if (!atual || typeof atual.corpo !== "string" || typeof atual.versao !== "number") return null;
  return { titulo: typeof atual.titulo === "string" ? atual.titulo : "", corpo: atual.corpo, versao: atual.versao, atualizado_em: atual.atualizado_em };
}
