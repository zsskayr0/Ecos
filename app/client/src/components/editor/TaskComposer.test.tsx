import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return { ...original, pastas: { ...original.pastas, listar: vi.fn().mockResolvedValue({ subpastas: [] }) } };
});
vi.mock("@/lib/use-catalogo-tags", () => ({ useCatalogoTags: () => ({ tags: [] }) }));
vi.mock("@/lib/use-viewport", () => ({ useIsMobile: () => true, useIsDesktop: () => false }));
vi.mock("./EquipeSelector", () => ({ EquipeSelector: () => <div>equipe</div> }));
vi.mock("./AttachmentsField", () => ({ AttachmentsField: () => <div data-testid="anexos" /> }));
vi.mock("./CorpoEditor", () => ({ CorpoEditor: () => <div data-testid="corpo" /> }));

import { EMPTY_TASK } from "@/lib/task-fields";
import { TaskComposer } from "./TaskComposer";

describe("TaskComposer — divulgação progressiva", () => {
  it("tarefa nova mostra só título, prioridade e data; o resto fica em Mais opções", () => {
    render(<TaskComposer value={EMPTY_TASK} onChange={() => undefined} onSave={() => undefined} />);
    expect(screen.getByLabelText("Título da tarefa")).toBeTruthy();
    expect(screen.getByText(/Data e horário/)).toBeTruthy();
    expect(screen.queryByTestId("corpo")).toBeNull();
    expect(screen.queryByTestId("anexos")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Mais opções/ }));
    expect(screen.getByTestId("corpo")).toBeTruthy();
    expect(screen.getByTestId("anexos")).toBeTruthy();
  });

  it("ao editar, o formulário completo já vem aberto", () => {
    render(<TaskComposer value={EMPTY_TASK} onChange={() => undefined} onSave={() => undefined} editing />);
    expect(screen.getByTestId("corpo")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Mais opções/ })).toBeNull();
  });
});
