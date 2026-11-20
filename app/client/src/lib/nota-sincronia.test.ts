import { describe, expect, it } from "vitest";
import { cabeNoKeepalive, diffLinhas, LIMITE_KEEPALIVE_BYTES, lerConflito, quedaSuspeita } from "./nota-sincronia";

describe("diffLinhas", () => {
  it("marca linhas iguais, removidas (servidor) e adicionadas (minhas)", () => {
    expect(diffLinhas("a\nb\nc", "a\nB\nc\nd")).toEqual([
      { tipo: "igual", texto: "a" },
      { tipo: "removida", texto: "b" },
      { tipo: "adicionada", texto: "B" },
      { tipo: "igual", texto: "c" },
      { tipo: "adicionada", texto: "d" },
    ]);
  });
  it("textos iguais não têm diferença", () => {
    expect(diffLinhas("x\ny", "x\ny").every((l) => l.tipo === "igual")).toBe(true);
  });
  it("de vazio para conteúdo", () => {
    expect(diffLinhas("", "novo").filter((l) => l.tipo !== "igual").map((l) => l.tipo)).toEqual(["removida", "adicionada"]);
  });
});

describe("quedaSuspeita", () => {
  it("conteúdo para vazio pede confirmação", () => expect(quedaSuspeita("um texto qualquer", "   ")).toBe(true));
  it("queda de mais de 80% pede confirmação", () => expect(quedaSuspeita("x".repeat(100), "x".repeat(19))).toBe(true));
  it("queda até 80% não pede", () => expect(quedaSuspeita("x".repeat(100), "x".repeat(20))).toBe(false));
  it("nota que já estava vazia não pede", () => expect(quedaSuspeita("", "")).toBe(false));
});

describe("keepalive", () => {
  it("só cabe abaixo de 60 KB (em bytes, não caracteres)", () => {
    expect(cabeNoKeepalive("a".repeat(LIMITE_KEEPALIVE_BYTES - 1))).toBe(true);
    expect(cabeNoKeepalive("a".repeat(LIMITE_KEEPALIVE_BYTES))).toBe(false);
    expect(cabeNoKeepalive("é".repeat(LIMITE_KEEPALIVE_BYTES / 2))).toBe(false);
  });
});

describe("lerConflito", () => {
  it("lê o `atual` do 409", () => {
    expect(lerConflito({ atual: { titulo: "T", corpo: "c", versao: 7, atualizado_em: "x" } })).toEqual({ titulo: "T", corpo: "c", versao: 7, atualizado_em: "x" });
  });
  it("sem dados válidos devolve null", () => {
    expect(lerConflito(undefined)).toBeNull();
    expect(lerConflito({ atual: { corpo: "c" } })).toBeNull();
  });
});
