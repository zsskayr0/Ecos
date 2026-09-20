import { describe, expect, it } from "vitest";
import { expandir, lerExdates, lerRrule } from "./recorrencia";

const L = (a: number, m: number, d: number, h = 10, mi = 0) => new Date(a, m - 1, d, h, mi);
const dias = (datas: Date[]) => datas.map((d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
const regra = (r: string) => lerRrule(r)!;

describe("lerRrule", () => {
  it("lê as regras que o Google gera, inclusive WKST", () => {
    expect(regra("RRULE:FREQ=WEEKLY;WKST=SU;INTERVAL=2;BYDAY=MO")).toMatchObject({ freq: "WEEKLY", intervalo: 2, diasSemana: [1], wkst: 0, count: null, ate: null });
    expect(regra("RRULE:FREQ=YEARLY")).toMatchObject({ freq: "YEARLY", intervalo: 1, wkst: 1 });
    expect(regra("FREQ=DAILY;COUNT=3")).toMatchObject({ freq: "DAILY", count: 3 });
  });

  it.each([
    "RRULE:FREQ=MONTHLY;BYDAY=2MO",
    "RRULE:FREQ=MONTHLY;BYMONTHDAY=15",
    "RRULE:FREQ=YEARLY;BYSETPOS=1;BYDAY=MO",
    "RRULE:FREQ=WEEKLY;BYDAY=XX",
    "RRULE:FREQ=DAILY;COUNT=2;UNTIL=20261231",
    "RRULE:FREQ=HOURLY",
    "RRULE:INTERVAL=2",
    "RRULE:FREQ=DAILY;INTERVAL=0",
    "RRULE:FREQ=DAILY;UNTIL=lixo",
    "lixo",
  ])("não expande o que não sabe: %s", (r) => expect(lerRrule(r)).toBeNull());
});

describe("expandir", () => {
  it("quinzenal na segunda com WKST=SU: uma segunda sim, outra não", () => {
    const r = expandir(L(2026, 9, 14), regra("RRULE:FREQ=WEEKLY;WKST=SU;INTERVAL=2;BYDAY=MO"), L(2026, 9, 1, 0), L(2026, 11, 1, 0));
    expect(dias(r)).toEqual(["2026-09-14", "2026-09-28", "2026-10-12", "2026-10-26"]);
    expect(r.every((d) => d.getHours() === 10 && d.getMinutes() === 0)).toBe(true);
  });

  it("semanal com dois dias e intervalo 1", () => {
    const r = expandir(L(2026, 9, 14), regra("RRULE:FREQ=WEEKLY;BYDAY=MO,WE"), L(2026, 9, 14, 0), L(2026, 9, 29, 0));
    expect(dias(r)).toEqual(["2026-09-14", "2026-09-16", "2026-09-21", "2026-09-23", "2026-09-28"]);
  });

  it("não devolve dias da primeira semana anteriores ao início", () => {
    // Começa numa quarta; BYDAY=MO,WE: a segunda daquela semana é anterior ao início.
    const r = expandir(L(2026, 9, 16), regra("RRULE:FREQ=WEEKLY;BYDAY=MO,WE"), L(2026, 9, 1, 0), L(2026, 9, 24, 0));
    expect(dias(r)).toEqual(["2026-09-16", "2026-09-21", "2026-09-23"]);
  });

  it("diária com intervalo e COUNT", () => {
    expect(dias(expandir(L(2026, 9, 1), regra("RRULE:FREQ=DAILY;INTERVAL=3;COUNT=4"), L(2026, 8, 1, 0), L(2026, 12, 1, 0)))).toEqual(["2026-09-01", "2026-09-04", "2026-09-07", "2026-09-10"]);
  });

  it("COUNT conta desde o início da série, não desde a janela", () => {
    // 5 ocorrências no total: só as duas últimas caem na janela.
    const r = expandir(L(2026, 9, 1), regra("RRULE:FREQ=DAILY;COUNT=5"), L(2026, 9, 4, 0), L(2026, 9, 30, 0));
    expect(dias(r)).toEqual(["2026-09-04", "2026-09-05"]);
  });

  it("UNTIL só com data vale o dia inteiro; com data e hora em UTC vale o instante", () => {
    expect(dias(expandir(L(2026, 9, 1), regra("RRULE:FREQ=DAILY;UNTIL=20260903"), L(2026, 9, 1, 0), L(2026, 9, 30, 0)))).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
    const r = expandir(L(2026, 9, 1), regra("RRULE:FREQ=DAILY;UNTIL=20260902T000000Z"), L(2026, 8, 30, 0), L(2026, 9, 30, 0));
    expect(r.length).toBeLessThanOrEqual(2);
  });

  it("anual (aniversário) salta direto para perto da janela", () => {
    const r = expandir(L(1990, 5, 10, 0), regra("RRULE:FREQ=YEARLY"), L(2026, 5, 1, 0), L(2026, 6, 1, 0));
    expect(dias(r)).toEqual(["2026-05-10"]);
  });

  it("mensal pula os meses sem o dia (31) e anual pula 29/02 fora de bissexto", () => {
    expect(dias(expandir(L(2026, 1, 31), regra("RRULE:FREQ=MONTHLY"), L(2026, 1, 1, 0), L(2026, 6, 1, 0)))).toEqual(["2026-01-31", "2026-03-31", "2026-05-31"]);
    expect(dias(expandir(L(2024, 2, 29), regra("RRULE:FREQ=YEARLY"), L(2024, 1, 1, 0), L(2029, 1, 1, 0)))).toEqual(["2024-02-29", "2028-02-29"]);
  });

  it("ocorrência que começou antes da janela mas ainda está rolando entra; a que já acabou não", () => {
    const tresHoras = 3 * 3_600_000;
    const r = expandir(L(2026, 9, 1, 22), regra("RRULE:FREQ=DAILY"), L(2026, 9, 3, 0), L(2026, 9, 4, 0), tresHoras);
    expect(dias(r)).toEqual(["2026-09-02", "2026-09-03"]); // a de 02/09 22:00 vai até 03/09 01:00
  });

  it("respeita o limite máximo e não trava com regra que nunca produz datas", () => {
    expect(expandir(L(2026, 1, 1), regra("RRULE:FREQ=DAILY"), L(2026, 1, 1, 0), L(2030, 1, 1, 0), 0, 10)).toHaveLength(10);
    // 30/02 não existe nunca, mas a regra mensal a partir de 31/01 acha 31/03: aqui só garantimos que termina.
    expect(() => expandir(L(2026, 1, 31), regra("RRULE:FREQ=YEARLY;INTERVAL=1"), L(2026, 1, 1, 0), L(2027, 1, 1, 0))).not.toThrow();
  });
});

describe("lerExdates", () => {
  it("lê UTC, hora local (com ou sem TZID), só data e listas separadas por vírgula", () => {
    const datas = lerExdates([
      "RRULE:FREQ=WEEKLY", // não é EXDATE
      "EXDATE:20261012T130000Z,20261019T130000Z",
      "EXDATE;TZID=America/Sao_Paulo:20261026T100000",
      "EXDATE;VALUE=DATE:20261102",
    ]);
    expect(datas.map((d) => d.toISOString())).toEqual([
      "2026-10-12T13:00:00.000Z",
      "2026-10-19T13:00:00.000Z",
      new Date(2026, 9, 26, 10).toISOString(),
      new Date(2026, 10, 2).toISOString(),
    ]);
  });

  it("ignora valores que não entende em vez de quebrar", () => {
    expect(lerExdates(["EXDATE:lixo", "EXDATE:"])).toEqual([]);
  });
});
