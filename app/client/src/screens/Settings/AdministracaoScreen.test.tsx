import { escolher, opcoesDe } from "@/test-helpers/escolher";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  listarUsuarios: vi.fn(), criarUsuario: vi.fn(), redefinirSenha: vi.fn(), listarEquipes: vi.fn(), adicionarMembro: vi.fn(), removerMembro: vi.fn(),
}));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ perfil: { id: "u1", nome_usuario: "diogo", papel: "admin" } }) }));
vi.mock("@/lib/api", () => ({ ApiError: class extends Error {}, admin: api }));

import { AdministracaoScreen } from "./AdministracaoScreen";

const usuarios = [
  { id: "u1", nome_usuario: "diogo", nome: "Diogo", papel: "admin", criado_em: "2026-01-01", deve_trocar_senha: false },
  { id: "u2", nome_usuario: "thaty", nome: null, papel: "usuario", criado_em: "2026-02-01", deve_trocar_senha: true },
];
const equipes = [{ id: "eq", nome: "Casa", membros: [{ usuario_id: "u1", nome_usuario: "diogo", nome: "Diogo", cargo: "dono" }] }];

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.listarUsuarios.mockResolvedValue(usuarios);
  api.listarEquipes.mockResolvedValue(equipes);
});

describe("administração de usuários e equipes", () => {
  it("lista as contas e sinaliza quem ainda não trocou a senha temporária", async () => {
    render(<AdministracaoScreen />);
    expect(await screen.findByText(/aguardando a troca da senha temporária/)).toBeTruthy();
    expect(screen.getByText("Admin")).toBeTruthy();
    expect(screen.queryByText("Redefinir senha", { selector: "button *" })).toBeNull;
  });

  it("cria a conta e mostra a senha temporária uma vez; o login só aceita os caracteres permitidos", async () => {
    api.criarUsuario.mockResolvedValue({ id: "u3", nome_usuario: "caio", papel: "usuario", senha_temporaria: "Xk7m-Pq2d-Ws9h-Tn4v" });
    render(<AdministracaoScreen />);
    await screen.findByText("Contas");
    fireEvent.change(screen.getByPlaceholderText("ex.: thaty"), { target: { value: "ca io!ç" } });
    expect((screen.getByPlaceholderText("ex.: thaty") as HTMLInputElement).value).toBe("caio");
    fireEvent.click(screen.getByRole("button", { name: /Criar conta/ }));
    await waitFor(() => expect(api.criarUsuario).toHaveBeenCalledWith("caio", undefined, "usuario"));
    expect(await screen.findByText("Xk7m-Pq2d-Ws9h-Tn4v")).toBeTruthy();
    expect(screen.getByText(/Conta criada: caio/)).toBeTruthy();
  });

  it("redefinir senha pede confirmação e mostra a nova senha temporária", async () => {
    api.redefinirSenha.mockResolvedValue({ id: "u2", senha_temporaria: "Aa2b-Cc3d-Ee4f-Gg5h" });
    render(<AdministracaoScreen />);
    fireEvent.click(await screen.findByText("Redefinir senha"));
    expect(api.redefinirSenha).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Confirmar"));
    await waitFor(() => expect(api.redefinirSenha).toHaveBeenCalledWith("u2"));
    expect(await screen.findByText("Aa2b-Cc3d-Ee4f-Gg5h")).toBeTruthy();
  });

  it("coloca uma conta numa equipe pelo menu", async () => {
    api.adicionarMembro.mockResolvedValue({ ok: true });
    render(<AdministracaoScreen />);
    await screen.findByRole("button", { name: "Adicionar pessoa a Casa" });
    escolher("Adicionar pessoa a Casa", /thaty/);
    await waitFor(() => expect(api.adicionarMembro).toHaveBeenCalledWith("eq", "u2"));
  });
});
