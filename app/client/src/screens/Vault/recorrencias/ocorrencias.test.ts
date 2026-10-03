import { describe, expect, it } from "vitest";
import type { OcorrenciaRecorrente, RecorrenciaApi } from "@/lib/api";
import { baldesDoPeriodo, centavosDoCampo, centavosParaCampo, filtrarPorTipo, montarLinhas, rotuloDaRegra, rotuloFrequencia, totaisPorBalde } from "./ocorrencias";

const regra = (extra: Partial<RecorrenciaApi> = {}): RecorrenciaApi => ({
  id: "r1", tipo: "saida", descricao: "Aluguel", valor_centavos: 150000, categoria_id: null, conta_id: null, beneficiario_id: null,
  forma_pagamento: null, tipo_recorrencia: "fixa", frequencia: "mensal", intervalo: 1, dia_vencimento: null, data_inicio: "2026-01-10",
  data_fim: null, total_parcelas: null, parcelas_geradas: 0, efetivadas: 0, observacoes: null, espaco: "pessoal", ativa: true,
  criado_em: "", atualizado_em: "", ...extra,
});
const oc = (extra: Partial<OcorrenciaRecorrente> = {}): OcorrenciaRecorrente => ({
  recorrencia_id: "r1", data: "2026-10-10", parcela: null, transacao_id: null, status: null, valor_centavos: 150000, data_lancamento: null, ...extra,
});

describe("montarLinhas", () => {
  it("casa ocorrência com regra, marca efetivada e ordena por data", () => {
    const linhas = montarLinhas([regra()], [oc({ data: "2026-10-20" }), oc({ data: "2026-10-05", status: "efetivada", transacao_id: "t" })]);
    expect(linhas.map((l) => l.data)).toEqual(["2026-10-05", "2026-10-20"]);
    expect(linhas.map((l) => l.efetivada)).toEqual([true, false]);
  });
  it("trata lançamento pendente como pendente e guarda a data reagendada", () => {
    const [l] = montarLinhas([regra()], [oc({ status: "pendente", transacao_id: "t", data_lancamento: "2026-10-12" })]);
    expect(l!.efetivada).toBe(false);
    expect(l!.reagendadaPara).toBe("2026-10-12");
  });
  it("ignora ocorrência de regra desconhecida", () => {
    expect(montarLinhas([regra()], [oc({ recorrencia_id: "outra" })])).toEqual([]);
  });
});

describe("filtrarPorTipo", () => {
  it("separa receitas e despesas", () => {
    const linhas = montarLinhas([regra(), regra({ id: "r2", tipo: "entrada" })], [oc(), oc({ recorrencia_id: "r2" })]);
    expect(filtrarPorTipo(linhas, "entrada")).toHaveLength(1);
    expect(filtrarPorTipo(linhas, "saida")).toHaveLength(1);
    expect(filtrarPorTipo(linhas, "todas")).toHaveLength(2);
  });
});

describe("baldesDoPeriodo", () => {
  it("mês: um balde por dia", () => {
    const b = baldesDoPeriodo({ kind: "month", year: 2026, month: 2 }, "2026-02-01", "2026-02-28");
    expect(b).toHaveLength(28);
    expect(b[0]).toEqual({ rotulo: "01", de: "2026-02-01", ate: "2026-02-01" });
  });
  it("ano: um balde por mês", () => {
    const b = baldesDoPeriodo({ kind: "year", year: 2026 }, "2026-01-01", "2026-12-31");
    expect(b.map((x) => x.rotulo).slice(0, 2)).toEqual(["Jan", "Fev"]);
    expect(b).toHaveLength(12);
  });
  it("intervalo longo vira mês a mês, cortando as pontas", () => {
    const b = baldesDoPeriodo({ kind: "range", from: "2026-01-15", to: "2026-04-10" }, "2026-01-15", "2026-04-10");
    expect(b).toHaveLength(4);
    expect(b[0]!.de).toBe("2026-01-15");
    expect(b[3]!.ate).toBe("2026-04-10");
  });
});

describe("totaisPorBalde", () => {
  it("soma por dia usando o valor real do lançamento e o dia reagendado", () => {
    const linhas = montarLinhas(
      [regra(), regra({ id: "r2", tipo: "entrada" })],
      [oc({ data: "2026-10-02", valor_centavos: 40000, status: "efetivada", transacao_id: "t", data_lancamento: "2026-10-03" }), oc({ recorrencia_id: "r2", data: "2026-10-03", valor_centavos: 90000 })],
    );
    const baldes = baldesDoPeriodo({ kind: "month", year: 2026, month: 10 }, "2026-10-01", "2026-10-31");
    const totais = totaisPorBalde(linhas, baldes);
    expect(totais[1]).toMatchObject({ entradas: 0, saidas: 0 });
    expect(totais[2]).toMatchObject({ entradas: 90000, saidas: 40000 });
  });
});

describe("rótulos e valores", () => {
  it("descreve frequência e parcela", () => {
    expect(rotuloFrequencia({ frequencia: "mensal", intervalo: 1 })).toBe("mensal");
    expect(rotuloFrequencia({ frequencia: "semanal", intervalo: 2 })).toBe("a cada 2 semanas");
    const [fixa] = montarLinhas([regra()], [oc()]);
    expect(rotuloDaRegra(fixa!)).toBe("Fixa · mensal");
    const [parc] = montarLinhas([regra({ tipo_recorrencia: "parcelada", total_parcelas: 12 })], [oc({ parcela: 3 })]);
    expect(rotuloDaRegra(parc!)).toBe("Parcela 3/12");
  });
  it("lê valores em formato brasileiro", () => {
    expect(centavosDoCampo("1.234,56")).toBe(123456);
    expect(centavosDoCampo("12")).toBe(1200);
    expect(centavosDoCampo("12,5")).toBe(1250);
    expect(centavosDoCampo("R$ 59,90")).toBe(5990);
    expect(centavosDoCampo("0")).toBeNull();
    expect(centavosDoCampo("abc")).toBeNull();
    expect(centavosDoCampo("1,234")).toBeNull();
  });
  it("formata o campo de valor", () => {
    expect(centavosParaCampo(123456)).toBe("1.234,56");
  });
});
