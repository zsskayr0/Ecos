import { describe, expect, it } from "vitest";
import { PADRAO_PREFERENCIAS_APLICATIVO as P } from "@/lib/preferencias-aplicativo";
import { estimarPaginas, estiloColunaNota, QUEBRA_PAGINA } from "@/lib/tipografia-nota";

describe("tipografia da nota", () => {
  it("reconhece a linha de quebra de página sozinha na linha", () => {
    expect(QUEBRA_PAGINA.test("---pagebreak")).toBe(true);
    expect(QUEBRA_PAGINA.test("  ---PageBreak ")).toBe(true);
    expect(QUEBRA_PAGINA.test("texto ---pagebreak")).toBe(false);
  });
  it("conta páginas só no modo página, uma a mais por quebra", () => {
    expect(estimarPaginas("oi", P)).toBeNull();
    const a4 = { ...P, notaPapel: "a4" as const };
    expect(estimarPaginas("oi", a4)).toBe(1);
    expect(estimarPaginas("um\n---pagebreak\ndois\n---pagebreak\ntrês", a4)).toBe(3);
    expect(estimarPaginas(Array(200).fill("linha").join("\n"), a4)).toBeGreaterThan(1);
  });
  it("limita a largura da coluna e vira folha no modo página", () => {
    expect(estiloColunaNota(P)).toBeUndefined();
    expect(estiloColunaNota({ ...P, notaLargura: "estreita" })?.maxWidth).toBe("640px");
    expect(estiloColunaNota({ ...P, notaPapel: "carta" })?.maxWidth).toBe("816px");
  });
});
