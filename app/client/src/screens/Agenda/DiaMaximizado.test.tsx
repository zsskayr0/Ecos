import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import type { TarefaResumo } from "@/lib/api";
import { DiaMaximizado } from "./DiaMaximizado";

const tarefa = (id: string, titulo: string, status: "pendente" | "concluida"): TarefaResumo => ({
  id, titulo, status, caminho_arquivo: `Tarefas/${id}.md`, scheduled_at: "2026-09-22T13:00:00Z", duration_min: 30,
  due_date: null, espaco: "pessoal", criado_em: "2026-09-01T10:00:00Z", prioridade: "baixa", criado_por: null, criado_por_nome: null,
  concluida_em: status === "concluida" ? "2026-09-22T14:00:00Z" : null,
});

it("separa tarefas pendentes e concluídas no resumo sem duplicar a conclusão do dia", () => {
  const pendente = tarefa("p1", "Revisar pauta", "pendente");
  const concluida = tarefa("c1", "Enviar convite", "concluida");
  render(<DiaMaximizado dia={new Date(2026, 8, 22)} hoje={false} eventosDoDia={[]} tarefasDoDia={[pendente, concluida]} concluidasDoDia={[concluida]} capacidade={null} semRotina={false} onAjustarRotina={() => {}} onAbrirEvento={() => {}} abrirDocumento={() => {}} onFechar={() => {}} />);

  expect(within(screen.getByRole("region", { name: "Tarefas pendentes do dia" })).getByText("Revisar pauta")).toBeTruthy();
  expect(within(screen.getByRole("region", { name: "Tarefas concluídas do dia" })).getAllByText("Enviar convite")).toHaveLength(1);
  fireEvent.click(screen.getByRole("tab", { name: /Tarefas/ }));
  expect(within(screen.getByRole("region", { name: "Tarefas pendentes" })).queryByText("Enviar convite")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Concluídas · 1/ }));
  expect(within(screen.getByRole("region", { name: "Concluídas neste dia" })).getAllByText("Enviar convite")).toHaveLength(1);
});
