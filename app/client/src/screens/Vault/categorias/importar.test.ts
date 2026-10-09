import { describe, expect, it } from "vitest";
import * as Icons from "lucide-react";
import type { CategoriaApi } from "@/lib/api";
import { acharDuplicatas } from "./duplicatas";
import { exportarCsv, linhasDoCsv, lerCsv, planejar } from "./importar";
import { linhasDoModelo, MODELOS } from "./modelos";
import { usoPorCategoria } from "./dados";

const c = (id: string, nome: string, extra: Partial<CategoriaApi> = {}): CategoriaApi => ({ id, nome, tipo: "saida", icone: null, cor: "#fff", padrao: false, espaco: "pessoal", ...extra });

describe("exportar e importar", () => {
  const cats = [c("f", "Funcionários", { icone: "Users", cor: "#f29a9f" }), c("s", "Salários, brutos", { pai_id: "f", arquivada: true }), c("r", "Renda", { tipo: "entrada" })];
  it("exporta mães primeiro, com aspas quando precisa, e o CSV volta igual", () => {
    const csv = exportarCsv(cats);
    expect(csv).toContain('"Salários, brutos",saida,Funcionários,,#fff,sim');
    const { linhas, erros } = linhasDoCsv(csv);
    expect(erros).toEqual([]);
    expect(linhas.map((l) => [l.nome, l.mae ?? null])).toEqual([["Funcionários", null], ["Renda", null], ["Salários, brutos", "Funcionários"]]);
  });
  it("lê ponto e vírgula, tipos em português e arquivo sem cabeçalho", () => {
    const { linhas, erros } = linhasDoCsv("Mercado;despesa;Alimentação\nSalário;receita;\nXis;banana;");
    expect(linhas.map((l) => [l.nome, l.tipo, l.mae ?? null])).toEqual([["Mercado", "saida", "Alimentação"], ["Salário", "entrada", null]]);
    expect(erros[0]!.motivo).toContain("banana");
  });
  it("lerCsv respeita aspas com quebra de linha e aspas duplas", () => {
    expect(lerCsv('a,"b ""x"" c"\n"d\ne",f')).toEqual([["a", 'b "x" c'], ["d\ne", "f"]]);
  });
});

describe("planejar", () => {
  const existentes = [c("f", "Funcionários"), c("s", "Salários", { pai_id: "f" })];
  it("ignora o que já existe sob a mesma mãe, cria a mãe que falta antes das filhas e aceita o mesmo nome sob outra mãe", () => {
    const plano = planejar([
      { nome: "salarios", tipo: "saida", mae: "FUNCIONARIOS" },
      { nome: "Benefícios", tipo: "saida", mae: "Funcionários" },
      { nome: "Aluguel", tipo: "saida", mae: "Moradia" },
      { nome: "Salários", tipo: "saida", mae: "Moradia" },
    ], existentes);
    expect(plano.ignoradas.map((i) => i.nome)).toEqual(["salarios"]);
    expect(plano.criar.map((l) => `${l.mae ?? "-"}/${l.nome}`)).toEqual(["-/Moradia", "Funcionários/Benefícios", "Moradia/Aluguel", "Moradia/Salários"]);
  });
  it("recusa subcategoria de subcategoria e repetidas no arquivo", () => {
    const plano = planejar([
      { nome: "Tributos", tipo: "saida", mae: "Salários" },
      { nome: "Casa", tipo: "saida" }, { nome: "casa", tipo: "saida" },
    ], existentes);
    expect(plano.criar.map((l) => l.nome)).toEqual(["Casa"]);
    expect(plano.ignoradas).toHaveLength(2);
  });
});

describe("modelos", () => {
  it("todo ícone dos modelos existe e as subcategorias herdam tipo e cor da mãe", () => {
    const mapa = Icons as unknown as Record<string, unknown>;
    for (const m of MODELOS) {
      for (const g of m.grupos) expect(mapa[g.icone], `${m.id}/${g.nome}: ${g.icone}`).toBeTruthy();
      const linhas = linhasDoModelo(m);
      expect(planejar(linhas, []).ignoradas).toEqual([]);
      for (const l of linhas.filter((x) => x.mae)) expect(l.tipo).toBe(m.grupos.find((g) => g.nome === l.mae)!.tipo);
    }
  });
});

describe("duplicatas", () => {
  const cats = [c("a", "Impostos e Taxas"), c("b", "impostos  e taxas"), c("x", "Outros", { pai_id: "m1" }), c("y", "Outros", { pai_id: "m2" }), c("m1", "Moradia"), c("m2", "Transporte"), c("z", "Alimentação"), c("w", "Alimentacao", { arquivada: true })];
  it("agrupa nomes quase iguais, escolhe a mais usada e ignora arquivadas e 'Outros' de mães diferentes", () => {
    const usos = usoPorCategoria([{ categoria_id: "b", tipo: "saida", valor_centavos: 1, data: "2026-01-01" }]);
    const g = acharDuplicatas(cats, usos);
    expect(g).toHaveLength(1);
    expect(g[0]!.membros.map((m) => m.id).sort()).toEqual(["a", "b"]);
    expect(g[0]!.principal.id).toBe("b");
    expect(acharDuplicatas(cats, usos, new Set([g[0]!.chave]))).toEqual([]);
  });
});
