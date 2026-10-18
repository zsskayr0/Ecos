import { describe, expect, it } from "vitest";
import { trechoCasado } from "./wikilink-autocompletar";

describe("trechoCasado", () => {
  it("destaca ignorando acento e caixa", () => {
    expect(trechoCasado("Açaí do João", "acai")).toEqual([0, 4]);
    expect(trechoCasado("Reunião de Projeto", "PROJ")).toEqual([11, 15]);
  });
  it("sem trecho contíguo ou sem consulta não destaca", () => {
    expect(trechoCasado("Projeto X", "pjx")).toBeNull();
    expect(trechoCasado("Projeto X", "")).toBeNull();
  });
});
