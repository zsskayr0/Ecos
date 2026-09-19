import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { useEdicaoOtimista } from "./agenda-otimista";

interface Item { id: string; x: number; y: number }
type Patch = Partial<Omit<Item, "id">>;

function montar(salvar: (id: string, p: Patch) => Promise<unknown>, atrasoMs = 350) {
  const aoConfirmar = vi.fn();
  const aoFalhar = vi.fn();
  const hook = renderHook(() => {
    const [itens, setItens] = useState<Item[]>([{ id: "a", x: 1, y: 1 }, { id: "b", x: 5, y: 5 }]);
    const { editar } = useEdicaoOtimista<Item, Patch>({ itens, setItens, salvar, aplicar: (i, p) => ({ ...i, ...p }), aoConfirmar, aoFalhar, atrasoMs });
    return { itens, editar };
  });
  return { ...hook, aoConfirmar, aoFalhar };
}
const item = (r: { current: { itens: Item[] } }, id: string) => r.current.itens.find((i) => i.id === id)!;

describe("edição otimista", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("a tela muda antes de o servidor responder, e depois confirma", async () => {
    let responder!: () => void;
    const salvar = vi.fn(() => new Promise<void>((ok) => { responder = ok; }));
    const { result, aoConfirmar } = montar(salvar);
    act(() => result.current.editar("a", { x: 9 }));
    expect(item(result, "a").x).toBe(9); // já mudou
    expect(salvar).toHaveBeenCalledWith("a", { x: 9 });
    expect(aoConfirmar).not.toHaveBeenCalled();
    await act(async () => { responder(); });
    expect(aoConfirmar).toHaveBeenCalledTimes(1);
    expect(item(result, "a").x).toBe(9);
  });

  it("se o servidor recusar, o item volta ao que estava e o erro é avisado", async () => {
    const erro = new Error("recusado");
    const { result, aoFalhar, aoConfirmar } = montar(() => Promise.reject(erro));
    act(() => result.current.editar("a", { x: 9, y: 9 }));
    expect(item(result, "a")).toEqual({ id: "a", x: 9, y: 9 });
    await act(async () => { await Promise.resolve(); });
    expect(item(result, "a")).toEqual({ id: "a", x: 1, y: 1 }); // rollback
    expect(aoFalhar).toHaveBeenCalledWith(erro, "a");
    expect(aoConfirmar).not.toHaveBeenCalled();
  });

  it("o rollback só mexe no item que falhou", async () => {
    const { result } = montar((id) => (id === "a" ? Promise.reject(new Error("x")) : Promise.resolve()));
    act(() => { result.current.editar("a", { x: 9 }); result.current.editar("b", { x: 50 }); });
    await act(async () => { await Promise.resolve(); });
    expect(item(result, "a").x).toBe(1);
    expect(item(result, "b").x).toBe(50);
  });

  it("edições em rajada (teclado) viram um único envio, com os campos acumulados", async () => {
    const salvar = vi.fn(() => Promise.resolve());
    const { result } = montar(salvar);
    act(() => {
      result.current.editar("a", { x: 2 }, { imediato: false });
      result.current.editar("a", { x: 3 }, { imediato: false });
      result.current.editar("a", { y: 7 }, { imediato: false });
    });
    expect(item(result, "a")).toEqual({ id: "a", x: 3, y: 7 }); // tela já reflete tudo
    expect(salvar).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(349); });
    expect(salvar).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(salvar).toHaveBeenCalledTimes(1);
    expect(salvar).toHaveBeenCalledWith("a", { x: 3, y: 7 });
  });

  it("falha depois de uma rajada volta ao estado confirmado, não a um estado intermediário", async () => {
    const { result, aoFalhar } = montar(() => Promise.reject(new Error("x")));
    act(() => { result.current.editar("a", { x: 2 }, { imediato: false }); result.current.editar("a", { x: 3 }, { imediato: false }); });
    await act(async () => { vi.advanceTimersByTime(400); await Promise.resolve(); });
    expect(item(result, "a")).toEqual({ id: "a", x: 1, y: 1 });
    expect(aoFalhar).toHaveBeenCalledTimes(1);
  });

  it("não há dois envios em voo para o mesmo item: a edição que chega no meio espera o envio anterior", async () => {
    const resolvers: (() => void)[] = [];
    const salvar = vi.fn(() => new Promise<void>((ok) => { resolvers.push(ok); }));
    const { result, aoConfirmar } = montar(salvar);
    act(() => result.current.editar("a", { x: 2 }));
    act(() => result.current.editar("a", { y: 8 })); // chega com o primeiro ainda em voo
    expect(salvar).toHaveBeenCalledTimes(1);
    await act(async () => { resolvers[0](); });
    expect(salvar).toHaveBeenCalledTimes(2);
    expect(salvar).toHaveBeenLastCalledWith("a", { y: 8 });
    expect(aoConfirmar).not.toHaveBeenCalled(); // ainda falta o segundo
    await act(async () => { resolvers[1](); });
    expect(aoConfirmar).toHaveBeenCalledTimes(1);
    expect(item(result, "a")).toEqual({ id: "a", x: 2, y: 8 });
  });

  it("falha no 2º envio volta ao que o 1º já tinha confirmado", async () => {
    const resolvers: { ok: () => void; falha: (e: Error) => void }[] = [];
    const salvar = vi.fn(() => new Promise<void>((ok, falha) => { resolvers.push({ ok, falha }); }));
    const { result } = montar(salvar);
    act(() => result.current.editar("a", { x: 2 }));
    act(() => result.current.editar("a", { y: 8 }));
    await act(async () => { resolvers[0].ok(); });
    await act(async () => { resolvers[1].falha(new Error("x")); });
    expect(item(result, "a")).toEqual({ id: "a", x: 2, y: 1 });
  });

  it("ao desmontar, a edição que ainda esperava o tempo de juntar é enviada", () => {
    const salvar = vi.fn(() => Promise.resolve());
    const { result, unmount } = montar(salvar);
    act(() => result.current.editar("a", { x: 4 }, { imediato: false }));
    expect(salvar).not.toHaveBeenCalled();
    unmount();
    expect(salvar).toHaveBeenCalledWith("a", { x: 4 });
  });

  it("edição de item que não existe é ignorada", () => {
    const salvar = vi.fn(() => Promise.resolve());
    const { result } = montar(salvar);
    act(() => result.current.editar("nada", { x: 1 }));
    expect(salvar).not.toHaveBeenCalled();
  });
});
