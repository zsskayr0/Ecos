import { describe, expect, it } from "vitest";
import { medirImagemEmLinhas } from "./imagem-linha";

describe("medirImagemEmLinhas", () => {
  it("encolhe para linhas inteiras e nunca cresce", () => {
    const m = medirImagemEmLinhas(800, 500, 600, 24, 2000);
    expect(m.altura % 24).toBe(0);
    expect(m.altura).toBeLessThanOrEqual(375);
    expect(m.largura / m.altura).toBeCloseTo(800 / 500);
    expect(m.folga).toBe(0);
  });
  it("imagem menor que uma linha mantém o tamanho e reserva a linha inteira", () => {
    const m = medirImagemEmLinhas(40, 10, 600, 24, 2000);
    expect(m.altura).toBe(10);
    expect(m.folga).toBe(14);
  });
  it("respeita a largura pedida e a altura máxima", () => {
    expect(medirImagemEmLinhas(800, 400, 600, 24, 2000, 200).largura).toBeLessThanOrEqual(200);
    expect(medirImagemEmLinhas(100, 1000, 600, 24, 240).altura).toBe(240);
  });
});
