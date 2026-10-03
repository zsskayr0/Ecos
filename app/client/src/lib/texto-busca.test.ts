import { describe, expect, it } from "vitest";
import { casaBusca, normalizarTexto } from "./texto-busca";

describe("normalizarTexto", () => {
  it("tira acento, caixa e pontuação", () => {
    expect(normalizarTexto("  Açaí-do  João, S/A! ")).toBe("acai do joao s a");
    expect(normalizarTexto("PÃO DE AÇÚCAR")).toBe("pao de acucar");
    expect(normalizarTexto("")).toBe("");
  });
});

describe("casaBusca", () => {
  it("não diferencia acento nem maiúscula, nos dois sentidos", () => {
    expect(casaBusca("acai", "Açaí da esquina")).toBe(true);
    expect(casaBusca("AÇAÍ", "acai da esquina")).toBe(true);
    expect(casaBusca("joão", "Pagamento Joao")).toBe(true);
  });

  it("todas as palavras precisam aparecer, em qualquer campo e em qualquer ordem", () => {
    expect(casaBusca("luz casa", "Conta de luz", null, "Casa")).toBe(true);
    expect(casaBusca("luz mercado", "Conta de luz", "Casa")).toBe(false);
  });

  it("consulta vazia ou só pontuação casa com tudo; campo nulo é ignorado", () => {
    expect(casaBusca("", "qualquer")).toBe(true);
    expect(casaBusca("  ", undefined)).toBe(true);
    expect(casaBusca("x", null, undefined)).toBe(false);
  });

  it("acha valor e data como a pessoa escreve", () => {
    expect(casaBusca("150,00", "Aluguel", "150,00")).toBe(true);
    expect(casaBusca("02/10/2026", "x", "02/10/2026 2026-10-02")).toBe(true);
  });
});
