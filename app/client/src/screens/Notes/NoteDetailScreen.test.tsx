import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { obter, desktop } = vi.hoisted(() => ({ obter: vi.fn(), desktop: { valor: false } }));

vi.mock("@/lib/api", async () => {
  const real = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...real, notas: { ...real.notas, obter } };
});
vi.mock("@/lib/use-viewport", async () => {
  const real = await vi.importActual<typeof import("@/lib/use-viewport")>("@/lib/use-viewport");
  return { ...real, useIsDesktop: () => desktop.valor };
});

import { ApiError } from "@/lib/api";
import { RefreshProvider } from "@/lib/refresh-bus";
import { NoteDetailScreen } from "./NoteDetailScreen";

const abrir = () =>
  render(
    <RefreshProvider><MemoryRouter initialEntries={["/notas/n1"]}>
      <Routes>
        <Route path="/notas/:id" element={<NoteDetailScreen />} />
      </Routes>
    </MemoryRouter></RefreshProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});

describe.each([
  ["mobile", false],
  ["desktop", true],
])("Nota — falha ao carregar (%s)", (_nome, ehDesktop) => {
  beforeEach(() => { desktop.valor = ehDesktop; });

  it("404 mostra que a nota sumiu", async () => {
    obter.mockRejectedValue(new ApiError("NOT_FOUND", "Nota não encontrada", 404));
    abrir();
    expect(await screen.findByText("Essa nota sumiu.")).toBeTruthy();
  });

  it("queda de rede não diz que a nota sumiu e deixa tentar de novo", async () => {
    obter.mockRejectedValueOnce(new ApiError("CONEXAO_INDISPONIVEL", "Não foi possível conectar", 0));
    obter.mockRejectedValue(new ApiError("NOT_FOUND", "Nota não encontrada", 404)); // 2ª tentativa: o servidor responde (nota apagada)
    abrir();
    expect(await screen.findByText("Não consegui carregar.")).toBeTruthy();
    expect(screen.queryByText("Essa nota sumiu.")).toBeNull();
    expect(document.body.textContent).toMatch(/Sem conexão com o servidor/);
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(obter).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Essa nota sumiu.")).toBeTruthy(); // só agora, com resposta 404 do servidor
  });

  it("erro 500 também não vira 'sumiu'", async () => {
    obter.mockRejectedValue(new ApiError("INTERNAL_ERROR", "Erro interno", 500));
    abrir();
    expect(await screen.findByText("Não consegui carregar.")).toBeTruthy();
    expect(screen.queryByText("Essa nota sumiu.")).toBeNull();
  });
});
