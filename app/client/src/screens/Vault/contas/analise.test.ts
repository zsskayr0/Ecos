import { describe, expect, it } from "vitest";
import { centavosBR, centavosParaCampo, resumir, serieSaldo, somarSaidasPor, variacao, type Tx } from "./analise";

let n = 0;
const tx = (tipo: "entrada" | "saida", valor: number, data: string, extra: Partial<Tx> = {}): Tx => ({ id: `t${n++}`, tipo, valor_centavos: valor, data, status: "efetivada", categoria_id: null, conta_id: "c1", forma_pagamento: null, descricao: "x", ...extra });

describe("centavosBR", () => {
  it("aceita milhar, vírgula, negativo, zero e vazio", () => {
    expect(centavosBR("1.234,56")).toBe(123456);
    expect(centavosBR("R$ 50")).toBe(5000);
    expect(centavosBR("-50,5")).toBe(-5050);
    expect(centavosBR("0")).toBe(0);
    expect(centavosBR("")).toBe(0);
  });
  it("recusa lixo", () => {
    expect(centavosBR("abc")).toBeNull();
    expect(centavosBR("1,234")).toBeNull();
    expect(centavosBR("12.34")).toBeNull();
  });
  it("ida e volta com o campo", () => {
    expect(centavosParaCampo(-5050)).toBe("-50,50");
    expect(centavosParaCampo(0)).toBe("");
    expect(centavosBR(centavosParaCampo(123456))).toBe(123456);
  });
});

describe("resumir", () => {
  const txs = [tx("entrada", 100000, "2026-09-05"), tx("saida", 30000, "2026-09-10"), tx("saida", 10000, "2026-09-12"), tx("saida", 99999, "2026-09-13", { status: "pendente" }), tx("saida", 5000, "2026-08-31")];
  it("soma só efetivadas dentro do período e separa pendentes", () => {
    const r = resumir(txs, "2026-09-01", "2026-09-30");
    expect(r).toMatchObject({ entradas: 100000, saidas: 40000, resultado: 60000, lancamentos: 3, ticketSaida: 20000, pendentesSaida: 99999, pendentesEntrada: 0 });
    expect(r.taxaEconomia).toBe(60);
    expect(r.maiorSaida?.valor_centavos).toBe(30000);
    expect(r.mediaDiariaSaida).toBe(1333);
  });
  it("sem entradas não inventa taxa de economia", () => {
    expect(resumir([tx("saida", 100, "2026-09-02")], "2026-09-01", "2026-09-30").taxaEconomia).toBeNull();
  });
});

describe("variacao", () => {
  it("compara com o anterior e some sem base", () => {
    expect(variacao(150, 100)).toBe(50);
    expect(variacao(50, 100)).toBe(-50);
    expect(variacao(10, 0)).toBeNull();
  });
});

describe("serieSaldo", () => {
  it("parte do saldo atual menos o que veio depois do início e acumula por dia", () => {
    // Saldo atual R$ 1.200; em setembro entraram 1.000 e saíram 300 (a pendente não conta): o saldo no dia 1º era 1.200 − 700 = 500.
    const txs = [tx("entrada", 100000, "2026-09-05"), tx("saida", 30000, "2026-09-10"), tx("saida", 7000, "2026-09-10", { status: "pendente" })];
    const s = serieSaldo(txs, 100000 + 20000, "2026-09-01", "2026-09-30");
    expect(s).toHaveLength(30);
    expect(s[0]).toMatchObject({ rotulo: "01", saldo: 50000 });
    expect(s[4]).toMatchObject({ rotulo: "05", entradas: 100000, saldo: 150000 });
    expect(s[9]).toMatchObject({ rotulo: "10", saidas: 30000, saldo: 120000 });
    expect(s[29]!.saldo).toBe(120000);
  });
  it("em períodos longos agrupa por mês", () => {
    const s = serieSaldo([tx("entrada", 1000, "2026-03-15")], 1000, "2026-01-01", "2026-12-31");
    expect(s).toHaveLength(12);
    expect(s[2]).toMatchObject({ rotulo: "Mar/26", saldo: 1000 });
    expect(s[0]!.saldo).toBe(0);
  });
});

describe("somarSaidasPor", () => {
  it("agrupa saídas efetivadas do período", () => {
    const r = somarSaidasPor([tx("saida", 100, "2026-09-02", { forma_pagamento: "pix" }), tx("saida", 300, "2026-09-03", { forma_pagamento: "cartao" }), tx("entrada", 999, "2026-09-03"), tx("saida", 50, "2026-10-03")], "2026-09-01", "2026-09-30", (t) => t.forma_pagamento);
    expect(r).toEqual([{ chave: "cartao", valor: 300 }, { chave: "pix", valor: 100 }]);
  });
});
