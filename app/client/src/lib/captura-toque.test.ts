import { describe, expect, it } from "vitest";
import { dataDoPrazoRapido } from "./captura-toque";

describe("prazo rápido da captura", () => {
  it("hoje e amanhã usam a data local, inclusive na virada do mês", () => {
    const agora = new Date(2026, 9, 31, 23, 30);
    expect(dataDoPrazoRapido("hoje", agora)).toBe("2026-10-31");
    expect(dataDoPrazoRapido("amanha", agora)).toBe("2026-11-01");
  });
});
