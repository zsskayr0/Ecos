import { describe, expect, it } from "vitest";
import { dividirLinha, lerTabela } from "./tabela-widget";

describe("tabela-widget", () => {
  it("divide células respeitando pipe escapado e barras das pontas", () => {
    expect(dividirLinha("| a | b \\| c | d |")).toEqual(["a", "b | c", "d"]);
    expect(dividirLinha("a | b")).toEqual(["a", "b"]);
  });

  it("lê cabeçalho, alinhamentos e linhas, completando células faltantes", () => {
    const t = lerTabela("| Função | Seção |\n|:---|---:|\n| Todos | 1 |\n| QA |");
    expect(t?.cabecalho).toEqual(["Função", "Seção"]);
    expect(t?.alinhamentos).toEqual(["left", "right"]);
    expect(t?.linhas).toEqual([["Todos", "1"], ["QA", ""]]);
  });

  it("rejeita texto sem linha delimitadora", () => {
    expect(lerTabela("| a | b |\n| c | d |")).toBeNull();
  });
});
