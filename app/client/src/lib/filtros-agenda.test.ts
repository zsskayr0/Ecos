import { afterEach, describe, expect, it } from "vitest";
import { gravarFiltrosAgenda, lerFiltrosAgenda, tipoDoItem } from "./filtros-agenda";

afterEach(() => localStorage.clear());

describe("filtros da Agenda", () => {
  it("padrão: tudo ligado menos a atividade; o botão antigo de atividade é respeitado", () => {
    expect(lerFiltrosAgenda()).toEqual({ eventos: true, tarefas: true, prazos: true, contas: true, lancamentos: true, atividade: false });
    localStorage.setItem("ecos.agenda.mostrarAtividade", "1");
    expect(lerFiltrosAgenda().atividade).toBe(true);
  });
  it("grava e lê", () => {
    gravarFiltrosAgenda({ eventos: false, tarefas: true, prazos: false, contas: true, lancamentos: true, atividade: true });
    expect(lerFiltrosAgenda()).toMatchObject({ eventos: false, prazos: false, atividade: true });
  });
  it("classifica itens da grade e da Timeline", () => {
    expect(tipoDoItem({ tipo: "prazo" })).toBe("prazos");
    expect(tipoDoItem({ tipo: "tarefa" })).toBe("tarefas");
    expect(tipoDoItem({ tipo: "evento" })).toBe("eventos");
    expect(tipoDoItem({ tipo: "evento", transacaoId: "t" })).toBe("lancamentos");
    expect(tipoDoItem({ tipo: "evento", recorrenciaId: "r" })).toBe("contas");
    expect(tipoDoItem({ natureza: "registro", icone: "tarefa" })).toBe("atividade");
    expect(tipoDoItem({ icone: "prazo", alvo: { tipo: "tarefa" } })).toBe("prazos");
    expect(tipoDoItem({ icone: "evento", alvo: { tipo: "evento" } })).toBe("eventos");
  });
});
