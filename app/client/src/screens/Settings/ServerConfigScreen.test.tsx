import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const servidor = vi.hoisted(() => ({ atual: "http://servidor-anterior:7023" as string | null }));

vi.mock("@/lib/server-config", () => ({
  obterServidorBaseUrl: vi.fn(() => servidor.atual),
  definirServidorBaseUrl: vi.fn((url: string | null) => { servidor.atual = url; }),
  estaNoTauri: vi.fn(() => true),
}));
vi.mock("@/lib/api", () => ({
  auth: { testarConexao: vi.fn() },
}));
vi.mock("./SincronizacaoBackup", () => ({ SincronizacaoBackup: () => null }));

import { auth } from "@/lib/api";
import { definirServidorBaseUrl } from "@/lib/server-config";
import { ServerConfigScreen } from "./ServerConfigScreen";

beforeEach(() => {
  servidor.atual = "http://servidor-anterior:7023";
  vi.clearAllMocks();
});

describe("configuração do servidor", () => {
  it("restaura o endereço anterior quando o novo não responde e mantém o texto para correção", async () => {
    vi.mocked(auth.testarConexao).mockRejectedValue(new Error("offline"));
    render(<MemoryRouter><ServerConfigScreen /></MemoryRouter>);

    const campo = screen.getByRole("textbox", { name: "Endereço" }) as HTMLInputElement;
    fireEvent.change(campo, { target: { value: "http://endereco-invalido:7023" } });
    fireEvent.click(screen.getByRole("button", { name: "Testar e salvar" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Não consegui falar com esse endereço");
    expect(campo.value).toBe("http://endereco-invalido:7023");
    expect(definirServidorBaseUrl).toHaveBeenNthCalledWith(1, "http://endereco-invalido:7023");
    expect(definirServidorBaseUrl).toHaveBeenNthCalledWith(2, "http://servidor-anterior:7023");
    expect(screen.getByRole("button", { name: "Voltar ao padrão" })).toBeTruthy();
  });

  it("mantém o novo endereço somente depois do teste bem-sucedido", async () => {
    vi.mocked(auth.testarConexao).mockResolvedValue(undefined);
    render(<MemoryRouter><ServerConfigScreen /></MemoryRouter>);
    const campo = screen.getByRole("textbox", { name: "Endereço" });
    fireEvent.change(campo, { target: { value: "http://servidor-novo:7023" } });
    fireEvent.click(screen.getByRole("button", { name: "Testar e salvar" }));

    await waitFor(() => expect(screen.getByText("Conectado. Endereço salvo.")).toBeTruthy());
    expect(definirServidorBaseUrl).toHaveBeenCalledTimes(1);
    expect(servidor.atual).toBe("http://servidor-novo:7023");
  });
});
