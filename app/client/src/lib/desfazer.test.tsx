import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastHost } from "@/lib/toast";
import { avisarComDesfazer, avisarExcluido } from "./desfazer";
import { ConfirmDeleteDialog } from "@/components/common/ConfirmDeleteDialog";

const listar = vi.hoisted(() => vi.fn());
const restaurar = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock("@/lib/api", () => ({ lixeira: { listar, restaurar } }));

describe("Desfazer", () => {
  beforeEach(() => { listar.mockReset(); restaurar.mockClear(); });

  it("o toast tem região viva, ação Desfazer e chama a operação inversa", async () => {
    const inverso = vi.fn(async () => undefined);
    const depois = vi.fn();
    render(<ToastHost />);
    act(() => avisarComDesfazer("Tarefa concluída.", inverso, { aoDesfazer: depois, sucesso: "Tarefa reaberta." }));
    expect(screen.getByRole("status").textContent).toContain("Tarefa concluída.");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Desfazer" })); });
    expect(inverso).toHaveBeenCalledTimes(1);
    expect(depois).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Tarefa reaberta.")).toBeTruthy();
  });

  it("exclusão: avisa da Lixeira e restaura o item mais recente com o mesmo título", async () => {
    listar.mockResolvedValue([
      { id: "documento-A", tipo: "nota", nome: "Ideia", excluido_em: "2026-10-01T10:00:00Z" },
      { id: "documento-B", tipo: "nota", nome: "Ideia", excluido_em: "2026-10-02T10:00:00Z" },
      { id: "documento-C", tipo: "tarefa", nome: "Ideia", excluido_em: "2026-10-03T10:00:00Z" },
    ]);
    const depois = vi.fn();
    render(<ToastHost />);
    act(() => avisarExcluido("nota", "Ideia", depois));
    expect(screen.getByRole("status").textContent).toContain("Nota enviada para a Lixeira.");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Desfazer" })); });
    expect(restaurar).toHaveBeenCalledWith("documento-B");
    expect(depois).toHaveBeenCalled();
  });

  it("falha ao desfazer mostra erro em vez de silêncio", async () => {
    render(<ToastHost />);
    act(() => avisarComDesfazer("Movido.", async () => { throw new Error("x"); }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Desfazer" })); });
    expect((await screen.findByRole("alert")).textContent).toContain("Não foi possível desfazer.");
  });

  it("o diálogo de exclusão avisa que vai para a Lixeira", () => {
    render(<ConfirmDeleteDialog open={false} title="Apagar esta nota?" busy={false} onCancel={() => {}} onConfirm={() => {}} />);
    expect(document.body.textContent).toContain("Vai para a Lixeira. Você pode restaurar depois.");
  });
});
