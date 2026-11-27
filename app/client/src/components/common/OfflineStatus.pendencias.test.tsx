import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

vi.mock("@/lib/offline-store", () => ({
  obterEstadoOffline: () => ({ servidorDisponivel: true, sincronizando: false, pendentes: 1, erro: "Recurso não encontrado." }),
  marcarServidorDisponivel: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ sincronizarPendenciasOffline: vi.fn().mockResolvedValue(0) }));
vi.mock("@/lib/refresh-bus", () => ({ useRefreshBus: () => ({ notificar: vi.fn() }) }));

import { OfflineStatus } from "./OfflineStatus";

it("clicar no aviso de sincronização abre a tela de Pendências", () => {
  const abrir = vi.fn();
  window.addEventListener("ecos:abrir-rota", (e) => abrir((e as CustomEvent<string>).detail));
  render(<OfflineStatus />);
  const aviso = screen.getByRole("status");
  expect(aviso.textContent).toContain("Sincronização pendente");
  fireEvent.click(aviso);
  expect(abrir).toHaveBeenCalledWith("/configuracoes/pendencias");
});

it("o aviso some enquanto a tela de Pendências está aberta", async () => {
  render(<OfflineStatus />);
  expect(screen.queryByRole("status")).not.toBeNull();
  const { act } = await import("@testing-library/react");
  act(() => { window.dispatchEvent(new CustomEvent("ecos:pendencias-aberta", { detail: true })); });
  expect(screen.queryByRole("status")).toBeNull();
});
