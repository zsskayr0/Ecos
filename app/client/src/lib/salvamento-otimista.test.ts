import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { conflitoFalso, ehFalhaTransitoria, esperaDoReenvio, separarCaptura, tituloDoCorpo, tituloEfetivo, tituloParaCriar, tituloParaEnviar } from "./salvamento-otimista";

describe("salvamento otimista", () => {
  it("falha passageira tenta de novo; recusa do servidor não", () => {
    expect(ehFalhaTransitoria(new ApiError("CONEXAO_INDISPONIVEL", "x", 0))).toBe(true);
    expect(ehFalhaTransitoria(new ApiError("RATE_LIMITED", "x", 429))).toBe(true);
    expect(ehFalhaTransitoria(new ApiError("X", "x", 503))).toBe(true);
    expect(ehFalhaTransitoria(new Error("rede"))).toBe(true);
    for (const status of [400, 401, 403, 404, 409, 413, 422]) expect(ehFalhaTransitoria(new ApiError("X", "x", status))).toBe(false);
  });

  it("espera cresce e se estabiliza em 30 s", () => {
    expect([0, 1, 2, 3, 4, 50].map(esperaDoReenvio)).toEqual([2_000, 5_000, 15_000, 30_000, 30_000, 30_000]);
    expect(esperaDoReenvio(-3)).toBe(2_000);
  });

  it("409 só de versão (texto igual ao confirmado ou ao meu) não é conflito", () => {
    const base = { titulo: "Plano", corpo: "a" };
    const servidor = { titulo: "Plano", corpo: "a", versao: 9 };
    expect(conflitoFalso(servidor, base, { titulo: "Plano", corpo: "ab" })).toBe(true);
    expect(conflitoFalso({ ...servidor, corpo: "ab" }, base, { titulo: "Plano", corpo: "ab" })).toBe(true);
    expect(conflitoFalso({ ...servidor, corpo: "de outra pessoa" }, base, { titulo: "Plano", corpo: "ab" })).toBe(false);
    expect(conflitoFalso({ ...servidor, titulo: "Outro" }, base, { titulo: "Plano", corpo: "ab" })).toBe(false);
    // Título meu em branco não conta: o servidor manteria o dele.
    expect(conflitoFalso({ ...servidor, titulo: "Outro" }, { titulo: "", corpo: "a" }, { titulo: "", corpo: "ab" })).toBe(true);
  });

  it("captura: a primeira linha inteira é o título", () => {
    expect(separarCaptura("  Comprar pão\nintegral e leite ")).toEqual({ titulo: "Comprar pão", corpo: "integral e leite" });
    const longa = "Lembrar de ligar para o contador sobre a declaração do ano passado e também pedir o recibo da mensalidade da escola do mais novo";
    expect(longa.length).toBeGreaterThan(120);
    expect(separarCaptura(longa)).toEqual({ titulo: longa, corpo: "" });
  });

  it("captura gigante: título cortado em palavra inteira e texto completo no corpo", () => {
    const enorme = "palavra ".repeat(60).trim();
    const r = separarCaptura(enorme);
    expect(r.titulo.endsWith("palavra…")).toBe(true);
    expect(r.titulo.length).toBeLessThanOrEqual(201);
    expect(r.corpo).toBe(enorme);
  });

  it("título em branco vem do corpo ao criar e some do envio ao editar", () => {
    expect(tituloDoCorpo("\n## Reunião de quinta\ntexto")).toBe("Reunião de quinta");
    expect(tituloDoCorpo("- [ ] Pagar a luz")).toBe("Pagar a luz");
    expect(tituloDoCorpo("   \n")).toBe("");
    expect(tituloParaCriar("  ", "Ideia solta")).toBe("Ideia solta");
    expect(tituloParaCriar("Meu", "outro")).toBe("Meu");
    expect(tituloParaEnviar("  ")).toEqual({});
    expect(tituloParaEnviar("Novo")).toEqual({ titulo: "Novo" });
    expect(tituloEfetivo("", "Base")).toBe("Base");
    expect(tituloEfetivo("X", "Base")).toBe("X");
  });
});
