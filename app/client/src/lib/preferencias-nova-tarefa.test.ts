import { describe, expect, it } from "vitest";
import { dataPadraoNovaTarefa } from "./preferencias-aplicativo";

describe("dataPadraoNovaTarefa", () => {
  const agora = new Date(2026, 10, 30, 23, 30); // 30/11/2026, 23:30 no relógio local
  it("usa o dia local, sem virar o dia por causa do fuso", () => {
    expect(dataPadraoNovaTarefa("hoje", agora)).toBe("2026-11-30");
  });
  it("calcula amanhã e daqui a 7 dias atravessando o mês", () => {
    expect(dataPadraoNovaTarefa("amanha", agora)).toBe("2026-12-01");
    expect(dataPadraoNovaTarefa("em7dias", agora)).toBe("2026-12-07");
  });
  it("sem data padrão devolve vazio", () => {
    expect(dataPadraoNovaTarefa("nenhuma", agora)).toBe("");
  });
});
