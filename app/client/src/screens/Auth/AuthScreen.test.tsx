import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const registrar = vi.fn().mockResolvedValue({ recovery_key: "chave" });
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ login: vi.fn(), registrar, recarregarPerfil: vi.fn() }) }));
vi.mock("@/lib/api", () => ({
  ApiError: class extends Error {},
  auth: { status: () => Promise.resolve({ instancia_vazia: true, versao: "0.4.0", idade_minima: 18, termos_versao: "2026-09-20" }) },
}));

import { AuthScreen } from "./AuthScreen";

beforeEach(() => registrar.mockClear());

function preencher() {
  fireEvent.change(screen.getByPlaceholderText("Seu nome"), { target: { value: "Diogo" } });
  fireEvent.change(screen.getByPlaceholderText("Sobrenome"), { target: { value: "Roque" } });
  fireEvent.change(screen.getByPlaceholderText("Seu usuário"), { target: { value: "diogo" } });
  fireEvent.change(screen.getByPlaceholderText("Sua senha (sem espaços)"), { target: { value: "senha-forte-123" } });
}

describe("cadastro: declaração de idade mínima", () => {
  it("não deixa criar a conta sem declarar a idade e envia a declaração ao registrar", async () => {
    render(<AuthScreen />);
    const caixa = await screen.findByRole("checkbox", { name: /Declaro ter 18 anos ou mais/ });
    preencher();
    const botao = screen.getByRole("button", { name: "Criar conta" }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    fireEvent.click(caixa);
    expect(botao.disabled).toBe(true); // falta aceitar os Termos
    const termos = screen.getByRole("checkbox", { name: /Li e aceito os/ }) as HTMLInputElement;
    expect(termos.checked).toBe(false); // nunca vem marcado
    fireEvent.click(termos);
    expect(botao.disabled).toBe(false);
    fireEvent.click(botao);
    await waitFor(() => expect(registrar).toHaveBeenCalledWith("diogo", "senha-forte-123", "Diogo Roque", true, true));
  });
});
