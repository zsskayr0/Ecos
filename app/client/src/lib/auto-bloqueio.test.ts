import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AUTO_BLOQUEIO_PADRAO_MIN, lerAutoBloqueioMin, salvarAutoBloqueioMin, useAutoBloqueio } from "./auto-bloqueio";

beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); });
afterEach(() => { vi.useRealTimers(); });

it("o padrão é 5 minutos e valores desconhecidos voltam ao padrão", () => {
  expect(lerAutoBloqueioMin()).toBe(AUTO_BLOQUEIO_PADRAO_MIN);
  localStorage.setItem("ecos:cofre:auto-bloqueio-min", "7");
  expect(lerAutoBloqueioMin()).toBe(AUTO_BLOQUEIO_PADRAO_MIN);
  salvarAutoBloqueioMin(15);
  expect(lerAutoBloqueioMin()).toBe(15);
});

it("bloqueia depois do tempo sem interação", () => {
  const bloquear = vi.fn();
  renderHook(() => useAutoBloqueio(true, bloquear));
  act(() => { vi.advanceTimersByTime(4 * 60_000); });
  expect(bloquear).not.toHaveBeenCalled();
  act(() => { vi.advanceTimersByTime(61_000); });
  expect(bloquear).toHaveBeenCalledTimes(1);
});

it("interação reinicia a contagem", () => {
  const bloquear = vi.fn();
  renderHook(() => useAutoBloqueio(true, bloquear));
  act(() => { vi.advanceTimersByTime(4 * 60_000); });
  act(() => { window.dispatchEvent(new Event("pointerdown")); });
  act(() => { vi.advanceTimersByTime(4 * 60_000); });
  expect(bloquear).not.toHaveBeenCalled();
  act(() => { vi.advanceTimersByTime(2 * 60_000); });
  expect(bloquear).toHaveBeenCalledTimes(1);
});

it("“Nunca” desliga e Cofre fechado não agenda nada", () => {
  salvarAutoBloqueioMin(0);
  const bloquear = vi.fn();
  renderHook(() => useAutoBloqueio(true, bloquear));
  act(() => { vi.advanceTimersByTime(3 * 3_600_000); });
  expect(bloquear).not.toHaveBeenCalled();
  salvarAutoBloqueioMin(1);
  const fechado = vi.fn();
  renderHook(() => useAutoBloqueio(false, fechado));
  act(() => { vi.advanceTimersByTime(10 * 60_000); });
  expect(fechado).not.toHaveBeenCalled();
});

it("voltar de um segundo plano mais longo que o limite bloqueia na hora", () => {
  const bloquear = vi.fn();
  renderHook(() => useAutoBloqueio(true, bloquear));
  let estado: DocumentVisibilityState = "hidden";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => estado);
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
  // O relógio do aparelho andou, mas os timers ficaram congelados (como no celular em segundo plano).
  vi.setSystemTime(Date.now() + 6 * 60_000);
  estado = "visible";
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(bloquear).toHaveBeenCalledTimes(1);
});
