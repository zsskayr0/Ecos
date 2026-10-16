import { describe, expect, it } from "vitest";

import type { ArestaGrafico, NoGrafico } from "@/lib/api";
import { casaBusca, idsVisiveis, montarGrafo, normalizar } from "./grafo-puro";

const no = (id: string, tipo: NoGrafico["tipo"], titulo = id): NoGrafico => ({ id, tipo, titulo, espaco: tipo === "tag" ? null : "pessoal", status: null });
const ar = (origem: string, destino: string, tipo: ArestaGrafico["tipo"] = "wikilink"): ArestaGrafico => ({ origem, destino, tipo });
const todos = { nota: true, tarefa: true, evento: true, tag: true };

describe("montarGrafo", () => {
  it("descarta arestas para nós que o servidor não devolveu e nunca cria nó", () => {
    const g = montarGrafo([no("a", "nota"), no("b", "nota")], [ar("a", "b"), ar("a", "fantasma"), ar("intruso", "b")]);
    expect(g.nos.map((n) => n.id)).toEqual(["a", "b"]);
    expect(g.arestas).toHaveLength(1);
    expect(g.vizinhos.has("fantasma")).toBe(false);
    expect(g.grau.has("fantasma")).toBe(false);
  });

  it("deduplica nós por id e arestas por origem, destino e tipo; tipos diferentes coexistem", () => {
    const g = montarGrafo(
      [no("a", "nota", "primeiro"), no("a", "nota", "repetido"), no("b", "nota")],
      [ar("a", "b"), ar("a", "b"), ar("a", "b", "evento_nota")],
    );
    expect(g.nos).toHaveLength(2);
    expect(g.nos[0].titulo).toBe("primeiro");
    expect(g.arestas.map((x) => x.tipo)).toEqual(["wikilink", "evento_nota"]);
    expect(g.grau.get("a")).toBe(1);
  });

  it("ignora autoarestas e calcula vizinhança simétrica", () => {
    const g = montarGrafo([no("a", "nota"), no("b", "tarefa"), no("tag:x", "tag", "#x")], [ar("a", "a"), ar("a", "tag:x", "tag"), ar("b", "tag:x", "tag")]);
    expect(g.arestas).toHaveLength(2);
    expect([...g.vizinhos.get("tag:x")!].sort()).toEqual(["a", "b"]);
    expect(g.grau.get("tag:x")).toBe(2);
    expect(g.grau.get("a")).toBe(1);
  });

  it("grafo vazio é válido", () => {
    const g = montarGrafo([], []);
    expect(g.nos).toEqual([]);
    expect(g.arestas).toEqual([]);
  });
});

describe("busca", () => {
  it("normaliza acentos e caixa", () => {
    expect(normalizar("Ação Crítica")).toBe("acao critica");
  });
  it("busca vazia casa tudo; senão procura por trecho sem acento", () => {
    expect(casaBusca(normalizar("Reunião"), "")).toBe(true);
    expect(casaBusca(normalizar("Reunião semanal"), normalizar("reuniao"))).toBe(true);
    expect(casaBusca(normalizar("Compras"), normalizar("reuniao"))).toBe(false);
  });
});

describe("idsVisiveis", () => {
  const nos = [no("n1", "nota"), no("n2", "nota"), no("t1", "tarefa"), no("tag:x", "tag"), no("solto", "nota")];
  const arestas = [ar("n1", "n2"), ar("n1", "tag:x", "tag"), ar("t1", "tag:x", "tag")];

  it("mostra tudo com nós soltos permitidos", () => {
    expect(idsVisiveis(nos, arestas, todos, true).size).toBe(5);
  });
  it("esconde nós sem conexão quando pedido", () => {
    const v = idsVisiveis(nos, arestas, todos, false);
    expect(v.has("solto")).toBe(false);
    expect(v.size).toBe(4);
  });
  it("desligar um tipo remove seus nós e as conexões que dependiam dele", () => {
    const v = idsVisiveis(nos, arestas, { ...todos, tag: false }, false);
    expect([...v].sort()).toEqual(["n1", "n2"]);
  });
  it("nunca devolve id que não esteja nos nós", () => {
    const v = idsVisiveis(nos, [...arestas, ar("n1", "fantasma")], todos, true);
    expect(v.has("fantasma")).toBe(false);
  });
});
