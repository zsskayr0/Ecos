import { describe, expect, it } from "vitest";
import type { FeedItem, Nota, Tarefa } from "@/lib/types";
import { ESTADO_VAZIO, estadoInicial, filtrar, filtrosAtivos, normalizarBusca, type EstadoFiltros } from "./modelo";

const tarefa = (id: string, titulo: string, extra: Partial<Tarefa> = {}): Tarefa => ({
  tipo: "tarefa", id, titulo, status: "pendente", scheduledAt: null, durationMin: 5, dueDate: null, espaco: "pessoal", dono: { id: "u1", nome: "Diogo" },
  encaixadaNaAgenda: false, prioridade: "baixa", atualizadoEm: "2026-09-20T10:00:00Z", criadoEm: "2026-09-01T10:00:00Z", pasta: null, tags: [], ...extra,
});
const nota = (id: string, titulo: string, extra: Partial<Nota> = {}): Nota => ({
  tipo: "nota", id, titulo, preview: "", modo: "texto", tags: [], pastaId: null, espaco: "pessoal", dono: { id: "u1", nome: "Diogo" }, criadoEm: "2026-09-01T10:00:00Z",
  atualizadoEm: "2026-09-20T10:00:00Z", ultimaRevisaoEm: null, contagemLinksEntrada: 0, motivoRanking: "frescor" as Nota["motivoRanking"], ...extra,
});
const com = (busca: string, extra: Partial<EstadoFiltros> = {}): EstadoFiltros => ({ ...ESTADO_VAZIO, busca, ...extra });
const titulos = (itens: FeedItem[]) => itens.map((i) => i.titulo);

const ITENS: FeedItem[] = [
  tarefa("1", "Relatório mensal", { pasta: "Trabalho", tags: ["financeiro"] }),
  tarefa("2", "Comprar pão", { pasta: "Casa", tags: ["mercado"] }),
  tarefa("3", "Revisar relatório do projeto", { status: "concluida", pasta: "Trabalho" }),
  tarefa("4", "Ligar para a Ana", { dono: { id: "u2", nome: "Mariana" } }),
  nota("5", "Ideias", { preview: "rascunho da apresentação", corpo: "slides sobre orçamento" }),
];

describe("normalizarBusca", () => {
  it("tira acento, maiúscula e espaços das pontas", () => {
    expect(normalizarBusca("  Relatório MENSAL ")).toBe("relatorio mensal");
    expect(normalizarBusca("Ação")).toBe("acao");
  });
});

describe("filtrar com busca", () => {
  it("sem texto (ou só espaços) não filtra nada", () => {
    expect(filtrar(ITENS, com(""))).toHaveLength(5);
    expect(filtrar(ITENS, com("   "))).toHaveLength(5);
  });

  it("acha sem diferenciar acento nem maiúscula", () => {
    expect(titulos(filtrar(ITENS, com("relatorio")))).toEqual(["Relatório mensal", "Revisar relatório do projeto"]);
    expect(titulos(filtrar(ITENS, com("RELATÓRIO")))).toEqual(["Relatório mensal", "Revisar relatório do projeto"]);
  });

  it("vários termos: todos precisam aparecer, em qualquer ordem", () => {
    expect(titulos(filtrar(ITENS, com("mensal relatorio")))).toEqual(["Relatório mensal"]);
    expect(filtrar(ITENS, com("relatorio pao"))).toEqual([]);
  });

  it("procura também em tags, pasta, dono e (em notas) no texto", () => {
    expect(titulos(filtrar(ITENS, com("mercado")))).toEqual(["Comprar pão"]); // tag
    expect(titulos(filtrar(ITENS, com("casa")))).toEqual(["Comprar pão"]); // pasta
    expect(titulos(filtrar(ITENS, com("mariana")))).toEqual(["Ligar para a Ana"]); // dono
    expect(titulos(filtrar(ITENS, com("orcamento")))).toEqual(["Ideias"]); // corpo da nota
    expect(titulos(filtrar(ITENS, com("rascunho")))).toEqual(["Ideias"]); // preview da nota
  });

  it("vale junto com os outros filtros (estreita o que eles já deixaram passar)", () => {
    expect(titulos(filtrar(ITENS, com("relatorio", { status: "concluida" })))).toEqual(["Revisar relatório do projeto"]);
    expect(titulos(filtrar(ITENS, com("relatorio", { pastas: ["Casa"] })))).toEqual([]);
    expect(titulos(filtrar(ITENS, com("relatorio", { status: "pendente" })))).toEqual(["Relatório mensal"]);
  });

  it("estado salvo antes da busca existir (sem o campo) continua funcionando", () => {
    const antigo = { ...ESTADO_VAZIO } as Partial<EstadoFiltros>;
    delete antigo.busca;
    expect(filtrar(ITENS, antigo as EstadoFiltros)).toHaveLength(5);
  });
});

describe("filtrosAtivos", () => {
  it("a busca conta como um filtro ativo (e assim aparece o 'Limpar')", () => {
    expect(filtrosAtivos(estadoInicial(true), true)).toBe(0);
    expect(filtrosAtivos({ ...estadoInicial(true), busca: "x" }, true)).toBe(1);
    expect(filtrosAtivos({ ...estadoInicial(true), busca: "   " }, true)).toBe(0);
  });
});
