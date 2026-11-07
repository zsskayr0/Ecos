import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async () => {
  const real = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...real, problemasArquivos: { listar: vi.fn(), corrigir: vi.fn() } };
});
vi.mock("@/lib/refresh-bus", () => ({ useRefreshBus: () => ({ versao: 0, notificar: vi.fn() }) }));

import { problemasArquivos, type ProblemaArquivo } from "@/lib/api";
import { ProblemasArquivosScreen } from "./ProblemasArquivosScreen";

const item: ProblemaArquivo = { tipo: "nota", id: "N1", titulo: "Plano", caminho: "diogo/Notas/Trabalho/Plano.md", problema: "sem_prefixo", nome_sugerido: "note-Plano.md" };
const abrir = () => render(<MemoryRouter><ProblemasArquivosScreen /></MemoryRouter>);

describe("ProblemasArquivosScreen", () => {
  beforeEach(() => {
    vi.mocked(problemasArquivos.listar).mockReset();
    vi.mocked(problemasArquivos.corrigir).mockReset();
  });

  it("estado vazio quando tudo segue o padrão", async () => {
    vi.mocked(problemasArquivos.listar).mockResolvedValue({ itens: [] });
    abrir();
    expect(await screen.findByText("Todos os arquivos seguem o padrão.")).toBeTruthy();
  });

  it("corrige um item e diz quantos foram renomeados", async () => {
    vi.mocked(problemasArquivos.listar).mockResolvedValueOnce({ itens: [item] }).mockResolvedValueOnce({ itens: [] });
    vi.mocked(problemasArquivos.corrigir).mockResolvedValue({ corrigidos: [{ id: "N1", de: item.caminho, para: "diogo/Notas/Trabalho/note-Plano.md" }], falhas: [] });
    abrir();
    expect(await screen.findByText("Plano.md")).toBeTruthy();
    expect(screen.getByText("note-Plano.md")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Corrigir" }));
    await waitFor(() => expect(problemasArquivos.corrigir).toHaveBeenCalledWith({ itens: [{ tipo: "nota", id: "N1" }] }));
    expect(await screen.findByText("1 arquivo renomeado.")).toBeTruthy();
  });

  it("corrigir todos pede confirmação antes", async () => {
    vi.mocked(problemasArquivos.listar).mockResolvedValue({ itens: [item] });
    vi.mocked(problemasArquivos.corrigir).mockResolvedValue({ corrigidos: [], falhas: [] });
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: "Corrigir todos" }));
    expect(problemasArquivos.corrigir).not.toHaveBeenCalled();
    const dialogo = screen.getByRole("alertdialog", { name: "Confirmar: corrigir todos" });
    fireEvent.click(dialogo.querySelector("button.bg-cyan")!);
    await waitFor(() => expect(problemasArquivos.corrigir).toHaveBeenCalledWith({ todos: true }));
  });
});
