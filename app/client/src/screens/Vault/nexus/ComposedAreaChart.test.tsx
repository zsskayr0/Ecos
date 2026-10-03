import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ComposedAreaChart, type ComposedAreaPoint } from "./ComposedAreaChart";

const pontos: ComposedAreaPoint[] = Array.from({ length: 10 }, (_, i) => ({
  label: String(i + 1),
  incomeConfirmedCents: i === 4 ? 200000 : 0,
  expenseConfirmedCents: 30000,
  incomeForecastCents: i >= 6 ? 150000 : 0,
  expenseForecastCents: i >= 3 ? 40000 : 0,
}));

const desenho = (c: HTMLElement) => ({
  // Só as linhas pontilhadas das previsões (a faixa das previsões não tem traço).
  linhas: Array.from(c.querySelectorAll("path[stroke-dasharray]")),
  eixo: Array.from(c.querySelectorAll("text")).map((t) => t.textContent ?? "").find((t) => t.startsWith("+")),
});

beforeEach(() => { vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout", "clearTimeout"] }); });
afterEach(() => { vi.useRealTimers(); });

const avancar = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

it("com as previsões desligadas, só o confirmado aparece", () => {
  const { container } = render(<ComposedAreaChart points={pontos} incomeColor="#0f0" expenseColor="#f00" showForecast={false} />);
  avancar(2000);
  expect(desenho(container).linhas).toHaveLength(0);
});

it("ligar as previsões faz a faixa subir aos poucos (em onda) e o eixo se ajusta junto, em vez de aparecer de uma vez", () => {
  const { container, rerender } = render(<ComposedAreaChart points={pontos} incomeColor="#0f0" expenseColor="#f00" showForecast={false} />);
  avancar(1000); // termina a revelação inicial
  const eixoAntes = desenho(container).eixo;
  rerender(<ComposedAreaChart points={pontos} incomeColor="#0f0" expenseColor="#f00" showForecast />);
  avancar(200);
  const cedo = desenho(container);
  expect(cedo.linhas).toHaveLength(2);
  const opacidadeCedo = Number(cedo.linhas[0]!.getAttribute("opacity"));
  const geometriaCedo = cedo.linhas[0]!.getAttribute("d");
  avancar(450);
  const meio = desenho(container);
  const geometriaMeio = meio.linhas[0]!.getAttribute("d");
  avancar(2000);
  const fim = desenho(container);
  const geometriaFim = fim.linhas[0]!.getAttribute("d");
  const opacidadeFim = Number(fim.linhas[0]!.getAttribute("opacity"));
  // A geometria muda em cada etapa (não é um salto), e a linha aparece com opacidade crescente até o valor final.
  expect(new Set([geometriaCedo, geometriaMeio, geometriaFim]).size).toBe(3);
  expect(opacidadeCedo).toBeGreaterThan(0);
  expect(opacidadeCedo).toBeLessThan(opacidadeFim);
  expect(opacidadeFim).toBeCloseTo(0.8, 5);
  expect(eixoAntes).toBeTruthy();
});

it("desligar volta ao confirmado e remove as linhas pontilhadas ao fim da animação", () => {
  const { container, rerender } = render(<ComposedAreaChart points={pontos} incomeColor="#0f0" expenseColor="#f00" showForecast />);
  avancar(3000);
  expect(desenho(container).linhas).toHaveLength(2);
  rerender(<ComposedAreaChart points={pontos} incomeColor="#0f0" expenseColor="#f00" showForecast={false} />);
  avancar(300);
  expect(desenho(container).linhas.length).toBeGreaterThan(0); // ainda recolhendo
  avancar(3000);
  expect(desenho(container).linhas).toHaveLength(0);
});

it("virar o botão no meio da animação continua de onde estava, sem salto", () => {
  const { container, rerender } = render(<ComposedAreaChart points={pontos} incomeColor="#0f0" expenseColor="#f00" showForecast={false} />);
  avancar(1000);
  rerender(<ComposedAreaChart points={pontos} incomeColor="#0f0" expenseColor="#f00" showForecast />);
  avancar(500);
  const no_meio = Number(desenho(container).linhas[0]!.getAttribute("opacity"));
  rerender(<ComposedAreaChart points={pontos} incomeColor="#0f0" expenseColor="#f00" showForecast={false} />);
  avancar(16);
  const logo_depois = Number(desenho(container).linhas[0]!.getAttribute("opacity"));
  expect(Math.abs(logo_depois - no_meio)).toBeLessThan(0.1);
});

it("com 'reduzir movimento' ligado, vai direto ao resultado", () => {
  const original = window.matchMedia;
  window.matchMedia = vi.fn((q: string) => ({ matches: true, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), onchange: null, dispatchEvent: vi.fn() })) as unknown as typeof window.matchMedia;
  try {
    const { container, rerender } = render(<ComposedAreaChart points={pontos} incomeColor="#0f0" expenseColor="#f00" showForecast={false} />);
    rerender(<ComposedAreaChart points={pontos} incomeColor="#0f0" expenseColor="#f00" showForecast />);
    avancar(32);
    expect(Number(desenho(container).linhas[0]!.getAttribute("opacity"))).toBeCloseTo(0.8, 5);
  } finally {
    window.matchMedia = original;
  }
});
