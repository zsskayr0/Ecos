import { readFileSync } from "node:fs";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { aceitarTermos, recarregarPerfil } = vi.hoisted(() => ({
  aceitarTermos: vi.fn().mockResolvedValue({ ok: true }),
  recarregarPerfil: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ perfil: { termos_pendente: true, termos_versao: "2026-09-20" }, recarregarPerfil, logout: vi.fn() }),
}));
vi.mock("@/lib/api", () => ({ ApiError: class extends Error {}, auth: { aceitarTermos } }));

import { ReaceiteTermos } from "./ReaceiteTermos";
import termos from "@/legal/termos.md?raw";
import privacidade from "@/legal/privacidade.md?raw";

beforeEach(() => { aceitarTermos.mockClear(); recarregarPerfil.mockClear(); });

describe("novo aceite dos Termos", () => {
  it("só libera o botão depois de marcar e envia a versão vigente", async () => {
    render(<ReaceiteTermos />);
    const botao = screen.getByRole("button", { name: "Aceitar e continuar" }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /Li e aceito os/ }));
    expect(botao.disabled).toBe(false);
    fireEvent.click(botao);
    await waitFor(() => expect(aceitarTermos).toHaveBeenCalledWith("2026-09-20"));
    expect(recarregarPerfil).toHaveBeenCalled();
  });
});

describe("textos legais", () => {
  it("citam a versão vigente do servidor e a regra de idade", () => {
    const servidor = readFileSync("../server/src/auth/mod.rs", "utf8");
    const versao = /TERMOS_VERSAO: &str = "([^"]+)"/.exec(servidor)?.[1];
    const idade = /IDADE_MINIMA: u8 = (\d+)/.exec(servidor)?.[1];
    expect(versao).toBeTruthy();
    for (const texto of [termos, privacidade]) {
      expect(texto).toContain(versao!);
      expect(texto).toContain(`${idade} anos`);
    }
  });
});
