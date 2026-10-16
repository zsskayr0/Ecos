import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async (importOriginal) => {
  const o = await importOriginal<typeof import("@/lib/api")>();
  return { ...o, vault: { ...o.vault, backup: { config: vi.fn(), historico: vi.fn(), exportar: vi.fn() } } };
});
import { vault } from "@/lib/api";
import { BackupsCofre, rotuloDoBackup } from "./BackupsCofre";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(vault.backup.config).mockResolvedValue({ frequencia: "diaria", retencao: "7 diários + 4 semanais + 3 mensais", proxima_execucao_automatica: "diariamente" });
});

it("lista o histórico e cria um backup na hora", async () => {
  vi.mocked(vault.backup.historico)
    .mockResolvedValueOnce([{ nome: "vault-2026-10-01.enc", tamanho_bytes: 2048 }])
    .mockResolvedValueOnce([{ nome: "vault-2026-10-01.enc", tamanho_bytes: 2048 }, { nome: "vault-2026-10-02.enc", tamanho_bytes: 4096 }]);
  vi.mocked(vault.backup.exportar).mockResolvedValue({ ok: true, arquivo: "vault-2026-10-02.enc" });
  render(<BackupsCofre />);
  expect(await screen.findByText(/Cópia de 01\/10\/2026 · 2,0 KB/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Fazer backup agora/ }));
  expect(await screen.findByText(/Cópia de 02\/10\/2026/)).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("vault-2026-10-02.enc");
});

it("mostra o erro do servidor e o estado vazio", async () => {
  vi.mocked(vault.backup.historico).mockResolvedValue([]);
  vi.mocked(vault.backup.exportar).mockRejectedValue(new Error("Sem permissão para exportar."));
  render(<BackupsCofre />);
  expect(await screen.findByText(/Nenhum backup ainda/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Fazer backup agora/ }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Sem permissão"));
});

it("dá nome legível aos arquivos", () => {
  expect(rotuloDoBackup("pre-reset-123.enc")).toBe("Antes de apagar o Cofre");
});
