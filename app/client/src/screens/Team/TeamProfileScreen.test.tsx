import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { sair, notificar, recarregarPerfil, trocarCargo, removerMembro, transferirPropriedade } = vi.hoisted(() => ({ sair: vi.fn(), notificar: vi.fn(), recarregarPerfil: vi.fn(), trocarCargo: vi.fn(), removerMembro: vi.fn(), transferirPropriedade: vi.fn() }));

vi.mock("@/lib/api", async () => {
  const real = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...real,
    equipes: {
      obter: vi.fn().mockResolvedValue({ id: "EQ", nome: "Casa", estatisticas: { notas: 1, tarefas: 2 } }),
      listarMembros: vi.fn().mockResolvedValue([{ usuario_id: "u1", cargo: "membro", entrou_em: "2026-01-01" }, { usuario_id: "u2", cargo: "dono", entrou_em: "2026-01-01" }]),
      sair,
      trocarCargo,
      removerMembro,
      transferirPropriedade,
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
vi.mock("@/lib/team-avatar", () => ({ enviarAvatarEquipe: vi.fn(), useAvatarEquipe: () => null }));

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

describe("Identidade dos membros", () => {
  it("mostra nome e nome de usuário reais e nunca o id truncado", async () => {
    const { equipes } = await import("@/lib/api");
    vi.mocked(equipes.listarMembros).mockResolvedValueOnce([
      { usuario_id: "u1", cargo: "membro", nome: "Ana", nome_usuario: "ana" },
      { usuario_id: "01HZXABCDEFGHJKMNPQRSTVWXY", cargo: "dono", nome: "Bruno Lima", nome_usuario: "bruno", avatar_atualizado_em: 123 },
      { usuario_id: "01HZXZZZZZZZZZZZZZZZZZZZZZ", cargo: "membro", nome_usuario: "carla" },
    ]);
    abrir();
    expect(await screen.findByText("Bruno Lima")).toBeTruthy();
    expect(screen.getByText("@bruno")).toBeTruthy();
    expect(screen.getByText("carla")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/01HZX/);
  });
});

describe("Gerenciar membros", () => {
  const lista = (meuCargo: string) => [
    { usuario_id: "u1", cargo: meuCargo, nome: "Ana", nome_usuario: "ana" },
    { usuario_id: "u2", cargo: "membro", nome: "Bruno", nome_usuario: "bruno" },
    { usuario_id: "u3", cargo: "dono", nome: "Carla", nome_usuario: "carla" },
  ];

  it("dono promove, rebaixa e remove, com confirmação para remover", async () => {
    const { equipes } = await import("@/lib/api");
    vi.mocked(equipes.listarMembros).mockResolvedValue(lista("dono"));
    trocarCargo.mockResolvedValue({ ok: true });
    removerMembro.mockResolvedValue({ ok: true });
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: "Gerenciar Bruno" }));
    fireEvent.click(screen.getByRole("button", { name: "Tornar administrador" }));
    await waitFor(() => expect(trocarCargo).toHaveBeenCalledWith("EQ", "u2", "admin"));

    fireEvent.click(await screen.findByRole("button", { name: "Gerenciar Bruno" }));
    fireEvent.click(screen.getByRole("button", { name: "Remover da equipe" }));
    expect(removerMembro).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remover" }));
    await waitFor(() => expect(removerMembro).toHaveBeenCalledWith("EQ", "u2"));
    expect(screen.getByRole("button", { name: "Convidar" })).toBeTruthy();
  });

  it("dono transfere a propriedade com confirmação; administrador não vê a opção", async () => {
    const { equipes } = await import("@/lib/api");
    vi.mocked(equipes.listarMembros).mockResolvedValue(lista("dono"));
    transferirPropriedade.mockResolvedValue({ ok: true });
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: "Gerenciar Bruno" }));
    fireEvent.click(screen.getByRole("button", { name: "Transferir propriedade" }));
    expect(transferirPropriedade).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Transferir" }));
    await waitFor(() => expect(transferirPropriedade).toHaveBeenCalledWith("EQ", "u2"));
    expect(recarregarPerfil).toHaveBeenCalled();
  });

  it("administrador não vê a opção de transferir", async () => {
    const { equipes } = await import("@/lib/api");
    vi.mocked(equipes.listarMembros).mockResolvedValue(lista("admin"));
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: "Gerenciar Bruno" }));
    expect(screen.queryByRole("button", { name: "Transferir propriedade" })).toBeNull();
  });

  it("membro comum não vê ações de gestão nem o botão de convite", async () => {
    const { equipes } = await import("@/lib/api");
    vi.mocked(equipes.listarMembros).mockResolvedValue(lista("membro"));
    abrir();
    await screen.findByText("Bruno");
    expect(screen.queryByRole("button", { name: /^Gerenciar/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Convidar" })).toBeNull();
  });

  it("administrador gerencia membros, mas não o dono", async () => {
    const { equipes } = await import("@/lib/api");
    vi.mocked(equipes.listarMembros).mockResolvedValue(lista("admin"));
    abrir();
    await screen.findByText("Bruno");
    expect(screen.getByRole("button", { name: "Gerenciar Bruno" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Gerenciar Carla" })).toBeNull();
  });

  it("mostra a recusa do servidor ao alterar um cargo", async () => {
    const { equipes } = await import("@/lib/api");
    vi.mocked(equipes.listarMembros).mockResolvedValue(lista("dono"));
    trocarCargo.mockRejectedValue(new ApiError("FORBIDDEN", "Você não pode alterar este cargo.", 403));
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: "Gerenciar Bruno" }));
    fireEvent.click(screen.getByRole("button", { name: "Tornar administrador" }));
    await waitFor(() => expect(document.body.textContent).toMatch(/não pode alterar este cargo/));
  });
});
