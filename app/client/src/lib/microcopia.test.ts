import { describe, expect, it } from "vitest";

/**
 * Guarda de microcopy: texto de interface não cita nome de processo, variável de ambiente nem seção de documento.
 * Cobre telas e componentes fora do Cofre (que tem dono próprio) e ignora comentários e testes.
 */
const fontes = import.meta.glob(["/src/screens/**/*.tsx", "/src/components/**/*.tsx", "!/src/**/*.test.tsx", "!/src/screens/Vault/**"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const PROIBIDOS = [/ecos-app/i, /ecos-vault/i, /ECOS_[A-Z_]+/, /cargo run/, /seção \d/];

function semComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

describe("microcopy da interface", () => {
  it("nenhum texto cita processo, variável de ambiente ou seção de documento", () => {
    expect(Object.keys(fontes).length).toBeGreaterThan(50);
    const achados: string[] = [];
    for (const [arquivo, codigo] of Object.entries(fontes)) {
      const limpo = semComentarios(codigo);
      for (const regra of PROIBIDOS) {
        const m = limpo.match(regra);
        if (m) achados.push(`${arquivo}: ${m[0]}`);
      }
    }
    expect(achados).toEqual([]);
  });
});
