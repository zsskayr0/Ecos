import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { pastas } from "@/lib/api";
import { RefreshProvider } from "@/lib/refresh-bus";
import { PastasGrade } from "./PastasGrade";
import { ToastHost } from "@/lib/toast";

vi.mock("@/lib/api", () => ({
  ApiError: class extends Error {},
  pastas: { listar: vi.fn(), renomear: vi.fn(), excluir: vi.fn() },
}));

const pasta = { caminho: "Arquivo", nome: "Arquivo", contagem_itens: 0 };

describe("ações e árvore de destino das pastas", () => {
  it("mostra as quatro ações pedidas e não oferece criar subpasta nos três pontos", () => {
    const abrir = vi.fn();
    render(<RefreshProvider><PastasGrade chave="notas" corIcone="text-steel-300" pastas={[pasta]} aoAbrir={abrir} /></RefreshProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Ações para Arquivo" }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Editar", "Renomear", "Mover", "Excluir"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Editar" }));
    expect(abrir).toHaveBeenCalledWith(pasta);
  });

  it("expande níveis com filhos, omite a seta nas folhas e permite mover para uma subpasta profunda", async () => {
    vi.mocked(pastas.listar).mockResolvedValue({
      subpastas: [
        { caminho: "Dev", nome: "Dev", contagem_itens: 0 },
        { caminho: "Dev/Apps", nome: "Apps", contagem_itens: 0 },
        { caminho: "Dev/Apps/Ecos", nome: "Ecos", contagem_itens: 0 },
      ],
      itens: [],
    });
    vi.mocked(pastas.renomear).mockResolvedValue({ ok: true });
    render(<RefreshProvider><PastasGrade chave="notas" corIcone="text-steel-300" espaco="pessoal" pastas={[pasta]} aoAbrir={vi.fn()} /><ToastHost /></RefreshProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Ações para Arquivo" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Mover" }));
    fireEvent.click(await screen.findByRole("button", { name: "Expandir Dev" }));
    fireEvent.click(await screen.findByRole("button", { name: "Expandir Apps" }));
    expect(screen.queryByRole("button", { name: "Expandir Ecos" })).toBeNull();
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Ecos" }));

    await waitFor(() => expect(pastas.renomear).toHaveBeenCalledWith({
      tipo: "nota", espaco: "pessoal", caminho_atual: "Arquivo", novo_caminho: "Dev/Apps/Ecos/Arquivo",
    }));
    const confirmacao = screen.getByRole("status");
    expect(confirmacao.textContent).toContain("Pasta movida com sucesso.");
    expect(confirmacao.className).toContain("bg-success");
  });
});
