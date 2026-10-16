import { describe, expect, it } from "vitest";
import { interpretarConsulta } from "./CommandPalette";

describe("interpretarConsulta", () => {
  it("sem prefixo mantém o filtro escolhido nos botões", () => {
    expect(interpretarConsulta("  reunião ", "notas")).toEqual({ texto: "reunião", filtro: "notas" });
  });
  it("prefixos escolhem o filtro e saem do termo", () => {
    expect(interpretarConsulta(">nova", "tudo")).toEqual({ texto: "nova", filtro: "comandos" });
    expect(interpretarConsulta("n: ideias", "tudo")).toEqual({ texto: "ideias", filtro: "notas" });
    expect(interpretarConsulta("T:pagar conta", "notas")).toEqual({ texto: "pagar conta", filtro: "tarefas" });
  });
  it("palavra que só começa com n ou t não vira prefixo", () => {
    expect(interpretarConsulta("nota fiscal", "tudo")).toEqual({ texto: "nota fiscal", filtro: "tudo" });
  });
});
