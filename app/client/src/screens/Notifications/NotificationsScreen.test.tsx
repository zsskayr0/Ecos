import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationsScreen } from "./NotificationsScreen";

const listar = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  notificacoes: { listar, marcarLida: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock("@/lib/refresh-bus", () => ({ useRefreshBus: () => ({ versao: 0, notificar: vi.fn() }) }));

describe("NotificationsScreen: falha de carregamento", () => {
  beforeEach(() => listar.mockReset());

  it("troca o carregamento por erro com Tentar de novo, que refaz a chamada", async () => {
    listar.mockRejectedValueOnce(new Error("falhou")).mockResolvedValueOnce({ items: [] });
    render(<MemoryRouter><NotificationsScreen /></MemoryRouter>);
    const botao = await screen.findByRole("button", { name: "Tentar de novo" });
    expect(screen.queryByText("Carregando…")).toBeNull();
    expect(listar).toHaveBeenCalledTimes(1);
    fireEvent.click(botao);
    await waitFor(() => expect(listar).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Nada por aqui ainda.")).toBeTruthy();
  });
});
