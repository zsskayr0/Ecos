import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationsScreen } from "./NotificationsScreen";

const listar = vi.hoisted(() => vi.fn());
const marcarLida = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  notificacoes: { listar, marcarLida, marcarTodasLidas: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock("@/lib/refresh-bus", () => ({ useRefreshBus: () => ({ versao: 0, notificar: vi.fn() }) }));

describe("NotificationsScreen: falha de carregamento", () => {
  beforeEach(() => listar.mockReset());

  it("o botão de voltar só com ícone tem nome acessível", async () => {
    listar.mockResolvedValue({ items: [] });
    render(<MemoryRouter><NotificationsScreen /></MemoryRouter>);
    expect(screen.getByRole("button", { name: "Voltar" })).toBeTruthy();
    await screen.findByText("Nada por aqui ainda.");
  });

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

describe("NotificationsScreen: aviso de sincronização com ação", () => {
  it("'Resolver' marca como lido e leva à tela de resolução", async () => {
    listar.mockReset();
    marcarLida.mockReset();
    marcarLida.mockResolvedValue({ ok: true });
    listar.mockResolvedValue({ items: [{ id: "N1", categoria: "sync", titulo: "Problema ao sincronizar com o Google", corpo: "\"Dentista\": Editado nos dois lugares", lida: false, criado_em: new Date().toISOString(), acao_url: "/configuracoes/calendario/problemas" }] });
    render(
      <MemoryRouter initialEntries={["/notificacoes"]}>
        <Routes>
          <Route path="/notificacoes" element={<NotificationsScreen />} />
          <Route path="/configuracoes/calendario/problemas" element={<p>Tela de problemas</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText("Problema ao sincronizar com o Google")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Marcar todas como lidas" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resolver" }));
    expect(await screen.findByText("Tela de problemas")).toBeTruthy();
    expect(marcarLida).toHaveBeenCalledWith("N1");
  });
});
