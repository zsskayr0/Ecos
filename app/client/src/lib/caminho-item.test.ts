import { describe, expect, it } from "vitest";
import { caminhoDoItem, pastaDoArquivo } from "./caminho-item";

describe("pastaDoArquivo", () => {
  it("árvore única: a pasta é o trecho entre o espaço e o nome", () => {
    expect(pastaDoArquivo("diogo/Trabalho/Clientes/note-Plano.md")).toBe("Trabalho/Clientes");
    expect(pastaDoArquivo("diogo/task-Solta.md")).toBeNull();
  });

  it("caminho do layout antigo continua dando a mesma pasta", () => {
    expect(pastaDoArquivo("diogo/Notas/Trabalho/note-Plano.md")).toBe("Trabalho");
    expect(pastaDoArquivo("diogo/Tarefas/task-Solta.md")).toBeNull();
    expect(pastaDoArquivo("diogo\\Trabalho\\note-Plano.md")).toBe("Trabalho");
  });
});

describe("caminhoDoItem", () => {
  it("nota e tarefa não têm mais Notas/Tarefas no caminho; evento continua em Eventos", () => {
    expect(caminhoDoItem({ tipo: "nota", espaco: "pessoal", pasta: "Trabalho", titulo: "Plano" })).toBe("Pessoal / Trabalho / Plano");
    expect(caminhoDoItem({ tipo: "tarefa", espaco: "pessoal", pasta: null, titulo: "Pagar" })).toBe("Pessoal / Pagar");
    expect(caminhoDoItem({ tipo: "evento", espaco: "pessoal", titulo: "Reunião" })).toBe("Pessoal / Eventos / Reunião");
  });
});
