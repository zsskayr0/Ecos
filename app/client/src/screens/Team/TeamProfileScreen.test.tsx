import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { sair, notificar, recarregarPerfil } = vi.hoisted(() => ({ sair: vi.fn(), notificar: vi.fn(), recarregarPerfil: vi.fn() }));

vi.mock("@/lib/api", async () => {
  const real = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...real,
    equipes: {
      obter: vi.fn().mockResolvedValue({ id: "EQ", nome: "Casa", estatisticas: { notas: 1, tarefas: 2 } }),
      listarMembros: vi.fn().mockResolvedValue([{ usuario_id: "u1", cargo: "membro", entrou_em: "2026-01-01" }, { usuario_id: "u2", cargo: "dono", entrou_em: "2026-01-01" }]),
      sair,
    },
  };
});
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ perfil: { id: "u1", nome_usuario: "ana", nome: "Ana", avatar_atualizado_em: null }, recarregarPerfil }),
  nomeExibicao: () => "Ana",
}));
vi.mock("@/lib/ui-context", () => ({ useAppUI: () => ({ setFiltroEquipeId: vi.fn(), setEspacoAtivo: vi.fn() }) }));
vi.mock("@/lib/refresh-bus", () => ({ useRefreshBus: () => ({ versao: 0, notificar }) }));
vi.mock("@/lib/profile-avatar", () => ({ prepararFotoPerfil: vi.fn(), useFotoPerfil: () => ({ url: null }) }));
vi.mock("@/lib/team-avatar", () => ({ definirAvatarEquipeLocal: vi.fn(), useAvatarEquipe: () => null }));

import { ApiError } from "@/lib/api";
import { TeamProfileScreen } from "./TeamProfileScreen";

const abrir = () => render(
  <MemoryRouter initialEntries={["/equipe/EQ"]}>
    <Routes>
      <Route path="/equipe/:equipeId" element={<TeamProfileScreen />} />
      <Route path="/equipes" element={<p>Lista de equipes</p>} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => vi.clearAllMocks());

describe("Sair da equipe", () => {
  it("pede confirmação, chama a rota, atualiza as listas e volta para Equipes", async () => {
    sair.mockResolvedValue({ ok: true });
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: "Sair da equipe" }));
    expect(sair).not.toHaveBeenCalled();
    expect(document.body.textContent).toMatch(/autor original/);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar saída" }));
    expect(await screen.findByText("Lista de equipes")).toBeTruthy();
    expect(sair).toHaveBeenCalledWith("EQ");
    expect(notificar).toHaveBeenCalled();
    expect(recarregarPerfil).toHaveBeenCalled();
  });

  it("mostra a recusa do servidor (dono precisa transferir) e continua na equipe", async () => {
    sair.mockRejectedValue(new ApiError("CONFLICT", "Você é dono desta equipe. Transfira a propriedade para outra pessoa antes de sair.", 409));
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: "Sair da equipe" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar saída" }));
    await waitFor(() => expect(document.body.textContent).toMatch(/Transfira a propriedade/));
    expect(screen.queryByText("Lista de equipes")).toBeNull();
  });
});
