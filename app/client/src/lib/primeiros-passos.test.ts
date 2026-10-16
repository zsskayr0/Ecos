import { afterEach, describe, expect, it, vi } from "vitest";
import { consumirFocoNaCaptura, criarExemplosIniciais, pedirFocoNaCaptura } from "./primeiros-passos";
import { notas, tarefas } from "./api";

afterEach(() => vi.restoreAllMocks());

describe("primeiros passos", () => {
  it("o pedido de foco é consumido uma única vez", () => {
    expect(consumirFocoNaCaptura()).toBe(false);
    pedirFocoNaCaptura();
    expect(consumirFocoNaCaptura()).toBe(true);
    expect(consumirFocoNaCaptura()).toBe(false);
  });

  it("cria uma nota e uma tarefa de exemplo", async () => {
    const nota = vi.spyOn(notas, "criar").mockResolvedValue({ id: "n1" } as never);
    const tarefa = vi.spyOn(tarefas, "criar").mockResolvedValue({ id: "t1" } as never);
    await criarExemplosIniciais();
    expect(nota).toHaveBeenCalledTimes(1);
    expect(tarefa).toHaveBeenCalledTimes(1);
  });

  it("não propaga falha de rede", async () => {
    vi.spyOn(notas, "criar").mockRejectedValue(new Error("offline"));
    await expect(criarExemplosIniciais()).resolves.toBeUndefined();
  });
});
