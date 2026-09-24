import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { pastas } from "@/lib/api";
import { FolderCreateScreen } from "./FolderCreateScreen";
import { TaskFolderCreateScreen } from "../Tasks/TaskFolderCreateScreen";

vi.mock("@/lib/api", () => ({ pastas: { criar: vi.fn() }, ApiError: class extends Error {} }));
vi.mock("@/lib/refresh-bus", () => ({ useRefreshBus: () => ({ notificar: vi.fn() }) }));
vi.mock("@/lib/use-espaco-filtro", () => ({ useEspacoFiltro: () => "equipe:design" }));

describe("criação contextual de subpastas", () => {
  it.each(["nota", "tarefa"])("cria %s na pasta pai e retorna a ela", async (tipo) => {
    const pai = "Projetos/Aplicativo";
    vi.mocked(pastas.criar).mockResolvedValue({ ok: true, caminho: `${pai}/Referências` });
    const base = tipo === "nota" ? "notas" : "tarefas";
    render(<MemoryRouter initialEntries={[`/${base}/pasta/nova?pai=${encodeURIComponent(pai)}`]}><Routes>
      <Route path={`/${base}/pasta/nova`} element={tipo === "nota" ? <FolderCreateScreen /> : <TaskFolderCreateScreen />} />
      <Route path={`/${base}/pasta/*`} element={<p>Voltou à pasta</p>} />
    </Routes></MemoryRouter>);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Referências" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar pasta" }));
    await waitFor(() => expect(pastas.criar).toHaveBeenLastCalledWith(expect.objectContaining({ nome: "Referências", pasta_pai: pai, espaco: "equipe:design" })));
    expect(await screen.findByText("Voltou à pasta")).toBeTruthy();
  });
});
