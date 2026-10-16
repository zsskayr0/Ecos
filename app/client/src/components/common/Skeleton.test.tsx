import { lazy } from "react";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAtraso } from "@/lib/use-atraso";
import { Skeleton, SkeletonCards, SkeletonLista, SkeletonRegiao, SkeletonTabela, SkeletonTela } from "./Skeleton";
import { TelaSobDemanda } from "./TelaSobDemanda";
import { readFileSync } from "node:fs";

const css = readFileSync("src/styles/global.css", "utf8");

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("useAtraso", () => {
  it("só vira true depois do atraso e volta a false ao desligar", () => {
    const { result, rerender } = renderHook(({ a }) => useAtraso(a, 150), { initialProps: { a: true } });
    expect(result.current).toBe(false);
    act(() => { vi.advanceTimersByTime(149); });
    expect(result.current).toBe(false);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe(true);
    rerender({ a: false });
    expect(result.current).toBe(false);
  });

  it("cancela o temporizador se o carregamento terminar antes", () => {
    const { result, rerender } = renderHook(({ a }) => useAtraso(a, 150), { initialProps: { a: true } });
    act(() => { vi.advanceTimersByTime(100); });
    rerender({ a: false });
    act(() => { vi.advanceTimersByTime(500); });
    expect(result.current).toBe(false);
  });
});

describe("SkeletonRegiao", () => {
  it("expõe role=status, aria-busy e texto para leitor de tela desde o início", () => {
    render(<SkeletonRegiao rotulo="Carregando Feed…"><Skeleton /></SkeletonRegiao>);
    expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText("Carregando Feed…").className).toContain("sr-only");
  });

  it("não desenha as peças antes do atraso e as esconde da acessibilidade depois", () => {
    const { container } = render(<SkeletonRegiao><Skeleton variante="circulo" /></SkeletonRegiao>);
    expect(container.querySelector("[data-skeleton]")).toBeNull();
    act(() => { vi.advanceTimersByTime(150); });
    const peca = container.querySelector("[data-skeleton]")!;
    expect(peca.getAttribute("aria-hidden")).toBe("true");
    expect(peca.parentElement?.getAttribute("aria-hidden")).toBe("true");
  });

  it("atrasoMs=0 desenha na hora", () => {
    const { container } = render(<SkeletonRegiao atrasoMs={0}><Skeleton /></SkeletonRegiao>);
    expect(container.querySelector("[data-skeleton]")).not.toBeNull();
  });
});

describe("animação", () => {
  it("usa só opacity e é desligada com prefers-reduced-motion", () => {
    const { container } = render(<Skeleton />);
    expect(container.querySelector(".ecos-skeleton")).not.toBeNull();
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.ecos-skeleton\s*\{\s*animation:\s*none/);
    const keyframes = css.match(/@keyframes ecos-skeleton-pulso\s*\{[^@]*\}\s*\n/)?.[0] ?? "";
    expect(keyframes).toContain("opacity");
    expect(keyframes).not.toMatch(/transform|width|height|margin/);
  });
});

describe("composições", () => {
  it("cada composição é uma região de carregamento com rótulo", () => {
    render(<><SkeletonCards rotulo="A" /><SkeletonLista rotulo="B" /><SkeletonTabela rotulo="C" /><SkeletonTela rotulo="D" /></>);
    expect(screen.getAllByRole("status")).toHaveLength(4);
    for (const r of ["A", "B", "C", "D"]) expect(screen.getByText(r)).toBeTruthy();
  });
});

describe("TelaSobDemanda", () => {
  it("o fallback anuncia o estado e só mostra o skeleton depois do atraso curto", () => {
    const Pendente = lazy(() => new Promise<never>(() => {}));
    const { container } = render(<TelaSobDemanda><Pendente /></TelaSobDemanda>);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(container.querySelector("[data-skeleton]")).toBeNull();
    act(() => { vi.advanceTimersByTime(120); });
    expect(container.querySelector("[data-skeleton]")).not.toBeNull();
  });
});
