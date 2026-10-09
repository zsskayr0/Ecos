import { describe, expect, it } from "vitest";
import type { CategoriaApi } from "@/lib/api";
import { montarFamilias, treemap, usoDaFamilia, usoPorCategoria } from "./dados";

const c = (id: string, nome: string, extra: Partial<CategoriaApi> = {}): CategoriaApi => ({ id, nome, tipo: "saida", icone: null, cor: "#fff", padrao: false, espaco: "pessoal", ...extra });
const cats = [c("f", "Funcionários"), c("s", "Salários", { pai_id: "f" }), c("b", "Benefícios", { pai_id: "f" }), c("m", "Moradia"), c("r", "Renda", { tipo: "entrada" })];
const lancs = [
  { categoria_id: "s", tipo: "saida" as const, valor_centavos: 1000, data: "2026-10-02" },
  { categoria_id: "s", tipo: "saida" as const, valor_centavos: 500, data: "2026-10-05" },
  { categoria_id: "b", tipo: "saida" as const, valor_centavos: 200, data: "2026-10-01" },
  { categoria_id: "m", tipo: "saida" as const, valor_centavos: 1200, data: "2026-10-03" },
  { categoria_id: "r", tipo: "entrada" as const, valor_centavos: 9000, data: "2026-10-04" },
  { categoria_id: null, tipo: "saida" as const, valor_centavos: 99, data: "2026-10-04" },
];

describe("uso das categorias", () => {
  const usos = usoPorCategoria(lancs);
  it("conta lançamentos e volumes por categoria e ignora os sem categoria", () => {
    expect(usos.get("s")).toEqual({ count: 2, entradas: 0, saidas: 1500, volume: 1500, ultimo: "2026-10-05" });
    expect(usos.get("r")?.entradas).toBe(9000);
    expect(usos.size).toBe(4);
  });
  it("a família soma a mãe e as filhas", () => {
    const [f] = montarFamilias(cats, usos, "manual", { busca: "", tipo: "todas" });
    expect(usoDaFamilia(f!, usos)).toMatchObject({ count: 3, saidas: 1700, ultimo: "2026-10-05" });
  });
  it("ordena por uso e por volume (mãe pela família, filhas pelo próprio uso)", () => {
    const usada = montarFamilias(cats, usos, "usadas", { busca: "", tipo: "todas" });
    expect(usada.map((x) => x.mae.id)).toEqual(["f", "m", "r"]);
    expect(usada[0]!.filhas.map((x) => x.id)).toEqual(["s", "b"]);
    expect(montarFamilias(cats, usos, "volume", { busca: "", tipo: "todas" }).map((x) => x.mae.id)).toEqual(["r", "f", "m"]);
    expect(montarFamilias(cats, usos, "nome-desc", { busca: "", tipo: "todas" }).map((x) => x.mae.id)).toEqual(["r", "m", "f"]);
  });
  it("busca acha a filha pelo nome (a mãe vem só com ela) e pelo nome da mãe (vem com todas)", () => {
    const porFilha = montarFamilias(cats, usos, "manual", { busca: "salario", tipo: "todas" });
    expect(porFilha.map((x) => [x.mae.id, x.filhas.map((y) => y.id)])).toEqual([["f", ["s"]]]);
    const porMae = montarFamilias(cats, usos, "manual", { busca: "funcionarios", tipo: "todas" });
    expect(porMae[0]!.filhas).toHaveLength(2);
    expect(montarFamilias(cats, usos, "manual", { busca: "", tipo: "entrada" }).map((x) => x.mae.id)).toEqual(["r"]);
  });
});

describe("treemap", () => {
  it("ocupa a área toda, sem sobrepor e proporcional ao valor", () => {
    const blocos = treemap([{ id: "a", valor: 50 }, { id: "b", valor: 30 }, { id: "c", valor: 20 }, { id: "z", valor: 0 }], 0, 0, 100, 60);
    expect(blocos.map((b) => b.id).sort()).toEqual(["a", "b", "c"]);
    expect(blocos.reduce((s, b) => s + b.w * b.h, 0)).toBeCloseTo(6000, 3);
    const a = blocos.find((b) => b.id === "a")!;
    expect((a.w * a.h) / 6000).toBeCloseTo(0.5, 3);
  });
  it("sem valores não devolve blocos", () => {
    expect(treemap([], 0, 0, 10, 10)).toEqual([]);
  });
});
