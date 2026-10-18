import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentoJanela } from "./DocumentoJanela";

const abrir = (aoFechar = vi.fn()) => render(<DocumentoJanela path="/tarefa/123" ordem={0} z={1} aoFechar={aoFechar} aoFocar={vi.fn()} conteudo={<p>Conteúdo da tarefa</p>} />);

describe("modo Focus da tarefa", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.useRealTimers());

  it("maximizar só alterna o estado: o botão entra e sai do Focus sem fechar a janela", () => {
    vi.useFakeTimers();
    const fechar = vi.fn();
    abrir(fechar);

    fireEvent.click(screen.getByRole("button", { name: "Abrir em modo Focus" }));
    fireEvent.click(screen.getByRole("button", { name: "Sair do modo Focus" }));
    act(() => { vi.advanceTimersByTime(400); });
    expect(screen.getByRole("button", { name: "Abrir em modo Focus" })).toBeTruthy();
    expect(fechar).not.toHaveBeenCalled();
  });

  it("um único Esc no Focus fecha a janela de uma vez", () => {
    vi.useFakeTimers();
    const fechar = vi.fn();
    abrir(fechar);

    fireEvent.click(screen.getByRole("button", { name: "Abrir em modo Focus" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    act(() => { vi.runAllTimers(); });
    expect(fechar).toHaveBeenCalledTimes(1);
  });

  it("o X do Focus também fecha direto", () => {
    vi.useFakeTimers();
    const fechar = vi.fn();
    abrir(fechar);

    fireEvent.click(screen.getByRole("button", { name: "Abrir em modo Focus" }));
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    act(() => { vi.runAllTimers(); });
    expect(fechar).toHaveBeenCalledTimes(1);
  });

  it("com a preferência ligada, a tarefa já abre maximizada", () => {
    localStorage.setItem("ecos:preferencias-aplicativo:v1", JSON.stringify({ tarefaMaximizada: true }));
    abrir();
    expect(screen.getByRole("button", { name: "Sair do modo Focus" })).toBeTruthy();
  });

  it("ao sair do Focus a janela normal volta com o foco, e o Esc já fecha sem clicar nela", () => {
    vi.useFakeTimers();
    const fechar = vi.fn();
    abrir(fechar);

    fireEvent.click(screen.getByRole("button", { name: "Abrir em modo Focus" }));
    fireEvent.click(screen.getByRole("button", { name: "Sair do modo Focus" }));
    act(() => { vi.advanceTimersByTime(400); });
    expect(document.activeElement?.getAttribute("role")).toBe("dialog");
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    act(() => { vi.runAllTimers(); });
    expect(fechar).toHaveBeenCalledTimes(1);
  });
});
