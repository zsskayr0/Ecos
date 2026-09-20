import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { exportar, excluir, resetar, logout, baixar } = vi.hoisted(() => ({
  exportar: vi.fn(), excluir: vi.fn(), resetar: vi.fn(), logout: vi.fn(), baixar: vi.fn(),
}));

vi.mock("@/lib/api", async () => {
  const real = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...real, conta: { exportar, excluir }, vault: { ...real.vault, resetar } };
});
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ logout }) }));
vi.mock("@/lib/baixar-arquivo", () => ({ baixarArquivo: baixar }));

import { ApiError } from "@/lib/api";
import { ContaDadosScreen } from "./ContaDadosScreen";
import { PrivacyVaultScreen } from "./PrivacyVaultScreen";

const abrir = (tela: JSX.Element) => render(<MemoryRouter>{tela}</MemoryRouter>);

beforeEach(() => { vi.clearAllMocks(); logout.mockResolvedValue(undefined); });

describe("Conta e dados — exportar", () => {
  it("chama GET /me/export e baixa o .zip", async () => {
    const zip = new Blob(["zip"], { type: "application/zip" });
    exportar.mockResolvedValue(zip);
    abrir(<ContaDadosScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Exportar meus dados" }));
    await waitFor(() => expect(baixar).toHaveBeenCalledTimes(1));
    expect(baixar.mock.calls[0][0]).toBe(zip);
    expect(baixar.mock.calls[0][1]).toMatch(/^ecos-exportacao-\d{8}-\d{6}\.zip$/);
    expect(await screen.findByText(/Arquivo gerado/)).toBeTruthy();
  });

  it("mostra o erro e deixa tentar de novo quando o servidor falha", async () => {
    exportar.mockRejectedValue(new ApiError("INTERNAL_ERROR", "Erro interno", 500));
    abrir(<ContaDadosScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Exportar meus dados" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/servidor/i);
    expect(baixar).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Exportar meus dados" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("Conta e dados — excluir", () => {
  const iniciar = () => {
    abrir(<ContaDadosScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Excluir minha conta" }));
    return { campo: screen.getByLabelText(/Digite/) as HTMLInputElement, confirmar: () => screen.getByRole("button", { name: /Excluir permanentemente/ }) as HTMLButtonElement };
  };

  it("explica o que some, as equipes e que não dá pra desfazer", () => {
    abrir(<ContaDadosScreen />);
    const texto = document.body.textContent ?? "";
    expect(texto).toMatch(/de forma permanente/);
    expect(texto).toMatch(/Equipes:/);
    expect(texto).toMatch(/única pessoa/);
    expect(texto).toMatch(/Não pode ser desfeito/);
  });

  it("só habilita com a frase exata e nunca chama DELETE antes", () => {
    const { campo, confirmar } = iniciar();
    expect(confirmar().disabled).toBe(true);
    fireEvent.change(campo, { target: { value: "excluir conta" } });
    expect(confirmar().disabled).toBe(true);
    fireEvent.change(campo, { target: { value: "EXCLUIR CONTA" } });
    expect(confirmar().disabled).toBe(false);
    expect(excluir).not.toHaveBeenCalled();
  });

  it("exclui, mostra o resultado e só então sai da sessão", async () => {
    excluir.mockResolvedValue({ ok: true, avisos: ["Não foi possível apagar Pessoal."] });
    const { campo, confirmar } = iniciar();
    fireEvent.change(campo, { target: { value: "EXCLUIR CONTA" } });
    fireEvent.click(confirmar());
    expect(await screen.findByText("Conta excluída")).toBeTruthy();
    expect(screen.getByText(/Não foi possível apagar Pessoal/)).toBeTruthy();
    expect(logout).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Concluir" }));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("mostra a recusa do servidor (dono de equipe) e mantém a conta", async () => {
    excluir.mockRejectedValue(new ApiError("CONFLICT", "Você é dono da equipe \"Casa\". Transfira a propriedade antes.", 409));
    const { campo, confirmar } = iniciar();
    fireEvent.change(campo, { target: { value: "EXCLUIR CONTA" } });
    fireEvent.click(confirmar());
    expect((await screen.findByRole("alert")).textContent).toMatch(/Transfira a propriedade/);
    expect(screen.queryByText("Conta excluída")).toBeNull();
    expect(logout).not.toHaveBeenCalled();
  });
});

describe("Privacidade e cofre — Resetar Cofre", () => {
  const preparar = () => {
    abrir(<PrivacyVaultScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Resetar Cofre" }));
    fireEvent.change(screen.getByPlaceholderText("apagar meu cofre"), { target: { value: "apagar meu cofre" } });
    return screen.getByRole("button", { name: /Apagar permanentemente/ });
  };

  it("chama POST /vault/reset e confirma o sucesso", async () => {
    resetar.mockResolvedValue({ ok: true, backup_de_seguranca: "pre-reset-x" });
    fireEvent.click(preparar());
    expect((await screen.findByRole("status")).textContent).toMatch(/Cofre resetado/);
    expect(resetar).toHaveBeenCalledTimes(1);
  });

  it("mostra o erro do servidor e não finge que apagou", async () => {
    resetar.mockRejectedValue(new ApiError("VAULT_LOCKED", "O Cofre está bloqueado.", 403));
    fireEvent.click(preparar());
    expect((await screen.findByRole("alert")).textContent).toMatch(/bloqueado/);
    expect(screen.queryByText(/Cofre resetado/)).toBeNull();
  });
});
