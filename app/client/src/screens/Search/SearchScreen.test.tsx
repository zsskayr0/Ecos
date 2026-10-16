import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SearchScreen } from "./SearchScreen";

const buscar = vi.hoisted(() => vi.fn());
const listarTransacoes = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  busca: { buscar },
  vault: { transacoes: { listar: listarTransacoes } },
  ApiError: class ApiError extends Error {},
}));
vi.mock("@/lib/documento-popup", () => ({ useAbrirDocumento: () => vi.fn() }));

function abrir() {
  render(<MemoryRouter><SearchScreen /></MemoryRouter>);
}

async function pesquisar(termo: string) {
  fireEvent.change(screen.getByPlaceholderText(/Buscar Notas/), { target: { value: termo } });
}

describe("SearchScreen", () => {
  beforeEach(() => {
    localStorage.clear();
    buscar.mockReset();
    listarTransacoes.mockReset();
    buscar.mockResolvedValue({
      notas: [{ id: "n1", titulo: "Nota de teste", espaco: "pessoal", trecho: "trecho" }],
      tarefas: [{ id: "t1", titulo: "Tarefa de teste", espaco: "pessoal", status: "concluida" }],
    });
    listarTransacoes.mockResolvedValue({ items: [] });
  });

  it("mostra o status da tarefa em português, nunca o valor cru", async () => {
    abrir();
    await pesquisar("teste");
    expect(await screen.findByText("Concluída")).toBeTruthy();
    expect(screen.queryByText("concluida")).toBeNull();
  });

  it("os filtros de escopo mudam de verdade o que é buscado", async () => {
    abrir();
    fireEvent.click(screen.getByRole("button", { name: "Só tarefas" }));
    await pesquisar("teste");
    await waitFor(() => expect(buscar).toHaveBeenCalledWith("teste", { tipo: "tarefa" }));
    expect(listarTransacoes).not.toHaveBeenCalled();
    const titulo = (t: string) => (_: string, el: Element | null) => el?.tagName === "P" && el.textContent === t;
    expect(await screen.findByText(titulo("Tarefa de teste"))).toBeTruthy();
    expect(screen.queryByText(titulo("Nota de teste"))).toBeNull();
  });

  it("limpa as buscas recentes e o que estava salvo", async () => {
    localStorage.setItem("ecos-buscas-recentes", JSON.stringify(["reunião", "orçamento"]));
    abrir();
    expect(screen.getByText("reunião")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Limpar" }));
    expect(screen.queryByText("reunião")).toBeNull();
    expect(localStorage.getItem("ecos-buscas-recentes")).toBeNull();
  });
});
