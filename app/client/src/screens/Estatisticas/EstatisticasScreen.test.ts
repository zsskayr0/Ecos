import { describe, expect, it } from "vitest";
import { agruparDias } from "./EstatisticasScreen";

describe("séries de atividade", () => {
  const dias = [
    { data: "2026-09-28", notas: 1, tarefas: 2, concluidas: 0 },
    { data: "2026-09-29", notas: 3, tarefas: 0, concluidas: 1 },
    { data: "2026-10-05", notas: 2, tarefas: 1, concluidas: 2 },
  ];

  it("preserva os dias e soma apenas os dias da mesma semana", () => {
    expect(agruparDias(dias, 30)).toHaveLength(3);
    expect(agruparDias(dias, 90).map(({ notas, tarefas, concluidas }) => ({ notas, tarefas, concluidas }))).toEqual([
      { notas: 4, tarefas: 2, concluidas: 1 },
      { notas: 2, tarefas: 1, concluidas: 2 },
    ]);
  });

  it("agrupa por mês sem misturar criação e conclusão", () => {
    expect(agruparDias(dias, 365).map(({ notas, tarefas, concluidas }) => ({ notas, tarefas, concluidas }))).toEqual([
      { notas: 4, tarefas: 2, concluidas: 1 },
      { notas: 2, tarefas: 1, concluidas: 2 },
    ]);
  });
});
