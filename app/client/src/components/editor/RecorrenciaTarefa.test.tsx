import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    tarefas: { ...original.tarefas, serie: { obter: vi.fn(), definir: vi.fn(), acao: vi.fn() } },
  };
});

import { tarefas, type SerieResumo } from "@/lib/api";
import { RecorrenciaTarefa, descreverRegra } from "./RecorrenciaTarefa";

const serie: SerieResumo = {
  serie_id: "s1", estado: "ativa", ocorrencia_data: "2026-10-05", excecao: false, total_geradas: 1, puladas: [], proxima_data: "2026-10-07",
  regra: { frequencia: "diaria", intervalo: 2, dias_semana: [], fim_de_mes: "ajustar", data_fim: null, max_ocorrencias: null, timezone: "America/Sao_Paulo", data_inicio: "2026-10-05" },
};

function montar(props: Partial<React.ComponentProps<typeof RecorrenciaTarefa>> = {}) {
  const onMudou = vi.fn();
  render(<RecorrenciaTarefa tarefaId="t1" serie={null} temData concluida={false} escopo="esta" onEscopo={() => {}} onMudou={onMudou} {...props} />);
  return { onMudou };
}

describe("RecorrenciaTarefa", () => {
  beforeEach(() => { vi.mocked(tarefas.serie.definir).mockReset(); vi.mocked(tarefas.serie.acao).mockReset(); });

  it("descreve a regra em português", () => {
    expect(descreverRegra({ frequencia: "diaria", intervalo: 1, dias_semana: [] })).toBe("Todo dia");
    expect(descreverRegra({ frequencia: "mensal", intervalo: 3, dias_semana: [] })).toBe("A cada 3 meses");
    expect(descreverRegra({ frequencia: "semanal", intervalo: 1, dias_semana: [1, 3] })).toBe("Toda semana (Seg, Qua)");
  });

  it("sem data na tarefa não deixa repetir e explica por quê", () => {
    montar({ temData: false });
    expect(screen.getByText(/Defina uma data/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Repetir" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("cria a repetição semanal com os dias escolhidos e o fuso do dispositivo", async () => {
    vi.mocked(tarefas.serie.definir).mockResolvedValue(serie);
    const { onMudou } = montar();
    fireEvent.click(screen.getByRole("button", { name: "Repetir" }));
    fireEvent.click(screen.getByRole("button", { name: "Seg" }));
    fireEvent.click(screen.getByRole("button", { name: "Qua" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar repetição" }));
    await waitFor(() => expect(tarefas.serie.definir).toHaveBeenCalledTimes(1));
    const [id, regra] = vi.mocked(tarefas.serie.definir).mock.calls[0];
    expect(id).toBe("t1");
    expect(regra).toMatchObject({ frequencia: "semanal", intervalo: 1, dias_semana: [1, 3], data_fim: null, max_ocorrencias: null });
    expect(regra.timezone).toBeTruthy();
    await waitFor(() => expect(onMudou).toHaveBeenCalled());
  });

  it("recusa intervalo inválido sem chamar o servidor", () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: "Repetir" }));
    fireEvent.change(screen.getByLabelText("Intervalo da repetição"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar repetição" }));
    expect(screen.getByRole("alert").textContent).toMatch(/intervalo/);
    expect(tarefas.serie.definir).not.toHaveBeenCalled();
  });

  it("pausa, pula e encerra a série", async () => {
    vi.mocked(tarefas.serie.acao).mockResolvedValue({ ok: true, proxima_id: null });
    const { onMudou } = montar({ serie });
    expect(screen.getByText(/A cada 2 dias · Ativa · próxima em/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Pausar/ }));
    await waitFor(() => expect(tarefas.serie.acao).toHaveBeenCalledWith("t1", "pausar"));
    fireEvent.click(screen.getByRole("button", { name: /Pular esta/ }));
    await waitFor(() => expect(tarefas.serie.acao).toHaveBeenCalledWith("t1", "pular"));
    fireEvent.click(screen.getByRole("button", { name: /Encerrar série/ }));
    await waitFor(() => expect(tarefas.serie.acao).toHaveBeenCalledWith("t1", "encerrar"));
    expect(onMudou).toHaveBeenCalledTimes(3);
  });

  it("série pausada oferece retomar", async () => {
    vi.mocked(tarefas.serie.acao).mockResolvedValue({ ok: true, proxima_id: "n1" });
    montar({ serie: { ...serie, estado: "pausada" } });
    expect(screen.queryByRole("button", { name: /Pausar/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Retomar/ }));
    await waitFor(() => expect(tarefas.serie.acao).toHaveBeenCalledWith("t1", "retomar"));
  });
});
