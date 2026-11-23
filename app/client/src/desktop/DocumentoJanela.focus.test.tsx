import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentoJanela } from "./DocumentoJanela";

// Notas e tarefas só existem no modo Focus: não há mais a janela flutuante por trás.
const abrir = (path = "/tarefa/123", aoFechar = vi.fn(), aoFixar?: () => void) =>
  render(<DocumentoJanela path={path} ordem={0} z={1} aoFechar={aoFechar} aoFocar={vi.fn()} aoFixar={aoFixar} conteudo={<p>Conteúdo</p>} />);

describe("modo Focus de notas e tarefas", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.useRealTimers());

  it.each(["/tarefa/123", "/notas/nota/abc"])("%s abre direto no Focus, com um único diálogo e sem botão de sair do Focus", (path) => {
    abrir(path);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Sair do modo Focus" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Abrir em modo Focus" })).toBeNull();
  });

  it("um único Esc fecha de uma vez", () => {
    vi.useFakeTimers();
    const fechar = vi.fn();
    abrir("/tarefa/123", fechar);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    act(() => { vi.runAllTimers(); });
    expect(fechar).toHaveBeenCalledTimes(1);
  });

  it("o X fecha direto", () => {
    vi.useFakeTimers();
    const fechar = vi.fn();
    abrir("/notas/nota/abc", fechar);
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    act(() => { vi.runAllTimers(); });
    expect(fechar).toHaveBeenCalledTimes(1);
  });

  it("o botão de fixar fica no cabeçalho do Focus", () => {
    const fixar = vi.fn();
    abrir("/notas/nota/abc", vi.fn(), fixar);
    fireEvent.click(screen.getByRole("button", { name: "Fixar como aba" }));
    expect(fixar).toHaveBeenCalledTimes(1);
  });

  it("o painel lateral começa recolhido por padrão", () => {
    abrir();
    expect(document.querySelectorAll("[inert]").length).toBe(1);
  });

  it("com a preferência desligada o painel já abre", () => {
    localStorage.setItem("ecos:preferencias-aplicativo:v1", JSON.stringify({ focusPainelRecolhido: false }));
    abrir();
    expect(document.querySelectorAll("[inert]").length).toBe(0);
  });
});
