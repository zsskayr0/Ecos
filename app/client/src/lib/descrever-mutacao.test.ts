import { describe, expect, it } from "vitest";
import { descreverMutacao } from "./descrever-mutacao";

describe("descreverMutacao", () => {
  it("criação offline traz o título e o texto", () => {
    const d = descreverMutacao({ metodo: "POST", caminho: "/notas", corpo: JSON.stringify({ titulo: "Ideias", corpo: "texto da nota" }) });
    expect(d).toEqual({ acao: "Nova nota", titulo: "Ideias", texto: "texto da nota", rota: null });
  });
  it("edição de item que existe no servidor abre o item", () => {
    expect(descreverMutacao({ metodo: "PATCH", caminho: "/tarefas/T1", corpo: JSON.stringify({ titulo: "Pagar luz" }) }))
      .toMatchObject({ acao: "Edição da tarefa", titulo: "Pagar luz", rota: "/tarefa/T1" });
  });
  it("sub-recursos e exclusão", () => {
    expect(descreverMutacao({ metodo: "PATCH", caminho: "/tarefas/T1/status", corpo: '{"status":"concluida"}' }).acao).toBe("Mudança de status da tarefa");
    expect(descreverMutacao({ metodo: "DELETE", caminho: "/notas/N1", corpo: null })).toMatchObject({ acao: "Exclusão da nota", rota: null });
    expect(descreverMutacao({ metodo: "POST", caminho: "/eventos", corpo: '{"titulo":"Reunião"}' }).acao).toBe("Novo evento");
  });
  it("item ainda com id temporário não tem rota", () => {
    expect(descreverMutacao({ metodo: "PATCH", caminho: "/notas/offline-abc", corpo: "{}" }).rota).toBeNull();
  });
  it("recurso desconhecido não quebra", () => {
    expect(descreverMutacao({ metodo: "PUT", caminho: "/me/preferencias/calendario", corpo: null }).acao).toBe("Alteração em me");
  });
});
