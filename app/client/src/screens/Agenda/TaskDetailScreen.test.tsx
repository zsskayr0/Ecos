import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const viewport = vi.hoisted(() => ({ desktop: true }));

vi.mock("@/lib/use-viewport", () => ({ useIsDesktop: () => viewport.desktop }));
vi.mock("@/components/editor/TaskComposer", () => ({
  TaskComposer: ({ titleActions }: { titleActions?: React.ReactNode }) => <div>{titleActions}</div>,
}));
vi.mock("@/components/layout/DetailHeader", () => ({
  DETAIL_ACTION: "",
  DetailHeader: ({ actions }: { actions?: React.ReactNode }) => <header>{actions}</header>,
}));
vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    tarefas: {
      ...original.tarefas,
      obter: vi.fn(),
      criar: vi.fn(),
      atualizar: vi.fn(),
      timeEntries: { ...original.tarefas.timeEntries, listar: vi.fn() },
    },
  };
});

import { tarefas, type TarefaDetalhe } from "@/lib/api";
import { RefreshProvider } from "@/lib/refresh-bus";
import { TaskDetailScreen } from "./TaskDetailScreen";

const original: TarefaDetalhe = {
  id: "original",
  titulo: "Revisar proposta",
  status: "pendente",
  scheduled_at: null,
  duration_min: 30,
  due_date: null,
  tags: [],
  prioridade: "media",
  subtarefas: [],
  espaco: "pessoal",
  criado_em: "2026-09-24T10:00:00Z",
  caminho_arquivo: "Tarefas/Revisar proposta.md",
  pasta: null,
  corpo: "",
};

function abrirDetalhe() {
  return render(
    <MemoryRouter initialEntries={["/tarefa/original"]}>
      <RefreshProvider>
        <Routes>
          <Route path="/tarefa/copia-2" element={<p>Detalhe da cópia</p>} />
          <Route path="/tarefa/:id" element={<TaskDetailScreen />} />
          <Route path="/feed" element={<p>Feed</p>} />
        </Routes>
      </RefreshProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(tarefas.obter).mockResolvedValue(original);
  vi.mocked(tarefas.timeEntries.listar).mockResolvedValue([]);
  vi.mocked(tarefas.criar).mockResolvedValue({ id: "copia-2" });
});

describe("duplicar tarefa", () => {
  it.each([
    { layout: "desktop com MemoryRouter por aba", desktop: true },
    { layout: "mobile", desktop: false },
  ])("abre o detalhe da cópia no $layout", async ({ desktop }) => {
    viewport.desktop = desktop;
    abrirDetalhe();

    fireEvent.click(await screen.findByRole("button", { name: "Duplicar tarefa" }));

    await waitFor(() => expect(screen.getByText("Detalhe da cópia")).toBeTruthy());
    expect(screen.queryByText("Feed")).toBeNull();
    expect(tarefas.criar).toHaveBeenCalledWith(expect.objectContaining({ titulo: "Revisar proposta (cópia)" }));
  });
});
