import "fake-indexeddb/auto";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { obter, atualizar } = vi.hoisted(() => ({ obter: vi.fn(), atualizar: vi.fn() }));

vi.mock("@/lib/api", async () => {
  const real = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...real,
    notas: {
      ...real.notas,
      obter,
      atualizar,
      links: vi.fn().mockResolvedValue({ entrada: [], saida: [] }),
      tinta: { ...real.notas.tinta, obter: vi.fn().mockResolvedValue({ tracos: [] }) },
      versoes: { listar: vi.fn().mockResolvedValue([]), obter: vi.fn(), restaurar: vi.fn(), fechar: vi.fn().mockResolvedValue({}), fecharAoSair: vi.fn() },
    },
  };
});
vi.mock("@/screens/Grafico/MiniGrafo", () => ({ MiniGrafo: () => null }));
vi.mock("@/components/common/Conexoes", () => ({ Conexoes: () => null }));

import { ApiError } from "@/lib/api";
import { RefreshProvider } from "@/lib/refresh-bus";
import { limparDadosOffline, lerRascunhoNota } from "@/lib/offline-store";
import { NoteEditorDesktop } from "./NoteEditorDesktop";

const NOTA = { id: "n1", titulo: "Original", modo: "texto", tags: [], espaco: "pessoal", criado_em: "2026-11-01T00:00:00Z", atualizado_em: "2026-11-01T00:00:00Z", ultima_revisao_em: null, caminho_arquivo: "notas/note-original.md", corpo: "linha 1\nlinha 2", versao: 5 };

const abrir = () => render(
  <RefreshProvider><MemoryRouter initialEntries={["/notas/n1"]}>
    <Routes><Route path="/notas/:id" element={<NoteEditorDesktop />} /></Routes>
  </MemoryRouter></RefreshProvider>,
);

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  localStorage.clear();
  await limparDadosOffline();
  obter.mockResolvedValue(NOTA);
});

describe("Nota (desktop) — versão-base e conflito", () => {
  it("manda base_versao no autosave e passa a usar a versão devolvida", async () => {
    atualizar.mockResolvedValueOnce({ id: "n1", versao: 6 }).mockResolvedValueOnce({ id: "n1", versao: 7 });
    abrir();
    const titulo = await screen.findByLabelText("Título da nota");
    fireEvent.change(titulo, { target: { value: "Primeira" } });
    await waitFor(() => expect(atualizar).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(atualizar.mock.calls[0][1]).toMatchObject({ titulo: "Primeira", base_versao: 5 });
    fireEvent.change(titulo, { target: { value: "Segunda" } });
    await waitFor(() => expect(atualizar).toHaveBeenCalledTimes(2), { timeout: 3000 });
    expect(atualizar.mock.calls[1][1]).toMatchObject({ titulo: "Segunda", base_versao: 6 });
  });

  it("409: para o autosave, guarda o rascunho e oferece as três saídas", async () => {
    const atual = { titulo: "Original", corpo: "linha 1\nmudada lá", versao: 9, atualizado_em: "2026-11-02T00:00:00Z" };
    atualizar.mockRejectedValueOnce(new ApiError("CONFLICT", "Esta nota mudou em outro lugar.", 409, undefined, undefined, { atual }));
    abrir();
    const titulo = await screen.findByLabelText("Título da nota");
    fireEvent.change(titulo, { target: { value: "Meu título" } });
    expect(await screen.findByText("Esta nota mudou em outro lugar", {}, { timeout: 3000 })).toBeTruthy();
    // Rascunho continua no aparelho.
    await waitFor(async () => expect((await lerRascunhoNota("n1"))?.titulo).toBe("Meu título"));
    // Nada de novo envio enquanto o conflito está aberto.
    fireEvent.change(titulo, { target: { value: "Meu título 2" } });
    await new Promise((r) => setTimeout(r, 900));
    expect(atualizar).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Ver diferenças" }));
    expect(screen.getByLabelText("Diferenças por linha").textContent).toMatch(/− mudada lá/);

    // Manter o meu: reenvia com a base nova.
    atualizar.mockResolvedValueOnce({ id: "n1", versao: 10 });
    fireEvent.click(screen.getByRole("button", { name: "Manter o meu" }));
    await waitFor(() => expect(atualizar).toHaveBeenCalledTimes(2));
    expect(atualizar.mock.calls[1][1]).toMatchObject({ titulo: "Meu título 2", base_versao: 9 });
    await waitFor(() => expect(screen.queryByText("Esta nota mudou em outro lugar")).toBeNull());
  });

  it("409 → usar o do servidor troca o texto e descarta o rascunho", async () => {
    const atual = { titulo: "Do servidor", corpo: "outro corpo", versao: 9 };
    atualizar.mockRejectedValueOnce(new ApiError("CONFLICT", "x", 409, undefined, undefined, { atual }));
    abrir();
    const titulo = await screen.findByLabelText("Título da nota") as HTMLInputElement;
    fireEvent.change(titulo, { target: { value: "Meu" } });
    fireEvent.click(await screen.findByRole("button", { name: "Usar o do servidor" }, { timeout: 3000 }));
    await waitFor(() => expect(titulo.value).toBe("Do servidor"));
    await waitFor(async () => expect(await lerRascunhoNota("n1")).toBeUndefined());
    await new Promise((r) => setTimeout(r, 900));
    expect(atualizar).toHaveBeenCalledTimes(1);
  });
});
