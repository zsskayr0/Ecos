import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { VaultLockScreen } from "./VaultLockScreen";

const digitar = (senha: string) => fireEvent.change(screen.getByPlaceholderText("Senha do Cofre"), { target: { value: senha } });

it("sem permissão (navegador, Android), a tela não oferece lembrar a senha", () => {
  render(<VaultLockScreen primeiraVez={false} onSubmeter={vi.fn()} />);
  expect(screen.queryByLabelText(/Lembrar a senha neste computador/)).toBeNull();
});

it("no Windows oferece a opção, marcada por padrão, e explica onde a senha fica", () => {
  render(<VaultLockScreen primeiraVez={false} onSubmeter={vi.fn()} permitirLembrar />);
  const caixa = screen.getByLabelText(/Lembrar a senha neste computador/) as HTMLInputElement;
  expect(caixa.checked).toBe(true);
  expect(screen.getByText(/Gerenciador de Credenciais do Windows/)).toBeTruthy();
  expect(screen.getByText(/“Bloquear” continua pedindo a senha/)).toBeTruthy();
});

it("desbloquear com a opção desmarcada envia lembrar = false", async () => {
  const onSubmeter = vi.fn().mockResolvedValue(undefined);
  render(<VaultLockScreen primeiraVez={false} onSubmeter={onSubmeter} permitirLembrar />);
  digitar("minha-senha");
  fireEvent.click(screen.getByLabelText(/Lembrar a senha neste computador/));
  fireEvent.click(screen.getByRole("button", { name: "Desbloquear" }));
  await waitFor(() => expect(onSubmeter).toHaveBeenCalledWith("minha-senha", false));
});

it("com a opção como veio (marcada) envia lembrar = true", async () => {
  const onSubmeter = vi.fn().mockResolvedValue(undefined);
  render(<VaultLockScreen primeiraVez={false} onSubmeter={onSubmeter} permitirLembrar />);
  digitar("minha-senha");
  fireEvent.click(screen.getByRole("button", { name: "Desbloquear" }));
  await waitFor(() => expect(onSubmeter).toHaveBeenCalledWith("minha-senha", true));
});

it("sem permissão, mesmo que o estado interno mude, nunca pede para lembrar", async () => {
  const onSubmeter = vi.fn().mockResolvedValue(undefined);
  render(<VaultLockScreen primeiraVez={false} onSubmeter={onSubmeter} />);
  digitar("minha-senha");
  fireEvent.click(screen.getByRole("button", { name: "Desbloquear" }));
  await waitFor(() => expect(onSubmeter).toHaveBeenCalledWith("minha-senha", false));
});

it("senha errada aparece como erro e a caixa continua como estava", async () => {
  const onSubmeter = vi.fn().mockRejectedValue(new Error("Senha do Cofre incorreta."));
  render(<VaultLockScreen primeiraVez={false} onSubmeter={onSubmeter} permitirLembrar />);
  digitar("errada");
  fireEvent.click(screen.getByRole("button", { name: "Desbloquear" }));
  await screen.findByText(/Não foi possível conectar ao Cofre|incorreta/);
  expect((screen.getByLabelText(/Lembrar a senha neste computador/) as HTMLInputElement).checked).toBe(true);
});

it("o gerenciador de senhas do navegador recebe usuário e senha com os atributos certos", () => {
  render(<VaultLockScreen primeiraVez={false} equipe="Família" onSubmeter={vi.fn()} />);
  const senha = screen.getByPlaceholderText("Senha do Cofre") as HTMLInputElement;
  expect(senha.getAttribute("autocomplete")).toBe("current-password");
  const usuario = document.querySelector('input[autocomplete="username"]') as HTMLInputElement;
  expect(usuario.value).toBe("Cofre Ecos · Família");
});

it("com senha guardada no aparelho, oferece o botão de biometria", async () => {
  const onBiometria = vi.fn().mockResolvedValue(undefined);
  render(<VaultLockScreen primeiraVez={false} onSubmeter={vi.fn()} onBiometria={onBiometria} />);
  fireEvent.click(screen.getByRole("button", { name: /Desbloquear com biometria/ }));
  await waitFor(() => expect(onBiometria).toHaveBeenCalled());
});
