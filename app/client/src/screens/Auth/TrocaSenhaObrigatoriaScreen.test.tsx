import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const trocarSenha = vi.fn();
const recarregarPerfil = vi.fn();
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ perfil: { id: "u2", nome_usuario: "thaty", nome: "Thaty" }, recarregarPerfil, logout: vi.fn() }),
  nomeExibicao: (p: { nome: string }) => p.nome,
}));
vi.mock("@/lib/api", () => ({
  ApiError: class extends Error {},
  auth: { trocarSenha: (...a: unknown[]) => trocarSenha(...a) },
}));
// A recovery key mora na tela de login; aqui basta saber que ela é exibida.
vi.mock("./AuthScreen", () => ({ RecoveryKeyReveal: ({ recoveryKey }: { recoveryKey: string }) => <p>chave: {recoveryKey}</p> }));

import { TrocaSenhaObrigatoriaScreen } from "./TrocaSenhaObrigatoriaScreen";

beforeEach(() => { trocarSenha.mockReset(); recarregarPerfil.mockReset(); });

function preencher(atual: string, nova: string, confirmacao: string) {
  const campos = document.querySelectorAll("input");
  fireEvent.change(campos[0], { target: { value: atual } });
  fireEvent.change(campos[1], { target: { value: nova } });
  fireEvent.change(campos[2], { target: { value: confirmacao } });
}

describe("troca de senha obrigatória (conta criada pela administração)", () => {
  it("só habilita com a senha atual, 12+ caracteres e confirmação igual; tira espaços digitados", () => {
    render(<TrocaSenhaObrigatoriaScreen />);
    const botao = screen.getByRole("button", { name: "Salvar e continuar" }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    preencher("Xk7m-Pq2d-Ws9h-Tn4v", "curta", "curta");
    expect(botao.disabled).toBe(true);
    preencher("Xk7m-Pq2d-Ws9h-Tn4v", "Nova-senha-Forte-77", "Outra-senha-Forte-88");
    expect(botao.disabled).toBe(true);
    expect(screen.getByText("As senhas não coincidem.")).toBeTruthy();
    preencher("Xk7m-Pq2d-Ws9h-Tn4v", "Nova senha Forte 77", "Nova senha Forte 77");
    expect((document.querySelectorAll("input")[1] as HTMLInputElement).value).toBe("NovasenhaForte77");
  });

  it("envia a troca e mostra a recovery key nova antes de liberar o app", async () => {
    trocarSenha.mockResolvedValue({ ok: true, recovery_key: "uma dois tres" });
    render(<TrocaSenhaObrigatoriaScreen />);
    preencher("Xk7m-Pq2d-Ws9h-Tn4v", "Nova-senha-Forte-77", "Nova-senha-Forte-77");
    fireEvent.click(screen.getByRole("button", { name: "Salvar e continuar" }));
    await waitFor(() => expect(trocarSenha).toHaveBeenCalledWith("Xk7m-Pq2d-Ws9h-Tn4v", "Nova-senha-Forte-77"));
    expect(await screen.findByText("chave: uma dois tres")).toBeTruthy();
    expect(recarregarPerfil).not.toHaveBeenCalled(); // só depois de a pessoa confirmar que guardou a chave
  });

  it("sem recovery key nova, recarrega o perfil e o app abre", async () => {
    trocarSenha.mockResolvedValue({ ok: true, recovery_key: null });
    render(<TrocaSenhaObrigatoriaScreen />);
    preencher("Xk7m-Pq2d-Ws9h-Tn4v", "Nova-senha-Forte-77", "Nova-senha-Forte-77");
    fireEvent.click(screen.getByRole("button", { name: "Salvar e continuar" }));
    await waitFor(() => expect(recarregarPerfil).toHaveBeenCalled());
  });
});
