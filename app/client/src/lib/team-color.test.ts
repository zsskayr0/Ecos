import { beforeEach, describe, expect, it } from "vitest";
import { corDaEquipe, corLocalPendente, registrarCoresDasEquipes } from "./team-color";

describe("cor da equipe", () => {
  beforeEach(() => localStorage.clear());

  it("deriva uma cor estável do id quando nada foi informado", () => {
    expect(corDaEquipe("equipe-sem-cor")).toBe(corDaEquipe("equipe-sem-cor"));
    expect(corDaEquipe("equipe-sem-cor")).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it("a cor do servidor vale mais que a cópia local", () => {
    localStorage.setItem("ecos:cor-equipe:E1", "#111111");
    expect(corDaEquipe("E1")).toBe("#111111");
    registrarCoresDasEquipes([{ id: "E1", cor: "#22C55E" }]);
    expect(corDaEquipe("E1")).toBe("#22C55E");
  });

  it("só considera pendente a escolha local diferente da do servidor e bem formada", () => {
    localStorage.setItem("ecos:cor-equipe:E2", "#abcdef");
    expect(corLocalPendente("E2", "#ABCDEF")).toBeNull();
    expect(corLocalPendente("E2", "#000000")).toBe("#abcdef");
    localStorage.setItem("ecos:cor-equipe:E3", "javascript:x");
    expect(corLocalPendente("E3", "#000000")).toBeNull();
  });
});
