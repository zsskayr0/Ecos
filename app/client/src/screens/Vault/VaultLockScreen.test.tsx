import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { VaultLockScreen } from "./VaultLockScreen";

const digitar = (senha: string) => fireEvent.change(screen.getByPlaceholderText("Senha do Cofre"), { target: { value: senha } });

it("sem permissão (navegador, Android), a tela não oferece lembrar a senha", () => {
  render(<VaultLockScreen primeiraVez={false} onSubmeter={vi.fn()} />);
  expect(screen.queryByLabelText(/Lembrar a senha neste computador/)).toBeNull();
});

it("no Windows oferece a opção, desligada por padrão, e explica onde a senha fica", () => {
  render(<VaultLockScreen primeiraVez={false} onSubmeter={vi.fn()} permitirLembrar />);
  const caixa = screen.getByLabelText(/Lembrar a senha neste computador/) as HTMLInputElement;
  expect(caixa.checked).toBe(false);
  expect(screen.getByText(/Gerenciador de Credenciais do Windows/)).toBeTruthy();
  expect(screen.getByText(/“Bloquear” continua pedindo a senha/)).toBeTruthy();
});

it("desbloquear sem marcar envia lembrar = false", async () => {
  const onSubmeter = vi.fn().mockResolvedValue(undefined);
  render(<VaultLockScreen primeiraVez={false} onSubmeter={onSubmeter} permitirLembrar />);
  digitar("minha-senha");
  fireEvent.click(screen.getByRole("button", { name: "Desbloquear" }));
  await waitFor(() => expect(onSubmeter).toHaveBeenCalledWith("minha-senha", false));
});

it("marcar a opção envia lembrar = true", async () => {
  const onSubmeter = vi.fn().mockResolvedValue(undefined);
  render(<VaultLockScreen primeiraVez={false} onSubmeter={onSubmeter} permitirLembrar />);
  digitar("minha-senha");
  fireEvent.click(screen.getByLabelText(/Lembrar a senha neste computador/));
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
  fireEvent.click(screen.getByLabelText(/Lembrar a senha neste computador/));
  fireEvent.click(screen.getByRole("button", { name: "Desbloquear" }));
  await screen.findByText(/Não foi possível conectar ao Cofre|incorreta/);
  expect((screen.getByLabelText(/Lembrar a senha neste computador/) as HTMLInputElement).checked).toBe(true);
});
