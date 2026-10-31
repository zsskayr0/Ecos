import { describe, expect, it, vi } from "vitest";
import type { GraficoDados } from "@/lib/api";
import { completarPastasDoGrafico } from "./pastas-grafico";

const dados: GraficoDados = { nos: [
  { id: "p1", tipo: "nota", titulo: "Pessoal", espaco: "pessoal", status: null },
  { id: "e1", tipo: "nota", titulo: "Equipe", espaco: "equipe:1", status: null },
  { id: "t1", tipo: "tarefa", titulo: "Tarefa", espaco: "pessoal", status: "pendente" },
  { id: "raiz", tipo: "nota", titulo: "Raiz", espaco: "pessoal", status: null },
], arestas: [] };

describe("pastas do gráfico em servidores antigos", () => {
  it("lê pastas aninhadas de cada espaço sem misturar IDs e preserva a raiz", async () => {
    const listar = vi.fn(async ({ tipo, espaco, recursivo, pasta_pai }: { tipo?: string; espaco?: string; recursivo?: boolean; pasta_pai?: string } = {}) => {
      if (recursivo) return { subpastas: tipo === "nota" ? [{ caminho: "Dev", nome: "Dev", contagem_itens: 1 }, { caminho: "Dev/Ecos App", nome: "Ecos App", contagem_itens: 1 }] : [{ caminho: "Dev/Tarefas", nome: "Tarefas", contagem_itens: 1 }], itens: [] };
      const id = tipo === "tarefa" && pasta_pai === "Dev/Tarefas" ? "t1" : tipo === "nota" && pasta_pai === "Dev/Ecos App" ? (espaco === "pessoal" ? "p1" : "e1") : null;
      return { subpastas: [], itens: id ? [{ id }] : [] };
    });
    const resultado = await completarPastasDoGrafico(dados, listar);
    expect(resultado.nos.map((n) => [n.id, n.pasta])).toEqual([["p1", "Dev/Ecos App"], ["e1", "Dev/Ecos App"], ["t1", "Dev/Tarefas"], ["raiz", null]]);
    expect(listar).toHaveBeenCalledWith({ tipo: "nota", espaco: "pessoal", recursivo: true });
  });

  it("não faz consultas adicionais quando o backend já fornece os caminhos", async () => {
    const listar = vi.fn();
    const completo = { nos: [{ ...dados.nos[0], caminho: "Ana/Notas/Dev/a.md" }], arestas: [] };
    expect(await completarPastasDoGrafico(completo, listar)).toBe(completo);
    expect(listar).not.toHaveBeenCalled();
  });
});
