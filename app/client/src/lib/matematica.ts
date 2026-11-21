/**
 * Fórmulas em LaTeX no texto: `$...$` (na linha) e `$$...$$` (em bloco, numa linha ou em várias).
 * Mesmas regras do remark-math usado na leitura, para editor, leitura e PDF concordarem.
 */
import type katexTipo from "katex";

export interface TrechoMatematica { de: number; ate: number; tex: string; bloco: boolean }

/** `$x$`: abre seguido de não-espaço, fecha precedido de não-espaço e sem dígito logo depois (`$5 e $10` não é fórmula). */
const INLINE = /(?<![\\$])\$(?!\$)(?=\S)((?:\\.|[^$\\\n])*?\S)\$(?![\d$])/g;

/**
 * Acha as fórmulas do texto. `ignorar(de, ate)` diz se o trecho está em código (onde `$` é literal).
 * Blocos: linha que começa com `$$` abre e vai até a linha que termina com `$$`.
 */
export function acharMatematica(texto: string, ignorar: (de: number, ate: number) => boolean = () => false): TrechoMatematica[] {
  const achados: TrechoMatematica[] = [];
  const linhas = texto.split("\n");
  let pos = 0;
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    const ini = pos;
    const t = l.trim();
    if (t.startsWith("$$") && !ignorar(ini, ini + l.length)) {
      // `$$ ... $$` numa linha só
      if (t.length > 4 && t.endsWith("$$")) {
        achados.push({ de: ini, ate: ini + l.length, tex: t.slice(2, -2).trim(), bloco: true });
        pos += l.length + 1;
        continue;
      }
      let j = i + 1, p = pos + l.length + 1;
      while (j < linhas.length && !linhas[j].trim().endsWith("$$")) { p += linhas[j].length + 1; j++; }
      if (j < linhas.length) {
        const fim = p + linhas[j].length;
        const corpo = texto.slice(ini, fim).trim();
        achados.push({ de: ini, ate: fim, tex: corpo.slice(2, -2).trim(), bloco: true });
        pos = fim + 1; i = j;
        continue;
      }
    }
    if (l.includes("$")) {
      INLINE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = INLINE.exec(l))) {
        const de = ini + m.index, ate = de + m[0].length;
        if (!ignorar(de, ate)) achados.push({ de, ate, tex: m[1], bloco: false });
      }
    }
    pos += l.length + 1;
  }
  return achados;
}

let carregando: Promise<typeof katexTipo> | null = null;
let katexPronto: typeof katexTipo | null = null;

/** KaTeX só é baixado quando aparece a primeira fórmula. */
export function carregarKatex(): Promise<typeof katexTipo> {
  carregando ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(([m]) => (katexPronto = m.default));
  return carregando;
}
export const katexCarregado = () => katexPronto;

/** HTML da fórmula; erro de sintaxe vira o próprio código em vermelho, com a mensagem no título (nunca lança). */
export function renderizarFormula(katex: typeof katexTipo, tex: string, bloco: boolean): string {
  return katex.renderToString(tex, { displayMode: bloco, throwOnError: false, errorColor: "#e5484d", output: "html", strict: "ignore", trust: false });
}

/**
 * `$$x$$` sozinho num parágrafo é bloco (como no editor); o remark-math o trata como fórmula na linha.
 * Plugin do remark para a leitura e o PDF.
 */
export function remarkMatematicaBloco() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (arvore: any, arquivo: { value?: unknown }) => {
    const fonte = String(arquivo.value ?? "");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const visitar = (no: any) => {
      if (!Array.isArray(no.children)) return;
      no.children = no.children.map((filho: any) => {
        if (filho.type === "paragraph") {
          const uteis = filho.children.filter((c: any) => !(c.type === "text" && !c.value.trim()));
          const m = uteis[0];
          if (uteis.length === 1 && m.type === "inlineMath" && m.position && fonte.startsWith("$$", m.position.start.offset)) {
            return {
              type: "math", value: m.value, position: filho.position,
              data: { hName: "pre", hChildren: [{ type: "element", tagName: "code", properties: { className: ["language-math", "math-display"] }, children: [{ type: "text", value: m.value }] }] },
            };
          }
        }
        visitar(filho);
        return filho;
      });
    };
    visitar(arvore);
  };
}
