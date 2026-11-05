import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LinksQuebradosScreen } from "./LinksQuebradosScreen";
import { RefreshProvider } from "@/lib/refresh-bus";

const pendentes = vi.fn();
const criar = vi.fn();
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  links: { pendentes: () => pendentes() },
  notas: { criar: (...a: unknown[]) => criar(...a) },
}));

const item = { titulo: "Algo inexistente", contagem: 2, espaco: "pessoal", pasta_sugerida: "Dev", origens: [{ tipo: "nota" as const, id: "n1", titulo: "Origem" }, { tipo: "tarefa" as const, id: "t1", titulo: "Outra" }] };

beforeEach(() => {
  pendentes.mockReset(); criar.mockReset();
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} })) as unknown as typeof window.matchMedia;
});

describe("Links quebrados", () => {
  it("lista o link e cria a nota com título, espaço e pasta sugerida", async () => {
    pendentes.mockResolvedValue([item]);
    criar.mockImplementation(async () => { pendentes.mockResolvedValue([]); return { id: "n9" }; });
    render(<RefreshProvider><LinksQuebradosScreen /></RefreshProvider>);
    expect(await screen.findByText("Algo inexistente")).toBeTruthy();
    expect(screen.getByText(/2 menções/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Criar nota Algo inexistente" }));
    await waitFor(() => expect(criar).toHaveBeenCalledWith({ titulo: "Algo inexistente", espaco: "pessoal", pasta: "Dev" }));
    await waitFor(() => expect(screen.queryByText("Algo inexistente")).toBeNull());
  });

  it("mostra estado vazio sem pendências", async () => {
    pendentes.mockResolvedValue([]);
    render(<RefreshProvider><LinksQuebradosScreen /></RefreshProvider>);
    expect(await screen.findByText("Nenhum link quebrado.")).toBeTruthy();
  });
});
