import { describe, expect, it } from "vitest";
import type { Evento } from "@/lib/api";
import { agruparPorDia, chaveDia, deInputData, deInputLocal, deslocarAncora, formatarDuracao, intervaloDoPeriodo, larguraRelativa, paraInputData, paraInputLocal } from "./eventos";

function evento(id: string, inicio: string): Evento {
  return { id, titulo: id, inicio, fim: inicio, dia_inteiro: false, fuso: null, local: null, categoria_id: null, categoria: null, visibilidade: "privado", rrule: null, espaco: "pessoal", origem_google: false, sync_pendente: false, criado_em: inicio, atualizado_em: inicio, tarefas: [], notas: [] };
}

describe("intervaloDoPeriodo", () => {
  it("semana vai de domingo a domingo, a partir de qualquer dia", () => {
    const { de, ate } = intervaloDoPeriodo("semana", new Date(2026, 8, 23, 15, 30)); // quarta 23/09/2026
    expect([de.getFullYear(), de.getMonth(), de.getDate(), de.getHours()]).toEqual([2026, 8, 20, 0]);
    expect([ate.getMonth(), ate.getDate()]).toEqual([8, 27]);
  });

  it("mês vai do dia 1 ao dia 1 do mês seguinte, inclusive na virada do ano", () => {
    const { de, ate } = intervaloDoPeriodo("mes", new Date(2026, 11, 15));
    expect([de.getFullYear(), de.getMonth(), de.getDate()]).toEqual([2026, 11, 1]);
    expect([ate.getFullYear(), ate.getMonth(), ate.getDate()]).toEqual([2027, 0, 1]);
  });
});

describe("deslocarAncora", () => {
  it("semana anda 7 dias", () => {
    const d = deslocarAncora("semana", new Date(2026, 8, 20), 1);
    expect([d.getMonth(), d.getDate()]).toEqual([8, 27]);
  });

  it("mês anterior a partir do dia 31 não pula um mês", () => {
    const d = deslocarAncora("mes", new Date(2026, 2, 31), -1); // 31/03 -> fevereiro
    expect(d.getMonth()).toBe(1);
  });
});

describe("formatarDuracao", () => {
  it.each([[0, "0 min"], [45, "45 min"], [60, "1h"], [150, "2h 30min"], [-5, "0 min"]])("%i -> %s", (min, texto) => {
    expect(formatarDuracao(min)).toBe(texto);
  });
});

describe("agruparPorDia", () => {
  it("agrupa pelo dia local, ordena dias e horários", () => {
    const a = evento("a", new Date(2026, 8, 22, 10).toISOString());
    const b = evento("b", new Date(2026, 8, 21, 16).toISOString());
    const c = evento("c", new Date(2026, 8, 21, 9).toISOString());
    const grupos = agruparPorDia([a, b, c]);
    expect(grupos.map((g) => g.dia)).toEqual(["2026-09-21", "2026-09-22"]);
    expect(grupos[0].eventos.map((e) => e.id)).toEqual(["c", "b"]);
  });
});

describe("conversão de datas locais", () => {
  it("datetime-local faz ida e volta sem mudar o instante", () => {
    const iso = new Date(2026, 8, 21, 13, 45).toISOString();
    expect(paraInputLocal(iso)).toBe("2026-09-21T13:45");
    expect(deInputLocal("2026-09-21T13:45")).toBe(iso);
  });

  it("dia inteiro: início na meia-noite local e fim no dia seguinte", () => {
    expect(paraInputData(deInputData("2026-09-21"))).toBe("2026-09-21");
    expect(chaveDia(deInputData("2026-09-21", 1))).toBe("2026-09-22");
  });
});

describe("larguraRelativa", () => {
  it("o maior ocupa 100%, os pequenos nunca somem e zero total não quebra", () => {
    expect(larguraRelativa(100, 100)).toBe(100);
    expect(larguraRelativa(50, 100)).toBe(50);
    expect(larguraRelativa(1, 1000)).toBe(2);
    expect(larguraRelativa(10, 0)).toBe(0);
  });
});
