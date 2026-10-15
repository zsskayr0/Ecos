import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Guarda de contraste dos tokens (UI-1, WCAG 1.4.3 e 1.4.11). Lê tokens.css,
 * resolve cada tema na ordem da cascata e falha se algum par cair abaixo do
 * limite. Troque um hex em tokens.css e este teste diz quem quebrou.
 */
const css = readFileSync("src/styles/tokens.css", "utf8");

function blocos(): { seletores: string[]; vars: Record<string, string> }[] {
  const limpo = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const saida: { seletores: string[]; vars: Record<string, string> }[] = [];
  for (const m of limpo.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const vars: Record<string, string> = {};
    for (const v of m[2].matchAll(/--ecos-([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) vars[v[1]] = v[2];
    saida.push({ seletores: m[1].split(",").map((s) => s.trim()), vars });
  }
  return saida;
}

/** Cascata simplificada: :root → tema → alto contraste (ordem do arquivo basta). */
function resolver(tema: "dark" | "light", alto: boolean): Record<string, string> {
  const r: Record<string, string> = {};
  // Ordem por especificidade (como no CSS), não por posição no arquivo.
  const camadas: [string, boolean][] = [
    [":root", true],
    ['[data-theme="dark"]', tema === "dark"],
    ['html[data-theme="light"]', tema === "light"],
    ['html[data-contraste="alto"]', alto],
    ['html[data-contraste="alto"][data-theme="dark"]', alto && tema === "dark"],
    ['html[data-contraste="alto"][data-theme="light"]', alto && tema === "light"],
  ];
  for (const [seletor, aplica] of camadas) {
    if (!aplica) continue;
    for (const b of blocos()) if (b.seletores.includes(seletor)) Object.assign(r, b.vars);
  }
  return r;
}

function lum(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function razao(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const SUPERFICIES = ["base", "surface-1", "surface-2", "surface-3"];
const TEXTO = ["text-primary", "text-secondary", "text-muted"];
// Cores usadas como texto/ícone sobre as superfícies (steel-700 é só fundo).
const ACENTOS = ["steel-400", "steel-300", "steel-200", "cyan", "violet",
  "success", "warning", "error", "frescor", "orfa", "interacao", "esquecimento", "encrypted"];

describe.each([["dark", false], ["light", false], ["dark", true], ["light", true]] as const)(
  "contraste dos tokens (%s, alto contraste: %s)", (tema, alto) => {
    const t = resolver(tema, alto);
    const falhas = (nomes: string[], fundos: string[], minimo: number) => {
      const ruins: string[] = [];
      for (const n of nomes) for (const f of fundos) {
        const v = razao(t[n], t[f]);
        if (!(v >= minimo)) ruins.push(`${n} ${t[n]} sobre ${f} ${t[f]} = ${v.toFixed(2)}:1`);
      }
      return ruins;
    };
    it("texto >= 4,5:1 em todas as superfícies", () => expect(falhas(TEXTO, SUPERFICIES, 4.5)).toEqual([]));
    it("acentos usados como texto >= 4,5:1 em todas as superfícies", () => {
      if (alto) return; // alto contraste só redefine texto e bordas
      expect(falhas(ACENTOS, SUPERFICIES, 4.5)).toEqual([]);
    });
    it("steel-500 (fundo de botão com texto branco) >= 4,5:1 contra o branco", () => {
      if (alto) return;
      expect(razao("#ffffff", t["steel-500"])).toBeGreaterThanOrEqual(4.5);
    });
    it("borda de controle >= 3:1 em todas as superfícies", () => expect(falhas(["border-control"], SUPERFICIES, 3)).toEqual([]));
    it("texto sobre fundo de acento (on-accent) >= 4,5:1", () => {
      if (alto) return;
      expect(falhas(["on-accent"], ["cyan", "violet"], 4.5)).toEqual([]);
    });
  });
