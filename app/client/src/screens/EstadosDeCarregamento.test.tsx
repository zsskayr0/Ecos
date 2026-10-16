import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listarNotificacoes, listarLixeira, metricas } = vi.hoisted(() => ({
  listarNotificacoes: vi.fn(), listarLixeira: vi.fn(), metricas: vi.fn(),
}));

vi.mock("@/lib/api", async () => {
  const real = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...real,
    notificacoes: { listar: listarNotificacoes, marcarLida: vi.fn() },
    lixeira: { listar: listarLixeira },
    auth: { ...real.auth, metricas },
    avatarPerfil: {},
    equipes: {},
  };
});
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ perfil: { id: "u1", nome_usuario: "ana", nome: "Ana", avatar_atualizado_em: null, equipes: [] }, status: "autenticado", recarregarPerfil: vi.fn() }),
  nomeExibicao: () => "Ana",
}));
vi.mock("@/lib/use-minhas-equipes", () => ({ useMinhasEquipes: () => ({ equipes: [] }) }));
vi.mock("@/lib/refresh-bus", () => ({ useRefreshBus: () => ({ versao: 0, notificar: vi.fn() }) }));
vi.mock("@/lib/profile-avatar", () => ({
  limparFotoLegada: vi.fn(), notificarFotoPerfilAtualizada: vi.fn(), prepararFotoPerfil: vi.fn(), useFotoPerfil: () => ({ url: null }),
}));

import { NotificationsScreen } from "./Notifications/NotificationsScreen";
import { TrashScreen } from "./Trash/TrashScreen";
import { ProfileScreen } from "./Profile/ProfileScreen";

beforeEach(() => {
  vi.useFakeTimers();
  for (const m of [listarNotificacoes, listarLixeira, metricas]) m.mockReset().mockReturnValue(new Promise(() => {}));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const casos: [string, () => JSX.Element, string][] = [
  ["Notificações", () => <NotificationsScreen />, "Carregando…"],
  ["Lixeira", () => <TrashScreen />, "Carregando lixeira…"],
  ["Perfil (métricas)", () => <ProfileScreen />, "Carregando seu espaço…"],
];

describe.each(casos)("estado de carregamento: %s", (_nome, tela, rotulo) => {
  it("anuncia o carregamento de imediato, sem desenhar skeleton antes do atraso", () => {
    const { container } = render(<MemoryRouter>{tela()}</MemoryRouter>);
    const regiao = screen.getByText(rotulo).closest("[role='status']")!;
    expect(regiao.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector("[data-skeleton]")).toBeNull();
  });

  it("mostra o skeleton se o carregamento passar do atraso", () => {
    const { container } = render(<MemoryRouter>{tela()}</MemoryRouter>);
    act(() => { vi.advanceTimersByTime(150); });
    expect(container.querySelector("[data-skeleton]")).not.toBeNull();
  });
});
