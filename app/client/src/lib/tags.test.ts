import { describe, expect, it } from "vitest";
import { canonicaTag, normalizarTags } from "./tags";

// Espelha os casos de `ecos_core::tags` (servidor): a mesma regra nos dois lados.
describe("canonicaTag", () => {
  it("ignora caixa, # inicial e espaços", () => {
    expect(canonicaTag("  #Projeto  Ecos ")).toBe("projeto-ecos");
  });
  it("recusa vazia, com vírgula ou longa demais", () => {
    expect(canonicaTag("##")).toBeNull();
    expect(canonicaTag("a,b")).toBeNull();
    expect(canonicaTag("x".repeat(49))).toBeNull();
  });
  it("normalizarTags remove duplicatas mantendo a ordem", () => {
    expect(normalizarTags(["Casa", "#casa", "casa ", "Obra"])).toEqual(["casa", "obra"]);
  });
});
