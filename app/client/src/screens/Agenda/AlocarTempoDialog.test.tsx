import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TarefaResumo } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return { ...original, tarefas: { ...original.tarefas, listar: vi.fn() } };
});

import { ApiError, tarefas } from "@/lib/api";
import { AlocarTempoDialog } from "./AlocarTempoDialog";

// Hoje = terça 22/09/2026 10:07 (Brasília) → início padrão 10:15 com encaixe de 15.
const AGORA = new Date("2026-09-22T13:07:00Z");

function tarefa(id: string, titulo: string, duration_min: number | null, pasta: string | null = null): TarefaResumo {
  return { id, caminho_arquivo: `Tarefas/${id}.md`, titulo, status: "pendente", scheduled_at: null, duration_min, due_date: null, espaco: "pessoal", criado_em: "2026-09-01T10:00:00Z", prioridade: "alta", criado_por: null, criado_por_nome: null, pasta } as TarefaResumo;
}
const LISTA = [tarefa("a", "Escrever relatório", 45, "Trabalho"), tarefa("b", "Revisar contrato", 120, "Trabalho"), tarefa("c", "Sem estimativa", null)];
const listar = vi.mocked(tarefas.listar);

async function abrir(props: { encaixe?: number } = {}) {
  const onFechar = vi.fn();
  const onAlocar = vi.fn();
  render(<AlocarTempoDialog encaixe={props.encaixe ?? 15} onFechar={onFechar} onAlocar={onAlocar} />);
  await screen.findByRole("option", { name: "Escrever relatório" });
  return { onFechar, onAlocar };
}
const duracao = () => screen.getByLabelText("Duração personalizada em minutos") as HTMLInputElement;
const escolher = (titulo: string) => fireEvent.click(screen.getByRole("option", { name: titulo }));
const abrirRelogio = () => fireEvent.click(screen.getByRole("button", { name: "Início" }));
const relogio = () => screen.getByRole("dialog", { name: /Início: escolher/ });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AGORA);
  listar.mockReset();
  listar.mockResolvedValue({ items: LISTA, next_cursor: null } as never);
});
afterEach(() => { vi.useRealTimers(); });

describe("Alocar tempo por diálogo", () => {
  it("lista só as tarefas pendentes, agrupadas por pasta (sem pasta por último), com a primeira escolhida", async () => {
    await abrir();
    expect(listar).toHaveBeenCalledWith({ status: "pendente", limit: 200 });
    expect(screen.getByRole("option", { name: "Escrever relatório" }).getAttribute("aria-selected")).toBe("true");
    const grupos = screen.getAllByRole("group").filter((g) => ["Trabalho", "Sem pasta"].includes(g.getAttribute("aria-label") ?? ""));
    expect(grupos.map((g) => g.getAttribute("aria-label"))).toEqual(["Trabalho", "Sem pasta"]);
    expect(within(grupos[0]).getAllByRole("option").map((o) => o.getAttribute("aria-label"))).toEqual(["Escrever relatório", "Revisar contrato"]);
  });

  it("não usa <select> nativo, nem input de data/hora nativos", async () => {
    await abrir();
    expect(document.querySelector("select, input[type=date], input[type=time]")).toBeNull();
  });

  it("começa em HOJE e no horário atual arredondado ao encaixe", async () => {
    await abrir();
    expect(screen.getByText("22/09/2026")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Início" }).textContent).toBe("10:15");
  });

  it("o horário inicial segue o encaixe (30 min → 10:30)", async () => {
    await abrir({ encaixe: 30 });
    expect(screen.getByRole("button", { name: "Início" }).textContent).toBe("10:30");
  });

  it("buscar filtra a lista pelo título", async () => {
    await abrir();
    fireEvent.change(screen.getByLabelText("Buscar tarefa"), { target: { value: "contr" } });
    expect(screen.getAllByRole("option").map((o) => o.getAttribute("aria-label"))).toEqual(["Revisar contrato"]);
    fireEvent.change(screen.getByLabelText("Buscar tarefa"), { target: { value: "zzz" } });
    expect(screen.getByText("Nenhuma tarefa encontrada.")).toBeTruthy();
  });

  it("o tempo começa em 5 min, com ou sem estimativa, e não muda ao trocar de tarefa", async () => {
    await abrir();
    expect(duracao().value).toBe("5");
    escolher("Revisar contrato");
    expect(duracao().value).toBe("5");
    escolher("Sem estimativa");
    expect(duracao().value).toBe("5");
  });

  it("o menu de durações preenche o tempo e mostram o intervalo resultante", async () => {
    await abrir();
    fireEvent.click(screen.getByRole("button", { name: "Escolher duração" }));
    fireEvent.click(screen.getByText("1h"));
    expect(duracao().value).toBe("60");
    expect(screen.getAllByText(/10:15 – 11:15/).length).toBeGreaterThan(0);
  });

  it("o tempo digitado é mantido ao escolher outra tarefa", async () => {
    await abrir();
    fireEvent.change(duracao(), { target: { value: "75" } });
    expect(duracao().value).toBe("75");
    escolher("Revisar contrato");
    expect(duracao().value).toBe("75");
  });

  it("o seletor de horário abre colunas de horas e minutos no passo do encaixe, e escolher muda o início", async () => {
    await abrir({ encaixe: 15 });
    abrirRelogio();
    const r = within(relogio());
    expect(within(r.getByRole("group", { name: "Minutos" })).getAllByRole("button").map((b) => b.textContent)).toEqual(["00", "15", "30", "45"]);
    fireEvent.click(r.getByRole("button", { name: "Hora 14" }));
    fireEvent.click(r.getByRole("button", { name: "Minuto 30" }));
    expect(screen.getByRole("button", { name: "Início" }).textContent).toBe("14:30");
    fireEvent.click(r.getByRole("button", { name: "Pronto" }));
    expect(screen.queryByRole("dialog", { name: /Início: escolher/ })).toBeNull();
  });

  it('"Agora" no seletor volta ao horário atual arredondado', async () => {
    await abrir();
    abrirRelogio();
    fireEvent.click(within(relogio()).getByRole("button", { name: "Hora 18" }));
    fireEvent.click(within(relogio()).getByRole("button", { name: "Agora" }));
    expect(screen.getByRole("button", { name: "Início" }).textContent).toBe("10:15");
  });

  it("alocar entrega a tarefa e o destino — sem tocar em nada da tarefa", async () => {
    const { onAlocar } = await abrir();
    abrirRelogio();
    fireEvent.click(within(relogio()).getByRole("button", { name: "Hora 14" }));
    fireEvent.click(within(relogio()).getByRole("button", { name: "Minuto 30" }));
    fireEvent.change(duracao(), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "Alocar" }));
    expect(onAlocar).toHaveBeenCalledWith({ id: "a", titulo: "Escrever relatório", duracaoMin: 45, prioridade: "alta" }, { dia: "2026-09-22", inicioMin: 14 * 60 + 30, duracaoMin: 50 });
  });

  it("escolher outro dia no calendário do Ecos", async () => {
    const { onAlocar } = await abrir();
    fireEvent.click(screen.getByText("22/09/2026"));
    fireEvent.click(screen.getByRole("button", { name: "25" }));
    fireEvent.click(screen.getByRole("button", { name: "Alocar" }));
    expect(onAlocar.mock.calls[0][1].dia).toBe("2026-09-25");
  });

  it("recusa tempo inválido e explica", async () => {
    const { onAlocar } = await abrir();
    fireEvent.change(duracao(), { target: { value: "0" } });
    expect(screen.getByRole("alert").textContent).toMatch(/de 5 minutos a 24/);
    expect((screen.getByRole("button", { name: "Alocar" }) as HTMLButtonElement).disabled).toBe(true);
    expect(onAlocar).not.toHaveBeenCalled();
  });

  it("Esc, o X, Cancelar e o clique fora fecham sem alocar", async () => {
    const { onFechar, onAlocar } = await abrir();
    fireEvent.keyDown(screen.getByRole("dialog", { name: /Alocar tempo/ }), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.pointerDown(screen.getByRole("presentation"));
    expect(onFechar).toHaveBeenCalledTimes(4);
    expect(onAlocar).not.toHaveBeenCalled();
  });

  it("avisa que a data da tarefa não é alterada", async () => {
    await abrir();
    expect(screen.getByRole("dialog", { name: /Alocar tempo/ }).textContent).toMatch(/data da tarefa não é alterada/);
  });

  it("sem tarefas pendentes explica e não deixa alocar", async () => {
    listar.mockResolvedValue({ items: [], next_cursor: null } as never);
    render(<AlocarTempoDialog encaixe={15} onFechar={vi.fn()} onAlocar={vi.fn()} />);
    expect(await screen.findByText(/Não há tarefas pendentes/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Alocar" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("falha ao carregar mostra o erro do servidor", async () => {
    listar.mockRejectedValue(new ApiError("INTERNAL", "Servidor indisponível.", 500));
    render(<AlocarTempoDialog encaixe={15} onFechar={vi.fn()} onAlocar={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Servidor indisponível/));
  });

  it("enquanto carrega mostra 'Carregando'", async () => {
    listar.mockImplementation(() => new Promise(() => {}));
    render(<AlocarTempoDialog encaixe={15} onFechar={vi.fn()} onAlocar={vi.fn()} />);
    expect(screen.getByText(/Carregando tarefas/)).toBeTruthy();
  });
});
