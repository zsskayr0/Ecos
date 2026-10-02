import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { recuperarSenha } = vi.hoisted(() => ({ recuperarSenha: vi.fn().mockResolvedValue({ ok: true }) }));
let statusVazia = true;
const registrar = vi.fn().mockResolvedValue({ recovery_key: "chave" });
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ login: vi.fn(), registrar, recarregarPerfil: vi.fn() }) }));
vi.mock("@/lib/api", () => ({
  ApiError: class extends Error {},
  auth: {
    status: () => Promise.resolve({ instancia_vazia: statusVazia, versao: "0.4.0", idade_minima: 18, termos_versao: "2026-09-20" }),
    recuperarSenha,
  },
}));

import { AuthScreen } from "./AuthScreen";

beforeEach(() => {
  registrar.mockClear();
  recuperarSenha.mockClear();
  statusVazia = true;
});

function preencher() {
  fireEvent.change(screen.getByPlaceholderText("Seu nome"), { target: { value: "Diogo" } });
  fireEvent.change(screen.getByPlaceholderText("Sobrenome"), { target: { value: "Roque" } });
  fireEvent.change(screen.getByPlaceholderText("Seu usuário"), { target: { value: "diogo" } });
  fireEvent.change(screen.getByPlaceholderText("Mínimo 12 caracteres, sem espaços"), { target: { value: "Vq7-lampada-Pato-42" } });
}

describe("recuperar senha com a recovery key", () => {
  it("só envia com 24 palavras e senha de 12+ caracteres, e volta ao login avisando", async () => {
    statusVazia = false;
    render(<AuthScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Esqueci minha senha" }));
    const botao = screen.getByRole("button", { name: "Definir senha nova" }) as HTMLButtonElement;
    const chave = Array.from({ length: 24 }, (_, i) => `palavra${i}`).join(" ");
    fireEvent.change(screen.getByPlaceholderText(/24 palavras/), { target: { value: chave } });
    fireEvent.change(screen.getByPlaceholderText("Mínimo 12 caracteres, sem espaços"), { target: { value: "curta" } });
    expect(botao.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("Mínimo 12 caracteres, sem espaços"), { target: { value: "Vq7-lampada-Pato-42" } });
    expect(botao.disabled).toBe(false);
    fireEvent.click(botao);
    await waitFor(() => expect(recuperarSenha).toHaveBeenCalledWith(chave, "Vq7-lampada-Pato-42"));
    expect(await screen.findByText(/Senha alterada/)).toBeTruthy();
  });
});

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
    await waitFor(() => expect(registrar).toHaveBeenCalledWith("diogo", "Vq7-lampada-Pato-42", "Diogo Roque", true, true));
  });
});
