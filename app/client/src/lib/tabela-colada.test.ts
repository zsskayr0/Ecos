import { describe, expect, it } from "vitest";
import { linhasDaTabela, separarTextoColadoNaTabela } from "./tabela-colada";

describe("texto colado na tabela", () => {
  it("separa o texto da tabela com uma linha em branco", () => {
    expect(separarTextoColadoNaTabela("| a | b |\n|---|---|\n| 1 | 2 |\ntexto aqui\noutra")).toBe("| a | b |\n|---|---|\n| 1 | 2 |\n\ntexto aqui\noutra");
  });
  it("não mexe em tabela já separada nem em bloco de código", () => {
    const ok = "| a | b |\n|---|---|\n| 1 | 2 |\n\ntexto";
    expect(separarTextoColadoNaTabela(ok)).toBe(ok);
    const cod = "```\n| a |\n|---|\nsolto\n```";
    expect(separarTextoColadoNaTabela(cod)).toBe(cod);
  });
  it("linhasDaTabela para na primeira linha sem barra", () => {
    expect(linhasDaTabela(["| a |", "|---|", "| 1 |", "texto"])).toBe(3);
  });
});

import { acharTabelas } from "./tabela-colada";
describe("acharTabelas", () => {
  it("acha a tabela mesmo com texto colado embaixo e ignora código", () => {
    expect(acharTabelas(["x", "| a | b |", "| --- | --- |", "| 1 | 2 |", "Cuidado: texto", "```", "| c |", "|---|", "```"])).toEqual([{ de: 1, ate: 3 }]);
  });
});
