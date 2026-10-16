import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { marcarServidorDisponivel } from "./offline-store";
import { estaOnline, useConectividade } from "./use-conectividade";

function redeLocal(valor: boolean) {
  Object.defineProperty(window.navigator, "onLine", { value: valor, configurable: true });
  window.dispatchEvent(new Event(valor ? "online" : "offline"));
}

afterEach(() => {
  redeLocal(true);
  marcarServidorDisponivel(true);
});

describe("useConectividade", () => {
  it("fica offline quando o navegador perde a rede e volta ao reconectar", () => {
    const { result } = renderHook(() => useConectividade());
    expect(result.current.online).toBe(true);
    act(() => redeLocal(false));
    expect(result.current.online).toBe(false);
    expect(estaOnline()).toBe(false);
    act(() => redeLocal(true));
    act(() => marcarServidorDisponivel(true));
    expect(result.current.online).toBe(true);
  });

  it("fica offline quando o servidor deixa de responder mesmo com rede local", () => {
    const { result } = renderHook(() => useConectividade());
    act(() => marcarServidorDisponivel(false));
    expect(result.current.online).toBe(false);
    act(() => marcarServidorDisponivel(true));
    expect(result.current.online).toBe(true);
  });
});
