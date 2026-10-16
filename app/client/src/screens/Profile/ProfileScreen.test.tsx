import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { metricas } = vi.hoisted(() => ({ metricas: vi.fn() }));

vi.mock("@/lib/api", async () => {
  const real = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...real, auth: { ...real.auth, metricas }, avatarPerfil: {}, equipes: {} };
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

import { ProfileScreen } from "./ProfileScreen";

const abrir = () => render(<MemoryRouter><ProfileScreen /></MemoryRouter>);

describe("ProfileScreen: métricas vindas do servidor", () => {
  beforeEach(() => metricas.mockReset());

  it("mostra carregamento e depois as contagens exatas do endpoint", async () => {
    metricas.mockResolvedValue({ escopo: "pessoal", entrou_em: "2026-01-02T10:00:00+00:00", primeira_nota_em: "2026-04-01T12:00:00+00:00", notas: 1234, tarefas: 56, palavras: 7890, caracteres: 45678 });
    abrir();
    expect(screen.getByText("Carregando seu espaço…")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Palavras escritas")).toBeTruthy());
    expect(screen.getByText((1234).toLocaleString("pt-BR"))).toBeTruthy();
    expect(screen.getByText((7890).toLocaleString("pt-BR"))).toBeTruthy();
    expect(metricas).toHaveBeenCalledTimes(1);
  });

  it("sem conteúdo mostra o estado vazio da primeira nota", async () => {
    metricas.mockResolvedValue({ escopo: "pessoal", entrou_em: "2026-01-02T10:00:00+00:00", primeira_nota_em: null, notas: 0, tarefas: 0, palavras: 0, caracteres: 0 });
    abrir();
    await waitFor(() => expect(screen.getByText("Ainda não há notas")).toBeTruthy());
  });
});
