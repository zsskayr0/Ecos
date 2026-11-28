import { describe, expect, it } from "vitest";
import { posicaoDoPopover, quandoDoItem } from "./PopoverAncorado";

const ret = (left: number, top: number, w = 100, h = 20) => ({ left, top, right: left + w, bottom: top + h, width: w, height: h, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
const janela = { largura: 1000, altura: 800 };

describe("posicaoDoPopover", () => {
  it("fica embaixo da âncora quando cabe", () => {
    expect(posicaoDoPopover(ret(100, 100), 200, janela)).toEqual({ left: 100, top: 126, width: 320 });
  });
  it("sobe para cima da âncora quando não cabe embaixo", () => {
    expect(posicaoDoPopover(ret(100, 700), 200, janela).top).toBe(494);
  });
  it("nunca sai pela direita nem pela esquerda", () => {
    expect(posicaoDoPopover(ret(950, 100), 200, janela).left).toBe(1000 - 320 - 8);
    expect(posicaoDoPopover(ret(-20, 100), 200, janela).left).toBe(8);
  });
});

describe("quandoDoItem", () => {
  it("dia com horário e dia todo", () => {
    expect(quandoDoItem("2026-11-25", 14 * 60 + 5)).toMatch(/25.*nov.*· 14:05$/);
    expect(quandoDoItem("2026-11-25", null)).toMatch(/· dia todo$/);
  });
});
