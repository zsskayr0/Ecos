import { describe, expect, it } from "vitest";
import { rotuloAdiamento } from "./format";

describe("rotuloAdiamento", () => {
  it("nunca adiada não mostra nada", () => {
    expect(rotuloAdiamento(null, 0)).toBe("");
    expect(rotuloAdiamento(undefined, undefined)).toBe("");
  });
  it("prazo mostra a data original e quantas vezes", () => {
    expect(rotuloAdiamento("2026-11-20", 1)).toBe("Adiada 1 vez · data original 20/11/2026");
    expect(rotuloAdiamento("2026-11-20", 3)).toBe("Adiada 3 vezes · data original 20/11/2026");
  });
  it("horário mostra data e hora locais", () => {
    expect(rotuloAdiamento("2026-11-20T13:05:00", 2)).toBe("Adiada 2 vezes · data original 20/11/2026 às 13:05");
  });
});

import { isoDoSqlite } from "./format";
describe("isoDoSqlite", () => {
  it("lê o datetime do SQLite como UTC", () => {
    expect(isoDoSqlite("2026-11-27 06:00:00")).toBe("2026-11-27T06:00:00Z");
    expect(isoDoSqlite("2026-11-27T06:00:00Z")).toBe("2026-11-27T06:00:00Z");
  });
});
