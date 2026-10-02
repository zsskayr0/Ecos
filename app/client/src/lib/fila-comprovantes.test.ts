import { beforeEach, expect, it, vi } from "vitest";
import { enfileirarComprovantes, inscreverFila, limparFilaDeComprovantes, quantosEsperando, tomarComprovantes } from "./fila-comprovantes";

const arq = (nome: string) => new File(["x"], nome, { type: "application/pdf" });

beforeEach(() => limparFilaDeComprovantes());

it("guarda em memória, entrega tudo uma única vez e zera", () => {
  enfileirarComprovantes([arq("a.pdf"), arq("b.pdf")]);
  enfileirarComprovantes([arq("c.pdf")]);
  expect(quantosEsperando()).toBe(3);
  expect(tomarComprovantes().map((f) => f.name)).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
  expect(quantosEsperando()).toBe(0);
  expect(tomarComprovantes()).toEqual([]);
});

it("avisa quem está inscrito ao entrar e ao sair, e para de avisar depois de cancelar", () => {
  const ouvinte = vi.fn();
  const cancelar = inscreverFila(ouvinte);
  enfileirarComprovantes([arq("a.pdf")]);
  expect(ouvinte).toHaveBeenCalledTimes(1);
  tomarComprovantes();
  expect(ouvinte).toHaveBeenCalledTimes(2);
  cancelar();
  enfileirarComprovantes([arq("b.pdf")]);
  expect(ouvinte).toHaveBeenCalledTimes(2);
});

it("lista vazia não acorda ninguém", () => {
  const ouvinte = vi.fn();
  inscreverFila(ouvinte);
  enfileirarComprovantes([]);
  tomarComprovantes();
  expect(ouvinte).not.toHaveBeenCalled();
});
