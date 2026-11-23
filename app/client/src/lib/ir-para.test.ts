import { describe, expect, it, vi } from "vitest";
import { aoPedirIr, consumirPedido, linhaDoAlvo, pedirIr } from "./ir-para";

const corpo = [
  "Intro",
  "```",
  "[[Escondido]] https://codigo.com",
  "```",
  "- [Docs](https://exemplo.com/a)",
  "Veja [[tarefa:Pagar luz|a conta]] e [[Reunião de Equipe]].",
].join("\n");

describe("ver onde está", () => {
  it("acha o link externo e o wikilink (com prefixo, apelido, acento e caixa) ignorando código", () => {
    expect(linhaDoAlvo(corpo, { url: "https://exemplo.com/a" })).toBe(5);
    expect(linhaDoAlvo(corpo, { wikilink: "Pagar luz" })).toBe(6);
    expect(linhaDoAlvo(corpo, { wikilink: "reuniao de equipe" })).toBe(6);
    expect(linhaDoAlvo(corpo, { wikilink: "Escondido" })).toBeNull();
    expect(linhaDoAlvo(corpo, { url: "https://codigo.com" })).toBeNull();
    expect(linhaDoAlvo(corpo, { url: "https://nao-tem.com" })).toBeNull();
  });

  it("o pedido vale uma vez, por item, e avisa janelas já abertas", () => {
    const aviso = vi.fn();
    const desligar = aoPedirIr("n1", aviso);
    pedirIr("n2", { url: "https://a.com" });
    expect(aviso).not.toHaveBeenCalled();
    pedirIr("n1", { wikilink: "X" });
    expect(aviso).toHaveBeenCalledTimes(1);
    expect(consumirPedido("n1")).toEqual({ wikilink: "X" });
    expect(consumirPedido("n1")).toBeNull();
    desligar();
    pedirIr("n1", { wikilink: "Y" });
    expect(aviso).toHaveBeenCalledTimes(1);
    expect(consumirPedido("n2")).toEqual({ url: "https://a.com" });
  });

  it("pedido velho é descartado", () => {
    vi.useFakeTimers();
    pedirIr("n3", { url: "https://a.com" });
    vi.advanceTimersByTime(20_000);
    expect(consumirPedido("n3")).toBeNull();
    vi.useRealTimers();
  });
});
