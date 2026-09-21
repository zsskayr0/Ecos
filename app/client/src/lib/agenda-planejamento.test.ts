import { describe, expect, it } from "vitest";
import type { TarefaResumo } from "@/lib/api";
import { FILTRO_PADRAO, agruparPorDia, capacidadeDoDia, cargaDoDia, comPrazoEm, entradasDaTarefa, formatarHoras, situacaoDaCarga, tagsDasTarefas, tarefasSemData } from "./agenda-planejamento";

function tarefa(p: Partial<TarefaResumo> = {}): TarefaResumo {
  return {
    id: "t1", caminho_arquivo: "Tarefas/a.md", titulo: "Tarefa", status: "pendente", scheduled_at: null, duration_min: 60, due_date: null, espaco: "pessoal",
    criado_em: "2026-09-01T10:00:00Z", prioridade: "media", criado_por: null, criado_por_nome: null, ...p,
  };
}
const DIAS = ["2026-09-21", "2026-09-22", "2026-09-23"];

describe("onde a tarefa cai", () => {
  it("só prazo: uma marca de prazo no dia do prazo, que pesa na carga", () => {
    expect(entradasDaTarefa(tarefa({ due_date: "2026-09-21" }))).toMatchObject([{ tipo: "prazo", dia: "2026-09-21", contaNaCarga: true, comPrazo: false }]);
  });
  it("só bloco: o dia LOCAL (22:30 em Brasília ainda é o mesmo dia)", () => {
    expect(entradasDaTarefa(tarefa({ scheduled_at: "2026-09-23T01:30:00Z" }))).toMatchObject([{ tipo: "bloco", dia: "2026-09-22", inicioMin: 22 * 60 + 30 }]);
  });
  it("bloco e prazo no mesmo dia: um card só, com a marca de prazo", () => {
    const e = entradasDaTarefa(tarefa({ scheduled_at: "2026-09-22T13:00:00Z", due_date: "2026-09-22" }));
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ tipo: "bloco", comPrazo: true });
  });
  it("bloco num dia e prazo em outro: aparece nos dois, mas pesa só no dia do bloco", () => {
    const e = entradasDaTarefa(tarefa({ scheduled_at: "2026-09-21T13:00:00Z", due_date: "2026-09-23" }));
    expect(e.map((x) => [x.tipo, x.dia, x.contaNaCarga])).toEqual([["bloco", "2026-09-21", true], ["prazo", "2026-09-23", false]]);
  });
  it("sem data nenhuma: fora do calendário", () => {
    expect(entradasDaTarefa(tarefa())).toEqual([]);
  });
});

describe("ordem dentro do dia", () => {
  it("prioridade (alta, média, baixa), depois a mais longa, depois o título", () => {
    const lista = [
      tarefa({ id: "a", titulo: "Baixa longa", prioridade: "baixa", duration_min: 240, due_date: "2026-09-21" }),
      tarefa({ id: "b", titulo: "Média curta", prioridade: "media", duration_min: 30, due_date: "2026-09-21" }),
      tarefa({ id: "c", titulo: "Alta curta", prioridade: "alta", duration_min: 15, due_date: "2026-09-21" }),
      tarefa({ id: "d", titulo: "Média longa", prioridade: "media", duration_min: 120, due_date: "2026-09-21" }),
      tarefa({ id: "e", titulo: "Alta longa", prioridade: "alta", duration_min: 90, due_date: "2026-09-21" }),
      tarefa({ id: "f", titulo: "Alta sem estimativa", prioridade: "alta", duration_min: null, due_date: "2026-09-21" }),
    ];
    const ids = agruparPorDia(lista, DIAS, FILTRO_PADRAO).get("2026-09-21")!.map((e) => e.tarefa.id);
    expect(ids).toEqual(["e", "c", "f", "d", "b", "a"]);
  });
  it("todo dia visível tem uma lista, mesmo vazia; entradas fora do período são ignoradas", () => {
    const mapa = agruparPorDia([tarefa({ due_date: "2026-10-30" })], DIAS, FILTRO_PADRAO);
    expect([...mapa.keys()]).toEqual(DIAS);
    expect([...mapa.values()].every((l) => l.length === 0)).toBe(true);
  });
});

describe("carga do dia", () => {
  const dia = (ps: Partial<TarefaResumo>[]) => agruparPorDia(ps.map((p, i) => tarefa({ id: `t${i}`, due_date: "2026-09-21", ...p })), DIAS, { ...FILTRO_PADRAO, mostrarConcluidas: true }).get("2026-09-21")!;
  it("soma duration_min das pendentes", () => {
    expect(cargaDoDia(dia([{ duration_min: 300 }, { duration_min: 330 }]))).toEqual({ minutos: 630, semEstimativa: 0 });
  });
  it("tarefa sem estimativa não entra na soma: é contada à parte", () => {
    expect(cargaDoDia(dia([{ duration_min: 60 }, { duration_min: null }, { duration_min: 0 }]))).toEqual({ minutos: 60, semEstimativa: 2 });
  });
  it("concluída não pesa, mesmo visível", () => {
    expect(cargaDoDia(dia([{ duration_min: 60 }, { duration_min: 120, status: "concluida" }]))).toEqual({ minutos: 60, semEstimativa: 0 });
  });
  it("a marca de prazo de quem já pesa em outro dia não pesa de novo", () => {
    const mapa = agruparPorDia([tarefa({ scheduled_at: "2026-09-21T13:00:00Z", due_date: "2026-09-23", duration_min: 120 })], DIAS, FILTRO_PADRAO);
    expect(cargaDoDia(mapa.get("2026-09-21")!).minutos).toBe(120);
    expect(cargaDoDia(mapa.get("2026-09-23")!).minutos).toBe(0);
  });
});

describe("situação da carga e formatação", () => {
  it("vermelho só quando excede; igual à capacidade cabe", () => {
    expect(situacaoDaCarga(630, 480)).toBe("sobrecarregado");
    expect(situacaoDaCarga(480, 480)).toBe("ok");
    expect(situacaoDaCarga(300, 480)).toBe("ok");
  });
  it("sem Rotina/capacidade: não julga", () => {
    expect(situacaoDaCarga(999, null)).toBe("sem-capacidade");
  });
  it("com Rotina, dia de capacidade 0 que recebeu trabalho é sobrecarga", () => {
    expect(situacaoDaCarga(60, 0)).toBe("sobrecarregado");
    expect(situacaoDaCarga(0, 0)).toBe("ok");
  });
  it("formata horas com vírgula", () => {
    expect(formatarHoras(630)).toBe("10,5 h");
    expect(formatarHoras(480)).toBe("8 h");
    expect(formatarHoras(300)).toBe("5 h");
    expect(formatarHoras(45)).toBe("45 min");
    expect(formatarHoras(0)).toBe("0 min");
  });
  it("capacidade do dia vem do dia da semana (2026-09-21 é segunda)", () => {
    const porDia = new Map([[1, 480], [0, 0]]);
    expect(capacidadeDoDia("2026-09-21", porDia)).toBe(480);
    expect(capacidadeDoDia("2026-09-20", porDia)).toBe(0);
    expect(capacidadeDoDia("2026-09-22", porDia)).toBeNull();
  });
});

describe("filtros", () => {
  const lista = [
    tarefa({ id: "a", due_date: "2026-09-21", status: "concluida" }),
    tarefa({ id: "b", due_date: "2026-09-21", prioridade: "alta", tags: ["casa"] }),
    tarefa({ id: "c", due_date: "2026-09-21", prioridade: "baixa", tags: ["trabalho"], espaco: "equipe" }),
  ];
  const ids = (f: Partial<typeof FILTRO_PADRAO>) => agruparPorDia(lista, DIAS, { ...FILTRO_PADRAO, ...f }).get("2026-09-21")!.map((e) => e.tarefa.id).sort();
  it("esconde concluídas por padrão, e mostra quando pedido", () => {
    expect(ids({})).toEqual(["b", "c"]);
    expect(ids({ mostrarConcluidas: true })).toEqual(["a", "b", "c"]);
  });
  it("por prioridade, tag e espaço", () => {
    expect(ids({ prioridade: "alta" })).toEqual(["b"]);
    expect(ids({ tag: "trabalho" })).toEqual(["c"]);
    expect(ids({ espaco: "equipe" })).toEqual(["c"]);
  });
  it("tags disponíveis, sem repetição e em ordem", () => {
    expect(tagsDasTarefas([...lista, tarefa({ tags: ["casa", "ana"] })])).toEqual(["ana", "casa", "trabalho"]);
  });
});

describe("painel de tarefas sem data", () => {
  it("só pendentes sem prazo e sem bloco, alta primeiro", () => {
    const lista = [
      tarefa({ id: "com-prazo", due_date: "2026-09-21" }),
      tarefa({ id: "com-bloco", scheduled_at: "2026-09-21T13:00:00Z" }),
      tarefa({ id: "feita", status: "concluida" }),
      tarefa({ id: "baixa", prioridade: "baixa" }),
      tarefa({ id: "alta", prioridade: "alta" }),
    ];
    expect(tarefasSemData(lista, { prioridade: null, tag: null }).map((t) => t.id)).toEqual(["alta", "baixa"]);
  });
  it("respeita prioridade e tag", () => {
    const lista = [tarefa({ id: "a", prioridade: "alta", tags: ["x"] }), tarefa({ id: "b", prioridade: "baixa", tags: ["x"] })];
    expect(tarefasSemData(lista, { prioridade: "baixa", tag: "x" }).map((t) => t.id)).toEqual(["b"]);
    expect(tarefasSemData(lista, { prioridade: null, tag: "y" })).toEqual([]);
  });
});

describe("mover para um dia", () => {
  it("muda só o prazo: o bloco de tempo (scheduled_at) não é tocado", () => {
    const original = tarefa({ scheduled_at: "2026-09-21T13:00:00Z", due_date: "2026-09-21" });
    const nova = comPrazoEm(original, "2026-09-23");
    expect(nova).toMatchObject({ due_date: "2026-09-23", scheduled_at: "2026-09-21T13:00:00Z" });
    expect(original.due_date).toBe("2026-09-21");
  });
});
