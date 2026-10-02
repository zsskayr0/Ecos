import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const hook = vi.hoisted(() => ({ estado: { suportado: true, lembrada: true, esquecer: vi.fn() } }));
vi.mock("@/lib/use-senha-lembrada", () => ({ useSenhaLembrada: () => hook.estado }));
import { SenhaLembrada } from "./SenhaLembrada";

beforeEach(() => { hook.estado = { suportado: true, lembrada: true, esquecer: vi.fn().mockResolvedValue(undefined) }; });

it("onde não há armazenamento seguro (navegador, Android), a seção nem aparece", () => {
  hook.estado.suportado = false;
  const { container } = render(<SenhaLembrada />);
  expect(container.innerHTML).toBe("");
});

it("com a senha lembrada: explica e oferece esquecer", async () => {
  render(<SenhaLembrada />);
  expect(screen.getByText(/está guardada no Gerenciador de Credenciais do Windows/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Esquecer neste computador" }));
  await waitFor(() => expect(hook.estado.esquecer).toHaveBeenCalledOnce());
});

it("sem senha lembrada: explica como ligar e não mostra o botão de esquecer", () => {
  hook.estado.lembrada = false;
  render(<SenhaLembrada />);
  expect(screen.getByText(/não está guardada aqui/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Esquecer/ })).toBeNull();
});
