import { describe, expect, it } from "vitest";
import { periodoDoDia, saudacaoDoDia } from "./saudacao";

describe("saudação", () => {
  it("períodos do dia", () => {
    expect([4, 5, 11, 12, 17, 18, 23].map(periodoDoDia)).toEqual(["noite", "manha", "manha", "tarde", "tarde", "noite", "noite"]);
  });
  it("usa o primeiro nome e a hora injetada", () => {
    expect(saudacaoDoDia(new Date(2026, 9, 16, 9, 0), "Diogo Roque").saudacao).toBe("Bom dia, Diogo");
    expect(saudacaoDoDia(new Date(2026, 9, 16, 15, 0), "Ana").saudacao).toBe("Boa tarde, Ana");
    expect(saudacaoDoDia(new Date(2026, 9, 16, 21, 0), "  ").saudacao).toBe("Boa noite");
  });
  it("frase curta sempre presente", () => {
    expect(saudacaoDoDia(new Date(2026, 9, 16, 9, 0), "Ana").frase.length).toBeGreaterThan(3);
  });
});
